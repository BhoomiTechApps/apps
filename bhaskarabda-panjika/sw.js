/* Bhaskarabda Panjika offline cache 1.2.0 */
const CACHE='bp-app-1.2.0';
const CORE=["./","assets/css/bp.min.css?v=1.2.0","assets/js/bp.min.js?v=1.2.0","assets/vendor/noto-sans-meetei-mayek/noto-sans-meetei-mayek-meetei-mayek-400-normal.woff2","assets/vendor/onest/onest-latin-ext-wght-normal.woff2","assets/vendor/onest/onest-latin-wght-normal.woff2","assets/vendor/tiro-bangla/tiro-bangla-bengali-400-normal.woff2","index.html","manifest.webmanifest","icons/icon-192.png","icons/icon-512.png"];
self.addEventListener('install',e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(CORE)).then(()=>self.skipWaiting()));});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));});
self.addEventListener('fetch',e=>{
  if(e.request.method!=='GET'||new URL(e.request.url).origin!==location.origin)return;
  e.respondWith(caches.match(e.request,{ignoreSearch:e.request.mode==='navigate'}).then(hit=>hit||fetch(e.request).then(res=>{if(res&&res.ok){const c=res.clone();caches.open(CACHE).then(x=>x.put(e.request,c));}return res;})).catch(()=>caches.match('index.html')));
});
