/* FORMA offline app shell. Bump CACHE when static assets change.
   The service worker only caches static files; workout data lives in browser storage and is never touched by updates. */
const CACHE='forma-shell-v2';
const ASSETS=['./','./index.html','./manifest.webmanifest','./icon.svg','./icon-180.png','./icon-192.png','./icon-512.png'];
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)).then(()=>self.skipWaiting())));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('forma-shell-')&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
/* Cache-first with background refresh: offline works, and the next launch picks up updated files. */
self.addEventListener('fetch',event=>{const req=event.request;if(req.method!=='GET'||new URL(req.url).origin!==self.location.origin)return;
 event.respondWith(caches.match(req,{ignoreSearch:true}).then(hit=>{
  const net=fetch(req).then(res=>{if(res&&res.ok){const copy=res.clone();caches.open(CACHE).then(c=>c.put(req,copy))}return res}).catch(()=>null);
  return hit||net.then(res=>res||caches.match('./index.html'));
 }))});
