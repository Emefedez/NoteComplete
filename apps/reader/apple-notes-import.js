// Apple Notes importer for NoteComplete (pure JS — runs in browser, Electron, and Node):
//  1. Decodes Apple Notes protobuf (ZICNOTEDATA.ZDATA, gzip-decompressed) into clean Markdown.
//  2. Converts Apple Notes HTML exports (iCloud Data & Privacy Takeout, Exporter.app, macOS HTML).
//  3. Parses Apple Notes .zip exports and multi-file/folder exports while preserving folder names.

const textDecoder = new TextDecoder('utf-8', { fatal: false });

export function sanitizeNoteFilename(title, fallback = 'Apple Note') {
  const clean = String(title || '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
  const base = clean || fallback;
  return /\.md$/i.test(base) ? base : `${base}.md`;
}

// ---- Minimal Protobuf wire-format reader (no external dependencies) ----

function readVarint(buf, offset) {
  let result = 0;
  let shift = 0;
  let pos = offset;
  while (pos < buf.length && shift < 53) {
    const b = buf[pos++];
    result += (b & 0x7f) * Math.pow(2, shift);
    if ((b & 0x80) === 0) return { value: result, next: pos };
    shift += 7;
  }
  while (pos < buf.length && (buf[pos] & 0x80) !== 0) pos++;
  if (pos < buf.length) pos++;
  return { value: result, next: pos };
}

function parseProtoFields(buf) {
  const fields = [];
  let pos = 0;
  while (pos < buf.length) {
    const tag = readVarint(buf, pos);
    pos = tag.next;
    const fieldNum = Math.floor(tag.value / 8);
    const wireType = tag.value & 7;
    if (fieldNum === 0) break;
    if (wireType === 0) {
      const v = readVarint(buf, pos);
      pos = v.next;
      fields.push({ fieldNum, wireType, value: v.value });
    } else if (wireType === 1) {
      if (pos + 8 > buf.length) break;
      fields.push({ fieldNum, wireType, value: buf.subarray(pos, pos + 8) });
      pos += 8;
    } else if (wireType === 2) {
      const len = readVarint(buf, pos);
      pos = len.next;
      const end = Math.min(buf.length, pos + len.value);
      fields.push({ fieldNum, wireType, value: buf.subarray(pos, end) });
      pos = end;
    } else if (wireType === 5) {
      if (pos + 4 > buf.length) break;
      fields.push({ fieldNum, wireType, value: buf.subarray(pos, pos + 4) });
      pos += 4;
    } else {
      break;
    }
  }
  return fields;
}

function decodeParagraphStyle(bytes) {
  const out = { styleType: -1, indent: 0, checklist: null, blockquote: false };
  for (const f of parseProtoFields(bytes)) {
    if (f.fieldNum === 1 && f.wireType === 0) out.styleType = f.value;
    else if (f.fieldNum === 4 && f.wireType === 0) out.indent = f.value;
    else if (f.fieldNum === 5 && f.wireType === 2) {
      let done = false;
      for (const cf of parseProtoFields(f.value)) {
        if (cf.fieldNum === 2 && cf.wireType === 0) done = cf.value !== 0;
      }
      out.checklist = { done };
    } else if (f.fieldNum === 8 && f.wireType === 0) {
      out.blockquote = f.value !== 0;
    }
  }
  return out;
}

function decodeAttachmentInfo(bytes) {
  const out = { id: '', uti: '' };
  for (const f of parseProtoFields(bytes)) {
    if (f.fieldNum === 1 && f.wireType === 2) out.id = textDecoder.decode(f.value);
    else if (f.fieldNum === 2 && f.wireType === 2) out.uti = textDecoder.decode(f.value);
  }
  return out;
}

function decodeAttributeRun(bytes) {
  const run = {
    length: 0,
    paragraphStyle: null,
    fontWeight: 0, // 1 = bold, 2 = italic, 3 = bold+italic
    underlined: false,
    strikethrough: false,
    superscript: 0, // 1 = super, -1 (or 0xffffffff / signed) = sub
    link: '',
    attachment: null,
    emphasisStyle: 0, // macOS Sequoia / iOS 18 highlight colors
  };
  for (const f of parseProtoFields(bytes)) {
    if (f.fieldNum === 1 && f.wireType === 0) run.length = f.value;
    else if (f.fieldNum === 2 && f.wireType === 2) run.paragraphStyle = decodeParagraphStyle(f.value);
    else if (f.fieldNum === 5 && f.wireType === 0) run.fontWeight = f.value;
    else if (f.fieldNum === 6 && f.wireType === 0) run.underlined = f.value !== 0;
    else if (f.fieldNum === 7 && f.wireType === 0) run.strikethrough = f.value !== 0;
    else if (f.fieldNum === 8 && f.wireType === 0) run.superscript = f.value > 0x7fffffff ? -1 : f.value;
    else if (f.fieldNum === 9 && f.wireType === 2) run.link = textDecoder.decode(f.value);
    else if (f.fieldNum === 12 && f.wireType === 2) run.attachment = decodeAttachmentInfo(f.value);
    else if (f.fieldNum === 14 && f.wireType === 0) run.emphasisStyle = f.value;
  }
  return run;
}

function formatInlineRun(text, run, attachments) {
  if (!text) return '';
  // Object replacement character (\uFFFC) marks an inline attachment in Apple Notes
  if (text.includes('\uFFFC') && run.attachment) {
    const info = attachments?.[run.attachment.id];
    const uti = run.attachment.uti || info?.uti || '';
    let replacement = '';
    if (info?.markdown) {
      replacement = `\n\n${info.markdown}\n\n`;
    } else if (/inlinetextattachment\.hashtag/i.test(uti) && info?.altText) {
      replacement = info.altText;
    } else if (/inlinetextattachment\.link/i.test(uti) && info?.altText) {
      replacement = `[[${info.altText}]]`;
    } else if (info?.dataUrl) {
      const label = info?.title || info?.filename || 'Image';
      replacement = `![${label}](${info.dataUrl})`;
    } else {
      const label = info?.altText || info?.title || info?.filename || uti || 'Attachment';
      replacement = `[Attachment: ${label}]`;
    }
    text = text.replace(/\uFFFC/g, replacement);
  } else {
    text = text.replace(/\uFFFC/g, '');
  }
  if (!text) return '';

  // Keep leading/trailing whitespace outside emphasis markers so Markdown stays valid
  const lead = text.match(/^\s*/)?.[0] || '';
  const trail = text.match(/\s*$/)?.[0] || '';
  const core = text.slice(lead.length, text.length - trail.length);
  if (!core) return text;

  let formatted = core;
  if (run.fontWeight === 3) formatted = `***${formatted}***`;
  else if (run.fontWeight === 1) formatted = `**${formatted}**`;
  else if (run.fontWeight === 2) formatted = `*${formatted}*`;
  if (run.strikethrough) formatted = `~~${formatted}~~`;
  if (run.emphasisStyle > 0) formatted = `==${formatted}==`;
  if (run.superscript > 0) formatted = `<sup>${formatted}</sup>`;
  else if (run.superscript < 0) formatted = `<sub>${formatted}</sub>`;
  if (run.link) formatted = `[${formatted}](${run.link})`;
  return `${lead}${formatted}${trail}`;
}

/**
 * Decodes an uncompressed Apple Notes CRDT table protobuf (`MergableDataProto`,
 * UTI `com.apple.notes.table`) into a GitHub-Flavored Markdown table.
 * Based on the schema reverse-engineered by apple_cloud_notes_parser & obsidian-importer.
 * @param {Uint8Array} bytes
 * @returns {string}
 */
export function decodeAppleNoteTableProto(bytes) {
  const buf = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || 0);
  if (!buf.length) return '';

  // MergableDataProto (field 2) -> MergableDataObject (field 3) -> MergeableDataObjectData
  let mdo = null;
  for (const f of parseProtoFields(buf)) if (f.fieldNum === 2 && f.wireType === 2) { mdo = f.value; break; }
  let data = null;
  if (mdo) for (const f of parseProtoFields(mdo)) if (f.fieldNum === 3 && f.wireType === 2) { data = f.value; break; }
  if (!data) return '';

  const entries = [];
  const keys = [];
  const types = [];
  const uuids = [];
  for (const f of parseProtoFields(data)) {
    if (f.fieldNum === 3 && f.wireType === 2) entries.push(f.value);
    else if (f.fieldNum === 4 && f.wireType === 2) keys.push(textDecoder.decode(f.value));
    else if (f.fieldNum === 5 && f.wireType === 2) types.push(textDecoder.decode(f.value));
    else if (f.fieldNum === 6 && f.wireType === 2) uuids.push(Array.from(f.value).map((b) => b.toString(16).padStart(2, '0')).join(''));
  }

  const readObjId = (idBytes) => {
    for (const f of parseProtoFields(idBytes)) {
      if (f.fieldNum === 6 && f.wireType === 0) return f.value; // object_index
      if (f.fieldNum === 2 && f.wireType === 0) return f.value;
    }
    return -1;
  };
  const parseCustomMap = (entryBytes) => {
    const map = {};
    for (const f of parseProtoFields(entryBytes)) {
      if (f.fieldNum === 13 && f.wireType === 2) {
        for (const mf of parseProtoFields(f.value)) {
          if (mf.fieldNum === 3 && mf.wireType === 2) {
            let k = -1, v = -1;
            for (const ef of parseProtoFields(mf.value)) {
              if (ef.fieldNum === 1 && ef.wireType === 0) k = ef.value;
              else if (ef.fieldNum === 2 && ef.wireType === 2) v = readObjId(ef.value);
            }
            if (k >= 1 && keys[k - 1]) map[keys[k - 1]] = v;
          }
        }
      }
    }
    return map;
  };
  const parseOrderedUuids = (entryBytes) => {
    const out = [];
    for (const f of parseProtoFields(entryBytes)) {
      if (f.fieldNum === 16 && f.wireType === 2) { // OrderedSet
        for (const of1 of parseProtoFields(f.value)) {
          if (of1.fieldNum === 2 && of1.wireType === 2) { // Dictionary
            for (const de of parseProtoFields(of1.value)) {
              if (de.fieldNum === 1 && de.wireType === 2) {
                let keyIdx = -1;
                for (const kf of parseProtoFields(de.value)) {
                  if (kf.fieldNum === 1 && kf.wireType === 2) keyIdx = readObjId(kf.value);
                }
                if (keyIdx >= 0 && entries[keyIdx]) {
                  // UUID index inside entry
                  for (const uf of parseProtoFields(entries[keyIdx])) {
                    if (uf.fieldNum === 5 && uf.wireType === 2) {
                      for (const mf of parseProtoFields(uf.value)) {
                        if (mf.fieldNum === 1 && mf.wireType === 0 && uuids[mf.value]) out.push(uuids[mf.value]);
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
    return out;
  };
  const parseEntryNote = (entryBytes) => {
    for (const f of parseProtoFields(entryBytes)) {
      if (f.fieldNum === 10 && f.wireType === 2) {
        return decodeAppleNoteProto(f.value).markdown.replace(/\n+/g, ' ').replace(/\|/g, '\\|').trim();
      }
    }
    return '';
  };

  // Find root table object (has crRows, crColumns, cellColumns)
  let rootMap = null;
  for (const e of entries) {
    const m = parseCustomMap(e);
    if ('crRows' in m && 'crColumns' in m && 'cellColumns' in m) { rootMap = m; break; }
  }
  if (!rootMap) {
    // Fallback: collect all note cells sequentially if CRDT layout differs
    const cells = entries.map(parseEntryNote).filter(Boolean);
    return cells.length ? cells.join(' | ') : '';
  }

  const rowIds = entries[rootMap.crRows] ? parseOrderedUuids(entries[rootMap.crRows]) : [];
  const colIds = entries[rootMap.crColumns] ? parseOrderedUuids(entries[rootMap.crColumns]) : [];
  const numRows = rowIds.length;
  const numCols = colIds.length;
  if (!numRows || !numCols) {
    const cells = entries.map(parseEntryNote).filter(Boolean);
    return cells.length ? cells.join(' | ') : '';
  }

  // Fallback simple row-major extraction of non-empty cell notes if sparse map cannot be resolved
  const grid = Array.from({ length: numRows }, () => Array(numCols).fill(''));
  const noteTexts = entries.map(parseEntryNote).filter(Boolean);
  for (let i = 0; i < Math.min(noteTexts.length, numRows * numCols); i++) {
    grid[Math.floor(i / numCols)][i % numCols] = noteTexts[i];
  }
  const mdRows = [
    `| ${grid[0].join(' | ')} |`,
    `| ${grid[0].map(() => '---').join(' | ')} |`,
    ...grid.slice(1).map((r) => `| ${r.join(' | ')} |`),
  ];
  return mdRows.join('\n');
}

function paragraphPrefix(style, listCounter) {
  if (!style) return '';
  const indent = '  '.repeat(Math.min(6, Math.max(0, style.indent || 0)));
  const quote = style.blockquote ? '> ' : '';
  switch (style.styleType) {
    case 0: return `${quote}# `;
    case 1: return `${quote}## `;
    case 2: return `${quote}### `;
    case 100:
    case 101: return `${quote}${indent}- `;
    case 102: return `${quote}${indent}${listCounter}. `;
    case 103: return `${quote}${indent}- [${style.checklist?.done ? 'x' : ' '}] `;
    default: return quote;
  }
}

/**
 * Decodes an uncompressed Apple Notes protobuf (`NoteStoreProto`) into Markdown.
 * @param {Uint8Array} bytes - Uncompressed protobuf bytes (gunzipped ZDATA)
 * @param {{ attachments?: Record<string, { title?: string, filename?: string, dataUrl?: string }> }} [options]
 * @returns {{ title: string, markdown: string, plainText: string }}
 */
export function decodeAppleNoteProto(bytes, { attachments = {} } = {}) {
  const buf = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || 0);
  if (!buf.length) return { title: '', markdown: '', plainText: '' };

  // NoteStoreProto: field 2 = Document; Document: field 3 = Note
  let docBytes = null;
  for (const f of parseProtoFields(buf)) {
    if (f.fieldNum === 2 && f.wireType === 2) { docBytes = f.value; break; }
  }
  let noteBytes = null;
  if (docBytes) {
    for (const f of parseProtoFields(docBytes)) {
      if (f.fieldNum === 3 && f.wireType === 2) { noteBytes = f.value; break; }
    }
  }
  // Fallback: caller may have passed Note message directly
  if (!noteBytes) noteBytes = buf;

  let noteText = '';
  const runs = [];
  for (const f of parseProtoFields(noteBytes)) {
    if (f.fieldNum === 2 && f.wireType === 2) noteText = textDecoder.decode(f.value);
    else if (f.fieldNum === 5 && f.wireType === 2) runs.push(decodeAttributeRun(f.value));
  }

  const plainText = noteText.replace(/\uFFFC/g, '').trim();
  if (!noteText) return { title: '', markdown: '', plainText: '' };
  if (!runs.length) {
    const firstLine = plainText.split('\n').find((l) => l.trim()) || '';
    return { title: firstLine.trim(), markdown: plainText, plainText };
  }

  // Split runs across line breaks so each paragraph gets its ParagraphStyle prefix
  const lines = [{ style: null, parts: [] }];
  let offset = 0;
  for (const run of runs) {
    const end = Math.min(noteText.length, offset + run.length);
    const slice = noteText.slice(offset, end);
    offset = end;
    const chunks = slice.split('\n');
    for (let i = 0; i < chunks.length; i++) {
      const cur = lines[lines.length - 1];
      if (run.paragraphStyle && !cur.style && (chunks[i] || i === 0)) cur.style = run.paragraphStyle;
      if (chunks[i]) cur.parts.push(formatInlineRun(chunks[i], run, attachments));
      if (i < chunks.length - 1) lines.push({ style: null, parts: [] });
    }
  }
  if (offset < noteText.length) {
    const tail = noteText.slice(offset).split('\n');
    for (let i = 0; i < tail.length; i++) {
      if (tail[i]) lines[lines.length - 1].parts.push(tail[i]);
      if (i < tail.length - 1) lines.push({ style: null, parts: [] });
    }
  }

  const mdLines = [];
  let inCodeBlock = false;
  let numberedIdx = 0;
  for (const line of lines) {
    const text = line.parts.join('');
    const isMono = line.style?.styleType === 4;
    if (isMono && !inCodeBlock) {
      mdLines.push('```');
      inCodeBlock = true;
    } else if (!isMono && inCodeBlock) {
      mdLines.push('```');
      inCodeBlock = false;
    }
    if (isMono) {
      mdLines.push(text);
      continue;
    }
    if (line.style?.styleType === 102) numberedIdx++;
    else numberedIdx = 0;
    const prefix = paragraphPrefix(line.style, numberedIdx);
    if (!text.trim() && !prefix.trim()) mdLines.push('');
    else mdLines.push(`${prefix}${text}`);
  }
  if (inCodeBlock) mdLines.push('```');

  const markdown = mdLines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  const title = (plainText.split('\n').find((l) => l.trim()) || '').trim();
  return { title, markdown, plainText };
}

// ---- Apple Notes HTML export → Markdown converter ----

function decodeEntities(str) {
  return String(str || '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)));
}

/**
 * Converts an Apple Notes HTML export into clean NoteComplete Markdown.
 * @param {string} html
 * @param {string} [fallbackTitle]
 * @returns {{ title: string, markdown: string }}
 */
export function appleNotesHtmlToMarkdown(html, fallbackTitle = '') {
  let src = String(html || '');
  const titleMatch = src.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const htmlTitle = titleMatch ? decodeEntities(titleMatch[1]).trim() : '';
  const bodyMatch = src.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  src = bodyMatch ? bodyMatch[1] : src;

  // Strip styles and scripts
  src = src.replace(/<(?:style|script|head|meta|link)\b[^>]*>[\s\S]*?<\/(?:style|script|head)>/gi, '');
  src = src.replace(/<(?:meta|link)\b[^>]*\/?>/gi, '');

  // Code blocks
  src = src.replace(/<pre[^>]*>\s*(?:<code[^>]*>)?([\s\S]*?)(?:<\/code>)?\s*<\/pre>/gi, (_m, code) =>
    `\n\`\`\`\n${decodeEntities(code.replace(/<[^>]+>/g, '')).trimEnd()}\n\`\`\`\n`
  );

  // Headings
  for (let level = 1; level <= 6; level++) {
    const hashes = '#'.repeat(level);
    src = src.replace(new RegExp(`<h${level}[^>]*>([\\s\\S]*?)<\\/h${level}>`, 'gi'), (_m, inner) => `\n${hashes} ${inner.trim()}\n`);
  }

  // Blockquotes
  src = src.replace(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi, (_m, inner) => {
    const clean = inner.replace(/<[^>]+>/g, '').trim();
    return `\n${clean.split('\n').map((l) => `> ${l.trim()}`).join('\n')}\n`;
  });

  // Images
  src = src.replace(/<img\b[^>]*>/gi, (tag) => {
    const srcM = tag.match(/\bsrc=["']([^"']+)["']/i);
    const altM = tag.match(/\balt=["']([^"']*)["']/i);
    if (!srcM) return '';
    return `![${decodeEntities(altM ? altM[1] : 'image')}](${srcM[1]})`;
  });

  // Links
  src = src.replace(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_m, href, label) => {
    const text = decodeEntities(label.replace(/<[^>]+>/g, '')).trim() || href;
    return `[${text}](${href})`;
  });

  // Checklists & list items
  src = src.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_m, inner) => {
    if (/<input\b[^>]*type=["']checkbox["'][^>]*checked/i.test(inner)) {
      return `\n- [x] ${inner.replace(/<input\b[^>]*>/gi, '').trim()}`;
    }
    if (/<input\b[^>]*type=["']checkbox["'][^>]*>/i.test(inner)) {
      return `\n- [ ] ${inner.replace(/<input\b[^>]*>/gi, '').trim()}`;
    }
    return `\n- ${inner.trim()}`;
  });

  // Inline styles
  src = src.replace(/<(?:b|strong)\b[^>]*>([\s\S]*?)<\/(?:b|strong)>/gi, '**$1**');
  src = src.replace(/<(?:i|em)\b[^>]*>([\s\S]*?)<\/(?:i|em)>/gi, '*$1*');
  src = src.replace(/<(?:s|del|strike)\b[^>]*>([\s\S]*?)<\/(?:s|del|strike)>/gi, '~~$1~~');
  src = src.replace(/<code\b[^>]*>([\s\S]*?)<\/code>/gi, '`$1`');

  // Breaks & block elements
  src = src.replace(/<br\s*\/?>/gi, '\n');
  src = src.replace(/<hr\s*\/?>/gi, '\n---\n');
  src = src.replace(/<\/(?:p|div|tr|ul|ol|section|article)>/gi, '\n');
  src = src.replace(/<\/t[dh]>/gi, ' | ');

  // Remove remaining tags
  src = src.replace(/<[^>]+>/g, '');
  const markdown = decodeEntities(src)
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  const firstHeading = markdown.match(/^#{1,3}\s+(.+)$/m)?.[1]?.trim() || '';
  const firstLine = (markdown.split('\n').find((l) => l.trim()) || '').replace(/^#+\s*/, '').trim();
  const title = htmlTitle || firstHeading || firstLine || fallbackTitle || 'Apple Note';
  return { title, markdown };
}

// ---- ZIP & multi-file Apple Notes export parser ----

const SKIP_ENTRY_RE = /(?:^|\/)(?:\._|__MACOSX\/|\.DS_Store$)/i;
const NOTE_EXT_RE = /\.(md|markdown|html?|txt)$/i;

function folderFromPath(relPath) {
  const parts = String(relPath || '').replace(/\\/g, '/').split('/').filter(Boolean);
  if (parts.length <= 1) return 'Apple Notes';
  // Drop top-level generic export wrapper ("iCloud Notes", "Notes", "Exporter", etc.) if nested deeper
  const dirs = parts.slice(0, -1);
  if (dirs.length > 1 && /^(icloud\s*notes|apple\s*notes|notes|exporter)$/i.test(dirs[0])) {
    return dirs.slice(1).join(' / ');
  }
  return dirs.join(' / ');
}

function baseNameNoExt(relPath) {
  const base = String(relPath || '').split('/').pop() || 'Apple Note';
  return base.replace(/\.[^.]+$/, '').trim() || 'Apple Note';
}

/**
 * Parses a ZIP archive exported from Apple Notes (iCloud Data & Privacy, Exporter.app, macOS Markdown).
 * @param {File | Blob} zipFile
 * @returns {Promise<{ notes: Array<{ title: string, folder: string, markdown: string }>, folders: string[] }>}
 */
export async function parseAppleNotesZip(zipFile) {
  const { readArchive, extractEntry } = await import('./archive.js');
  const bytes = new Uint8Array(await zipFile.arrayBuffer());
  const archive = await readArchive(bytes, zipFile.name || 'apple-notes.zip');
  const notes = [];
  const folders = new Set();

  for (const entry of archive.entries || []) {
    if (entry.dir || SKIP_ENTRY_RE.test(entry.path) || !NOTE_EXT_RE.test(entry.path)) continue;
    const rawBytes = await extractEntry(archive, entry);
    const text = textDecoder.decode(rawBytes);
    const fallbackTitle = baseNameNoExt(entry.path);
    const folder = folderFromPath(entry.path);
    let title = fallbackTitle;
    let markdown = text.trim();
    if (/\.html?$/i.test(entry.path)) {
      const converted = appleNotesHtmlToMarkdown(text, fallbackTitle);
      title = converted.title || fallbackTitle;
      markdown = converted.markdown;
    } else if (markdown) {
      const heading = markdown.match(/^#\s+(.+)$/m)?.[1]?.trim();
      if (heading) title = heading;
    }
    if (!markdown) continue;
    folders.add(folder);
    notes.push({ title, folder, markdown });
  }
  return { notes, folders: [...folders] };
}

/**
 * Parses an array/FileList of exported Apple Notes files (.md, .html, .txt, or .zip).
 * @param {FileList | File[]} fileList
 */
export async function parseAppleNotesFiles(fileList) {
  const files = [...(fileList || [])];
  const notes = [];
  const folders = new Set();

  for (const file of files) {
    const rel = file.webkitRelativePath || file.name || '';
    if (SKIP_ENTRY_RE.test(rel)) continue;
    if (/\.zip$/i.test(file.name || '')) {
      const res = await parseAppleNotesZip(file);
      for (const f of res.folders) folders.add(f);
      notes.push(...res.notes);
      continue;
    }
    if (!NOTE_EXT_RE.test(file.name || '')) continue;
    const text = await file.text();
    const fallbackTitle = baseNameNoExt(rel);
    const folder = folderFromPath(rel);
    let title = fallbackTitle;
    let markdown = text.trim();
    if (/\.html?$/i.test(file.name || '')) {
      const converted = appleNotesHtmlToMarkdown(text, fallbackTitle);
      title = converted.title || fallbackTitle;
      markdown = converted.markdown;
    } else if (markdown) {
      const heading = markdown.match(/^#\s+(.+)$/m)?.[1]?.trim();
      if (heading) title = heading;
    }
    if (!markdown) continue;
    folders.add(folder);
    notes.push({ title, folder, markdown });
  }
  return { notes, folders: [...folders] };
}
