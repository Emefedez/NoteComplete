import {fileKind} from './media-import.js';
import {hasExtension} from './text-types.js';
const OWN={note:/\.noteful$/i,project:/\.nfedit$/i,notecomplete:/\.(notecomp|notecomplete|notepart)$/i};
const SUFFIX={note:'.noteful',project:'.nfedit',notecomplete:'.notecomp',pdf:'.pdf',image:'.png',html:'.html',text:'.txt'};
// The file keeps its own name and extension (Report.docx opens as Word). Only a missing
// extension, or one of ours that the bytes contradict (providers guess), is replaced by the
// one the content shows.
export function importName(name,kind){
 const given=(typeof name==='string'&&name.trim())||'Imported file';
 if(OWN[kind]?OWN[kind].test(given):hasExtension(given)&&!/\.(noteful|nfedit|notecomp|notecomplete|notepart)$/i.test(given))return given;
 return given.replace(/\.(noteful|nfedit|notecomp|notecomplete|notepart|pdf|png|jpe?g|webp)$/i,'')+(SUFFIX[kind]||'');
}
// Native file intents enter through the same user-visible open flow as the picker.
export function receiveNativeFiles({open,canReplace,isBusy,status}) {
 const pending=new Set(),completed=new Set();
 const reply=(id,error)=>window.ReactNativeWebView.postMessage(JSON.stringify({type:'noteful-import-result',id,error}));
 async function receive(event) {
  if(!window.ReactNativeWebView)return;
  let message;try{message=typeof event.data==='string'?JSON.parse(event.data):event.data;}catch{return;}
  // Small files come inline as base64; large ones as a path on the app's own loopback server.
  const url=typeof message?.url==='string'&&/^\/incoming\/[0-9a-f]{32}$/.test(message.url)?message.url:null;
  if(message?.type!=='noteful-import'||!Number.isSafeInteger(message.id)||(typeof message.base64!=='string'&&!url))return;
  if(completed.has(message.id)){reply(message.id);return;}if(pending.has(message.id))return;
  pending.add(message.id);let failure;
  try {
   if(isBusy())throw Error('An edit is still being saved. Open the file again when it finishes.');
   if(!canReplace())return;
   let bytes;
   if(url){const response=await fetch(url,{cache:'no-store'});if(!response.ok)throw Error('The app could not hand over the file ('+response.status+').');bytes=new Uint8Array(await response.arrayBuffer());}
   else bytes=Uint8Array.from(atob(message.base64),c=>c.charCodeAt(0));
   // Content-provider URIs often omit filenames. The bytes determine the format.
   const kind=fileKind(message.name||'',bytes);
   await open(new File([bytes],importName(message.name,kind)));
  }catch(error){failure=error.message;status(failure,true);}
  finally{pending.delete(message.id);completed.add(message.id);reply(message.id,failure);}
 }
 window.addEventListener('message',receive);document.addEventListener('message',receive);
}
