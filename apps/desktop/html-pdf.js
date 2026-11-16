// Hidden Chromium HTML -> paginated A4 vector PDF + [data-tape-answer] box measurement.

const A4_PT = [595.2756, 841.8898];
const UNITS_PER_POINT = 11 / 6;
export const A4_UNITS = [A4_PT[0] * UNITS_PER_POINT, A4_PT[1] * UNITS_PER_POINT];

export const PAGINATE_AND_MEASURE_SCRIPT = `(() => {
  const root = document.querySelector('.exam-flow');
  const host = document.querySelector('.exam-pages') || document.body;
  if (root && host) {
    const createPage = () => {
      const p = document.createElement('section');
      p.className = 'exam-page';
      host.appendChild(p);
      return p;
    };
    const blocks = Array.from(root.children);
    root.remove();
    let page = createPage();
    const maxH = () => page.clientHeight || 1122;
    const over = () => page.scrollHeight > maxH() + 1;
    const limit = () => {
      const r = page.getBoundingClientRect();
      const pad = parseFloat(getComputedStyle(page).paddingBottom) || 0;
      return r.top + maxH() - pad;
    };
    // Same splitting as the reader's paginateAndMeasureDom (exam-pdf.js): only these are
    // split, between their parts, and the rest goes first on the next page.
    const SPLITTABLE = '.prob-card, .key, .key-sum, .key-steps, p.sp, .writing-lines, .solve-steps-box, .solve-part-ans, .theory-box';
    const splitToFit = (el, bottom) => {
      if (!el.matches || !el.matches(SPLITTABLE)) return null;
      const kids = Array.from(el.children);
      let i = kids.findIndex((k) => k.getBoundingClientRect().bottom > bottom + 0.5);
      if (i < 0) return null;
      const rest = el.cloneNode(false);
      rest.classList.add('split-cont');
      rest.removeAttribute('id');
      // The part across the page bottom is split inside when it starts with room left
      // (always for the first part, or nothing would stay); otherwise it moves whole.
      const top = kids[i].getBoundingClientRect().top;
      const inner = (i === 0 || bottom - top > 48) ? splitToFit(kids[i], bottom) : null;
      if (inner) { rest.appendChild(inner); i += 1; }
      else if (i === 0) return null;
      for (const k of kids.slice(i)) rest.appendChild(k);
      return rest;
    };
    for (let b = 0; b < blocks.length; b++) {
      const block = blocks[b];
      if (block.classList && block.classList.contains('page-break')) {
        if (page.children.length > 0) page = createPage();
        continue;
      }
      page.appendChild(block);
      if (!over()) continue;
      const alone = page.children.length === 1;
      const room = limit() - block.getBoundingClientRect().top;
      if (!alone && (block.getBoundingClientRect().height <= maxH() * 0.9 || room < maxH() * 0.2)) {
        block.remove();
        page = createPage();
        page.appendChild(block);
        if (!over()) continue;
      }
      const rest = splitToFit(block, limit());
      if (rest && block.children.length) blocks.splice(b + 1, 0, rest);
      else if (rest) { block.remove(); blocks.splice(b + 1, 0, rest); }
      page = createPage();
    }
    const pages = Array.from(host.querySelectorAll('.exam-page'));
    if (pages.length > 1 && pages[pages.length - 1].children.length === 0) {
      pages[pages.length - 1].remove();
    }
  }
  const pages = Array.from(document.querySelectorAll('.exam-page'));
  const tapes = [];
  pages.forEach((pageEl, pageIndex) => {
    const pr = pageEl.getBoundingClientRect();
    if (pr.width <= 0 || pr.height <= 0) return;
    pageEl.querySelectorAll('[data-tape-answer]').forEach((box) => {
      const r = box.getBoundingClientRect();
      if (r.width <= 1 || r.height <= 1) return;
      const top = Math.max(0, r.top - pr.top);
      const bottom = Math.min(pr.height, r.bottom - pr.top);
      const left = Math.max(0, r.left - pr.left);
      const right = Math.min(pr.width, r.right - pr.left);
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
  return { pageCount: pages.length, tapes };
})()`;

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

export async function renderHtmlToPdfWithTapes({ BrowserWindow, html, timeoutMs = 25000 }) {
  if (typeof BrowserWindow !== 'function') throw Error('Desktop PDF renderer unavailable.');
  const win = new BrowserWindow({
    show: false,
    width: 794,
    height: 1123,
    useContentSize: true,
    backgroundColor: '#ffffff',
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      javascript: true,
    },
  });
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(Error('Timed out rendering exam PDF.')), timeoutMs);
  });
  try {
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', (event, targetUrl) => {
      if (!String(targetUrl).startsWith('data:text/html')) event.preventDefault();
    });
    const url = `data:text/html;charset=utf-8,${encodeURIComponent(String(html || ''))}`;
    await Promise.race([win.webContents.loadURL(url), timeout]);
    const measured = await Promise.race([
      win.webContents.executeJavaScript(PAGINATE_AND_MEASURE_SCRIPT, true),
      timeout,
    ]);
    const pdfBytes = await Promise.race([
      win.webContents.printToPDF({
        printBackground: true,
        preferCSSPageSize: true,
        margins: { top: 0, bottom: 0, left: 0, right: 0 },
      }),
      timeout,
    ]);
    const count = Math.max(1, Number(measured?.pageCount) || 1);
    const sizes = Array.from({ length: count }, () => [...A4_UNITS]);
    return {
      pdf: new Uint8Array(pdfBytes),
      pageCount: count,
      sizes,
      tapes: tapeLinesFromNormalized(measured?.tapes, sizes),
    };
  } finally {
    clearTimeout(timer);
    if (!win.isDestroyed()) win.destroy();
  }
}
