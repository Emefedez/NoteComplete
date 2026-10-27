// Export pages as they are shown: every page as one PDF (the Rust core binds
// the pages, drawn here as JPEGs, see page_pdf.rs) or the current page as an
// image in a chosen format. SVG export stays in app.js.
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

const blobOf = (canvas, type, quality) => new Promise((resolve, reject) => canvas.toBlob(b => (b ? resolve(b) : reject(Error('This page could not be drawn.'))), type, quality));

export function pageExporter({ pageCanvas, call, documentInfo, currentPage, filename, download, jobs, status }) {
  // One page drawn as shown (tape included), with its size in points.
  async function draw(index) {
    const { canvas, scale } = await pageCanvas(index, PAGE_WIDTH);
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
  return { pdf, image };
}
