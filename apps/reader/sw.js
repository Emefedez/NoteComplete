// Cache only application assets. Notes opened with the file picker never enter CacheStorage.
const CACHE='noteful-reader-v11';
self.addEventListener('install',event=>event.waitUntil((async()=>{
 const files=await (await fetch('./precache.json',{cache:'no-store'})).json();
 const cache=await caches.open(CACHE);await cache.addAll(files);
})()));
self.addEventListener('activate',event=>event.waitUntil((async()=>{for(const key of await caches.keys())if(key.startsWith('noteful-reader-')&&key!==CACHE)await caches.delete(key);})()));
self.addEventListener('fetch',event=>{
 const url=new URL(event.request.url);
 if(event.request.method!=='GET'||url.origin!==location.origin||url.pathname.includes('/samples/'))return;
 event.respondWith(fetch(event.request).catch(()=>caches.match(event.request).then(r=>r||new Response('Offline asset unavailable',{status:503}))));
});
