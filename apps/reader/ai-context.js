// What the AI sees of a page: an image (tape lifted, since covered answers are
// study material) and the page's text from Find: typed, PDF, OCR and audio.
import { rememberAiFile } from './rich-text.js';
export const SOURCE_NAMES = { text: 'Typed text', pdf: 'PDF text', ocr: 'Recognized handwriting/scan text', audio: 'Lecture transcript', document: 'Text' };

const JSON_ESCAPES = new Set(['"', '\\', '/', 'b', 'f', 'n', 'r', 't']);

function prevNonWsChar(raw, idx) {
  for (let j = idx - 1; j >= 0; j -= 1) {
    if (!/\s/.test(raw[j])) return raw[j];
  }
  return '';
}

function isValidClosingQuote(raw, quoteIdx, couldBeKey) {
  let j = quoteIdx + 1;
  while (j < raw.length && /\s/.test(raw[j])) j += 1;
  if (j >= raw.length) return true;
  const next = raw[j];
  if (next === ':') return couldBeKey;
  if (next === '}' || next === ']') return true;
  if (next !== ',') return false;
  let k = j + 1;
  while (k < raw.length && /\s/.test(raw[k])) k += 1;
  if (k >= raw.length) return true;
  const after = raw[k];
  if (after === '"' || after === '{' || after === '[' || after === '}' || after === ']') return true;
  if (after === '-' || /\d/.test(after)) return /^-?\d/.test(raw.slice(k, k + 3));
  return /^(?:true|false|null)(?=[\s,}\]])/.test(raw.slice(k, k + 6));
}

function repairJsonString(raw) {
  let out = '';
  let inString = false;
  let couldBeKey = false;
  let escaped = false;
  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw[i];
    const code = raw.charCodeAt(i);
    if (inString) {
      if (escaped) {
        escaped = false;
        out += ch;
        continue;
      }
      if (ch === '\\') {
        const next = raw[i + 1];
        const validUnicode = next === 'u' && /^[0-9a-fA-F]{4}$/.test(raw.slice(i + 2, i + 6));
        if (JSON_ESCAPES.has(next) || validUnicode) {
          escaped = true;
          out += ch;
        } else {
          out += '\\\\';
        }
        continue;
      }
      if (ch === '"') {
        if (!isValidClosingQuote(raw, i, couldBeKey)) {
          out += '\\"';
          continue;
        }
        inString = false;
        couldBeKey = false;
        out += ch;
        continue;
      }
      if (ch === '\r') {
        if (raw[i + 1] === '\n') {
          i += 1;
          out += '\\n';
        } else {
          out += '\\r';
        }
        continue;
      }
      if (ch === '\n') { out += '\\n'; continue; }
      if (ch === '\t') { out += '\\t'; continue; }
      if (code < 0x20) {
        out += `\\u${code.toString(16).padStart(4, '0')}`;
        continue;
      }
      out += ch;
      continue;
    }
    if (ch === '"') {
      const prev = prevNonWsChar(raw, i);
      inString = true;
      couldBeKey = prev === '{' || prev === ',';
      out += ch;
      continue;
    }
    if (ch === ',') {
      let j = i + 1;
      while (j < raw.length && /\s/.test(raw[j])) j += 1;
      if (raw[j] === '}' || raw[j] === ']') continue;
    }
    out += ch;
  }
  return out;
}

function tryParseJsonSlice(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    try {
      return JSON.parse(repairJsonString(raw));
    } catch {
      return null;
    }
  }
}

export function jsonFrom(text) {
  const source = String(text ?? '');
  const fence = /```(?:json)?\s*([\s\S]*?)```/gi;
  let match;
  while ((match = fence.exec(source))) {
    const inner = match[1];
    const start = inner.indexOf('{'), end = inner.lastIndexOf('}');
    if (start >= 0 && end > start) {
      const parsed = tryParseJsonSlice(inner.slice(start, end + 1));
      if (parsed !== null) return parsed;
    }
  }
  const start = source.indexOf('{'), end = source.lastIndexOf('}');
  if (start < 0 || end <= start) throw Error('The AI did not return the expected JSON.');
  const slice = source.slice(start, end + 1);
  try {
    return JSON.parse(slice);
  } catch {
    return JSON.parse(repairJsonString(slice));
  }
}

