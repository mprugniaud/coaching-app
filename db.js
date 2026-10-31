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
 * sans réseau est donc aussi écrit dans un cache à part ET dans le localStorage.
 * Le 2026-10-31, la base et le cache sont partis ensemble alors que le stockage
 * était « protégé » : seul le localStorage a survécu. Il garde donc tout sauf les
 * vidéos (trop lourdes). Si TOUT le site est vidé, les copies partent aussi.
 */
const DB_NOM = "ma-seance";
const DB_VERSION = 1;
const CACHE_SECOURS = "flx-sauvegarde";
const CLES_SECOURS = ["config", "programme", "historique", "charge", "encours", "sons", "installation", "restaurations"];
// La séance en cours est écrite à chaque geste, sans attendre : seul le localStorage,
// synchrone, garantit qu'un abandon passe bien après la dernière sauvegarde.
const CLES_SANS_CACHE = ["encours"];
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
    if (typeof localStorage !== "undefined") {
      if (v === undefined) localStorage.removeItem(k + "-secours");
      else localStorage.setItem(k + "-secours", JSON.stringify(v));
    }
  } catch (err) {}
  if (CLES_SANS_CACHE.includes(k)) return;
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
    if (typeof localStorage !== "undefined") {
      const t = localStorage.getItem(k + "-secours");
      if (t) return JSON.parse(t);
    }
  } catch (err) {}
  return undefined;
}

/** Téléphone déjà installé : ses données n'ont jamais été copiées dans le localStorage. */
async function secoursCompleter() {
  if (typeof localStorage === "undefined") return;
  for (const k of CLES_SECOURS) {
    let absente = false;
    try { absente = localStorage.getItem(k + "-secours") === null; } catch (err) {}
    if (!absente) continue;
    const v = await kvGet(k);
    if (v !== undefined) await secoursEcrire(k, v);
  }
}

/**
 * Copie de la file d'envois : c'est la seule trace d'une séance pas encore partie.
 * Le service worker n'a pas de localStorage : cette copie peut donc garder un envoi
 * déjà parti, jusqu'à la prochaine ouverture. Sans risque, le serveur ignore un id déjà traité.
 */
async function secoursEnvois(liste) {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem("envois-secours", JSON.stringify(liste || await envoisTous()));
  } catch (err) {}
}

function secoursEnvoisLire() {
  try {
    if (typeof localStorage !== "undefined") return JSON.parse(localStorage.getItem("envois-secours")) || [];
  } catch (err) {}
  return [];
}

const videoGet = (yt) => idb("videos", "readonly", (s) => s.get(yt));
const videoSet = (v) => idb("videos", "readwrite", (s) => s.put(v));
const videoCles = () => idb("videos", "readonly", (s) => s.getAllKeys());
const videoSupprimer = (yt) => idb("videos", "readwrite", (s) => s.delete(yt));
const videosVider = () => idb("videos", "readwrite", (s) => s.clear());

const envoisTous = () => idb("envois", "readonly", (s) => s.getAll())
  .then((l) => l.sort((a, b) => a.cree - b.cree));
const envoiMettre = (e) => idb("envois", "readwrite", (s) => s.put(e)).then((r) => secoursEnvois().then(() => r));
const envoiSupprimer = (id) => idb("envois", "readwrite", (s) => s.delete(id)).then((r) => secoursEnvois().then(() => r));
