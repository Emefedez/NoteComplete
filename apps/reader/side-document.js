// A second document opened in an engine worker of its own, so reading it never touches the
// open note: comparing versions (versions.js), "To look at" pages in the chart editors, and
// the batch actions over Recent (batch-ocr.js, content search) that read notes nobody opened.
import { prepareDocument } from './media-import.js';
import { PdfBackgrounds } from './pdf-background.js';

export function sideDocument() {
  const worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
  const pending = new Map();
  let next = 0;
  const ready = new Promise((resolve, reject) => {
    worker.onmessage = ({ data }) => {
      if (data.ready) return resolve();
      if (data.fatal) return reject(Error(data.fatal));
      const p = pending.get(data.id);
      if (!p) return;
      pending.delete(data.id);
      data.error ? p.reject(Error(data.error)) : p.resolve(data.result);
    };
  });
  const call = async (op, args = {}) => { await ready; const id = ++next; return new Promise((resolve, reject) => { pending.set(id, { resolve, reject }); worker.postMessage({ id, op, ...args }, args.bytes instanceof ArrayBuffer ? [args.bytes] : []); }); };
  const backgrounds = new PdfBackgrounds(resource => call('pdf', { resource }));
  return {
    call, backgrounds,
    // The file prepared like an opened one (a PDF or picture becomes a note); null for
    // documents the page engine does not show (text, HTML, Office).
    async open(file, prepared = null) {
      prepared ||= await prepareDocument(file);
      if (['text', 'html'].includes(prepared.kind)) return null;
      return call('open', { ...prepared, project: prepared.kind === 'project', notecomplete: prepared.kind === 'notecomplete', notebook: prepared.kind === 'notebook', name: file?.name || '', page: 0 });
    },
    view: page => call('view', { page }),
    close() { backgrounds.closed = true; backgrounds.close?.(); worker.terminate(); },
  };
}
