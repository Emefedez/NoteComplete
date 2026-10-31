// Export rows in a menu: a label and a few small format buttons in one row
// (Pages as SVG · PDF · IMG▾). A caret button opens its family of formats
// indented under the row, each with a one-word hint. Every exporter hands its
// bytes to download(), which picks the way out for the platform.
//
// <div class="menu-row" role="group" aria-label="Export pages as">
//   <span>Pages as</span>
//   <button id="exportSvg" disabled data-palette="Export page as SVG" title="This page as SVG (vector)">SVG</button>
//   <button id="exportPdf" disabled data-palette="Export pages as PDF" title="Every page as one PDF (runs in the background)">PDF</button>
//   <button id="exportImage" disabled class="has-caret" aria-haspopup="menu" aria-expanded="false" title="This page as an image: choose the format">IMG<span class="caret"></span></button>
// </div>
// <div id="imageTypes" class="menu-sub" role="menu" aria-label="Image format" hidden></div>

export const IMAGE_TYPES = [
  { id: 'jpeg', label: 'JPEG', mime: 'image/jpeg', ext: 'jpg', quality: 0.88, hint: 'small, photos and scans' },
  { id: 'webp', label: 'WebP', mime: 'image/webp', ext: 'webp', quality: 0.85, hint: 'smallest' },
  { id: 'png', label: 'PNG', mime: 'image/png', ext: 'png', hint: 'lossless, larger' },
];

// A caret button and its list under the row. The menu stays open while the list
// is open; choosing an item closes the list and the menu (closeMenus).
export function caretList(button, list, items, { closeMenus, palette = item => item.label }) {
  list.replaceChildren(...items.map(item => {
    const b = document.createElement('button');
    b.type = 'button'; b.setAttribute('role', 'menuitem'); b.dataset.palette = palette(item);
    b.innerHTML = `<span>${item.label}</span><span class="muted">${item.hint || ''}</span>`;
    b.onclick = () => { close(); closeMenus(); item.run(); };
    return b;
  }));
  function close() { list.hidden = true; button.setAttribute('aria-expanded', 'false'); }
  button.onclick = event => {
    event.stopPropagation(); // keep the menu open
    const open = list.hidden;
    list.hidden = !open;
    button.setAttribute('aria-expanded', String(open));
  };
  return { close };
}

// All export buttons are enabled together when there is something to export.
export function enableExports(ids, on) {
  for (const id of ids) { const el = document.getElementById(id); if (el) el.disabled = !on; }
}

// Pages to export from "3-7", "1, 4, 9-12", "all" or "" (the current page), 0-based.
export function parsePages(text, count, current) {
  const t = String(text).trim().toLowerCase();
  if (!t) return [current];
  if (t === 'all') return [...Array(count).keys()];
  const pages = new Set();
  for (const part of t.split(',')) {
    const m = part.trim().match(/^(\d+)(?:\s*[-–]\s*(\d+))?$/);
    if (!m) throw Error(`"${part.trim()}" is not a page or a range.`);
    const a = +m[1], b = m[2] ? +m[2] : a;
    if (a < 1 || b > count || a > b) throw Error(`Pages go from 1 to ${count}.`);
    for (let p = a; p <= b; p++) pages.add(p - 1);
  }
  return [...pages].sort((x, y) => x - y);
}

// An image of a canvas in the asked format; fails instead of silently falling
// back to PNG where the engine can't encode it.
export async function canvasImage(canvas, type) {
  const blob = await new Promise(resolve => canvas.toBlob(resolve, type.mime, type.quality));
  if (!blob || blob.type !== type.mime) throw Error(`${type.label} images are not supported here.`);
  return blob;
}

// The one way out. Desktop shells expose a guarded bridge that writes plain file
// names into the chosen downloads folder; mobile WebViews pass the bytes to the
// native share sheet; browsers download.
export async function download(data, name, type) {
  const blob = data instanceof Blob ? data : new Blob([data], { type });
  if (window.appFiles?.write) {
    const path = await window.appFiles.write(name, new Uint8Array(await blob.arrayBuffer()));
    return { path };
  }
  if (window.ReactNativeWebView) {
    const base64 = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(',')[1]);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
    window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'export', name, mime: blob.type, base64 }));
    return { shared: true };
  }
  const url = URL.createObjectURL(blob), link = document.createElement('a');
  link.href = url; link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return { downloaded: true };
}

// A slow export as a background job with Stop: `jobs` is the app's job chip
// (start(label, { cancel }) → { set(fraction, phase), finish(text), fail(text) }).
export async function exportJob(jobs, label, pages, drawOne, finish) {
  let stopped = false;
  const job = jobs.start(label, { cancel: () => { stopped = true; } });
  try {
    const parts = [];
    for (let i = 0; i < pages.length; i++) {
      if (stopped) return job.fail(`${label} export stopped.`);
      parts.push(await drawOne(pages[i]));
      job.set((i + 1) / (pages.length + 1), `page ${i + 1} of ${pages.length}`);
    }
    job.set(pages.length / (pages.length + 1), 'putting it together');
    job.finish(await finish(parts));
  } catch (error) { job.fail(error.message); }
}
