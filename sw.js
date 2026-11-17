
const CACHE_NAME = 'pwa-outbox-shell-v1';

const STATIC_ASSETS = [
  './',
  './index.html',
  './style.css',
  './db-helper.js',
  './app.js',
  './manifest.json'
];

// 1. INSTALL: Guardar el App Shell en Cache Storage
self.addEventListener('install', (event) => {
  console.log('[SW] Instalando Service Worker y precacheando App Shell...');
  self.skipWaiting();

  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS);
    })
  );
});

// 2. ACTIVATE: Eliminar cachés obsoletas y reclamar pestañas abiertas
self.addEventListener('activate', (event) => {
  console.log('[SW] Service Worker activado.');

  event.waitUntil(
    caches
      .keys()
      .then((keys) => {
        return Promise.all(
          keys.map((key) => {
            if (key !== CACHE_NAME) {
              console.log('[SW] Eliminando caché antigua:', key);
              return caches.delete(key);
            }
          })
        );
      })
      .then(() => {
        return self.clients.claim();
      })
  );
});

// 3. FETCH: Estrategia Cache First solo para archivos estáticos locales (GET)
self.addEventListener('fetch', (event) => {
  // Ignorar peticiones POST (como las de jsonplaceholder) para que vayan directo a red/Outbox
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(event.request).then((respuestaCache) => {
      return respuestaCache || fetch(event.request);
    })
  );
});