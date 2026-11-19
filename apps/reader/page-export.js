// Export pages as they are shown: every page as one PDF (the Rust core binds
// the pages, drawn here as JPEGs, see page_pdf.rs), the current page as an
// image in a chosen format, or the current page as SVG, plus the Export dialog
// and menu wiring.
import { UNITS_PER_POINT } from './insert-pages.js';

export const IMAGE_TYPES = [
  { id: 'jpeg', label: 'JPEG', mime: 'image/jpeg', ext: 'jpg', quality: 0.88, hint: 'small, photos and scans' },
  { id: 'webp', label: 'WebP', mime: 'image/webp', ext: 'webp', quality: 0.85, hint: 'smallest' },
  { id: 'png', label: 'PNG', mime: 'image/png', ext: 'png', hint: 'lossless, larger' },
];
const PAGE_WIDTH = 1800; // pixels per drawn page (about 220 dpi on A4)

// JPEG pages packed one after another, with the layout the core reads.
export function packPages(pages) {
  const total = pages.reduce((n, p) => n + p.bytes.length, 0), data = new Uint8Array(total), layout = [];
  let offset = 0;
  for (const p of pages) {
    data.set(p.bytes, offset);
    layout.push({ offset, length: p.bytes.length, widthPx: p.widthPx, heightPx: p.heightPx, widthPt: p.widthPt, heightPt: p.heightPt });
    offset += p.bytes.length;
  }
  return { data, layout: JSON.stringify(layout) };
}

// The page's SVG to save as a file, as it is in the note: the paper and the PDF inside it.
export async function pageSvg(p, { pdfImage, backgroundPlacement, chinese = null } = {}) {
  const svg = p.render.firstElementChild.cloneNode(true);
  if (p.render.dataset.paper) {
    svg.querySelector('[data-background] > rect')?.setAttribute('fill', p.render.dataset.paper);
    svg.style.isolation = 'isolate';
  }
  // Pinyin over Chinese as the Export dialog says, and the font for it (chinese/).
  if (chinese) {
    const ruby = chinese.ruby();
    if (ruby && !svg.querySelector('.zh-ruby')) await chinese.rubySvg(svg, { force: true }).catch(() => {});
    if (!ruby) for (const g of svg.querySelectorAll('.zh-ruby')) g.remove();
    await chinese.embedFont(svg);
  }
  // Fast zoom sharpening's on-screen part is for the window, not the file.
  for (const detail of svg.querySelectorAll('.pdf-detail')) detail.remove();
  const raster = p.render.querySelector(':scope > canvas.pdf-raster');
  if (raster && p.view?.pdf_background && pdfImage && backgroundPlacement)
    svg.querySelector('[data-background]')?.append(pdfImage(raster.toDataURL('image/png'), backgroundPlacement(p.view.pdf_background, p.size)));
  // A blob: URL means nothing outside this window.
  for (const image of svg.querySelectorAll('image[href^="blob:"]')) {
    const blob = await (await fetch(image.getAttribute('href'))).blob();
    image.setAttribute('href', await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    }));
  }
  return svg;
}

const blobOf = (canvas, type, quality) => new Promise((resolve, reject) => canvas.toBlob(b => (b ? resolve(b) : reject(Error('This page could not be drawn.'))), type, quality));

