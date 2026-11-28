// Files NoteComplete opens from other apps ("Open with", Share), and the MIME types it
// declares for them in app.json. Own formats first; the rest are offered, never claimed.
export const OPEN_TYPES = {
 'application/x-noteful':['noteful'],
 'application/x-nfedit':['nfedit'],
 'application/x-notecomp':['notecomp','notecomplete'],
 'application/x-notepart':['notepart'],
 'application/x-ncstudy':['ncstudy'],
 'application/json':['json'],
 'application/pdf':['pdf'],
 'image/png':['png'],
 'image/jpeg':['jpg','jpeg'],
 'image/webp':['webp'],
 'image/gif':['gif'],
 'image/bmp':['bmp'],
 'image/avif':['avif'],
 'image/heic':['heic'],
 'image/heif':['heif'],
 'application/x-tar':['tar'],
 'text/markdown':['md','markdown'],
 'text/x-markdown':['md'],
 'text/plain':['txt'],
 'text/html':['html','htm'],
 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':['docx','docm','dotx'],
 'application/msword':['doc'],
 'application/rtf':['rtf'],
 'text/rtf':['rtf'],
 'application/vnd.oasis.opendocument.text':['odt','fodt'],
 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':['xlsx','xlsm','xlsb'],
 'application/vnd.ms-excel':['xls'],
 'application/vnd.oasis.opendocument.spreadsheet':['ods','fods'],
 'application/vnd.openxmlformats-officedocument.presentationml.presentation':['pptx','pptm'],
 'application/vnd.ms-powerpoint':['ppt'],
 'application/vnd.oasis.opendocument.presentation':['odp'],
 'application/epub+zip':['epub'],
 'application/x-ipynb+json':['ipynb'],
 'text/csv':['csv'],
 'text/comma-separated-values':['csv'],
 'text/tab-separated-values':['tsv'],
 'audio/mpeg':['mp3'],
 'audio/mp4':['m4a'],
 'audio/wav':['wav'],
 'audio/ogg':['ogg','oga','opus'],
 'audio/flac':['flac'],
 'video/mp4':['mp4','m4v'],
};
// Generic types other apps (WhatsApp, mail, file managers) attach to files they cannot name:
// declared for sharing and opening, but never used to guess a file name.
export const CARRIER_TYPES = ['application/octet-stream','application/zip','application/x-zip-compressed','application/gzip','application/x-gzip'];
export const OWN_EXTENSIONS = ['noteful','nfedit','notecomp','notecomplete','notepart','ncstudy'];
const SUPPORTED = new RegExp(`\\.(${[...new Set(Object.values(OPEN_TYPES).flat())].join('|')})$`,'i');

// The name the reader gets: the provider's display name, else the URI's last segment, as long
// as it has a supported extension; else one from the MIME type. With neither, a plain name:
// the reader recognises notes, PDFs, images and text by their bytes.
export function incomingName(uri, {name, mime} = {}) {
 for (const candidate of [name, lastSegment(uri)]) {
  if (typeof candidate === 'string' && SUPPORTED.test(candidate.trim())) return candidate.trim();
 }
 const base = (typeof name === 'string' && name.trim() ? name.trim() : 'Imported file').replace(/\.[^.]*$/, '') || 'Imported file';
 const ext = OPEN_TYPES[String(mime || '').split(';')[0].trim().toLowerCase()]?.[0];
 return ext ? `${base}.${ext}` : base;
}
function lastSegment(uri) {
 let path; try { path = new URL(uri).pathname; } catch { return ''; }
 // Document providers encode the whole path in one segment (primary%3ADownload%2Fa.pdf).
 try { return decodeURIComponent(path).split(/[/:]/).at(-1); } catch { return ''; }
}
const ORIGIN_PROVIDERS = [
 [/(^|\.)whatsapp(\.|$)/i, 'WhatsApp'],
 [/(^|\.)telegram(\.|$)/i, 'Telegram'],
 [/google\.android\.gm(\.|$)/i, 'Gmail'],
 [/google\.android\.apps\.docs/i, 'Google Drive'],
 [/(^|\.)discord(\.|$)/i, 'Discord'],
 [/(^|\.)slack(\.|$)/i, 'Slack'],
 [/(^|\.)teams(\.|$)/i, 'Teams'],
 [/android\.providers\.downloads/i, 'Downloads'],
];

// Human-readable source or folder label for Android content:// and file:// URIs.
export function incomingOrigin(uri) {
 let parsed; try { parsed = new URL(uri); } catch { return 'Shared'; }
 const host = (parsed.hostname || '').toLowerCase();
 for (const [re, label] of ORIGIN_PROVIDERS) if (re.test(host)) return label;
 if (/externalstorage\.documents/i.test(host) || parsed.protocol === 'file:') {
  let decoded = ''; try { decoded = decodeURIComponent(parsed.pathname || ''); } catch { decoded = parsed.pathname || ''; }
  const clean = decoded.replace(/^\/?(document|tree|root)\//i, '').replace(/^[^:]+:/, '');
  const parts = clean.split('/').filter(Boolean);
  if (parts.length >= 2) return parts.at(-2);
  return 'Device storage';
 }
 if (host && !/^(media|fileprovider)$/i.test(host)) {
  const seg = host.replace(/^com\.android\.(providers\.)?|^com\.google\.android\.|^org\.|^com\.|\.fileprovider$|\.provider$/gi, '').split('.').filter(Boolean)[0];
  if (seg) return seg[0].toUpperCase() + seg.slice(1);
 }
 return 'Shared';
}

// Android URI grants are used only for the file explicitly opened by the user.
export function incomingFile(uri) {
 if (typeof uri !== 'string' || !/^(content|file):\/\//i.test(uri)) return null;
 try { new URL(uri); } catch { return null; }
 return {uri, name: incomingName(uri), origin: incomingOrigin(uri)};
}
// describe(uri) (optional): the provider's {name, mime}, read before the bytes.
// read(uri): the file as base64, or {url} where the reader fetches it (large files never cross
// the bridge). release(file) (optional): the reader has it, or gave up; drop any copy.
export class IncomingFiles {
 constructor({read,post,error,describe,release}) { Object.assign(this,{read,post,error,describe,release}); this.queue=[]; this.sequence=0; this.ready=false; this.busy=false; this.current=null; }
 open(uri) {
  const file=incomingFile(uri); if (!file || this.current?.uri===uri || this.queue.some(f=>f.uri===uri)) return;
  this.queue.push({...file,id:++this.sequence}); this.flush();
 }
 setReady(ready) { this.ready=ready; if (ready) { if(this.current?.data) this.post(this.message()); else this.flush(); } }
 message() { const {id,name,origin,data}=this.current; return {type:'noteful-import',id,name,...(origin?{origin}:{}),...data}; }
 async flush() {
  if(!this.ready || this.busy || this.current || !this.queue.length) return;
  this.busy=true; this.current=this.queue.shift();
  try {
   if (this.describe) { try { this.current.name=incomingName(this.current.uri, await this.describe(this.current.uri) || {}); } catch { /* Keep the URI's name. */ } }
   const data=await this.read(this.current.uri); this.current.data=typeof data==='string'?{base64:data}:data; if(this.ready)this.post(this.message());
  }
  catch(error) { this.error(error); this.current=null; }
  finally { this.busy=false; if(!this.current)this.flush(); }
 }
 acknowledge(id) { if(this.current?.id!==id)return; const done=this.current; this.current=null; try { this.release?.(done); } catch { /* A stale copy is cleared on the next launch. */ } this.flush(); }
}
