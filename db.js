/*
 * Stockage local de l'app (IndexedDB), partagé avec le service worker.
 *   kv      : 'config' {url, cle, demo}, 'programme', 'encours' (séance en cours)…
 *   videos  : yt → {yt, blob, taille, date}
 *   envois  : id → {id, envoi, resume, cree, essais, erreur, refuse}
 *             la file des séances à écrire dans la feuille
 * Rien ici ne dépend de la page : importé tel quel par sw.js.
 *
 * Copie de secours : Android a déjà vidé cette base (écran de configuration à la
 * salle, cause exacte inconnue, voir CLAUDE.md). Ce qu'il faut pour repartir
 * sans réseau est donc aussi écrit dans un cache à part (et la config dans le
 * localStorage). Si TOUT le site est vidé, les copies partent aussi : seul
 * navigator.storage.persist() protège de ça (protegerStockage dans app.js).
 */
const DB_NOM = "ma-seance";
const DB_VERSION = 1;
const CACHE_SECOURS = "flx-sauvegarde";
const CLES_SECOURS = ["config", "programme", "historique", "installation", "restaurations"];
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
        // Connexion coupée par le navigateur : sans ça, toutes les opérations
        // suivantes échoueraient jusqu'au prochain lancement.
        db.onclose = function () { dbPromesse = null; };
        ok(db);
      };
      req.onerror = function () { dbPromesse = null; ko(req.error); };
    });
  }
  return dbPromesse;
}

/** Une opération sur un magasin ; renvoie le résultat de la requête. */
function idb(magasin, mode, fn, options) {
  return ouvrirDB().then(function (db) {
    return new Promise(function (ok, ko) {
      const tx = db.transaction(magasin, mode, options);
      const req = fn(tx.objectStore(magasin));
      tx.oncomplete = function () { ok(req ? req.result : undefined); };
      tx.onerror = tx.onabort = function () { ko(tx.error); };
    });
  });
}

const kvGet = (k) => idb("kv", "readonly", (s) => s.get(k));
// La config passe en « strict » : écrite sur le disque avant de rendre la main,
// quitte à être un peu plus lente (une coupure ne doit pas la perdre).
const kvSet = (k, v) => idb("kv", "readwrite", (s) => s.put(v, k), k === "config" ? { durability: "strict" } : undefined)
  .then((r) => secoursEcrire(k, v).then(() => r));
const kvDel = (k) => idb("kv", "readwrite", (s) => s.delete(k))
  .then((r) => secoursEcrire(k, undefined).then(() => r));

const requeteSecours = (k) => new Request("secours/" + k);

/** Copie de secours d'une clé (undefined = l'effacer). Un échec ne bloque jamais l'écriture principale. */
async function secoursEcrire(k, v) {
  if (!CLES_SECOURS.includes(k)) return;
  try {
    if (k === "config" && typeof localStorage !== "undefined") {
      if (v === undefined) localStorage.removeItem("config-secours");
      else localStorage.setItem("config-secours", JSON.stringify(v));
    }
  } catch (err) {}
  try {
    const c = await caches.open(CACHE_SECOURS);
    if (v === undefined) await c.delete(requeteSecours(k));
    else await c.put(requeteSecours(k), new Response(JSON.stringify(v)));
  } catch (err) {}
}

/** Lit une copie de secours ; undefined si elle n'existe pas. */
async function secoursLire(k) {
  try {
    const c = await caches.open(CACHE_SECOURS);
    const r = await c.match(requeteSecours(k));
    if (r) return await r.json();
  } catch (err) {}
  try {
    if (k === "config" && typeof localStorage !== "undefined") {
      const t = localStorage.getItem("config-secours");
      if (t) return JSON.parse(t);
    }
  } catch (err) {}
  return undefined;
}

const videoGet = (yt) => idb("videos", "readonly", (s) => s.get(yt));
const videoSet = (v) => idb("videos", "readwrite", (s) => s.put(v));
const videoCles = () => idb("videos", "readonly", (s) => s.getAllKeys());
const videosVider = () => idb("videos", "readwrite", (s) => s.clear());

const envoisTous = () => idb("envois", "readonly", (s) => s.getAll())
  .then((l) => l.sort((a, b) => a.cree - b.cree));
const envoiMettre = (e) => idb("envois", "readwrite", (s) => s.put(e));
const envoiSupprimer = (id) => idb("envois", "readwrite", (s) => s.delete(id));
