export const presets = {
  performance: { scale: 1, megapixels: 4, contrast: 100, brightness: 100 },
  balanced: { scale: 2, megapixels: 12, contrast: 100, brightness: 100 },
  sharp: { scale: 3, megapixels: 20, contrast: 105, brightness: 100 },
};
export function normalizeQuality(value = {}) {
  const limits = { scale: [1, 3], megapixels: [4, 24], contrast: [75, 150], brightness: [75, 125] };
  return Object.fromEntries(Object.entries(limits).map(([key, [min, max]]) => {
    const n = value?.[key];
    return [key, Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : presets.balanced[key]];
  }));
}
const storageKey = "notecomplete-quality-v1";
export function loadQuality() {
  try { return normalizeQuality(JSON.parse(localStorage.getItem(storageKey))); }
  catch { return { ...presets.balanced }; }
}
// Fast zoom sharpening: zoomed PDF pages keep a fit-to-window raster and draw only what is on
// screen at full resolution (app.js drawDetail), seconds sooner on phones and tablets than a
// whole page at the zoomed size. Off by default: panning redraws that part each time it stops.
const detailKey = "notecomplete-zoom-detail-v1";
export function loadZoomDetail() {
  try { return localStorage.getItem(detailKey) === "1"; }
  catch { return false; }
}
export function qualitySettings(onApply) {
  const dialog = document.getElementById("qualityDialog");
  const form = dialog.querySelector("form");
  let current = loadQuality(), detail = loadZoomDetail();
  const read = () => normalizeQuality(Object.fromEntries(Object.keys(current).map(key => [key, Number(form.elements[key].value)])));
  function fill(value) {
    for (const [key, n] of Object.entries(value)) form.elements[key].value = n;
    update();
  }
  function update() {
    const value = read();
    for (const [key, n] of Object.entries(value)) dialog.querySelector(`[data-value="${key}"]`).textContent = n + (key === "scale" ? "×" : key === "megapixels" ? " MP" : "%");
    for (const button of dialog.querySelectorAll("[data-preset]")) button.setAttribute("aria-pressed", String(JSON.stringify(value) === JSON.stringify(presets[button.dataset.preset])));
    dialog.querySelector(".quality-sample").style.filter = `contrast(${value.contrast}%) brightness(${value.brightness}%)`;
  }
  document.getElementById("qualityOpen").onclick = () => { fill(current); form.elements.zoomDetail.checked = detail; dialog.showModal(); };
  dialog.querySelector("[data-cancel]").onclick = () => dialog.close();
  for (const button of dialog.querySelectorAll("[data-preset]")) button.onclick = () => fill(presets[button.dataset.preset]);
  form.oninput = update;
  form.onsubmit = event => {
    event.preventDefault();
    const next = read(), nextDetail = form.elements.zoomDetail.checked;
    const rasterChanged = next.scale !== current.scale || next.megapixels !== current.megapixels || nextDetail !== detail;
    current = next;
    detail = nextDetail;
    try {
      localStorage.setItem(storageKey, JSON.stringify(current));
      localStorage.setItem(detailKey, detail ? "1" : "");
    } catch { /* Session settings still work without storage. */ }
    onApply(current, rasterChanged, detail);
    dialog.close();
  };
  onApply(current, false, detail);
}
