'use strict';
// Service worker de la version web : permet d'installer le planning comme une application.
// Toujours la version en ligne d'abord (mises à jour immédiates) ; la copie locale ne sert que hors connexion.
const CACHE = 'planning-20261028173706';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil((async () => {
  for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
  await self.clients.claim();
})()));

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return; // Supabase, ESPN : jamais en cache
  e.respondWith((async () => {
    try {
      const fresh = await fetch(e.request, { cache: 'no-store' });
      if (fresh.ok) (await caches.open(CACHE)).put(e.request, fresh.clone());
      return fresh;
    } catch {
      return (await caches.match(e.request)) || Response.error();
    }
  })());
});
