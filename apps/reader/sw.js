// Cache only application assets. Notes opened with the file picker never enter CacheStorage.
// precache.json (tools/build_web.py) lists every app file with a hash of its contents: a cached
// file is used as long as its hash is the current one, so a visit downloads only what changed
// (before, every visit downloaded the whole app again). Installing caches only the shell; the
// engines a feature loads when used (speech, text recognition, Word and spreadsheet readers,
// math, PDF fonts) are cached the first time they are fetched.
const CACHE='noteful-reader-v12';
const base=()=>self.registration.scope;
// A file's place in the cache: its path and hash (never fetched with this address).
const keyOf=(name,hash)=>new URL(`${name}?v=${hash}`,base()).href;
// precache.json, fresh on each page load (it is small, and a 304 when nothing changed).
let manifest=null;
const readManifest=async()=>{
 const cache=await caches.open(CACHE);
 try{
  const r=await fetch(new URL('precache.json',base()),{cache:'no-cache'});
  if(!r.ok)throw Error(r.status);
  await cache.put(new URL('precache.json',base()),r.clone());
  return await r.json();
 }catch{const kept=await cache.match(new URL('precache.json',base()));return kept?kept.json():null;}
};
const current=()=>(manifest||=readManifest().catch(()=>null));
// Revalidated against the server (a 304 when the browser already has it), so a stale HTTP copy
// is never kept under a new hash.
async function keep(cache,name,hash){
 const r=await fetch(new URL(name,base()),{cache:'no-cache'});
 if(r.ok)await cache.put(keyOf(name,hash),r.clone());
 return r;
}
// Copies whose hash is no longer listed, and files no longer shipped, are dropped.
async function prune(m){
 const cache=await caches.open(CACHE);
 for(const request of await cache.keys()){
  const url=new URL(request.url),name=url.href.slice(base().length).split('?')[0];
  if(name!=='precache.json'&&m.files[name]!==url.searchParams.get('v'))await cache.delete(request);
 }
}
self.addEventListener('install',event=>event.waitUntil((async()=>{
 const m=await (manifest=readManifest());
 if(!m?.files)throw Error('No precache.json');
 const cache=await caches.open(CACHE);
 for(let i=0;i<m.shell.length;i+=6)await Promise.all(m.shell.slice(i,i+6).map(async name=>{
  if(!await cache.match(keyOf(name,m.files[name]))&&!(await keep(cache,name,m.files[name])).ok)throw Error(`Could not cache ${name}`);
 }));
 await self.skipWaiting();
})()));
self.addEventListener('activate',event=>event.waitUntil((async()=>{
 for(const key of await caches.keys())if(key.startsWith('noteful-reader-')&&key!==CACHE)await caches.delete(key);
 const m=await current();
 if(m?.files)await prune(m);
})()));
// The file a navigation shows: the reader for the folder, an invite (/join, /tablet) or itself.
const pageOf=name=>(!name||name.endsWith('/')||name==='join'||name==='tablet'?'index.html':name);
// A cached response with the address the page asked for (modules resolve imports from it).
const serve=r=>new Response(r.body,{status:r.status,statusText:r.statusText,headers:r.headers});
self.addEventListener('fetch',event=>{
 const request=event.request,url=new URL(request.url);
 if(request.method!=='GET'||url.origin!==location.origin||!url.href.startsWith(base())||url.pathname.includes('/samples/')||request.headers.has('range'))return;
 let name;
 try{name=decodeURIComponent(url.pathname.slice(new URL(base()).pathname.length));}catch{return;}
 if(name==='precache.json')return;
 if(request.mode==='navigate'){
  // Pages from the network, so updates arrive; the manifest is read again for this load.
  manifest=readManifest().catch(()=>null);
  return event.respondWith(fetch(request).then(r=>{
   const copy=r.clone();
   event.waitUntil(current().then(async m=>{
    const hash=m?.files?.[pageOf(name)];
    if(r.ok&&hash)await (await caches.open(CACHE)).put(keyOf(pageOf(name),hash),copy);
    if(m?.files)await prune(m);
   }));
   return r;
  }).catch(async()=>{
   const m=await current(),hash=m?.files?.[pageOf(name)];
   const kept=(hash&&await caches.match(keyOf(pageOf(name),hash)))||await caches.match(new URL(pageOf(name),base()).href,{ignoreSearch:true});
   return kept?serve(kept):new Response('Offline page unavailable',{status:503});
  }));
 }
 event.respondWith((async()=>{
  const m=await current(),hash=m?.files?.[name];
  const cache=await caches.open(CACHE);
  if(hash){
   const hit=await cache.match(keyOf(name,hash));
   if(hit)return serve(hit);
   try{return await keep(cache,name,hash);}catch{/* Offline: any copy below. */}
  }else{
   try{return await fetch(request);}catch{/* Offline. */}
  }
  const kept=await cache.match(new URL(name,base()).href,{ignoreSearch:true});
  return kept?serve(kept):new Response('Offline asset unavailable',{status:503});
 })());
});
