/* Minimal offline application shell. No personal itinerary, packing content, location, or external responses are cached. */
'use strict';
const CACHE='sk-travel-v4-public-shell-v1:'+encodeURIComponent(new URL(self.registration.scope).pathname);
const ASSETS=['./','./index.html','./packing.html','./packing-app.js','./manifest.webmanifest','./icons/icon-192.png','./icons/icon-512.png','./icons/apple-touch-icon.png','./icons/favicon-32.png'];
self.addEventListener('install',event=>{event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(ASSETS)));});
self.addEventListener('fetch',event=>{
  const req=event.request;
  if(req.method!=='GET')return;
  const url=new URL(req.url), scope=new URL(self.registration.scope);
  if(url.origin!==scope.origin)return;
  const allowed=new Set(ASSETS.map(path=>new URL(path,scope).pathname));
  if(!allowed.has(url.pathname))return;
  event.respondWith(caches.open(CACHE).then(async cache=>{
    const cached=await cache.match(new URL(url.pathname,scope.origin).href);
    if(cached)return cached;
    return fetch(req);
  }));
});
