const CACHE='cwf-shell-v4';
const ASSETS=['./review.html','./review.js','./review-core.js','./review.css','./','./index.html','./app.js','./product.js','./config.js','./engine.js','./product.css','./manifest.webmanifest','./icon-192.png','./icon-512.png','./vendor/chess.js','./vendor/stockfish.js','./vendor/stockfish.wasm.js','./vendor/stockfish.wasm','./privacy.html','./about.html','./info.css'];
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(ASSETS))));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('cwf-shell-')&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{
  const url=new URL(event.request.url);
  // Never cache player API requests, analytics, checkout, or third-party pages.
  if(event.request.method!=='GET'||url.origin!==self.location.origin||!ASSETS.some(path=>new URL(path,self.registration.scope).pathname===url.pathname))return;
  event.respondWith(fetch(event.request).then(response=>{
    if(response.ok){const copy=response.clone();event.waitUntil(caches.open(CACHE).then(cache=>cache.put(event.request,copy)));}
    return response;
  }).catch(()=>caches.match(event.request,{ignoreSearch:true}).then(cached=>cached||Response.error())));
});
