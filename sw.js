/*
 * Service worker : l'app s'ouvre sans réseau (fichiers en cache) et la file
 * des séances part dès que le réseau revient, même l'app fermée
 * (Background Sync, Chrome Android).
 * ⚠ Changer VERSION à chaque modification d'un fichier de l'app, sinon le
 *   téléphone garde l'ancienne version en cache.
 */
const VERSION = "ma-seance-v18";
const FICHIERS = [
  "./", "index.html", "style.css", "app.js", "db.js", "sync.js", "demo.js",
  "manifest.webmanifest", "icon-192.png", "icon-512.png", "icon.svg", "favicon-32.png",
  "apple-touch-icon.png", "fonts/inter.woff2"
];

importScripts("db.js", "sync.js");

self.addEventListener("install", function (e) {
  // cache: "reload" : sinon le navigateur peut resservir l'ANCIEN fichier gardé
  // dans son cache HTTP (GitHub Pages : 10 min), et la nouvelle version
  // s'installerait avec l'ancien contenu.
  e.waitUntil(
    caches.open(VERSION)
      .then((c) => c.addAll(FICHIERS.map((f) => new Request(f, { cache: "reload" }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", function (e) {
  e.waitUntil(
    caches.keys()
      .then((cles) => Promise.all(cles.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Fichiers de l'app : cache d'abord. Les appels à Apps Script passent tels quels
// (le programme et les vidéos sont gardés dans IndexedDB par l'app).
self.addEventListener("fetch", function (e) {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== self.location.origin) return;
  e.respondWith(
    caches.match(e.request, { ignoreSearch: true }).then(function (r) {
      if (r) return r;
      return fetch(e.request).catch(function () {
        return e.request.mode === "navigate" ? caches.match("index.html") : Response.error();
      });
    })
  );
});

// La page demande la version installée (affichée dans les Réglages).
self.addEventListener("message", function (e) {
  if (e.data === "version" && e.source) e.source.postMessage({ version: VERSION });
});

self.addEventListener("sync", function (e) {
  if (e.tag !== "envois") return;
  // Échouer tant qu'il reste des envois : Android reprogramme alors la synchro.
  e.waitUntil(envoyerFile().then(envoisTous).then(function (reste) {
    if (reste.some((x) => !x.refuse)) throw new Error("Envois en attente : nouvel essai plus tard");
  }));
});
