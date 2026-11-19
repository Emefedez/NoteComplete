// Fonts for typed text beyond the five built in: fonts the person imports (kept on this
// device, offered in the text format bar) and the fonts embedded in a PDF whose text Edit PDF
// turned into text boxes (pdf-edit.js). Both are registered with the document (FontFace)
// under the family name the text box carries, so the core's SVG, which writes that name first
// in its font-family, draws the box in it. Where a font is not registered (another device,
// Noteful on the iPad), the same kind of face is used instead (fontStack).

// Faces for Chinese characters after the Latin ones, so Latin text keeps its font: the bundled
// Noto Sans SC (chinese/fonts.js) first, then the systems'. Mirrored in text.rs (a test checks).
export const CJK_SANS = "'Noto Sans SC', 'PingFang SC', 'Microsoft YaHei', 'Source Han Sans SC', 'Noto Sans CJK SC'";
export const CJK_SERIF = `'Noto Serif CJK SC', 'Songti SC', SimSun, ${CJK_SANS}`;
// A family stack for any font name, mirroring the core's fallback (text.rs text_svg).
export function genericFor(font = "") {
  const lower = font.toLowerCase();
  if (lower.includes("courier") || lower.includes("mono")) return `'Courier New', monospace, ${CJK_SANS}`;
  if ((lower.includes("times") || lower.includes("georgia") || lower.includes("serif") || lower.includes("roman")) && !lower.includes("sans")) return `'Times New Roman', serif, ${CJK_SERIF}`;
  if (["noteworthy", "marker", "chalk", "comic"].some((w) => lower.includes(w))) return `'Comic Neue', 'Comic Sans MS', cursive, ${CJK_SANS}`;
  return `Arial, sans-serif, ${CJK_SANS}`;
}
const quoted = (name) => `'${String(name).replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
export const fontStack = (font) => `${quoted(font)}, ${genericFor(font)}`;

// A name the core accepts for a text box's font (imports.rs TextBox::valid): letters, digits,
// spaces and - _ . only, at most 64 characters.
export function fontName(name, max = 64) {
  return String(name || "").replace(/[^\p{L}\p{N} ._-]+/gu, "-").replace(/\s+/g, " ").trim().slice(0, max).trim() || "Font";
}

// Text boxes from a PDF: the font's own name (subset prefix gone), then " pdf" and the short
// hash of the embedded program, so two PDFs' different subsets of one font never share a name.
export const PDF_FONT = / pdf([0-9a-f]{8})$/;
export const pdfFontName = (base, hash) => `${fontName(base, 50)} pdf${hash}`;
export const pdfFontHash = (font) => PDF_FONT.exec(font || "")?.[1] || null;

const registered = new Map();
// Registers `bytes` (TrueType, OpenType, WOFF) as `family`. Resolves true when the browser
// accepted it, false when it refused it (the stack's other faces are used then).
export function registerFont(family, bytes, descriptors = {}) {
  if (registered.has(family)) return registered.get(family);
  const done = (async () => {
    if (typeof FontFace !== "function" || typeof document === "undefined") return false;
    try {
      const face = new FontFace(family, bytes, descriptors);
      await face.load();
      document.fonts.add(face);
      return true;
    } catch {
      return false;
    }
  })();
  registered.set(family, done);
  return done;
}
export const isRegistered = (family) => registered.has(family);

// Imported fonts, kept in this browser (IndexedDB): { family, name, bytes }.
const DB = "notecomplete-fonts";
function store(mode, work) {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") return resolve(mode === "readonly" ? [] : null);
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore("fonts", { keyPath: "family" });
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result, tx = db.transaction("fonts", mode);
      const result = work(tx.objectStore("fonts"));
      tx.oncomplete = () => { db.close(); resolve(result?.result ?? null); };
      tx.onerror = () => { db.close(); reject(tx.error); };
    };
  });
}
export const importedFonts = () => store("readonly", (s) => s.getAll()).catch(() => []);

// The family name inside a font file (its `name` table: typographic family 16, else family 1),
// or null. TrueType/OpenType only; WOFF is compressed, so its name comes from the file name.
export function familyInFont(bytes) {
  try {
    const v = new DataView(bytes.buffer || bytes, bytes.byteOffset || 0, bytes.byteLength);
    const tables = v.getUint16(4);
    for (let i = 0; i < Math.min(tables, 64); i++) {
      const at = 12 + i * 16;
      if (String.fromCharCode(v.getUint8(at), v.getUint8(at + 1), v.getUint8(at + 2), v.getUint8(at + 3)) !== "name") continue;
      const table = v.getUint32(at + 8), count = v.getUint16(table + 2), strings = table + v.getUint16(table + 4);
      const found = {};
      for (let r = 0; r < count; r++) {
        const rec = table + 6 + r * 12;
        const platform = v.getUint16(rec), id = v.getUint16(rec + 6), length = v.getUint16(rec + 8), offset = v.getUint16(rec + 10);
        if (id !== 1 && id !== 16) continue;
        let text = "";
        if (platform === 3 || platform === 0) for (let k = 0; k + 1 < length; k += 2) text += String.fromCharCode(v.getUint16(strings + offset + k));
        else for (let k = 0; k < length; k++) text += String.fromCharCode(v.getUint8(strings + offset + k));
        if (text.trim()) found[id] = text.trim();
      }
      return found[16] || found[1] || null;
    }
  } catch { /* Not a TrueType or OpenType font. */ }
  return null;
}

// A font file chosen by the person: registered, kept, and its family returned. Throws with a
// message when the browser cannot use it.
export async function importFont(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.byteLength > 30 * 1024 * 1024) throw Error("That font file is too large (over 30 MB).");
  const family = fontName(familyInFont(bytes) || file.name.replace(/\.(ttf|otf|woff2?)$/i, ""));
  registered.delete(family);
  if (!(await registerFont(family, bytes))) throw Error(`${file.name} is not a font this browser can use (TTF, OTF, WOFF or WOFF2).`);
  await store("readwrite", (s) => s.put({ family, name: file.name, bytes })).catch(() => {
    throw Error("The font works now but could not be kept for next time (browser storage is unavailable).");
  });
  return family;
}

// Imported fonts registered at start, so text in them shows as soon as a note opens.
export async function loadImportedFonts() {
  const fonts = await importedFonts();
  await Promise.all(fonts.map((f) => registerFont(f.family, f.bytes)));
  return fonts.map((f) => f.family);
}
