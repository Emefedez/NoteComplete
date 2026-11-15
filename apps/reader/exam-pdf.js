// Converts exam HTML -> A4 PDF bytes + aligned Noteful Tape specs.
// Uses Electron desktop printToPDF when available, or Web/Android paginated canvas PDF fallback.
import { EXAM_PRINT_CSS } from './exam-html.js';

const A4_PT = [595.2756, 841.8898];
const UNITS_PER_POINT = 11 / 6;
export const A4_UNITS = [A4_PT[0] * UNITS_PER_POINT, A4_PT[1] * UNITS_PER_POINT];

export function tapeLinesFromNormalized(tapes, pageSizesUnits = [], fallbackSize = A4_UNITS) {
  const palette = {
    theory: [0.46, 0.73, 0.94, 1],
    solution: [0.95, 0.77, 0.28, 1],
  };
  return (Array.isArray(tapes) ? tapes : [])
    .filter((t) => Number.isInteger(t?.page) && t.page >= 0 && t.rw > 0 && t.rh > 0)
    .map((t) => {
      const [pw, ph] = pageSizesUnits[t.page] || fallbackSize;
      const padX = 2;
      const padY = 2;
      const x = Math.max(0, t.rx * pw - padX);
      const y = Math.max(0, t.ry * ph - padY);
      return {
        page: t.page,
        x,
        y,
        w: Math.min(pw - x, t.rw * pw + padX * 2),
        h: Math.min(ph - y, t.rh * ph + padY * 2),
        rgba: palette[t.kind] || palette.solution,
      };
    });
}

// Paginates blocks inside `.exam-flow` in a host DOM/document and measures [data-tape-answer] boxes.
export function paginateAndMeasureDom(hostRoot = document) {
  const ownerDoc = hostRoot.ownerDocument || hostRoot;
  const root = hostRoot.querySelector('.exam-flow');
  const host = hostRoot.querySelector('.exam-pages') || (hostRoot === ownerDoc ? ownerDoc.body : hostRoot);
  if (root && host) {
    const createPage = () => {
      const p = ownerDoc.createElement('section');
      p.className = 'exam-page';
      host.appendChild(p);
      return p;
    };
    const blocks = Array.from(root.children);
    root.remove();
    let page = createPage();
    const maxH = () => page.clientHeight || 1122;
    for (const block of blocks) {
      if (block.classList?.contains('page-break')) {
        if (page.children.length > 0) page = createPage();
        continue;
      }
      page.appendChild(block);
      if (page.children.length > 1 && page.scrollHeight > maxH() + 1) {
        block.remove();
        page = createPage();
        page.appendChild(block);
      }
    }
    const pages = Array.from(host.querySelectorAll('.exam-page'));
    if (pages.length > 1 && pages[pages.length - 1].children.length === 0) pages[pages.length - 1].remove();
  }
  const pages = Array.from(hostRoot.querySelectorAll('.exam-page'));
  const tapes = [];
  pages.forEach((pageEl, pageIndex) => {
    const pr = pageEl.getBoundingClientRect();
    if (pr.width <= 0 || pr.height <= 0) return;
    pageEl.querySelectorAll('[data-tape-answer]').forEach((box) => {
      const r = box.getBoundingClientRect();
      if (r.width <= 1 || r.height <= 1) return;
      const left = Math.max(0, r.left - pr.left);
      const top = Math.max(0, r.top - pr.top);
      const right = Math.min(pr.width, r.right - pr.left);
      const bottom = Math.min(pr.height, r.bottom - pr.top);
      if (right - left <= 1 || bottom - top <= 1) return;
      tapes.push({
        page: pageIndex,
        rx: left / pr.width,
        ry: top / pr.height,
        rw: (right - left) / pr.width,
        rh: (bottom - top) / pr.height,
        kind: box.getAttribute('data-tape-answer') || 'solution',
      });
    });
  });
  return { pages, tapes };
}

async function pageElementToJpeg(pageEl, widthPx = 1488, heightPx = 2104) {
  const clone = pageEl.cloneNode(true);
  clone.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');
  const xhtml = new XMLSerializer().serializeToString(clone);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="794" height="1123" viewBox="0 0 794 1123">`
    + `<foreignObject x="0" y="0" width="794" height="1123">`
    + `<div xmlns="http://www.w3.org/1999/xhtml" style="margin:0;padding:0;background:#fff;width:794px;height:1123px;">`
    + `<style>${EXAM_PRINT_CSS}</style>${xhtml}</div></foreignObject></svg>`;
  const img = new Image();
  img.width = widthPx;
  img.height = heightPx;
  const loaded = new Promise((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(Error('SVG foreignObject rasterization failed'));
  });
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  await loaded;
  const canvas = document.createElement('canvas');
  canvas.width = widthPx;
  canvas.height = heightPx;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, widthPx, heightPx);
  ctx.drawImage(img, 0, 0, widthPx, heightPx);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.92));
  return new Uint8Array(await blob.arrayBuffer());
}

async function waitForHostImages(host) {
  const imgs = Array.from(host.querySelectorAll('img'));
  await Promise.all(imgs.map((im) => {
    if (im.complete && im.naturalWidth > 0) return Promise.resolve();
    if (typeof im.decode === 'function') return im.decode().catch(() => {});
    return new Promise((resolve) => {
      im.addEventListener('load', resolve, { once: true });
      im.addEventListener('error', resolve, { once: true });
    });
  }));
}

async function webFallbackPdf(html, title, call) {
  const host = document.createElement('div');
  Object.assign(host.style, {
    position: 'fixed', left: '-10000px', top: '0', width: '794px', visibility: 'hidden', pointerEvents: 'none',
  });
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const styleEl = document.createElement('style');
  styleEl.textContent = EXAM_PRINT_CSS;
  host.append(styleEl);
  for (const child of Array.from(doc.body.children)) {
    if (child.tagName !== 'SCRIPT') host.append(document.importNode(child, true));
  }
  document.body.append(host);
  try {
    await waitForHostImages(host);
    const { pages, tapes } = paginateAndMeasureDom(host);
    const jpegs = [];
    for (const p of pages) {
      jpegs.push(await pageElementToJpeg(p));
    }
    const total = jpegs.reduce((acc, b) => acc + b.length, 0);
    const data = new Uint8Array(total);
    const layout = [];
    let at = 0;
    for (const b of jpegs) {
      data.set(b, at);
      layout.push({ offset: at, length: b.length, width: A4_PT[0], height: A4_PT[1] });
      at += b.length;
    }
    const pdfOut = await call('jpegPagesPdf', {
      data,
      layout: JSON.stringify(layout),
      title: title || 'Exam',
    }, [data.buffer]);
    const pdf = pdfOut instanceof Uint8Array ? pdfOut : new Uint8Array(pdfOut);
    const sizes = pages.map(() => [...A4_UNITS]);
    return { pdf, sizes, pageCount: pages.length, tapes: tapeLinesFromNormalized(tapes, sizes) };
  } finally {
    host.remove();
  }
}

export async function renderExamPdfAndTapes(html, { title = 'Exam', bridge = globalThis.notecompleteFiles, call } = {}) {
  if (typeof bridge?.renderHtmlPdf === 'function') {
    const res = await bridge.renderHtmlPdf(html);
    const pdf = res.pdf instanceof Uint8Array ? res.pdf : new Uint8Array(res.pdf);
    const sizes = res.sizes?.length ? res.sizes : Array.from({ length: res.pageCount || 1 }, () => [...A4_UNITS]);
    return { pdf, sizes, pageCount: sizes.length, tapes: res.tapes || [] };
  }
  return webFallbackPdf(html, title, call);
}
