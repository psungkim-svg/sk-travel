/* SK-여행 v3.4: 핵심 오프라인 캐시 + 필요할 때 받는 한국어 PDF 자산 */
const CACHE_NAME = 'sk-travel-v34-optimized-1';
const PACKED_PDF_ASSETS = {"vendor/cmaps/Adobe-Korea1-0.bcmap":[0,241],"vendor/cmaps/Adobe-Korea1-1.bcmap":[241,386],"vendor/cmaps/Adobe-Korea1-2.bcmap":[627,391],"vendor/cmaps/Adobe-Korea1-UCS2.bcmap":[1018,23293],"vendor/cmaps/KSC-EUC-H.bcmap":[24311,1848],"vendor/cmaps/KSC-EUC-V.bcmap":[26159,164],"vendor/cmaps/KSC-H.bcmap":[26323,1831],"vendor/cmaps/KSC-Johab-H.bcmap":[28154,16791],"vendor/cmaps/KSC-Johab-V.bcmap":[44945,166],"vendor/cmaps/KSC-V.bcmap":[45111,160],"vendor/cmaps/KSCms-UHC-H.bcmap":[45271,2787],"vendor/cmaps/KSCms-UHC-HW-H.bcmap":[48058,2789],"vendor/cmaps/KSCms-UHC-HW-V.bcmap":[50847,169],"vendor/cmaps/KSCms-UHC-V.bcmap":[51016,166],"vendor/cmaps/KSCpc-EUC-H.bcmap":[51182,2024],"vendor/cmaps/KSCpc-EUC-V.bcmap":[53206,166],"vendor/cmaps/UniKS-UCS2-H.bcmap":[53372,25783],"vendor/cmaps/UniKS-UCS2-V.bcmap":[79155,178],"vendor/cmaps/UniKS-UTF16-H.bcmap":[79333,26327],"vendor/cmaps/UniKS-UTF16-V.bcmap":[105660,164],"vendor/cmaps/UniKS-UTF32-H.bcmap":[105824,26451],"vendor/cmaps/UniKS-UTF32-V.bcmap":[132275,168],"vendor/cmaps/UniKS-UTF8-H.bcmap":[132443,27790],"vendor/cmaps/UniKS-UTF8-V.bcmap":[160233,169],"vendor/standard_fonts/FoxitDingbats.pfb":[160402,29513],"vendor/standard_fonts/FoxitSymbol.pfb":[189915,16729]};
// Core-only install keeps first launch light. PDF/QR assets are cached on first use.
const APP_ASSETS = [
  './index.html',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/favicon-32.png'
];
let packedPdfAssetBuffer = null;

async function getPackedAssetResponse(relativePath) {
  const range = PACKED_PDF_ASSETS[relativePath];
  if (!range) return new Response('Not found', { status: 404 });
  if (!packedPdfAssetBuffer) {
    const cache = await caches.open(CACHE_NAME);
    const packUrl = new URL('./vendor/pdf-assets.pack', self.location.href).href;
    let response = await cache.match(packUrl);
    if (!response) {
      try {
        const networkResponse = await fetch(packUrl);
        if (!networkResponse.ok) return new Response('PDF asset pack is unavailable', { status: 503 });
        await cache.put(packUrl, networkResponse.clone());
        response = networkResponse;
      } catch (_) {
        return new Response('PDF asset pack is not available offline', { status: 503 });
      }
    }
    packedPdfAssetBuffer = await response.arrayBuffer();
  }
  const [offset, length] = range;
  if (offset < 0 || length < 0 || offset + length > packedPdfAssetBuffer.byteLength) {
    return new Response('Invalid packed PDF asset range', { status: 500 });
  }
  return new Response(packedPdfAssetBuffer.slice(offset, offset + length), {
    status: 200,
    headers: { 'Content-Type': 'application/octet-stream' }
  });
}

self.addEventListener('message', event => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(APP_ASSETS)));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys
        .filter(key => key.startsWith('sk-travel-') && key !== CACHE_NAME)
        .map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  const scopePath = new URL(self.registration.scope).pathname;
  if (url.pathname.startsWith(scopePath)) {
    let relativePath = '';
    try { relativePath = decodeURIComponent(url.pathname.slice(scopePath.length)); } catch (_) { relativePath = ''; }
    if (Object.prototype.hasOwnProperty.call(PACKED_PDF_ASSETS, relativePath)) {
      event.respondWith(getPackedAssetResponse(relativePath));
      return;
    }
  }

  if (request.mode === 'navigate') {
    const appShellUrl = new URL('./index.html', self.location.href).href;
    event.respondWith(
      fetch(request)
        .catch(async () => (await caches.match(request)) || (await caches.match(appShellUrl)))
    );
    return;
  }

  event.respondWith(
    caches.match(request).then(hit => {
      if (hit) return hit;
      return fetch(request).then(response => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(request, copy));
        }
        return response;
      });
    })
  );
});
