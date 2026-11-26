// OpenOffice / LibreOffice / Euro-Office (.odt) exporter for the normal NoteComplete editor:
//  - Mode 1 ("blocks"): uses the PDF Move Tool engine (`pdfBlocks` + pdf.js `assignText`)
//    to extract text blocks from every PDF page (plus native note text boxes) and place them
//    as editable <draw:text-box> frames at their EXACT coordinates on each ODT page.
//  - Mode 2 ("visual"): embeds each rendered page (PDF + ink + annotations as shown) at exact
//    page dimensions into an OpenDocument Text (.odt) file.
import { zipFiles } from './zip.js';
import { assignText, rectOnPage, nearestFamily } from './pdf-edit.js';
import { backgroundPlacement } from './pdf-background.js';
import { UNITS_PER_POINT } from './insert-pages.js';
import { icon } from './icons.js';

const encoder = new TextEncoder();
const PAGE_WIDTH_PX = 1600;

export function xmlEscape(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function rgbaToHex(rgba) {
  if (!Array.isArray(rgba) || rgba.length < 3) return '#111111';
  const h = (n) => Math.max(0, Math.min(255, Math.round(Number(n) || 0))).toString(16).padStart(2, '0');
  return `#${h(rgba[0])}${h(rgba[1])}${h(rgba[2])}`;
}

function pt(n) {
  const v = Number(n);
  return `${Number.isFinite(v) ? Math.max(0, v).toFixed(2) : '0.00'}pt`;
}

/**
 * Builds a valid OASIS OpenDocument Text (.odt) archive from structured pages:
 * pages: [{ widthPt, heightPt, backgroundBytes?, blocks?: [{ xPt, yPt, wPt, hPt, fontSizePt, bold, italic, fontFamily, color, align, text }] }]
 */
export function buildOdtBytes({ title = 'NoteComplete Document', pages = [] } = {}) {
  const list = pages.length ? pages : [{ widthPt: 595.28, heightPt: 841.89, blocks: [] }];
  const first = list[0];
  const pageW = pt(first.widthPt || 595.28);
  const pageH = pt(first.heightPt || 841.89);

  const pictures = [];
  const autoStyles = [
    `<style:style style:name="PPageBreak" style:family="paragraph"><style:paragraph-properties fo:break-before="page" fo:margin-top="0pt" fo:margin-bottom="0pt"/></style:style>`,
    `<style:style style:name="PNormal" style:family="paragraph"><style:paragraph-properties fo:margin-top="0pt" fo:margin-bottom="0pt"/></style:style>`,
    `<style:style style:name="BgFrame" style:family="graphic"><style:graphic-properties style:wrap="run-through" style:run-through="background" draw:stroke="none" draw:fill="none" style:horizontal-pos="from-left" style:horizontal-rel="page" style:vertical-pos="from-top" style:vertical-rel="page"/></style:style>`,
    `<style:style style:name="BlockFrame" style:family="graphic"><style:graphic-properties style:wrap="run-through" style:run-through="foreground" draw:stroke="none" draw:fill="none" fo:padding="1pt" style:horizontal-pos="from-left" style:horizontal-rel="page" style:vertical-pos="from-top" style:vertical-rel="page"/></style:style>`,
  ];
  const textStyleMap = new Map();
  function styleForBlock(b) {
    const size = Math.max(6, Math.min(72, Number(b.fontSizePt) || 11)).toFixed(1);
    const weight = b.bold ? 'bold' : 'normal';
    const slant = b.italic ? 'italic' : 'normal';
    const fam = xmlEscape(b.fontFamily || 'Liberation Sans');
    const color = xmlEscape(b.color || '#111111');
    const align = ['center', 'right', 'justify'].includes(b.align) ? b.align : 'left';
    const key = `${size}|${weight}|${slant}|${fam}|${color}|${align}`;
    if (!textStyleMap.has(key)) {
      const name = `PB${textStyleMap.size + 1}`;
      textStyleMap.set(key, name);
      autoStyles.push(
        `<style:style style:name="${name}" style:family="paragraph">`
        + `<style:paragraph-properties fo:text-align="${align}" fo:margin-top="0pt" fo:margin-bottom="2pt" fo:line-height="115%"/>`
        + `<style:text-properties fo:font-family="${fam}" fo:font-size="${size}pt" fo:font-weight="${weight}" fo:font-style="${slant}" fo:color="${color}"/>`
        + `</style:style>`,
      );
    }
    return textStyleMap.get(key);
  }

  const bodyParts = [];
  list.forEach((pg, idx) => {
    const pageNum = idx + 1;
    const pw = pg.widthPt || first.widthPt || 595.28;
    const ph = pg.heightPt || first.heightPt || 841.89;
    const frames = [];

    if (pg.backgroundBytes instanceof Uint8Array && pg.backgroundBytes.length) {
      const picPath = `Pictures/page-${pageNum}.jpg`;
      pictures.push({ name: picPath, bytes: pg.backgroundBytes });
      frames.push(
        `<draw:frame draw:style-name="BgFrame" draw:name="PageBg${pageNum}" text:anchor-type="page" text:anchor-page-number="${pageNum}" svg:x="0pt" svg:y="0pt" svg:width="${pt(pw)}" svg:height="${pt(ph)}" draw:z-index="0">`
        + `<draw:image xlink:href="${picPath}" xlink:type="simple" xlink:show="embed" xlink:actuate="onLoad"/>`
        + `</draw:frame>`,
      );
    }

    const blocks = Array.isArray(pg.blocks) ? pg.blocks : [];
    blocks.forEach((b, bi) => {
      const rawText = String(b.text || '').trim();
      if (!rawText) return;
      const pStyle = styleForBlock(b);
      const lines = rawText.split(/\r?\n/).map((line) => `<text:p text:style-name="${pStyle}">${xmlEscape(line)}</text:p>`).join('');
      const w = Math.max(24, Number(b.wPt) || 120);
      const h = Math.max(14, Number(b.hPt) || 20);
      frames.push(
        `<draw:frame draw:style-name="BlockFrame" draw:name="Block_${pageNum}_${bi + 1}" text:anchor-type="page" text:anchor-page-number="${pageNum}" svg:x="${pt(b.xPt)}" svg:y="${pt(b.yPt)}" svg:width="${pt(w)}" svg:height="${pt(h)}" draw:z-index="${bi + 1}">`
        + `<draw:text-box fo:min-height="${pt(h)}">${lines}</draw:text-box>`
        + `</draw:frame>`,
      );
    });

    if (idx === 0) {
      bodyParts.push(`<text:p text:style-name="PNormal">${frames.join('')}</text:p>`);
    } else {
      bodyParts.push(`<text:p text:style-name="PPageBreak">${frames.join('')}</text:p>`);
    }
  });

  const stylesXml = `<?xml version="1.0" encoding="UTF-8"?>
<office:document-styles xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0" office:version="1.2">
  <office:automatic-styles>
    <style:page-layout style:name="PM1">
      <style:page-layout-properties fo:page-width="${pageW}" fo:page-height="${pageH}" fo:margin-top="0pt" fo:margin-bottom="0pt" fo:margin-left="0pt" fo:margin-right="0pt"/>
    </style:page-layout>
  </office:automatic-styles>
  <office:master-styles>
    <style:master-page style:name="Standard" style:page-layout-name="PM1"/>
  </office:master-styles>
</office:document-styles>`;

  const contentXml = `<?xml version="1.0" encoding="UTF-8"?>
<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0" xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0" xmlns:svg="urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0" xmlns:xlink="http://www.w3.org/1999/xlink" office:version="1.2">
  <office:automatic-styles>${autoStyles.join('')}</office:automatic-styles>
  <office:body>
    <office:text>
      ${bodyParts.join('\n      ')}
    </office:text>
  </office:body>
</office:document-content>`;

  const metaXml = `<?xml version="1.0" encoding="UTF-8"?>
<office:document-meta xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:dc="http://purl.org/dc/elements/1.1/" office:version="1.2">
  <office:meta><dc:title>${xmlEscape(title)}</dc:title></office:meta>
</office:document-meta>`;

  const manifestEntries = [
    '<manifest:file-entry manifest:full-path="/" manifest:media-type="application/vnd.oasis.opendocument.text"/>',
    '<manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/>',
    '<manifest:file-entry manifest:full-path="styles.xml" manifest:media-type="text/xml"/>',
    '<manifest:file-entry manifest:full-path="meta.xml" manifest:media-type="text/xml"/>',
    ...pictures.map((p) => `<manifest:file-entry manifest:full-path="${xmlEscape(p.name)}" manifest:media-type="image/jpeg"/>`),
  ];
  const manifestXml = `<?xml version="1.0" encoding="UTF-8"?>
<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.2">
  ${manifestEntries.join('\n  ')}
</manifest:manifest>`;

  return zipFiles([
    { name: 'mimetype', bytes: encoder.encode('application/vnd.oasis.opendocument.text') },
    { name: 'content.xml', bytes: encoder.encode(contentXml) },
    { name: 'styles.xml', bytes: encoder.encode(stylesXml) },
    { name: 'meta.xml', bytes: encoder.encode(metaXml) },
    { name: 'META-INF/manifest.xml', bytes: encoder.encode(manifestXml) },
    ...pictures,
  ]);
}

const canvasToJpegBytes = (canvas, quality = 0.88) => new Promise((resolve, reject) => {
  canvas.toBlob(async (b) => {
    if (!b) return reject(Error('Could not render page image.'));
    resolve(new Uint8Array(await b.arrayBuffer()));
  }, 'image/jpeg', quality);
});

export function odtExportController({
  call,
  pageCanvas,
  documentInfo,
  getPanels,
  backgrounds,
  filename,
  download,
  openGeneratedFile = null,
  jobs,
  status,
  busy = () => false,
  closeMenus = () => {},
}) {
  let dialog = null;

  function ensureDialog() {
    if (dialog) return dialog;
    dialog = document.createElement('dialog');
    dialog.id = 'odtExportDialog';
    dialog.className = 'ocr-dialog';
    dialog.innerHTML = `
      <div class="exam-dlg-head">
        <h2 id="odtTitle">Convert to OpenOffice / OpenDocument (.odt)</h2>
        <button id="odtCloseX" type="button" class="dlg-close" aria-label="Close"></button>
      </div>
      <p class="muted">Transform this document into an editable <code>.odt</code> file for OpenOffice, LibreOffice or Euro-Office.</p>
      <div class="wizard-provider-list" style="margin: 10px 0;">
        <label class="wizard-provider">
          <input type="radio" name="odtMode" value="blocks" checked />
          <span><strong>PDF Move Tool — Editable text blocks in exact position</strong><span class="wizard-check-hint">Extracts text blocks from PDF pages (and note text boxes) and places them as editable text frames at their exact coordinates on each page.</span></span>
        </label>
        <label class="wizard-provider">
          <input type="radio" name="odtMode" value="visual" />
          <span><strong>Direct visual pages (PDF &amp; ink as shown)</strong><span class="wizard-check-hint">Embeds every page directly at exact dimensions into OpenDocument (.odt), preserving all graphics, PDF layout and ink.</span></span>
        </label>
      </div>
      <label id="odtKeepBgRow" class="wizard-check" style="margin: 0 0 12px;">
        <input id="odtKeepBg" type="checkbox" checked />
        <span><strong>Include page visual background behind text blocks</strong><span class="wizard-check-hint">Uncheck for clean white pages with only the extracted editable text blocks.</span></span>
      </label>
      <p id="odtStatus" class="muted" role="status"></p>
      <div class="ocr-actions">
        <button id="odtCancel" type="button">Cancel</button>
        <button id="odtSaveBtn" type="button" class="primary">Save .odt</button>
        <button id="odtOpenBtn" type="button">Convert &amp; open</button>
      </div>
    `;
    dialog.querySelector('#odtCloseX').append(icon('close'));
    dialog.querySelector('#odtCloseX').onclick = () => dialog.close();
    dialog.querySelector('#odtCancel').onclick = () => dialog.close();
    const syncBgRow = () => {
      const mode = dialog.querySelector('input[name="odtMode"]:checked')?.value || 'blocks';
      dialog.querySelector('#odtKeepBgRow').hidden = mode !== 'blocks';
    };
    for (const r of dialog.querySelectorAll('input[name="odtMode"]')) r.onchange = syncBgRow;
    dialog.querySelector('#odtSaveBtn').onclick = () => runExport({ openAfter: false });
    dialog.querySelector('#odtOpenBtn').onclick = () => runExport({ openAfter: true });
    document.body.append(dialog);
    return dialog;
  }

  async function extractPageBlocks(pageIdx, view) {
    const out = [];
    const bg = view?.pdf_background;
    if (bg && backgrounds) {
      try {
        const [raw, pdf] = await Promise.all([
          call('pdfBlocks', { resource: bg.resource_id, pageIndex: bg.page_index }),
          backgrounds().document(bg.resource_id),
        ]);
        const page = await pdf.getPage(bg.page_index + 1);
        try {
          const viewport = page.getViewport({ scale: 1 });
          const content = await page.getTextContent().catch(() => ({ items: [] }));
          const blocks = assignText(raw.blocks || [], content.items);
          const place = backgroundPlacement(bg, view.size);
          for (const b of blocks) {
            const rect = rectOnPage(b.bbox, viewport.transform, viewport, place);
            const text = (b.lines || []).map((l) => l.text || '').join('\n').trim();
            if (!text) continue;
            const scalePt = (place.height / viewport.height) / UNITS_PER_POINT;
            out.push({
              xPt: rect[0] / UNITS_PER_POINT,
              yPt: rect[1] / UNITS_PER_POINT,
              wPt: Math.max(24, rect[2] / UNITS_PER_POINT + 8),
              hPt: Math.max(14, rect[3] / UNITS_PER_POINT + 6),
              fontSizePt: Math.max(7, Math.min(48, (b.size || 11) * (Number.isFinite(scalePt) && scalePt > 0 ? scalePt : 1))),
              bold: !!b.bold,
              italic: !!b.italic,
              fontFamily: nearestFamily(b),
              color: rgbaToHex(b.rgba),
              align: b.align || 'left',
              text,
            });
          }
        } finally {
          page.cleanup();
        }
      } catch { /* Non-PDF or unreadable PDF blocks: fall back gracefully. */ }
    }
    return out;
  }

  async function runExport({ openAfter = false } = {}) {
    if (busy()) return;
    const { pages: count } = documentInfo();
    if (!count) return;
    const mode = dialog.querySelector('input[name="odtMode"]:checked')?.value || 'blocks';
    const keepBg = mode === 'visual' || Boolean(dialog.querySelector('#odtKeepBg')?.checked);
    const saveBtn = dialog.querySelector('#odtSaveBtn');
    const openBtn = dialog.querySelector('#odtOpenBtn');
    const note = dialog.querySelector('#odtStatus');
    saveBtn.disabled = openBtn.disabled = true;

    let stopped = false;
    const job = jobs?.start?.('OpenOffice (.odt)', { pages: count, batches: 1, kind: 'export', cancel: () => { stopped = true; } });
    try {
      const panels = getPanels?.() || [];
      const odtPages = [];
      let totalBlocks = 0;

      for (let i = 0; i < count; i++) {
        if (stopped) { job?.fail?.('Stopped.'); return; }
        note.textContent = `Processing page ${i + 1} of ${count}…`;
        job?.prepared?.(i + 1);

        const view = panels[i]?.view || await call('view', { page: i }).catch(() => null);
        const size = view?.size || [595.28 * UNITS_PER_POINT, 841.89 * UNITS_PER_POINT];
        let widthPt = size[0] / UNITS_PER_POINT;
        let heightPt = size[1] / UNITS_PER_POINT;
        let backgroundBytes = null;

        if (keepBg) {
          const { canvas, scale } = await pageCanvas(i, PAGE_WIDTH_PX, { exporting: true });
          widthPt = canvas.width / scale / UNITS_PER_POINT;
          heightPt = canvas.height / scale / UNITS_PER_POINT;
          backgroundBytes = await canvasToJpegBytes(canvas, 0.86);
        }

        const blocks = mode === 'blocks' ? await extractPageBlocks(i, view) : [];
        totalBlocks += blocks.length;
        odtPages.push({ widthPt, heightPt, backgroundBytes, blocks });
      }

      if (stopped) { job?.fail?.('Stopped.'); return; }
      const title = filename();
      const bytes = buildOdtBytes({ title, pages: odtPages });
      const outName = `${title}.odt`;
      const outFile = new File([bytes], outName, { type: 'application/vnd.oasis.opendocument.text' });

      if (openAfter && typeof openGeneratedFile === 'function') {
        dialog.close();
        await openGeneratedFile(outFile);
      } else {
        await download(bytes, outName, 'application/vnd.oasis.opendocument.text');
        dialog.close();
      }
      const detail = mode === 'blocks' ? ` (${totalBlocks} editable text blocks)` : '';
      const msg = `Exported ${outName}${detail}.`;
      job?.finish?.(msg);
      status?.(msg);
    } catch (e) {
      note.textContent = e?.message || String(e);
      job?.fail?.(e?.message || String(e));
    } finally {
      saveBtn.disabled = openBtn.disabled = false;
    }
  }

  return {
    open() {
      closeMenus();
      const dlg = ensureDialog();
      dlg.querySelector('#odtStatus').textContent = '';
      dlg.showModal();
    },
  };
}
