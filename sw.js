// Bump this on any deploy that changes a cached file — it's the only thing
// that invalidates the old cache. Kept in sync by eye with the BUILD const
// in script.js (they can't share a value directly: this file runs in a
// separate worker context script.js never loads into).
const CACHE_NAME = 'ladder-snake-v8';

// NOTE: './' only — do not add './index.html'. Cloudflare canonicalises
// /index.html to / with a 307, and cache.addAll() is unreliable for requests
// that redirect: the whole call can reject, which would take precaching (and
// therefore all offline support) down with it. './' is the canonical URL and
// serves the same document.
const CORE_ASSETS = [
  './',
  './style.css',
  './script.js',
  './data.js',
  './manifest.json',
  './assets/textures/romance.webp',
  './assets/textures/forest.webp',
  './assets/textures/ocean.webp',
  './assets/textures/meadow.webp',
  './assets/textures/sunset.webp',
  './assets/textures/night.webp',
  './icons/icon-192.png',
  './icons/icon-512.webp',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(CORE_ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

// Network-first, falling back to cache when offline — deliberately NOT
// cache-first. This project already spent two rounds fixing a bug where a
// plain static server let browsers serve a stale script.js forever; a
// cache-first service worker would reintroduce exactly that class of bug,
// just one layer deeper. Network-first means an online player always gets
// the current build, and a cached copy only kicks in with no connection.
self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  // Never touch cross-origin requests — the AI feature calls
  // api.anthropic.com / api.openai.com / generativelanguage.googleapis.com
  // directly from the page, and those must always hit the real network.
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    fetch(request)
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        return response;
      })
      // Falls back to './' rather than './index.html' — that is the URL the
      // document is actually cached under (see CORE_ASSETS above).
      .catch(() => caches.match(request).then((cached) => cached || caches.match('./')))
  );
});
