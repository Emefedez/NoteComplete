// First-page previews for listed notes: Google's thumbnail when it has one,
// otherwise the local decoder in a throwaway worker, one file at a time.
import { FOLDER_MIME, supportedDriveFile } from './drive-client.js';

export function driveThumbnails(client, width = 96) {
  let worker = null, generation = 0, chain = Promise.resolve(), urls = [], controller = new AbortController();
  function ensureWorker() {
    return worker ||= new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
  }
  function decode(bytes, project, signal) {
    const active = ensureWorker();
    return new Promise((resolve, reject) => {
      const id = Math.random().toString(36).slice(2);
      const onmessage = ({ data }) => {
        if (data.id !== id) return;
        active.removeEventListener('message', onmessage);
        data.error ? reject(Error(data.error)) : resolve(data.result);
      };
      active.addEventListener('message', onmessage);
      signal.addEventListener?.('abort', () => reject(Error('aborted')), { once: true });
      active.postMessage({ id, op: 'open', bytes, project }, [bytes]);
    });
  }
  // The page SVG is self-contained; rasterize it small so rows never keep a full page around.
  async function raster(svg) {
    const parsed = new DOMParser().parseFromString(svg, 'image/svg+xml');
    const source = parsed.documentElement;
    const box = (source.getAttribute('viewBox') || '').split(/\s+/).map(Number);
    const ratio = box.length === 4 && box[3] > 0 && box[2] > 0 ? box[3] / box[2] : 1.3;
    source.setAttribute('width', width);
    source.setAttribute('height', Math.max(1, Math.round(width * ratio)));
    const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(source)], { type: 'image/svg+xml' }));
    try {
      const image = new Image();
      image.src = url;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = width; canvas.height = Math.max(1, Math.round(width * ratio));
      canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
      const preview = canvas.toDataURL('image/jpeg', 0.7);
      canvas.width = canvas.height = 0;
      return preview;
    } finally { URL.revokeObjectURL(url); }
  }
  async function local(file, token, signal) {
    const downloaded = await client.download(file, signal);
    if (token !== generation) return '';
    const project = /\.nfedit$/i.test(file.name);
    const bytes = project
      ? new TextEncoder().encode(await downloaded.text())
      : new Uint8Array(await downloaded.arrayBuffer());
    const view = await decode(bytes.buffer, project, signal);
    if (token !== generation) return '';
    return view?.svg ? await raster(view.svg) : '';
  }
  return {
    // Returns a preview URL for a listed file, or '' when none is available.
    get(file) {
      if (file?.mimeType === FOLDER_MIME || !supportedDriveFile(file) || typeof client.download !== 'function') return Promise.resolve('');
      const token = generation;
      const job = async () => {
        if (token !== generation) return '';
        try {
          const remote = typeof client.thumbnail === 'function' ? await client.thumbnail(file, controller.signal) : '';
          if (remote) { urls.push(remote); return remote; }
          // Google cannot render .noteful previews, so the first page is decoded on this device.
          if (!/\.(noteful|nfedit)$/i.test(file.name || '')) return '';
          return await local(file, token, controller.signal);
        } catch { return ''; }
      };
      chain = chain.then(job, job);
      return chain;
    },
    cancel() {
      generation++;
      controller.abort();
      controller = new AbortController();
      worker?.terminate();
      worker = null;
      chain = Promise.resolve();
      for (const url of urls) URL.revokeObjectURL(url);
      urls = [];
    },
  };
}
