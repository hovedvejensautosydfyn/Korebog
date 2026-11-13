/*
 * Service worker til Kørebogen. Den gør to ting:
 *  - gemmer appens egne filer, så appen åbner hurtigt og også uden forbindelse (turene hentes stadig fra serveren)
 *  - henter index.html og config.js fra nettet først, så rettelser slår igennem med det samme
 * Kald til serveren (anden adresse, POST) rører den aldrig: svar fra API'et gemmes ALDRIG.
 * Appen deler adresse (BRUGERNAVN.github.io) med Procedurer-appen. Derfor rydder den kun sine
 * egne gemte filer (navne, der starter med "korebog-app-"), aldrig Procedurers.
 * Hæv CACHE-nummeret, når ikoner eller manifestet ændres.
 */
var PREFIX = 'korebog-app-';
var CACHE = PREFIX + 'v2';
var SHELL = ['index.html', 'config.js', 'manifest.webmanifest', 'icons/ikon2-180.png', 'icons/ikon2-192.png', 'icons/ikon2-512.png', 'icons/ikon2-maskable-512.png'];
var NETWORK_WAIT_MS = 4000; // på dårligt net vises den gemte udgave, hvis nettet er for langsomt

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE).then(function (cache) {
      return cache.addAll(SHELL.map(function (url) { return new Request(url, { cache: 'reload' }); }));
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (names) {
      return Promise.all(names.filter(function (n) { return n.indexOf(PREFIX) === 0 && n !== CACHE; }).map(function (n) { return caches.delete(n); }));
    }).then(function () { return self.clients.claim(); })
  );
});

/** Sidens adresse (mappen, med eller uden ?...) svarer til den ene gemte index.html. */
function fromCache(request) {
  if (request.mode === 'navigate') return caches.open(CACHE).then(function (cache) { return cache.match('index.html'); });
  return caches.open(CACHE).then(function (cache) { return cache.match(request, { ignoreSearch: true }); });
}

/** Nettet først (med frisk kopi), den gemte udgave hvis nettet svigter eller er langsomt. */
function networkFirst(request) {
  return new Promise(function (resolve) {
    var settled = false;
    function settle(response) { if (!settled) { settled = true; resolve(response); } }
    var timer = setTimeout(function () {
      fromCache(request).then(function (hit) { if (hit) settle(hit); });
    }, NETWORK_WAIT_MS);
    fetch(request.url, { cache: 'no-cache', credentials: 'same-origin' }).then(function (response) {
      clearTimeout(timer);
      if (response && response.ok) {
        var copy = response.clone();
        caches.open(CACHE).then(function (cache) { cache.put(request.mode === 'navigate' ? 'index.html' : request.url, copy); });
        settle(response);
        return;
      }
      // 404 eller 5xx fra serveren (fx GitHub Pages midt i en opdatering): vis hellere den gemte side end en fejlside.
      fromCache(request).then(function (hit) { settle(hit || response); });
    }, function () {
      clearTimeout(timer);
      fromCache(request).then(function (hit) { settle(hit || Response.error()); });
    });
  });
}

/** Ikoner og manifest ændrer sig sjældent: den gemte udgave først. */
function cacheFirst(request) {
  return caches.open(CACHE).then(function (cache) {
    return cache.match(request).then(function (hit) {
      if (hit) return hit;
      return fetch(request).then(function (response) {
        if (response && response.ok) cache.put(request, response.clone());
        return response;
      });
    });
  });
}

self.addEventListener('fetch', function (event) {
  var request = event.request;
  if (request.method !== 'GET') return;                       // API-kald er POST
  var url = new URL(request.url);
  if (url.origin !== self.location.origin) return;            // serveren og skrifttyper hentes direkte
  if (url.pathname.indexOf(new URL('./', self.location.href).pathname) !== 0) return;
  var page = request.mode === 'navigate' || /\/(index\.html|config\.js)$/.test(url.pathname);
  event.respondWith(page ? networkFirst(request) : cacheFirst(request));
});
