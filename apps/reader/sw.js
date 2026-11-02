// Cache only application assets. Notes opened with the file picker never enter CacheStorage.
const CACHE='noteful-reader-v11';
// The Word and spreadsheet readers are fetched the first time such a file is opened, then
// kept for offline use, so installing stays light.
const LAZY=/vendor\/(mammoth|sheetjs)\//;
self.addEventListener('install',event=>event.waitUntil((async()=>{
 const files=await (await fetch('./precache.json',{cache:'no-store'})).json();
 const cache=await caches.open(CACHE);await cache.addAll(files.filter(f=>!LAZY.test(f)));
})()));
self.addEventListener('activate',event=>event.waitUntil((async()=>{for(const key of await caches.keys())if(key.startsWith('noteful-reader-')&&key!==CACHE)await caches.delete(key);})()));
self.addEventListener('fetch',event=>{
 const url=new URL(event.request.url);
 if(event.request.method!=='GET'||url.origin!==location.origin||url.pathname.includes('/samples/'))return;
 event.respondWith(fetch(event.request).then(r=>{
  if(r.ok&&LAZY.test(url.pathname)){const copy=r.clone();event.waitUntil(caches.open(CACHE).then(c=>c.put(event.request,copy)));}
  return r;
 }).catch(()=>caches.match(event.request).then(r=>r||new Response('Offline asset unavailable',{status:503}))));
});
