// HEIC photos on the computer: the core draws an iPhone photo as <image data-format="heic">
// over a labelled box (scene.rs), which Safari shows as it is but Chromium and Electron cannot
// read. Here each one is decoded once (heic-worker.js, libheif, loaded only when a note has
// such a photo) into a JPEG that takes its place; the same photo on another page or drawn
// again reuses it. The worker is let go after a minute without photos to decode.
const done = new Map();
let worker = null, next = 0, idleTimer = 0;
const waiting = new Map();
const IDLE_MS = 60_000;

function decoder() {
  clearTimeout(idleTimer);
  if (!worker) {
    worker = new Worker(new URL('./heic-worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = ({ data }) => {
      const job = waiting.get(data.id);
      waiting.delete(data.id);
      if (job) data.error ? job.reject(Error(data.error)) : job.resolve(data.blob);
      if (!waiting.size) idleTimer = setTimeout(stop, IDLE_MS);
    };
    worker.onerror = (event) => {
      for (const job of waiting.values()) job.reject(Error(event.message || 'HEIC decoder failed'));
      waiting.clear();
      stop();
    };
  }
  return worker;
}
function stop() {
  worker?.terminate();
  worker = null;
}
function decode(bytes) {
  return new Promise((resolve, reject) => {
    const id = ++next;
    waiting.set(id, { resolve, reject });
    decoder().postMessage({ id, bytes: bytes.buffer }, [bytes.buffer]);
  });
}
// A HEIC/HEIF file (its bytes) as a JPEG blob: a photo opened or imported from the computer.
export function heicBlob(bytes) {
  return decode(new Uint8Array(bytes));
}
// A short key for a data URL of a few hundred KB: its length and both ends.
const keyOf = (href) => `${href.length}:${href.slice(0, 160)}:${href.slice(-160)}`;

// A blob: URL of the photo as a JPEG (one decode per photo).
export function heicUrl(href) {
  const key = keyOf(href);
  if (!done.has(key)) {
    const comma = href.indexOf(',');
    const binary = atob(href.slice(comma + 1));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const job = decode(bytes).then((blob) => URL.createObjectURL(blob));
    // A photo that could not be decoded keeps its labelled box; asked again later, it is tried again.
    job.catch(() => done.delete(key));
    done.set(key, job);
  }
  return done.get(key);
}

// Whether this browser shows HEIC itself (Safari on iPad, iPhone and the Mac): asked once, with
// the first photo. There the conversion is skipped: it cost the iPad a decoder download, the
// photo copied out of its text on the main thread (a stall while scrolling) and a second
// decode, for a picture Safari was already showing.
let native = null;
function showsHeic(href) {
  native ??= (async () => {
    const image = new Image();
    image.src = href;
    try { await image.decode(); return image.naturalWidth > 0; } catch { return false; }
  })();
  return native;
}

// Puts the decoded photo in place of every HEIC picture in `root` (a drawn page).
export async function showHeicPictures(root) {
  const pictures = [...root.querySelectorAll('image[data-format="heic"]')];
  const first = pictures.map((image) => image.getAttribute('href') || '').find((href) => href.startsWith('data:image/heic'));
  if (!first || await showsHeic(first)) return;
  await Promise.all(pictures.map(async (image) => {
    const href = image.getAttribute('href') || '';
    if (!href.startsWith('data:image/heic')) return;
    try {
      const url = await heicUrl(href);
      // The page may have been drawn again meanwhile: only a picture still showing it changes.
      if (image.getAttribute('href') !== href) return;
      image.setAttribute('href', url);
      image.setAttribute('data-converted', 'heic');
    } catch (error) {
      console.warn('HEIC photo not shown:', error.message);
    }
  }));
}