export function pageExporter({
  pageCanvas,
  call,
  documentInfo,
  currentPage,
  currentPanel = () => null,
  pdfImage,
  backgroundPlacement,
  chinese = null,
  filename,
  download,
  jobs,
  status,
  save = () => {},
  busy = () => false,
  closeMenus = () => {},
  $ = null,
  doc = typeof document !== 'undefined' ? document : null,
}) {
  // One page drawn as shown (tape included), with its size in points.
  async function draw(index) {
    const { canvas, scale } = await pageCanvas(index, PAGE_WIDTH, { exporting: true });
    const widthPt = canvas.width / scale / UNITS_PER_POINT, heightPt = canvas.height / scale / UNITS_PER_POINT;
    return { canvas, widthPt, heightPt };
  }
  async function pdf() {
    const { pages } = documentInfo();
    if (!pages) return;
    let stopped = false;
    const job = jobs.start('PDF', { pages, batches: 1, kind: 'export', cancel: () => { stopped = true; } });
    try {
      const drawn = [];
      for (let i = 0; i < pages && !stopped; i++) {
        const { canvas, widthPt, heightPt } = await draw(i);
        const bytes = new Uint8Array(await (await blobOf(canvas, 'image/jpeg', 0.88)).arrayBuffer());
        drawn.push({ bytes, widthPx: canvas.width, heightPx: canvas.height, widthPt, heightPt });
        canvas.width = canvas.height = 0;
        job.prepared(i + 1);
      }
      if (stopped) return job.fail('PDF export stopped.');
      job.set(0.95, 'binding the PDF');
      const { data, layout } = packPages(drawn);
      const bytes = await call('jpegPagesPdf', { data, layout, title: documentInfo().title });
      await download(bytes, `${filename()}.pdf`, 'application/pdf');
      job.finish(`PDF exported: ${pages} page${pages === 1 ? '' : 's'}.`);
    } catch (error) {
      job.fail(error.message);
    }
  }
  async function image(typeId) {
    const type = IMAGE_TYPES.find(t => t.id === typeId) || IMAGE_TYPES[0], page = currentPage();
    try {
      const { canvas } = await draw(page);
      const blob = await blobOf(canvas, type.mime, type.quality);
      canvas.width = canvas.height = 0;
      if (blob.type !== type.mime) throw Error(`${type.label} images are not supported here.`);
      await download(blob, `${filename()}-p${page + 1}.${type.ext}`, type.mime);
      status(`Page ${page + 1} exported as ${type.label} (${Math.round(blob.size / 1024)} KB).`);
    } catch (error) { status(error.message, true); }
  }
  async function svg() {
    const p = currentPanel();
    if (p?.pdfReady && !busy()) {
      try {
        const el = await pageSvg(p, { pdfImage, backgroundPlacement, chinese });
        await download(new XMLSerializer().serializeToString(el), `${filename()}-p${currentPage() + 1}.svg`, 'image/svg+xml');
      } catch (e) {
        status(e.message, true);
      }
    }
  }

  const exportRequest = { kind: '', key: '' };
  async function exportRequested(key, opened) {
    const { kind, key: wanted } = exportRequest;
    exportRequest.kind = exportRequest.key = '';
    if (!opened || !kind || wanted !== key || !documentInfo().pages) return;
    if (kind === 'pdf') return $ ? $('exportPdf')?.click() : pdf();
    await save(true, kind);
  }

  if ($) {
    for (const help of doc?.querySelectorAll?.('[data-format-help]') || []) {
      help.onclick = (e) => { e.preventDefault(); e.stopPropagation(); closeMenus(); $('formatsDialog')?.showModal(); };
    }
    if ($('formatsClose')) $('formatsClose').onclick = () => $('formatsDialog')?.close();
    if ($('native')) $('native').onclick = () => save(true);
    if ($('nativeMarkdown')) $('nativeMarkdown').onclick = () => save(true, 'markdown');
    if ($('exportProject')) $('exportProject').onclick = () => save(true, 'project');
    if ($('exportPdf')) $('exportPdf').onclick = () => { closeMenus(); if (!busy()) pdf(); };
    if ($('imageTypes') && doc) {
      $('imageTypes').replaceChildren(...IMAGE_TYPES.map((t) => {
        const b = doc.createElement('button');
        b.type = 'button';
        b.setAttribute('role', 'menuitem');
        b.dataset.palette = `Export page as ${t.label}`;
        const label = doc.createElement('span');
        label.textContent = t.label;
        const hint = doc.createElement('span');
        hint.className = 'muted';
        hint.textContent = t.hint;
        b.append(label, hint);
        b.onclick = () => { closeMenus(); image(t.id); };
        return b;
      }));
    }
    if ($('exportImage')) {
      $('exportImage').onclick = (e) => {
        e.stopPropagation();
        const types = $('imageTypes');
        if (!types) return;
        const open = types.hidden;
        types.hidden = !open;
        $('exportImage').setAttribute('aria-expanded', String(open));
      };
    }
    if ($('svg')) $('svg').onclick = () => svg();
    if ($('exportOpen')) $('exportOpen').onclick = () => { closeMenus(); $('exportDialog')?.showModal(); };
    if ($('exportClose')) $('exportClose').onclick = () => $('exportDialog')?.close();
    $('exportDialog')?.addEventListener?.('click', (e) => {
      const b = e.target?.closest?.('button');
      if (!b || b.id === 'exportImage' || b.id === 'exportClose' || b.hasAttribute?.('data-format-help') || b.hasAttribute?.('data-export-tab') || b.getAttribute?.('role') === 'tab') return;
      setTimeout(() => $('exportDialog')?.close(), 0);
    });
  }

  return { pdf, image, svg, exportRequest, exportRequested };
}
