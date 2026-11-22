// PlantUML diagrams: text documents the desktop app can also draw (text-view.js, diagrams.js).
export const DIAGRAM_EXTENSIONS = ['puml', 'plantuml', 'pu', 'iuml', 'wsd'];
export const isDiagramName = (name) => new RegExp(`\\.(${DIAGRAM_EXTENSIONS.join('|')})$`, 'i').test(name || '');

// Files opened as text documents: Markdown, plain text, common source/data/config formats,
// and names without an extension whose content is text (data files, README, Makefile…).
export const TEXT_EXTENSIONS = ['txt', 'md', 'markdown', 'rst', 'adoc', 'asciidoc', 'org', 'rmd', 'qmd',
  'csv', 'tsv', 'log', 'json', 'yaml', 'yml', 'toml', 'xml', 'ini', 'conf', 'cfg', 'env', 'properties',
  'sh', 'bash', 'zsh', 'fish', 'ps1', 'bat', 'py', 'c', 'h', 'cc', 'cpp', 'hpp', 'cs', 'java', 'kt', 'swift', 'dart',
  'js', 'mjs', 'cjs', 'jsx', 'ts', 'tsx', 'css', 'scss', 'rs', 'go', 'rb', 'php', 'sql', 'tex', 'bib',
  'r', 'm', 'jl', 'hs', 'asm', 's', 'lua', 'vhd', 'vhdl', 'v', 'sv', 'mk', 'cmake', 'nix', 'proto',
  'awk', 'sed', 'diff', 'patch', ...DIAGRAM_EXTENSIONS];
const EXT = new RegExp(`\\.(${TEXT_EXTENSIONS.join('|')})$`, 'i');

// Documents, spreadsheets, presentations, e-books and notebooks converted to Markdown (office.js);
// so are .csv and .tsv (listed in TEXT_EXTENSIONS too so plain text detection sees them).
export const OFFICE_EXTENSIONS = [
  'docx', 'docm', 'dotx', 'doc', 'rtf', 'odt', 'fodt',
  'xlsx', 'xlsm', 'xlsb', 'xls', 'ods', 'fods',
  'pptx', 'pptm', 'ppt', 'odp',
  'epub', 'ipynb',
];
export const OFFICE_NAME = new RegExp(`\\.(${OFFICE_EXTENSIONS.join('|')})$`, 'i');
export const isOfficeName = (name) => OFFICE_NAME.test(name || '');
export const isTableName = (name) => /\.(csv|tsv)$/i.test(name || '');

// Images opened directly as single-page notes (raster only; SVG is never opened as an image).
export const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'avif', 'ico'];
export const IMAGE_NAME = new RegExp(`\\.(${IMAGE_EXTENSIONS.join('|')})$`, 'i');
export const isImageName = (name) => IMAGE_NAME.test(name || '');

// Audio played in the global top-bar player without closing the open note.
export const AUDIO_EXTENSIONS = ['mp3', 'm4a', 'wav', 'ogg', 'oga', 'opus', 'flac', 'aac', 'weba'];
export const AUDIO_NAME = new RegExp(`\\.(${AUDIO_EXTENSIONS.join('|')})$`, 'i');
export const isAudioName = (name, type = '') => AUDIO_NAME.test(String(name || '')) || /^audio\//i.test(String(type || ''));

// Video handed off to the system's media player (or a browser tab on the web).
export const VIDEO_EXTENSIONS = ['mp4', 'm4v', 'webm', 'mkv', 'mov', 'avi', 'ogv'];
export const VIDEO_NAME = new RegExp(`\\.(${VIDEO_EXTENSIONS.join('|')})$`, 'i');
export const isVideoName = (name, type = '') => VIDEO_NAME.test(String(name || '')) || /^video\//i.test(String(type || ''));
export const isMediaName = (name, type = '') => isAudioName(name, type) || isVideoName(name, type);

export const hasExtension = (name) => /[^/\\]\.[^./\\]+$/.test(String(name || ''));
export const isMarkdownName = (name) => /\.(md|markdown)$/i.test(name || '');
// By name alone: a text extension, or no extension at all (the content decides then).
export const isTextName = (name) => EXT.test(name || '') || (Boolean(name) && !String(name).startsWith('.') && !hasExtension(name));
// For filters and badges: a text extension or a plain name without a dot.
export const TEXT_NAME = new RegExp(`(\\.(${TEXT_EXTENSIONS.join('|')})$)|^[^./\\\\]+$`, 'i');

// Text when the start has no NUL bytes; UTF-8 if it decodes as such, else Windows-1252.
export function looksLikeText(bytes) {
  const head = bytes.subarray(0, 8192);
  return !head.includes(0);
}
export function decodeText(bytes) {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { return new TextDecoder('windows-1252').decode(bytes); }
}
