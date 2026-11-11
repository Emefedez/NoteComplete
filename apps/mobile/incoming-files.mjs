// Files NoteComplete opens from other apps ("Open with", Share), and the MIME types it
// declares for them in app.json. Own formats first; the rest are offered, never claimed.
export const OPEN_TYPES = {
 'application/x-noteful':['noteful'],
 'application/x-nfedit':['nfedit'],
 'application/x-notecomp':['notecomp','notecomplete'],
 'application/x-notepart':['notepart'],
 'application/pdf':['pdf'],
 'image/png':['png'],
 'image/jpeg':['jpg','jpeg'],
 'image/webp':['webp'],
 'application/x-tar':['tar'],
 'text/markdown':['md','markdown'],
 'text/x-markdown':['md'],
 'text/plain':['txt'],
 'text/html':['html','htm'],
 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':['docx'],
 'application/vnd.oasis.opendocument.text':['odt'],
 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':['xlsx'],
 'application/vnd.oasis.opendocument.spreadsheet':['ods'],
 'text/csv':['csv'],
 'text/comma-separated-values':['csv'],
 'text/tab-separated-values':['tsv'],
};
// Generic types other apps (WhatsApp, mail, file managers) attach to files they cannot name:
// declared for sharing and opening, but never used to guess a file name.
export const CARRIER_TYPES = ['application/octet-stream','application/zip','application/x-zip-compressed','application/gzip','application/x-gzip'];
export const OWN_EXTENSIONS = ['noteful','nfedit','notecomp','notecomplete','notepart'];
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
// Android URI grants are used only for the file explicitly opened by the user.
export function incomingFile(uri) {
 if (typeof uri !== 'string' || !/^(content|file):\/\//i.test(uri)) return null;
 try { new URL(uri); } catch { return null; }
 return {uri, name: incomingName(uri)};
}
// describe(uri) (optional): the provider's {name, mime}, read before the bytes.
export class IncomingFiles {
 constructor({read,post,error,describe}) { Object.assign(this,{read,post,error,describe}); this.queue=[]; this.sequence=0; this.ready=false; this.busy=false; this.current=null; }
 open(uri) {
  const file=incomingFile(uri); if (!file || this.current?.uri===uri || this.queue.some(f=>f.uri===uri)) return;
  this.queue.push({...file,id:++this.sequence}); this.flush();
 }
 setReady(ready) { this.ready=ready; if (ready) { if(this.current?.base64) this.post(this.message()); else this.flush(); } }
 message() { const {id,name,base64}=this.current; return {type:'noteful-import',id,name,base64}; }
 async flush() {
  if(!this.ready || this.busy || this.current || !this.queue.length) return;
  this.busy=true; this.current=this.queue.shift();
  try {
   if (this.describe) { try { this.current.name=incomingName(this.current.uri, await this.describe(this.current.uri) || {}); } catch { /* Keep the URI's name. */ } }
   this.current.base64=await this.read(this.current.uri); if(this.ready)this.post(this.message());
  }
  catch(error) { this.error(error); this.current=null; }
  finally { this.busy=false; if(!this.current)this.flush(); }
 }
 acknowledge(id) { if(this.current?.id!==id)return; this.current=null;this.flush(); }
}