export function saveAiDraft(store, key, draft) {
  if (!store || !key || !draft) return false;
  try {
    const payload = {
      ...draft,
      prompt: String(draft.prompt || '').slice(0, 120000),
      partialText: String(draft.partialText || '').slice(-80000),
      savedAt: draft.savedAt || Date.now(),
    };
    store.setItem(key, JSON.stringify(payload));
    return true;
  } catch {
    try {
      const compact = {
        ...draft,
        prompt: String(draft.prompt || '').slice(0, 32000),
        partialText: String(draft.partialText || '').slice(-32000),
        savedAt: draft.savedAt || Date.now(),
      };
      store.setItem(key, JSON.stringify(compact));
      return true;
    } catch {
      return false;
    }
  }
}

export function loadAiDraft(store, key) {
  if (!store || !key) return null;
  try {
    const raw = store.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

export function clearAiDraft(store, key) {
  if (!store || !key) return;
  try { store.removeItem(key); } catch { /* Optional. */ }
}

export function buildContinuationPrompt({ basePrompt = '', partialText = '', kind = 'exam' } = {}) {
  const partial = String(partialText || '').trim();
  const tail = partial.length > 14000 ? `… [earlier output omitted]\n${partial.slice(-14000)}` : partial;
  if (kind === 'note') {
    return [
      String(basePrompt || '').trim(),
      partial ? [
        'PREVIOUS PARTIAL OUTPUT ALREADY GENERATED (your last run interrupted here — CONTINUE with only the remaining new sections without repeating headings already written):',
        tail,
      ].join('\n\n') : '',
    ].filter(Boolean).join('\n\n');
  }
  return [
    String(basePrompt || '').trim(),
    partial ? [
      'PREVIOUS PARTIAL GENERATION (interrupted before completion):',
      tail,
      'IMPORTANT: Continue from where the partial output stopped. Do NOT repeat problems already written above; produce a complete, valid JSON object matching the exact schema containing the remaining/completed exam problems.',
    ].join('\n\n') : '',
  ].filter(Boolean).join('\n\n');
}

// Extracts any complete problem objects already present in truncated exam JSON output so
// resuming from partial output preserves completed questions seamlessly.
export function extractCompletedObjects(rawText, arrayKey = 'problems') {
  const s = String(rawText || '');
  const out = [];
  const keyRe = new RegExp(`"${arrayKey}"\\s*:\\s*\\[`, 'g');
  let m;
  while ((m = keyRe.exec(s))) {
    let i = m.index + m[0].length;
    while (i < s.length) {
      while (i < s.length && /[\s,]/.test(s[i])) i += 1;
      if (s[i] !== '{') break;
      const objStart = i;
      let depth = 0;
      let inString = false;
      let escaped = false;
      let closed = false;
      for (; i < s.length; i += 1) {
        const ch = s[i];
        if (inString) {
          if (escaped) escaped = false;
          else if (ch === '\\') escaped = true;
          else if (ch === '"') inString = false;
          continue;
        }
        if (ch === '"') inString = true;
        else if (ch === '{') depth += 1;
        else if (ch === '}') {
          depth -= 1;
          if (depth === 0) {
            closed = true;
            i += 1;
            break;
          }
        }
      }
      if (!closed) break;
      const slice = s.slice(objStart, i);
      const parsed = tryParseJsonSlice(slice);
      if (parsed && typeof parsed === 'object') out.push(parsed);
    }
  }
  return out;
}

export function mergePartialExamJson(partialText, continuationText) {
  const next = jsonFrom(continuationText);
  const priorProblems = extractCompletedObjects(partialText, 'problems');
  if (!priorProblems.length) return next;
  const seenPrompts = new Set();
  const norm = (v) => String(v || '').trim().toLowerCase().replace(/\s+/g, ' ');
  const priorSection = {
    heading: 'Recovered Progress',
    badge: 'PART 1',
    badgeKind: 'src',
    intro: 'Problems preserved from interrupted run.',
    theory: '',
    problems: [],
  };
  for (const p of priorProblems) {
    const key = norm(p?.prompt);
    if (!key || seenPrompts.has(key)) continue;
    seenPrompts.add(key);
    priorSection.problems.push(p);
  }
  const nextSections = Array.isArray(next?.sections) ? next.sections : [];
  const filteredNext = nextSections.map((sec) => ({
    ...sec,
    problems: (sec?.problems || []).filter((p) => {
      const key = norm(p?.prompt);
      if (!key || seenPrompts.has(key)) return false;
      seenPrompts.add(key);
      return true;
    }),
  })).filter((s) => s.problems.length);
  const sections = priorSection.problems.length ? [priorSection, ...filteredNext] : nextSections;
  return { ...next, sections };
}

export async function canvasImage(canvas, label, width = 1400) {
  const scale = Math.min(1, width / canvas.width);
  const out = document.createElement('canvas');
  out.width = Math.round(canvas.width * scale);
  out.height = Math.round(canvas.height * scale);
  out.getContext('2d').drawImage(canvas, 0, 0, out.width, out.height);
  try {
    const page = /^page-(\d+)$/i.test(String(label || '')) ? Number(String(label).slice(5)) : undefined;
    rememberAiFile(label, { url: out.toDataURL('image/jpeg', 0.86), label, page });
  } catch { /* Canvas may be mocked in unit tests. */ }
  const blob = await new Promise(resolve => out.toBlob(resolve, 'image/jpeg', 0.86));
  out.width = out.height = 0;
  return { bytes: new Uint8Array(await blob.arrayBuffer()), type: 'image/jpeg', label };
}

export function hasClipboardImage(clipboardData) {
  return [...(clipboardData?.items || [])].some(item => item.kind === 'file' && /^image\/(png|jpe?g|webp|gif)$/i.test(item.type));
}

export async function clipboardImages(clipboardData, readBlob = blob => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result || ''));
  reader.onerror = () => reject(reader.error || Error('Could not read pasted image.'));
  reader.readAsDataURL(blob);
})) {
  const files = [...(clipboardData?.items || [])]
    .filter(item => item.kind === 'file' && /^image\/(png|jpe?g|webp|gif)$/i.test(item.type))
    .map(item => item.getAsFile?.())
    .filter(Boolean);
  const out = [];
  for (const file of files) {
    const url = await readBlob(file);
    if (url) out.push({ url, label: 'a pasted image from the clipboard' });
  }
  return out;
}

