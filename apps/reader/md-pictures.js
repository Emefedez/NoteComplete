// Pictures in Markdown (a text document being edited, and the Notes panel): a picture pasted,
// dropped or chosen with the bar's picture button goes in as `![name](data:…)`, so the file
// keeps it wherever it is opened. JPEG, PNG, GIF, WebP and AVIF keep their own bytes (an
// animated GIF, WebP or APNG still moves); HEIC/HEIF photos become JPEG, and BMP, ICO and
// anything else the browser reads become PNG (readImage).
import { pictureFormat, readImage } from './media-import.js';
import { paths as iconPaths } from './icons.js';

const AS_IS = { 'image/jpeg': 1, 'image/png': 1, 'image/gif': 1, 'image/webp': 1, 'image/avif': 1 };
export const PICTURE_ACCEPT = 'image/*,.heic,.heif,.jfif,.apng,.avif,.ico';

const isPicture = (file) => /^image\//.test(file?.type || '') || /\.(png|jpe?g|jfif|apng|gif|webp|avif|heic|heif|bmp|ico)$/i.test(file?.name || '');

function base64Of(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).slice(String(reader.result).indexOf(',') + 1));
    reader.onerror = () => reject(reader.error || Error('Could not read this picture.'));
    reader.readAsDataURL(blob);
  });
}

// The Markdown for one picture file.
export async function pictureMarkdown(file) {
  const head = new Uint8Array(await file.slice(0, 64 * 1024).arrayBuffer());
  const format = pictureFormat(head);
  const alt = (file.name || 'picture').replace(/\.[^.]+$/, '').replace(/[[\]\\]/g, '') || 'picture';
  let mime = file.type, base64;
  if (format !== 'heic' && AS_IS[mime]) base64 = await base64Of(file);
  else ({ base64, mime } = await readImage(file, { any: true }));
  return `![${alt}](data:${mime};base64,${base64})`;
}

async function insertAll(files, insert) {
  const pictures = [...files].filter(isPicture);
  if (!pictures.length) return false;
  const parts = [];
  for (const file of pictures) parts.push(await pictureMarkdown(file));
  insert(`\n${parts.join('\n\n')}\n`);
  return true;
}

// Pasted or dropped picture files on `el` go in through `insert(markdown)`. `fail(message)`
// says why one could not.
export function attachPictureInput(el, insert, fail = (m) => console.warn(m)) {
  if (!el || el.__mdPictures) return;
  el.__mdPictures = true;
  const take = (event, files) => {
    if (![...(files || [])].some(isPicture)) return;
    event.preventDefault();
    event.stopPropagation();
    insertAll(files, insert).catch((e) => fail('Could not add the picture: ' + e.message));
  };
  el.addEventListener('paste', (event) => take(event, event.clipboardData?.files), true);
  el.addEventListener('dragover', (event) => { if ([...(event.dataTransfer?.items || [])].some((i) => i.kind === 'file')) event.preventDefault(); });
  el.addEventListener('drop', (event) => take(event, event.dataTransfer?.files), true);
}

// The TinyMDE bar button: choose picture files from the computer.
export function pictureCommand(fail = (m) => console.warn(m)) {
  return {
    name: 'insertPicture',
    title: 'Insert picture from a file (GIF, PNG, JPEG, WebP, HEIC…) — or paste / drop one',
    innerHTML: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${iconPaths.image}" style="fill:none;stroke:currentColor;stroke-width:1.65;stroke-linecap:round;stroke-linejoin:round"/></svg>`,
    action: (editor) => {
      const focus = editor.getSelection(false), anchor = editor.getSelection(true);
      const input = Object.assign(document.createElement('input'), { type: 'file', accept: PICTURE_ACCEPT, multiple: true });
      input.onchange = () => insertAll(input.files || [], (md) => {
        if (focus) editor.setSelection(focus, anchor);
        editor.paste(md);
      }).catch((e) => fail('Could not add the picture: ' + e.message));
      input.click();
    },
  };
}
