const CACHE_NAME = 'drawgeo-v1.1';
const ASSETS = [
    './',
    './index.html',
	'./manifest.json',
    './style-mnf.css',
    './main-obf.js',
    './favicon.ico',
    './icon-192.png',
    './icon-512.png',
	'./leaflet/leaflet.css',
	'./leaflet/leaflet.js',
	'./leaflet/leaflet.draw.js',
	'./leaflet/leaflet.draw.css',
	'./leaflet/Control.Geocoder.js',
	'./leaflet/Control.Geocoder.css',
	'./leaflet/images/layers.png',
	'./leaflet/images/layers-2x.png',
	'./leaflet/images/marker-icon.png',
	'./leaflet/images/marker-icon-2x.png',
	'./leaflet/images/marker-shadow.png',
	'./leaflet/images/spritesheet.svg',
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            console.log('DrawGeo: Caching shell assets');
            return cache.addAll(ASSETS);
        })
    );
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames.map((cache) => {
                    if (cache !== CACHE_NAME) {
                        console.log('DrawGeo: Clearing old cache');
                        return caches.delete(cache);
                    }
                })
            );
        })
    );
    return self.clients.claim();
});

self.addEventListener('fetch', (event) => {
    event.respondWith(
        fetch(event.request).catch(() => {
            return caches.match(event.request);
        })
    );
});