// Text documents have sections instead of pages (text-study.js): `unit` names them.
export function textBlock(page, parts, limit = 6000, unit = 'page') {
  const lines = Object.entries(parts).filter(([, v]) => v?.trim()).map(([k, v]) => `${SOURCE_NAMES[k] || k}:\n${v.trim().slice(0, limit)}`);
  return `--- ${unit === 'section' ? 'Section' : 'Page'} ${page + 1} ---\n${lines.join('\n') || (unit === 'section' ? '(empty)' : '(no extracted text; read the image)')}`;
}

// The user's own Markdown notes for the document, capped, as a prompt block.
export function notesBlock(text, limit = 20000) {
  const notes = String(text || '').trim();
  if (!notes) return '';
  const cut = notes.length > limit ? `${notes.slice(0, limit)}\n[… ${notes.length - limit} more characters not included]` : notes;
  return `The student's own Markdown notes for this document (lines like "[p. 3]" tie a section to a page):\n${cut}`;
}
// Page images plus text for a list of display pages; text documents have no
// image (pageCanvas gives null), only their sections' text.
export async function pagesContext(pages, { pageCanvas, pageText, onProgress = () => {}, width = 2200, unit = 'page' }) {
  const images = [], texts = [];
  for (const [n, page] of pages.entries()) {
    onProgress(n, pages.length, page);
    const drawn = await pageCanvas(page, width, { liftTape: true });
    if (drawn?.canvas) {
      images.push(await canvasImage(drawn.canvas, `page-${page + 1}`));
      drawn.canvas.width = drawn.canvas.height = 0;
    }
    texts.push(textBlock(page, await pageText(page), unit === 'section' ? 12000 : 6000, unit));
  }
  return { images, text: texts.join('\n\n') };
}
