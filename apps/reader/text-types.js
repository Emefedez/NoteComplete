// Files opened as text documents: Markdown, plain text, common source/data/config formats,
// and names without an extension whose content is text (data files, README, Makefile…).
export const TEXT_EXTENSIONS = ['txt', 'md', 'markdown', 'csv', 'tsv', 'log', 'json', 'yaml', 'yml', 'toml', 'xml', 'ini', 'conf', 'cfg', 'env',
  'sh', 'bash', 'zsh', 'fish', 'py', 'c', 'h', 'cc', 'cpp', 'hpp', 'java', 'js', 'mjs', 'ts', 'rs', 'go', 'rb', 'php', 'sql', 'tex', 'bib',
  'r', 'm', 'asm', 's', 'lua', 'vhd', 'vhdl', 'v', 'sv', 'mk', 'awk', 'sed', 'diff', 'patch'];
const EXT = new RegExp(`\\.(${TEXT_EXTENSIONS.join('|')})$`, 'i');

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
