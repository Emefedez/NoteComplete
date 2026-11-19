// The bundled Chinese font (docs/CHINESE-INPUT.md §6.1–6.2): Noto Sans SC (SIL OFL 1.1) in
// Fontsource's 101 unicode-range slices, declared in vendor/fonts/noto-sans-sc.css
// (tools/build_web.py). The stylesheet is linked only once a note shows Chinese or Chinese mode
// is on, and the browser then fetches only the slices of the characters it draws. A picture of a
// page (an SVG drawn through an <img>) cannot use the document's fonts, so exports embed the
// slices that page needs as data: URLs.

// Han characters (CJK ideographs, extensions and compatibility forms).
export const HAN = /[㐀-䶿一-鿿豈-﫿]|[\ud840-\ud87f][\udc00-\udfff]/;
const CSS_URL = new URL("../vendor/fonts/noto-sans-sc.css", import.meta.url).href;

let linked = null;
// Links the stylesheet once; resolves when it is read (or could not be).
export function ensureChineseFont(doc = globalThis.document) {
  if (linked || !doc?.head) return linked || Promise.resolve();
  const link = doc.createElement("link");
  link.rel = "stylesheet";
  link.href = CSS_URL;
  link.dataset.zhFont = "";
  linked = new Promise((resolve) => { link.onload = link.onerror = () => resolve(); });
  doc.head.append(link);
  return linked;
}
// The font ready for `text`'s characters (measuring them before it arrives would give the
// fallback's widths).
export async function chineseFontReady(text) {
  await ensureChineseFont();
  try { await globalThis.document?.fonts?.load(`16px 'Noto Sans SC'`, wide(text) || "中"); } catch { /* The fallback draws them. */ }
}

// Characters from the CJK blocks on (U+2E80), the only ones a CJK face is used for here.
const wide = (text) => [...new Set(String(text))].filter((c) => c.codePointAt(0) >= 0x2e80).join("");

// The stylesheet's rules: [{url, range, ranges: [[from, to], …]}], `url` resolved against `base`.
export function parseSlices(css, base = CSS_URL) {
  const slices = [];
  for (const [, body] of String(css).matchAll(/@font-face\s*{([^}]*)}/g)) {
    const url = /url\(([^)]+)\)/.exec(body)?.[1]?.replace(/^['"]|['"]$/g, "");
    const range = /unicode-range:\s*([^;]+)/.exec(body)?.[1]?.trim();
    if (!url || !range) continue;
    const ranges = range.split(",").map((r) => r.trim().replace(/^U\+/i, "").split("-").map((h) => parseInt(h, 16))).map(([a, b]) => [a, b ?? a]);
    slices.push({ url: new URL(url, base).href, range, ranges });
  }
  return slices;
}
// The slices holding `text`'s CJK characters, each once.
export function slicesFor(text, slices) {
  const points = [...wide(text)].map((c) => c.codePointAt(0));
  return slices.filter((s) => points.some((p) => s.ranges.some(([a, b]) => p >= a && p <= b)));
}

let sheet = null;
const dataUrls = new Map();
const base64 = (bytes) => {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};
// @font-face rules with the slices `text` needs inside them, or "" (no CJK, or no font here).
export async function embeddedFontCss(text, { fetch: get = globalThis.fetch } = {}) {
  if (!HAN.test(text)) return "";
  try {
    sheet ||= get(CSS_URL).then((r) => (r.ok ? r.text() : "")).then((css) => parseSlices(css)).catch(() => { sheet = null; return []; });
    const rules = await Promise.all(slicesFor(text, await sheet).map(async (slice) => {
      if (!dataUrls.has(slice.url)) dataUrls.set(slice.url, get(slice.url).then(async (r) => (r.ok ? `data:font/woff2;base64,${base64(new Uint8Array(await r.arrayBuffer()))}` : "")).catch(() => ""));
      const url = await dataUrls.get(slice.url);
      if (!url) dataUrls.delete(slice.url);
      return url ? `@font-face{font-family:'Noto Sans SC';font-weight:100 900;src:url(${url}) format('woff2');unicode-range:${slice.range}}` : "";
    }));
    return rules.join("");
  } catch { return ""; }
}
// Puts the font into an SVG that will be drawn as a picture or saved; true when it did.
export async function embedChineseFont(svg) {
  const css = await embeddedFontCss(svg.textContent || "");
  if (!css) return false;
  const style = svg.ownerDocument.createElementNS("http://www.w3.org/2000/svg", "style");
  style.textContent = css;
  style.dataset.zhFont = "";
  svg.prepend(style);
  return true;
}
