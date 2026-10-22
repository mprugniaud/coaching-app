/*
 * Stockage local de l'app (IndexedDB), partagé avec le service worker.
 *   kv      : 'config' {url, cle, demo}, 'programme', 'encours' (séance en cours)…
 *   videos  : yt → {yt, blob, taille, date}
 *   envois  : id → {id, envoi, resume, cree, essais, erreur, refuse}
 *             la file des séances à écrire dans la feuille
 * Rien ici ne dépend de la page : importé tel quel par sw.js.
 */
const DB_NOM = "ma-seance";
const DB_VERSION = 1;
let dbPromesse = null;

function ouvrirDB() {
  if (!dbPromesse) {
    dbPromesse = new Promise(function (ok, ko) {
      const req = indexedDB.open(DB_NOM, DB_VERSION);
      req.onupgradeneeded = function () {
        const db = req.result;
        if (!db.objectStoreNames.contains("kv")) db.createObjectStore("kv");
        if (!db.objectStoreNames.contains("videos")) db.createObjectStore("videos", { keyPath: "yt" });
        if (!db.objectStoreNames.contains("envois")) db.createObjectStore("envois", { keyPath: "id" });
      };
      req.onsuccess = function () {
        const db = req.result;
        // Le service worker et la page ont chacun leur connexion : on cède la
        // place à une mise à jour (ou suppression) de la base au lieu de la bloquer.
        db.onversionchange = function () { db.close(); dbPromesse = null; };
        ok(db);
      };
      req.onerror = function () { dbPromesse = null; ko(req.error); };
    });
  }
  return dbPromesse;
}

/** Une opération sur un magasin ; renvoie le résultat de la requête. */
function idb(magasin, mode, fn) {
  return ouvrirDB().then(function (db) {
    return new Promise(function (ok, ko) {
      const tx = db.transaction(magasin, mode);
      const req = fn(tx.objectStore(magasin));
      tx.oncomplete = function () { ok(req ? req.result : undefined); };
      tx.onerror = tx.onabort = function () { ko(tx.error); };
    });
  });
}

const kvGet = (k) => idb("kv", "readonly", (s) => s.get(k));
const kvSet = (k, v) => idb("kv", "readwrite", (s) => s.put(v, k));
const kvDel = (k) => idb("kv", "readwrite", (s) => s.delete(k));

const videoGet = (yt) => idb("videos", "readonly", (s) => s.get(yt));
const videoSet = (v) => idb("videos", "readwrite", (s) => s.put(v));
const videoCles = () => idb("videos", "readonly", (s) => s.getAllKeys());
const videosVider = () => idb("videos", "readwrite", (s) => s.clear());

const envoisTous = () => idb("envois", "readonly", (s) => s.getAll())
  .then((l) => l.sort((a, b) => a.cree - b.cree));
const envoiMettre = (e) => idb("envois", "readwrite", (s) => s.put(e));
const envoiSupprimer = (id) => idb("envois", "readwrite", (s) => s.delete(id));
