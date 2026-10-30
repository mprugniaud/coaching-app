/*
 * « FLX Training » — l'app de l'élève (anciennement « Ma séance »).
 *
 * Avant la salle (avec réseau) : le programme et les vidéos sont copiés sur le
 * téléphone (IndexedDB). À la salle (sans réseau) : semaine → séance → un
 * exercice (ou un superset) par écran, séries cochées une à une avec poids et
 * reps ajustables, minuteur de récup. À la fin : RPE et commentaires partent
 * dans une file, envoyée à la page web du Pilotage dès que le réseau revient
 * (voir sync.js).
 *
 * Le commentaire écrit dans la feuille est composé ICI (commentaireExo) pour
 * être montré tel quel dans le récapitulatif avant l'envoi.
 */
"use strict";

const $app = document.getElementById("app");
const $repos = document.getElementById("repos");
const $toast = document.getElementById("toast");

/** Vidéos téléchargées en même temps (Apps Script accepte des appels simultanés). */
const TELECHARGEMENTS_PARALLELES = 6;

/** Programme jugé assez frais pour ne pas le redemander avant de télécharger (ms). */
const PROGRAMME_FRAIS = 5 * 60 * 1000;

/**
 * Serveur (page web du Pilotage). Le lien magique « …/coaching-app/#cle=… »
 * n'apporte que le code : l'adresse du serveur est ici. Un « &serveur=… » dans
 * le lien la remplace (environnement de test).
 */
const SERVEUR = "https://script.google.com/macros/s/AKfycbwg5uKntHvtEeS2QgknmmYuJYXUd-QTS1AbYm4quPArtNXDUciCh1yrUacNu-QzUO41JQ/exec";

/** Version de la séance en cours sauvegardée : une ancienne est abandonnée. */
const VERSION_SEANCE = 2;

const etat = {
  config: null,        // {url, cle, demo}
  prog: null,          // réponse de ?api=programme
  seance: null,        // séance en cours (sauvée à chaque geste)
  envois: [],          // file d'envoi
  videos: new Set(),   // vidéos présentes sur le téléphone
  vue: "accueil",
  semaine: null,       // sheetId de la semaine affichée
  apercu: null,        // ref de la séance affichée avant de commencer
  apercuExo: 0,        // exercice de cette séance vu en aperçu (indice)
  menu: null,          // menu ouvert : indice d'un exo, ou "seance"
  historique: {},      // ref → résumé des séances faites avec l'app (sur ce téléphone)
  commentaires: {},    // exos dont la zone de commentaire est dépliée
  telechargements: {}, // clé → {fait, total, erreurs}
  majA: 0,             // dernière mise à jour réussie du programme (ms)
  actualisation: false, // « Actualiser » en cours : bouton qui tourne
  charge: null,        // réponse de ?api=charge (suivi de fatigue), gardée hors ligne
  form: null,          // séance en cours de déclaration
  progEdit: null,      // séance programmée en cours de modification
  videoEls: {},        // yt → <video>, gardées d'un rendu à l'autre
  sons: true,          // bande-son de la séance (réglage, kv « sons »)
  enLigne: navigator.onLine,
  installer: null      // proposition d'installation de Chrome (beforeinstallprompt)
};


/* ================================ ICÔNES ================================= */
// Tracés Lucide (ISC), en ligne : rien à charger, marche hors réseau.
const ICONES = {
  check: '<path d="M20 6 9 17l-5-5"/>',
  x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  gauche: '<path d="m15 18-6-6 6-6"/>',
  droite: '<path d="m9 18 6-6-6-6"/>',
  plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
  moins: '<path d="M5 12h14"/>',
  plusieurs: '<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>',
  telecharger: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/>',
  rafraichir: '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>',
  reglages: '<path d="M20 7h-9"/><path d="M14 17H5"/><circle cx="17" cy="17" r="3"/><circle cx="7" cy="7" r="3"/>',
  haltere: '<path d="M6 5v14"/><path d="M18 5v14"/><path d="M3 8v8"/><path d="M21 8v8"/><path d="M6 12h12"/>',
  course: '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
  chrono: '<line x1="10" x2="14" y1="2" y2="2"/><line x1="12" x2="15" y1="14" y2="11"/><circle cx="12" cy="14" r="8"/>',
  sauter: '<polygon points="5 4 15 12 5 20 5 4"/><line x1="19" x2="19" y1="5" y2="19"/>',
  bulle: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
  horsligne: '<path d="M12 20h.01"/><path d="M8.5 16.429a5 5 0 0 1 7 0"/><path d="M5 12.859a10 10 0 0 1 5.17-2.69"/><path d="M19 12.859a10 10 0 0 0-2.007-1.523"/><path d="M2 8.82a15 15 0 0 1 4.177-2.643"/><path d="M22 8.82a15 15 0 0 0-11.288-3.764"/><path d="m2 2 20 20"/>',
  lien: '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
  calendrier: '<rect width="18" height="18" x="3" y="4" rx="2"/><path d="M16 2v4"/><path d="M8 2v4"/><path d="M3 10h18"/>',
  sansvideo: '<path d="M10.66 6H14a2 2 0 0 1 2 2v2.5l5.248-3.062A.5.5 0 0 1 22 7.87v8.196"/><path d="M16 16a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h2"/><path d="m2 2 20 20"/>',
  historique: '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l4 2"/>',
  envoi: '<path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/>',
  charge: '<line x1="18" x2="18" y1="20" y2="10"/><line x1="12" x2="12" y1="20" y2="4"/><line x1="6" x2="6" y1="20" y2="14"/>',
  crayon: '<path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/>',
  aide: '<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><path d="M12 17h.01"/>'
};
/** Logo FLX Training (même dessin que app/icon.svg : direction « Couloirs »), en ligne pour marcher hors réseau. */
const LOGO_SVG = '<svg viewBox="0 0 512 512" aria-hidden="true"><rect width="512" height="512" fill="#c4462c"/><g fill="#ffffff" opacity=".9"><rect x="35" width="10" height="512"/><rect x="155" width="10" height="512"/><rect x="347" width="10" height="512"/><rect x="467" width="10" height="512"/></g><rect x="64" y="92" width="386" height="252" fill="#c4462c"/><g fill="#ffffff"><rect x="78" y="110" width="52" height="220"/><rect x="78" y="110" width="100" height="46"/><rect x="78" y="200" width="88" height="42"/><rect x="196" y="110" width="52" height="220"/><rect x="196" y="284" width="96" height="46"/><polygon points="304,110 358,110 436,330 382,330"/><polygon points="382,110 436,110 358,330 304,330"/></g><rect x="96" y="372" width="320" height="44" fill="#17213a"/></svg>';
const marque = () => `<div class="marque">${LOGO_SVG}FLX TRAINING</div>`;

const ic = (nom, cls) => `<svg class="i ${cls || ""}" viewBox="0 0 24 24" aria-hidden="true">${ICONES[nom]}</svg>`;

/**
 * Anneau de progression (part des séances faites) : l'icône d'une semaine
 * passée pas entièrement faite. Montre ce qui a été fait plutôt qu'un échec.
 */
function anneau(faites, total) {
  const c = 2 * Math.PI * 9, part = total ? faites / total : 0;
  return `<svg class="i anneau" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" class="fond"/>
    ${part ? `<circle cx="12" cy="12" r="9" stroke-dasharray="${(c * part).toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 12 12)"/>` : ""}</svg>`;
}


/* ================================ OUTILS ================================= */

const esc = (v) => String(v === null || v === undefined ? "" : v)
  .replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/** Date locale au format AAAA-MM-JJ (celui qu'attend le serveur). */
const isoLocal = (d) => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
/** « 2026-10-23 » → « ven. 23/10 ». */
const jourCourt = (iso) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || "");
  if (!m) return iso || "";
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return d.toLocaleDateString("fr-FR", { weekday: "short" }) + " " + m[3] + "/" + m[2];
};

const mmss = (s) => Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
const num = (t) => Number(String(t).replace(",", "."));
const fmtNum = (n) => String(Math.round(n * 100) / 100).replace(".", ",");

function uuid() {
  if (self.crypto && crypto.randomUUID) return crypto.randomUUID();
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

let toastMinuteur = null;
function toast(texte, duree) {
  $toast.textContent = texte;
  $toast.hidden = false;
  clearTimeout(toastMinuteur);
  toastMinuteur = setTimeout(() => { $toast.hidden = true; }, duree || 3500);
}

function sauver() {
  if (etat.seance) kvSet("encours", etat.seance).catch(() => {});
}

function rpeRempli(v) {
  const s = String(v === null || v === undefined ? "" : v).trim();
  return s !== "" && s !== "0";
}

const nomCle = (n) => String(n || "").toLowerCase().replace(/\s*-\s*youtube\s*$/, "").replace(/\s+/g, " ").trim();

/** « S4 (19/10-25/10) » → {titre: "S4", dates: "19/10 – 25/10"}. */
function nomSemaine(onglet) {
  const m = /^(.*?)\s*\((.*)\)\s*$/.exec(onglet || "");
  return m ? { titre: m[1], dates: m[2].replace(/\s*-\s*/, " – ") } : { titre: onglet, dates: "" };
}

/** Date locale → « aaaa-mm-jj » (comparable en texte). */
const isoJour = (d) => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");

/** Lundi (« aaaa-mm-jj ») de la semaine d'une date. Midi : à l'abri des changements d'heure. */
function lundiIso(d) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12);
  x.setDate(x.getDate() - (x.getDay() + 6) % 7);
  return isoJour(x);
}

/**
 * Où tombe un onglet semaine par rapport à aujourd'hui, d'après le « (jj/mm »
 * de son nom (même règle que lundiDepuisNom_ de CoachLib : l'année la plus
 * proche) : "courante", "passee" ou "future". Sans date dans le nom :
 * "courante" (c'est la convention : le premier onglet = la semaine en cours).
 * Sert quand le lundi arrive avant le programme de Félix : le premier onglet
 * est alors encore celui de la semaine dernière.
 */
function quandSemaine(onglet) {
  const m = /\((\d{1,2})\/(\d{1,2})/.exec(onglet || "");
  if (!m) return "courante";
  const auj = new Date();
  let d = null;
  [-1, 0, 1].forEach((dy) => {
    const x = new Date(auj.getFullYear() + dy, Number(m[2]) - 1, Number(m[1]), 12);
    if (!d || Math.abs(x - auj) < Math.abs(d - auj)) d = x;
  });
  const l = lundiIso(d), ici = lundiIso(auj);
  return l === ici ? "courante" : l < ici ? "passee" : "future";
}

/**
 * Semaine terminée (dans le passé) ? D'après la date du nom ; sans date,
 * tout onglet après le premier (convention : plus loin = plus ancien).
 */
function semainePassee(sem, k) {
  return /\(\d/.test(sem.onglet || "") ? quandSemaine(sem.onglet) === "passee" : k > 0;
}


/** Poids prévu, en kg, lu dans la charge de Félix : « Barre +27,5 kg » → 27,5. */
function poidsPrevu(charge) {
  const m = /(\d+(?:[.,]\d+)?)\s*kg/i.exec(charge || "");
  if (m) return num(m[1]);
  const seul = /^\s*(\d+(?:[.,]\d+)?)\s*$/.exec(charge || "");
  return seul ? num(seul[1]) : null;
}

/** Reps (ou durée) prévues : « 7/côté » → 7 ; « 35 s/côté » → 35 s ; « 8 min » → 8 min. */
function repsPrevues(reps) {
  const m = /^\s*(\d+)\s*(min|mn|sec|s\b|'|")?/i.exec(reps || "");
  if (!m) return null;
  let unite = "";
  if (m[2]) unite = /^m/i.test(m[2]) || m[2] === "'" ? "min" : "s";
  return { n: Number(m[1]), unite: unite };
}

function fmtReps(x, n) {
  const u = x.repsPrevues ? x.repsPrevues.unite : "";
  return n + (u ? " " + u : " reps");
}


/* ============================== DÉMARRAGE ================================ */

async function demarrer() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
    // Une nouvelle version vient de s'installer : on recharge pour l'afficher,
    // sauf en pleine séance (ce sera à la prochaine ouverture).
    const avaitUnSW = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (avaitUnSW && etat.vue !== "seance" && etat.vue !== "recap") location.reload();
    });
    navigator.serviceWorker.addEventListener("message", (e) => {
      // Le service worker a vidé la file (Background Sync) : la page n'en sait
      // rien sinon, et la charge affichée resterait l'ancienne.
      if (e.data && e.data.envoyes) { apresEnvoi(); return; }
      if (e.data && e.data.version) {
        etat.versionApp = e.data.version.replace("flx-", "");
        const el = document.getElementById("version");
        if (el) el.textContent = etat.versionApp;
      }
    });
  }

  await restaurerStockage();
  etat.config = await kvGet("config");
  await lienMagique();
  etat.prog = await kvGet("programme");
  etat.seance = await kvGet("encours");
  etat.historique = (await kvGet("historique")) || {};
  etat.charge = (await kvGet("charge")) || null;
  etat.sons = (await kvGet("sons")) !== false;
  if (etat.seance && etat.seance.v !== VERSION_SEANCE) {
    etat.seance = null;                    // séance d'une version précédente de l'app
    await kvDel("encours");
  }
  await rafraichirLocaux();
  protegerStockage();

  if (!etat.config) etat.vue = "config";
  else if (etat.seance) etat.vue = "seance";
  history.replaceState({ vue: etat.vue }, "");
  rendre();

  if (etat.bienvenue) toast("Bienvenue sur FLX Training ! Ton programme se télécharge…", 4000);
  if (etat.config) {
    synchroniser();
    if (navigator.onLine) {
      majProgramme(true).then(preparerSemaineEnCours);
      majCharge(true);
      telechargerSons();
      envoyerDiag();
    }
  }
  setInterval(tic, 1000);
}

/**
 * Base vidée mais copie de secours présente : on remet tout en place sans
 * rien demander, l'élève repart même sans réseau (les vidéos, elles, sont à
 * retélécharger). Chaque restauration est comptée pour le diagnostic.
 */
async function restaurerStockage() {
  etat.restaurations = (await kvGet("restaurations")) || (await secoursLire("restaurations")) || [];
  if (!(await kvGet("installation"))) {
    const copie = await secoursLire("installation");
    await kvSet("installation", copie || { id: uuid(), cree: Date.now() });
  }
  if (await kvGet("config")) return;

  const config = await secoursLire("config");
  if (!config) return;
  for (const k of ["programme", "historique"]) {
    const v = await secoursLire(k);
    if (v !== undefined) await kvSet(k, v);
  }
  await kvSet("config", config);
  etat.restaurations = etat.restaurations.concat(Date.now()).slice(-20);
  await kvSet("restaurations", etat.restaurations);
}

/**
 * Demande au navigateur de ne pas vider le stockage de l'app. À chaque
 * lancement tant que ce n'est pas accordé : Chrome décide selon l'usage du
 * site (app installée, visites), un refus d'hier peut être accordé aujourd'hui.
 */
async function protegerStockage() {
  const s = navigator.storage;
  if (!s || !s.persist || !s.persisted) return null;
  try {
    return (await s.persisted()) || (await s.persist());
  } catch (err) {
    return false;
  }
}

/**
 * État du stockage envoyé au Pilotage (onglet « _Diag app ») à chaque lancement
 * en ligne : c'est la seule trace qui survit à un vidage complet du téléphone,
 * et la seule façon de savoir pourquoi le profil a sauté. Serveur pas encore à
 * jour ou réseau capricieux : tant pis, ce n'est qu'un diagnostic.
 */
async function envoyerDiag() {
  const c = etat.config;
  if (!c || c.demo) return;
  try {
    const protege = await protegerStockage();
    const estim = navigator.storage && navigator.storage.estimate ? await navigator.storage.estimate() : {};
    const mo = (o) => (o ? Math.round(o / 1048576) : "");
    const version = (await caches.keys()).find((k) => k.startsWith("flx-v")) || "";
    await posterJSON(c.url, {
      action: "diag", cle: c.cle,
      installation: (await kvGet("installation") || {}).id,
      protege: protege,
      usageMo: mo(estim.usage),
      quotaMo: mo(estim.quota),
      videos: etat.videos.size,
      restaurations: etat.restaurations.length,
      mode: matchMedia("(display-mode: standalone)").matches ? "installée" : "navigateur",
      navigateur: navigator.userAgent,
      version: version.replace("flx-", "")
    });
  } catch (err) {}
}

/**
 * L'élève a ouvert son lien perso (« #cle=… », QR code de Félix) : l'app se
 * configure toute seule. Le code est retiré de la barre d'adresse aussitôt.
 * Lien d'un AUTRE compte que celui en place : on demande avant de remplacer.
 */
async function lienMagique() {
  const p = new URLSearchParams(location.hash.slice(1));
  const cle = p.get("cle") || "";
  if (!/^[0-9a-f]{32}$/.test(cle)) return;
  history.replaceState(null, "", location.pathname);
  const url = p.get("serveur") || SERVEUR;

  const c = etat.config;
  if (c && !c.demo && c.cle === cle && c.url === url) return;           // déjà configurée
  if (c && !c.demo && !confirm("Ce lien est celui d'un autre compte. Remplacer le compte actuel sur ce téléphone ?")) return;

  // Nouveau compte : rien de l'ancien ne doit se mélanger (séance en cours, programme, charge, historique).
  for (const k of ["programme", "charge", "encours", "historique", "demoEnvoi"]) await kvDel(k);
  etat.config = { url: url, cle: cle, demo: false };
  await kvSet("config", etat.config);
  etat.bienvenue = true;
}

// Chrome propose d'installer l'app : on garde la proposition pour un bouton à nous.
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  etat.installer = e;
  if (etat.vue === "accueil") rendre();
});
window.addEventListener("appinstalled", () => { etat.installer = null; rendre(); });

async function rafraichirLocaux() {
  etat.envois = await envoisTous();
  etat.videos = new Set(await videoCles());
}

window.addEventListener("online", () => { etat.enLigne = true; synchroniser(); rendreStatut(); });
window.addEventListener("offline", () => { etat.enLigne = false; rendreStatut(); });
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible") return;
  synchroniser();
  if (etat.vue === "seance") garderEcran(true);
});

// Bouton retour d'Android : revenir d'un écran plutôt que fermer l'app.
window.addEventListener("popstate", (e) => {
  if (etat.menu !== null) { etat.menu = null; rendre(); return; }
  const vue = (e.state && e.state.vue) || "accueil";
  if (etat.vue === "seance" && vue !== "recap" && vue !== "seance") sortirSeance();
  etat.vue = vue === "seance" && !etat.seance ? "accueil" : vue;
  rendre();
});

function naviguer(vue) {
  if (vue === etat.vue) return;
  if (etat.vue === "seance" && vue !== "recap") sortirSeance();
  etat.vue = vue;
  history.pushState({ vue: vue }, "");
  rendre();
  window.scrollTo(0, 0);
}

/** Remplace l'écran courant sans laisser d'entrée « retour » (fin de séance…). */
function allerA(vue) {
  if (etat.vue === "seance") sortirSeance();
  etat.vue = vue;
  history.replaceState({ vue: vue }, "");
  rendre();
  window.scrollTo(0, 0);
}

/** Chaque seconde : chrono de la séance, sans tout redessiner. */
function tic() {
  const el = document.getElementById("chrono");
  if (el && etat.seance) el.textContent = mmss(Math.floor((Date.now() - etat.seance.debut) / 1000));
}


/* ============================ RÉSEAU / ENVOIS ============================ */

async function synchroniser() {
  if (!etat.config) return;
  await rafraichirLocaux();
  if (!etat.envois.some((e) => !e.refuse)) return;

  let bilan = null;
  try { bilan = await envoyerFile(); } catch (err) { bilan = null; }
  await rafraichirLocaux();

  if (bilan && bilan.envoyes) {
    const ignores = [].concat(...bilan.rapports.map((r) => r.rapport.ignores || []));
    const seances = bilan.envoyes - (bilan.corrections || 0);
    toast("✓ " + (seances ? seances + (seances > 1 ? " séances écrites" : " séance écrite") : "RPE corrigé") +
          " dans ta feuille" + (ignores.length ? " — non retrouvés : " + ignores.join(", ") : ""), 5000);
  }
  if (etat.envois.some((e) => !e.refuse)) syncArrierePlan();
  // Charge relue AVANT de redessiner : sinon la séance quitte « À envoyer »
  // sans être encore comptée dans la semaine.
  if (bilan && bilan.envoyes) await majCharge(true);
  if (["accueil", "semaine", "charge"].includes(etat.vue)) rendre(); else rendreStatut();
}

/** Envoi fait par le service worker : on relit la file et la charge. */
async function apresEnvoi() {
  await rafraichirLocaux();
  await majCharge(true);
  if (["accueil", "semaine", "charge"].includes(etat.vue)) rendre(); else rendreStatut();
}

/** Laisse Android envoyer la file plus tard, même l'app fermée. */
function syncArrierePlan() {
  if (!("serviceWorker" in navigator)) return;
  navigator.serviceWorker.ready
    .then((reg) => reg.sync && reg.sync.register("envois"))
    .catch(() => {});
}

async function majProgramme(silencieux) {
  const c = etat.config;
  try {
    let rep;
    if (c.demo) {
      rep = JSON.parse(JSON.stringify(PROGRAMME_DEMO));
    } else {
      const r = await fetch(c.url + "?api=programme&cle=" + encodeURIComponent(c.cle));
      rep = await r.json();
    }
    if (!rep.ok) throw new Error(rep.erreur || "réponse inattendue");
    reporterCorrections(rep);
    etat.prog = rep;
    etat.majA = Date.now();
    await kvSet("programme", rep);
    if (!silencieux) toast("Programme à jour");
  } catch (err) {
    if (!silencieux) toast("Mise à jour impossible : " + err.message, 5000);
    return false;
  }
  if (["accueil", "semaine", "apercu", "apercuExo"].includes(etat.vue)) rendre();
  return true;
}

/**
 * La séance en cours garde sa copie des exos : on y reporte les liens et la
 * présence au Drive relus (un lien corrigé dans la feuille entre-temps).
 */
function majSeanceDepuisProgramme() {
  const S = etat.seance;
  const t = S && trouverSeance(S.ref);
  if (!t) return;
  S.exos.forEach((x) => {
    const p = t.seance.exos.find((y) => y.ligne === x.ligne && nomCle(y.nom) === nomCle(x.nom));
    if (p) Object.assign(x, { lien: p.lien, yt: p.yt, video: p.video });
  });
  sauver();
}

/**
 * À l'ouverture de l'app, avec du réseau : les vidéos de la semaine en cours
 * sont copiées en arrière-plan, pour qu'une séance ouverte ensuite soit prête.
 * Rien si le téléphone est en mode « économie de données ».
 */
function preparerSemaineEnCours(ok) {
  const sem = semaines()[0];
  const c = navigator.connection;
  if (!ok || !sem || (c && c.saveData)) return;
  preparerHorsLigne("sem-" + sem.sheetId, sem.seances.map((s) => s.ref), true);
}

/** Copie une vidéo du Drive sur le téléphone. */
const videosEnCours = {};
function telechargerVideo(yt) {
  if (!videosEnCours[yt]) {
    videosEnCours[yt] = telechargerVideo_(yt).finally(() => { delete videosEnCours[yt]; });
  }
  return videosEnCours[yt];
}

async function telechargerVideo_(yt) {
  const r = await fetch(etat.config.url + "?api=video&cle=" + encodeURIComponent(etat.config.cle) +
                        "&yt=" + encodeURIComponent(yt));
  const rep = await r.json();
  if (!rep.ok) throw new Error(rep.erreur);
  const blob = await (await fetch("data:" + rep.mime + ";base64," + rep.base64)).blob();
  await videoSet({ yt: yt, blob: blob, taille: blob.size, date: Date.now() });
  etat.videos.add(yt);
}

/**
 * Redessine pour montrer l'avancement — sauf en pleine saisie dans une
 * séance (on effacerait le chiffre en cours de frappe).
 */
function rendreDiscret() {
  const a = document.activeElement;
  if (etat.vue === "seance" && a && /^(INPUT|TEXTAREA)$/.test(a.tagName)) return;
  rendre();
}

/** Bouton « Actualiser » : icône qui tourne et désactivé pendant l'actualisation. */
function boutonActualiser(libelle) {
  const enCours = etat.actualisation;
  return `<button class="btn sm outline" data-a="actualiser" ${etat.enLigne && !enCours ? "" : "disabled"}>
    ${ic("rafraichir", "sm" + (enCours ? " tourne" : ""))}${enCours ? "Actualisation…" : libelle || "Actualiser"}</button>`;
}

/** Programme ET charge relus ensemble, avec un seul message à la fin. */
async function actualiser() {
  if (etat.actualisation) return;
  etat.actualisation = true;
  rendre();
  const [prog, charge] = await Promise.all([majProgramme(true), majCharge(true)]);
  etat.actualisation = false;
  rendre();
  toast(prog ? "✓ Programme" + (charge && etat.charge && etat.charge.equipe ? " et charge" : "") + " à jour"
             : "Mise à jour impossible : vérifie ta connexion.", prog ? 2500 : 5000);
}

/** Suivi de charge (même lien perso). Gardé sur le téléphone pour l'afficher hors réseau. */
async function majCharge(silencieux) {
  const c = etat.config;
  if (!c) return false;
  try {
    let rep;
    if (c.demo) {
      rep = JSON.parse(JSON.stringify(CHARGE_DEMO));
    } else {
      const r = await fetch(c.url + "?api=charge&cle=" + encodeURIComponent(c.cle) + "&t=" + Date.now(), { cache: "no-store" });
      rep = await r.json();
    }
    if (!rep.ok) throw new Error(rep.erreur || "réponse inattendue");
    rep.maj = new Date().toISOString();
    etat.charge = rep;
    await kvSet("charge", rep);
    if (!silencieux) toast("Charge à jour");
  } catch (err) {
    if (!silencieux) toast("Mise à jour impossible : " + err.message, 5000);
    return false;
  }
  if (["charge", "accueil"].includes(etat.vue)) rendre();
  return true;
}

/**
 * Télécharge les vidéos manquantes d'une liste de séances. Le programme est
 * relu d'abord : une vidéo déposée depuis la dernière mise à jour (ou un lien
 * corrigé dans la feuille) est ainsi prise en compte.
 * @param {boolean=} discret  lancé tout seul (ouverture d'une séance) : pas de
 *        message si tout est déjà là
 */
async function preparerHorsLigne(cle, refs, discret) {
  if (etat.telechargements[cle] || !etat.config || etat.config.demo) return;
  const t = { fait: 0, total: 0, erreurs: 0, message: "" };
  etat.telechargements[cle] = t;
  try {
    await preparer_(t, refs, discret);
  } catch (err) {
    toast("Téléchargement interrompu : " + err.message, 5000);
  } finally {
    delete etat.telechargements[cle];
    rendreDiscret();
  }
}

async function preparer_(t, refs, discret) {
  rendreDiscret();
  if (Date.now() - etat.majA > PROGRAMME_FRAIS) await majProgramme(true);
  majSeanceDepuisProgramme();

  const yts = new Set();
  let absentes = 0;
  refs.forEach((ref) => {
    const s = trouverSeance(ref);
    if (!s) return;
    s.seance.exos.forEach((x) => {
      if (x.yt && x.video && !etat.videos.has(x.yt)) yts.add(x.yt);
      if (x.yt && !x.video) absentes++;
    });
  });
  t.total = yts.size;
  if (!yts.size) {
    if (!discret) toast(absentes ? absentes + " vidéo(s) pas encore dans le Drive." : "Tout est déjà sur le téléphone.");
    return;
  }

  rendreDiscret();
  // Plusieurs à la fois : chaque appel à Apps Script met quelques secondes à
  // démarrer, c'est ce délai (pas la taille des vidéos) qui fait la durée.
  const file = [...yts];
  const ouvrier = async () => {
    while (file.length) {
      const yt = file.shift();
      try {
        await telechargerVideo(yt);
      } catch (err) {
        t.erreurs++;
        t.message = err.message;
      }
      t.fait++;
      rendreDiscret();
    }
  };
  await Promise.all(Array.from({ length: Math.min(TELECHARGEMENTS_PARALLELES, file.length) }, ouvrier));
  toast(t.erreurs ? t.erreurs + " vidéo(s) en échec : " + t.message
                  : "✓ " + t.total + " vidéo(s) sur le téléphone" + (absentes ? " (" + absentes + " pas dans le Drive)" : ""), 4000);
}

/**
 * Vidéos d'une séance : progression si un téléchargement tourne (celui de la
 * séance ou celui de sa semaine), sinon bouton s'il en manque. Jamais de
 * bouton grisé : on peut commencer la séance pendant le téléchargement.
 */
function barreVideos(s, v) {
  const actif = Object.keys(etat.telechargements).length > 0;
  if (v.ici >= v.total) return "";
  if (actif && etat.enLigne) {
    return `<div class="card stack" style="margin-bottom:14px"><div class="row between">
      <span class="sm row">${ic("telecharger", "sm")}Vidéos en cours de téléchargement</span>
      <span class="sm muted tnum">${v.ici}/${v.total}</span></div>
      <div class="bar accent"><div style="width:${v.total ? Math.round(100 * v.ici / v.total) : 0}%"></div></div></div>`;
  }
  if (!etat.enLigne) {
    return `<p class="sm muted row" style="margin-bottom:14px">${ic("horsligne", "sm")}${v.total - v.ici} vidéo(s) pas sur le téléphone (pas de réseau)</p>`;
  }
  return `<button class="btn outline block" style="margin-bottom:14px" data-a="preparer-seance" data-ref="${esc(s.ref)}">
    ${ic("telecharger")}Télécharger les vidéos · ${v.total - v.ici}</button>`;
}

/* =============================== PROGRAMME =============================== */

const semaines = () => (etat.prog ? etat.prog.programme.semaines : []);

function trouverSeance(ref) {
  for (const sem of semaines()) {
    for (const s of sem.seances) if (s.ref === ref) return { semaine: sem, seance: s };
  }
  return null;
}

/** Faite dans la feuille : au moins 80 % des RPE, comme le Suivi de Félix. */
function seanceFaite(s) {
  if (s.type === "course") return rpeRempli(s.rpePied);
  const n = s.exos.filter((x) => rpeRempli(x.rpe)).length;
  return s.exos.length > 0 && n / s.exos.length >= 0.8;
}

function enAttente(ref) {
  return etat.envois.some((e) => e.envoi && e.envoi.ref === ref && !e.refuse);
}

function videosDe(seances) {
  const avec = new Set();
  seances.forEach((s) => s.exos.forEach((x) => { if (x.yt && x.video) avec.add(x.yt); }));
  const ici = [...avec].filter((yt) => etat.videos.has(yt)).length;
  return { total: avec.size, ici: ici };
}

/** Étapes d'une séance : un exo seul, ou un superset (Séries fusionnées dans la feuille). */
function etapesDe(exos) {
  const etapes = [];
  exos.forEach((x, i) => {
    const prec = etapes[etapes.length - 1];
    if (x.groupe && prec && exos[prec[0]].groupe === x.groupe) prec.push(i);
    else etapes.push([i]);
  });
  return etapes;
}

/** Le même exercice dans une semaine plus ancienne du programme. */
function historique(nom, onglet) {
  const liste = semaines();
  const k = liste.findIndex((s) => s.onglet === onglet);
  for (let j = k + 1; j < liste.length; j++) {
    for (const s of liste[j].seances) {
      const x = s.exos.find((e) => nomCle(e.nom) === nomCle(nom));
      if (x) return { semaine: nomSemaine(liste[j].onglet).titre, x: x };
    }
  }
  return null;
}


/* ============================ SÉANCE EN COURS ============================ */

function nouvelleSeance(s, onglet) {
  const exos = s.exos.map((x) => {
    const poids = s.type === "salle" ? poidsPrevu(x.charge) : null;
    const reps = repsPrevues(x.reps);
    return Object.assign({}, x, {
      poidsPrevu: poids,
      repsPrevues: reps,
      sets: Array.from({ length: x.nbSeries || 1 }, () => ({ fait: false, poids: poids, reps: reps ? reps.n : null })),
      saute: false, raison: "", rpe: null, commentaire: ""
    });
  });
  return {
    v: VERSION_SEANCE, ref: s.ref, titre: s.titre, type: s.type, onglet: onglet,
    debut: Date.now(), exos: exos, etapes: etapesDe(exos), etape: 0, repos: null, rpePied: null
  };
}

function exoTermine(x) {
  return x.saute || x.sets.every((se) => se.fait);
}

function compteSeries(S) {
  let faites = 0, total = 0;
  S.exos.forEach((x) => {
    if (x.saute) return;
    total += x.sets.length;
    faites += x.sets.filter((se) => se.fait).length;
  });
  return { faites: faites, total: total };
}

/**
 * Après une série cochée : la récup démarre quand le TOUR est fini (tous les
 * exos du superset ont fait cette série) — y compris après la dernière série,
 * pour souffler avant l'exercice suivant. Pas de récup à la toute fin.
 */
function apresSerie(s) {
  const S = etat.seance;
  const groupe = S.etapes[S.etape].map((k) => S.exos[k]).filter((x) => !x.saute);
  const tourFini = groupe.every((x) => s >= x.sets.length || x.sets[s].fait);
  if (!tourFini) return;
  const reste = groupe.some((x) => x.sets.some((se) => !se.fait));
  const derniere = S.etape === S.etapes.length - 1;
  if (!reste && derniere) { finRepos(); sonFinSeance(); return; }

  const sec = Math.max(0, ...groupe.map((x) => x.recupSec || 0));
  if (!sec) return;
  const suite = reste ? "Série suivante" : "Ensuite : " + S.exos[S.etapes[S.etape + 1][0]].nom;
  demarrerRepos(sec, suite);
}

/** Écart d'une série au programme : « 3 reps @ 30 kg », « 30 kg », ou "". */
function ecartSerie(x, se, complet) {
  const parts = [];
  if (x.repsPrevues && se.reps !== null && (complet || se.reps !== x.repsPrevues.n)) parts.push(fmtReps(x, se.reps));
  if (x.poidsPrevu !== null && se.poids !== null && (complet || se.poids !== x.poidsPrevu)) parts.push(fmtNum(se.poids) + " kg");
  return parts.join(" @ ");
}

/**
 * Commentaire écrit dans la feuille, à droite du RPE. Les séries consécutives
 * au même écart sont regroupées : « S2–S4 : 30 kg · S3 : non faite ».
 */
function commentaireExo(x) {
  const libre = (x.commentaire || "").trim();
  if (x.saute) return ["⏭ sauté" + (x.raison ? " — " + x.raison : ""), libre].filter(Boolean).join(" · ");

  const items = x.sets.map((se, i) => {
    const enPlus = i >= (x.nbSeries || 1);
    if (!se.fait) return enPlus ? null : "non faite";
    if (enPlus) return "en plus" + (ecartSerie(x, se, true) ? ", " + ecartSerie(x, se, true) : "");
    return ecartSerie(x, se, false) || null;
  });
  const parts = [];
  for (let i = 0; i < items.length; i++) {
    if (!items[i]) continue;
    let j = i;
    while (j + 1 < items.length && items[j + 1] === items[i]) j++;
    parts.push((i === j ? "S" + (i + 1) : "S" + (i + 1) + "–S" + (j + 1)) + " : " + items[i]);
    i = j;
  }
  if (libre) parts.push(libre);
  return parts.join(" · ");
}

/** Séries faites, en clair : « 4 × 4 reps @ 30 kg », ou série par série si elles diffèrent. */
function resumeSets(x) {
  if (x.saute) return "";
  const txt = (se) => !se.fait ? "✗"
    : [x.repsPrevues && se.reps !== null ? fmtReps(x, se.reps) : "", se.poids !== null ? fmtNum(se.poids) + " kg" : ""]
        .filter(Boolean).join(" @ ") || "✓";
  const l = x.sets.map(txt);
  if (l.every((t) => t === "✗")) return "aucune série";
  const parts = [];
  for (let i = 0; i < l.length; i++) {
    let j = i;
    while (j + 1 < l.length && l[j + 1] === l[i]) j++;
    parts.push(j > i ? (j - i + 1) + " × " + l[i] : l[i]);
    i = j;
  }
  return parts.join(" · ");
}

function commencer(ref) {
  const t = trouverSeance(ref);
  if (!t) return;
  if (etat.seance && etat.seance.ref !== ref && !confirm("Une autre séance est en cours. L'abandonner ?")) return;
  if ((seanceFaite(t.seance) || etat.historique[ref]) &&
      !confirm("Cette séance est déjà faite. La refaire ? Les nouveaux RPE remplaceront les anciens dans ta feuille.")) return;
  etat.seance = nouvelleSeance(t.seance, t.semaine.onglet);
  etat.commentaires = {};
  sauver();
  activerSon();
  preparerSons().then(() => jouerSon("debut"));
  naviguer("seance");
  if (etat.enLigne) preparerHorsLigne(ref, [ref], true);
}

function libererVideos() {
  Object.values(etat.videoEls).forEach((v) => { v.pause(); URL.revokeObjectURL(v.src); });
  etat.videoEls = {};
}

function sortirSeance() {
  garderEcran(false);
  libererVideos();
  $repos.hidden = true;
  document.body.classList.remove("avec-repos");
  clearInterval(minuteurRepos);
}

async function enregistrerSeance() {
  const S = etat.seance;
  const manquants = S.type === "salle"
    ? S.exos.filter((x) => !x.saute && !x.rpe).length
    : (S.rpePied ? 0 : 1);
  if (manquants && !confirm(manquants + " RPE manquant(s). Enregistrer quand même ?")) return;

  const envoi = {
    id: uuid(), ref: S.ref, titre: S.titre, onglet: S.onglet,
    duree: Math.round((Date.now() - S.debut) / 60000),
    date: isoLocal(new Date(S.debut)),
    rpePied: S.type === "course" && S.rpePied ? S.rpePied : "",
    exos: S.exos.map((x) => ({
      ligne: x.ligne, nom: x.nom,
      rpe: !x.saute && x.rpe ? x.rpe : "",
      commentaire: commentaireExo(x)
    }))
  };
  await envoiMettre({ id: envoi.id, envoi: envoi, resume: S.titre + " · " + S.onglet, cree: Date.now(), essais: 0 });

  // Affichée faite tout de suite, sans attendre la prochaine mise à jour.
  const t = trouverSeance(S.ref);
  if (t) {
    if (S.type === "course") t.seance.rpePied = envoi.rpePied;
    t.seance.exos.forEach((x) => {
      const e = envoi.exos.find((y) => y.ligne === x.ligne && y.nom === x.nom);
      if (e && e.rpe) x.rpe = String(e.rpe);
    });
    await kvSet("programme", etat.prog);
  }

  // Le détail des séries ne va pas dans la feuille : on le garde ici pour le revoir.
  etat.historique[S.ref] = {
    date: Date.now(), duree: envoi.duree, rpePied: envoi.rpePied,
    exos: S.exos.map((x, k) => ({
      ligne: x.ligne, nom: x.nom, saute: x.saute, raison: x.raison, rpe: x.rpe, resume: resumeSets(x),
      commentaire: envoi.exos[k].commentaire
    }))
  };
  await kvSet("historique", etat.historique);

  await kvDel("encours");
  sortirSeance();
  etat.seance = null;
  await rafraichirLocaux();
  allerA("semaine");
  toast(etat.enLigne ? "Séance enregistrée, envoi en cours…" : "Séance enregistrée. Envoi dès que le réseau revient.", 4000);
  synchroniser();               // programme lui-même le Background Sync s'il reste des envois
}


/** Ce qui a été fait sur cet exercice ; par la ligne si connue : un exo peut revenir deux fois dans une séance. */
function exoHistorique(histo, x) {
  return histo && (histo.exos.find((y) => y.ligne === x.ligne && nomCle(y.nom) === nomCle(x.nom))
    || histo.exos.find((y) => nomCle(y.nom) === nomCle(x.nom)));
}

/**
 * Corrige un RPE d'une séance déjà enregistrée (i absent = RPE de la séance,
 * bloc course). Passe par la file d'envoi, donc marche hors réseau et part
 * après la séance elle-même. rpeSeul : le serveur laisse les commentaires
 * tranquilles, et ni la durée ni la date ne sont envoyées. La charge suit
 * seule, elle est recalculée depuis la feuille.
 * L'affichage est mis à jour avant le premier await : la feuille de choix se
 * ferme juste après et redessine l'écran.
 */
async function corrigerRPE(ref, i, v) {
  const t = trouverSeance(ref);
  if (!t) return;
  const s = t.seance, h = etat.historique[ref];
  const envoi = { id: uuid(), ref: ref, titre: s.titre, onglet: t.semaine.onglet, rpeSeul: true, rpePied: "", exos: [] };
  if (s.type === "course") {
    s.rpePied = String(v);
    if (h) h.rpePied = v;
    envoi.rpePied = v;
  } else {
    const x = s.exos[i];
    if (!x) return;
    x.rpe = String(v);
    const he = exoHistorique(h, x);
    if (he) he.rpe = v;
    envoi.exos.push({ ligne: x.ligne, nom: x.nom, rpe: v });
  }
  await envoiMettre({ id: envoi.id, envoi: envoi, resume: "Correction du RPE · " + s.titre + " · " + t.semaine.onglet, cree: Date.now(), essais: 0 });
  await kvSet("programme", etat.prog);
  if (h) await kvSet("historique", etat.historique);
  await rafraichirLocaux();
  toast(etat.enLigne ? "RPE corrigé, envoi en cours…" : "RPE corrigé. Envoi dès que le réseau revient.", 4000);
  synchroniser();
}

/**
 * Programme relu du serveur alors qu'une correction n'est pas encore partie :
 * on la remet par-dessus, sinon l'ancien RPE réapparaîtrait à l'écran.
 */
function reporterCorrections(prog) {
  const ancien = etat.prog;
  etat.prog = prog;
  etat.envois.filter((e) => e.envoi && e.envoi.rpeSeul).forEach((e) => {
    const t = trouverSeance(e.envoi.ref);
    if (!t) return;
    if (e.envoi.rpePied) t.seance.rpePied = String(e.envoi.rpePied);
    e.envoi.exos.forEach((c) => {
      const x = t.seance.exos.find((y) => y.ligne === c.ligne && nomCle(y.nom) === nomCle(c.nom));
      if (x) x.rpe = String(c.rpe);
    });
  });
  etat.prog = ancien;
}


/* ======================== MINUTEUR, SON, ÉCRAN =========================== */

let minuteurRepos = null;
let audio = null;
let verrouEcran = null;

function demarrerRepos(sec, suite) {
  etat.seance.repos = { fin: Date.now() + sec * 1000, total: sec, suite: suite || "", sonne: false };
  sauver();
  afficherRepos();
}

function afficherRepos() {
  clearInterval(minuteurRepos);
  const R = etat.seance && etat.seance.repos;
  const visible = !!R && etat.vue === "seance";
  $repos.hidden = !visible;
  document.body.classList.toggle("avec-repos", visible);
  if (!visible) return;

  const C = 2 * Math.PI * 66;
  $repos.innerHTML = `
    <div class="xs subtle" style="font-weight:600;letter-spacing:.06em;text-transform:uppercase">Récup</div>
    <div class="anneau"><svg viewBox="0 0 150 150"><circle class="fond" cx="75" cy="75" r="66"/>
      <circle class="prog" cx="75" cy="75" r="66" stroke-dasharray="${C}" stroke-dashoffset="0"/></svg>
      <div class="temps"></div></div>
    <div class="suivant">${esc(R.suite)}</div>
    <div class="row"><button class="btn outline" data-a="repos-moins">−15 s</button>
      <button class="btn outline" data-a="repos-plus">+15 s</button>
      <button class="btn" data-a="repos-fin">Passer</button></div>`;
  const $t = $repos.querySelector(".temps");
  const $p = $repos.querySelector(".prog");
  const maj = () => {
    const resteMs = R.fin - Date.now();
    const reste = Math.ceil(resteMs / 1000);
    $p.setAttribute("stroke-dashoffset", String(C * (1 - Math.max(0, resteMs) / (R.total * 1000))));
    if (reste > 0) {
      $t.textContent = mmss(reste); $repos.classList.remove("fini");
      // Le « 3, 2, 1 » part au bon moment pour que le GO tombe pile à zéro.
      if (!R.decompte && resteMs <= SONS.go.go * 1000) {
        R.decompte = true;
        sonDecompte = jouerSon("go", SONS.go.go - resteMs / 1000);
        R.avecSon = !!sonDecompte;
      }
      return;
    }
    $t.textContent = "Go";
    $repos.classList.add("fini");
    if (!R.sonne) { R.sonne = true; sauver(); signalFin(R.avecSon); }
    if (reste < -8) finRepos();
  };
  maj();
  minuteurRepos = setInterval(maj, 250);
}

function finRepos() {
  clearInterval(minuteurRepos);
  couperDecompte();
  if (etat.seance && etat.seance.repos) { etat.seance.repos = null; sauver(); }
  $repos.hidden = true;
  document.body.classList.remove("avec-repos");
}

/** Le son n'est permis qu'après un geste : on prépare l'AudioContext au clic. */
function activerSon() {
  try {
    if (!audio) audio = new (window.AudioContext || window.webkitAudioContext)();
    if (audio.state === "suspended") audio.resume();
    preparerSons();
  } catch (err) { audio = null; }
}

/** Fin de récup : vibration, et les bips si le « GO » de la bande-son n'a pas joué. */
function signalFin(avecSon) {
  if (navigator.vibrate) navigator.vibrate([400, 150, 400, 150, 400]);
  if (!audio || avecSon) return;
  [0, 0.35, 0.7].forEach((d) => {
    const o = audio.createOscillator();
    const g = audio.createGain();
    o.frequency.value = 880;
    g.gain.setValueAtTime(0.4, audio.currentTime + d);
    g.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + d + 0.25);
    o.connect(g).connect(audio.destination);
    o.start(audio.currentTime + d);
    o.stop(audio.currentTime + d + 0.3);
  });
}

/* ------------------------------ Bande-son -------------------------------
 * Choisie le 2026-10-25. Extraits YouTube déposés par `tools/videos_exos.py --sons`
 * dans le dossier Drive privé des vidéos (usage perso : rien dans le dépôt public,
 * qui est public), relus par ?api=video et gardés dans IndexedDB (kv « son-<yt> »).
 * de / a : passage joué, en secondes. Son absent (démo, pas encore téléchargé) ou
 * réglage coupé : rien, sauf les bips de fin de récup.
 */
const SONS = {
  debut: { yt: "0e_-8ShpF1I", de: 1.1, a: 5.6 },            // « Let's get ready to rumble »
  go:    { yt: "C8SFHfhmgDk", de: 0.85, a: 5.0, go: 3.05 }, // Smash Bros « 3, 2, 1, GO ! » (GO 3,05 s après « de »)
  exo:   { yt: "CAIa0TbirAQ", de: 0, a: 2.6 },              // Smash Bros « Un nouveau challenger arrive ! »
  fin:   { yt: "Y5H4Das52wk", de: 0.05, a: 4.4 }            // Fortnite « Victory Royale »
};
const tampons = {};    // moment → AudioBuffer décodé
let sonDecompte = null; // « 3, 2, 1, GO » en cours, coupé si la récup change (Passer, ±15 s)

/** Décode les sons déjà sur le téléphone (il faut l'AudioContext, donc un geste). */
async function preparerSons() {
  if (!audio) return;
  for (const m of Object.keys(SONS)) {
    if (tampons[m]) continue;
    try {
      const blob = await kvGet("son-" + SONS[m].yt);
      if (blob) tampons[m] = await audio.decodeAudioData(await blob.arrayBuffer());
    } catch (err) { /* illisible : on fera sans */ }
  }
}

/** Avec du réseau : copie sur le téléphone les sons qui manquent. */
async function telechargerSons() {
  if (!etat.config || etat.config.demo) return;
  for (const s of Object.values(SONS)) {
    try {
      if (await kvGet("son-" + s.yt)) continue;
      const r = await fetch(etat.config.url + "?api=video&cle=" + encodeURIComponent(etat.config.cle) + "&yt=" + s.yt);
      const rep = await r.json();
      if (!rep.ok) continue;               // pas encore déposé dans le Drive
      const blob = await (await fetch("data:audio/mp4;base64," + rep.base64)).blob();
      await kvSet("son-" + s.yt, blob);
    } catch (err) { /* réessayé au prochain lancement */ }
  }
  preparerSons();
}

/**
 * Joue un moment de la bande-son. « position » : où commencer dans le passage (s),
 * pour caler le compte à rebours. Renvoie la source, ou null si rien n'a joué.
 */
function jouerSon(moment, position) {
  const s = SONS[moment], b = tampons[moment];
  if (!etat.sons || !audio || !b) return null;
  const de = s.de + Math.max(0, position || 0);
  const duree = Math.min(s.a, b.duration) - de;
  if (duree <= 0.05) return null;
  const src = audio.createBufferSource();
  src.buffer = b;
  // Fondu de sortie : le passage est coupé au milieu d'un son, sans « clic ».
  const g = audio.createGain(), t = audio.currentTime;
  g.gain.setValueAtTime(1, t);
  g.gain.setValueAtTime(1, t + Math.max(0, duree - 0.25));
  g.gain.linearRampToValueAtTime(0.0001, t + duree);
  src.connect(g); g.connect(audio.destination);
  src.start(t, de, duree);
  return src;
}

function couperDecompte() {
  if (sonDecompte) { try { sonDecompte.stop(); } catch (err) { /* déjà fini */ } }
  sonDecompte = null;
}

/** Une seule fois par séance : dernière série cochée, ou « Terminer ». */
function sonFinSeance() {
  const S = etat.seance;
  if (!S || S.finJouee) return;
  S.finJouee = true;
  jouerSon("fin");
}

/** Écran allumé pendant la séance. */
async function garderEcran(actif) {
  try {
    if (actif && "wakeLock" in navigator && !verrouEcran) {
      verrouEcran = await navigator.wakeLock.request("screen");
      verrouEcran.addEventListener("release", () => { verrouEcran = null; });
    } else if (!actif && verrouEcran) {
      await verrouEcran.release();
      verrouEcran = null;
    }
  } catch (err) { /* refusé (batterie faible…) : tant pis */ }
}


/* ================================ RENDU ================================== */

function rendre() {
  const vues = { config: vueConfig, accueil: vueAccueil, semaine: vueSemaine, apercu: vueApercu, apercuExo: vueApercuExo,
                 charge: vueCharge, declarer: vueDeclarer, programmee: vueProgrammee, aideCharge: vueAideCharge,
                 seance: vueSeance, recap: vueRecap, reglages: vueReglages };
  // « FLX TRAINING » en haut de chaque écran ; la séance l'a dans sa barre fixe,
  // l'écran de bienvenue a le grand logo.
  const avecMarque = !["config", "seance"].includes(etat.vue);
  $app.innerHTML = (avecMarque ? marque() : "") + (vues[etat.vue] || vueAccueil)() +
    (etat.menu !== null ? vueMenu() : "");
  if (etat.vue === "seance") {
    brancherVideos();
    afficherRepos();
    garderEcran(true);
  } else {
    $repos.hidden = true;
    document.body.classList.remove("avec-repos");
    if (etat.vue === "apercuExo") brancherVideos();
    // Le récap garde les vidéos de la séance, qu'on peut y retrouver.
    else if (etat.vue !== "recap") libererVideos();
  }
}

function statut() {
  const attente = etat.envois.filter((e) => !e.refuse).length;
  if (attente) return `<span class="badge accent" id="statut"><span class="dot"></span>${attente} à envoyer</span>`;
  if (!etat.enLigne) return `<span class="badge" id="statut">${ic("horsligne", "sm")}Hors réseau</span>`;
  return `<span class="badge ok" id="statut"><span class="dot"></span>À jour</span>`;
}

function rendreStatut() {
  const p = document.getElementById("statut");
  if (p) p.outerHTML = statut();
}

function vueConfig() {
  return `
    <div class="logo-grand">${LOGO_SVG}</div>
    <div class="top"><div><p class="muted sm">Bienvenue sur</p><h1>FLX Training</h1></div></div>
    <div class="card stack">
      <h3>Pour commencer</h3>
      <p class="muted sm">Scanne le <b>QR code</b> que t'a donné Félix, ou ouvre le <b>lien</b> qu'il t'a envoyé
        (aussi en haut de ta feuille : « 📱 Ouvrir l'app FLX Training »). L'app se configure toute seule.</p>
    </div>
    <div class="card stack">
      <h3>Pas de lien sous la main ?</h3>
      <p class="muted sm">Colle ici ton lien perso.</p>
      <textarea id="lien" class="champ" placeholder="https://script.google.com/macros/s/…/exec?cle=…"></textarea>
      <button class="btn block" data-a="config-ok">Continuer</button>
    </div>
    <button class="btn ghost block mt" data-a="demo">Essayer en démo</button>`;
}

function alertesEnvois() {
  return etat.envois.filter((e) => e.refuse).map((e) => `
    <div class="card warn stack"><div><h3>Envoi refusé</h3><p class="muted sm">${esc(e.resume)} — ${esc(e.erreur)}</p></div>
      <div class="row"><button class="btn sm" data-a="reessayer" data-id="${esc(e.id)}">Réessayer</button>
      <button class="btn sm danger" data-a="supprimer-envoi" data-id="${esc(e.id)}">Supprimer</button></div></div>`).join("");
}

function vueAccueil() {
  const p = etat.prog;
  const prenom = p && p.nom ? String(p.nom).split(" ")[0] : "";
  const jour = new Date().toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
  const aujourdhui = jour.charAt(0).toUpperCase() + jour.slice(1);
  let h = `<div class="top"><div><p class="muted sm">${esc(aujourdhui)}</p>
      <h1>${prenom ? "Salut " + esc(prenom) : "Bienvenue"}</h1></div>
    <div class="row">${statut()}<button class="btn icon" data-a="reglages" aria-label="Réglages">${ic("reglages")}</button></div></div>`;
  if (etat.config.demo) h += `<p class="sm muted" style="margin:-8px 0 14px">Mode démo : rien n'est envoyé à ta feuille.</p>`;
  h += alertesEnvois();
  if (etat.installer) {
    h += `<div class="card stack" style="margin-bottom:12px"><div class="row"><div class="tile">${LOGO_SVG}</div>
      <div class="grow"><h3>Installe FLX Training</h3><p class="xs muted">Une icône sur ton écran d'accueil, en plein écran, même sans réseau.</p></div></div>
      <button class="btn block hero-btn" data-a="installer">${ic("telecharger")}Installer l'app</button></div>`;
  }

  if (!p) {
    return h + `<div class="card vide-etat stack"><p>Ton programme n'est pas encore sur le téléphone.</p>
      ${boutonActualiser("Télécharger mon programme")}</div>` + onglets("seances");
  }

  h += carteProchaine() + tuilesSemaine();

  // Toutes les semaines, en liste compacte
  const BADGES_SEMAINE = { courante: "Cette semaine", future: "Semaine prochaine", passee: "Semaine dernière" };
  h += `<h2>Programme</h2><div class="liste">` + semaines().map((sem, k) => {
    const n = nomSemaine(sem.onglet);
    const badge = k === 0 ? BADGES_SEMAINE[quandSemaine(sem.onglet)] : "";
    const faites = sem.seances.filter(seanceFaite).length;
    const total = sem.seances.length;
    const tile = total && faites === total ? `<div class="tile ok">${ic("check")}</div>`
      : semainePassee(sem, k) && total ? `<div class="tile passee">${anneau(faites, total)}</div>`
      : `<div class="tile">${ic("calendrier")}</div>`;
    return `<div class="item click" data-a="semaine" data-id="${sem.sheetId}">
      ${tile}
      <div class="grow"><div class="row"><p style="font-weight:600">${esc(n.titre)}</p>${badge ? `<span class="badge ${badge === "Cette semaine" ? "accent" : ""}">${badge}</span>` : ""}</div>
        <p class="xs muted">${esc(n.dates)}${n.dates ? " · " : ""}${faites}/${total} faite${faites > 1 ? "s" : ""}</p></div>
      ${ic("droite")}</div>`;
  }).join("") + `</div>`;

  const d = new Date(p.maj);
  h += `<div class="row between mt"><span class="xs subtle">Mis à jour le ${d.toLocaleDateString("fr-FR")} à
      ${d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}</span>
    ${boutonActualiser()}</div>`;
  if (etat.config.demo) {
    h += '<div id="demo-envoi"></div>';
    kvGet("demoEnvoi").then(afficherEnvoiDemo);
  }
  return h + onglets("seances");
}

/**
 * La carte principale de l'accueil : la séance en cours, sinon la première
 * séance pas encore faite de la semaine en cours, sinon « semaine terminée ».
 */
function carteProchaine() {
  const S = etat.seance;
  if (S) {
    const c = compteSeries(S);
    return `<div class="hero">
      <div class="row between"><span class="badge accent"><span class="dot"></span>En cours</span>
        <span class="xs muted tnum">${c.faites}/${c.total} séries</span></div>
      <h2 class="hero-titre">${esc(S.titre)}</h2>
      <p class="sm muted">${esc(nomSemaine(S.onglet).titre)} · exercice ${S.etape + 1} sur ${S.etapes.length}</p>
      <div class="bar accent" style="margin:14px 0"><div style="width:${c.total ? Math.round(100 * c.faites / c.total) : 0}%"></div></div>
      <button class="btn lg block hero-btn" data-a="reprendre">${ic("chrono")}Reprendre la séance</button></div>`;
  }

  const sem = semaines()[0];
  if (!sem || !sem.seances.length) {
    return `<div class="hero"><h2 class="hero-titre">Pas de séance cette semaine</h2>
      <p class="sm muted">Félix n'a encore rien programmé. Pense à actualiser plus tard.</p></div>`;
  }
  const faite = (x) => seanceFaite(x) || enAttente(x.ref) || !!etat.historique[x.ref];
  const s = sem.seances.find((x) => !faite(x));
  // Nouvelle semaine, programme pas encore arrivé : le premier onglet est
  // celui de la semaine dernière. On le dit, et on propose de rattraper.
  const passee = quandSemaine(sem.onglet) === "passee";
  if (passee && !s) {
    return `<div class="hero"><span class="badge">${ic("calendrier", "sm")}Nouvelle semaine</span>
      <h2 class="hero-titre">Programme pas encore arrivé</h2>
      <p class="sm muted">Félix n'a pas encore posté le programme de cette semaine. Pense à actualiser plus tard.
        Un match ou une course entre-temps ? Déclare-la dans l'onglet Charge.</p>
      <div class="mt">${boutonActualiser("Actualiser")}</div></div>`;
  }
  if (!s) {
    return `<div class="hero"><span class="badge ok">${ic("check", "sm")}Semaine terminée</span>
      <h2 class="hero-titre">Bien joué 💪</h2>
      <p class="sm muted">Toutes les séances de ${esc(nomSemaine(sem.onglet).titre)} sont faites. Un match ou une course en plus ? Déclare-la dans l'onglet Charge.</p>
      <button class="btn lg block outline mt" data-a="onglet-charge">${ic("charge")}Voir ma charge</button></div>`;
  }

  const series = s.exos.reduce((a, x) => a + (x.nbSeries || 1), 0);
  const v = videosDe([s]);
  const tel = Object.keys(etat.telechargements).length > 0;
  const videos = !v.total ? "" : v.ici >= v.total ? `${ic("check", "sm")}Vidéos prêtes hors réseau`
    : tel ? `${ic("telecharger", "sm")}Vidéos en téléchargement ${v.ici}/${v.total}` : `${ic("sansvideo", "sm")}${v.total - v.ici} vidéo(s) à télécharger`;
  return `<div class="hero">
    <div class="row between"><span class="badge accent">${passee ? "À rattraper" : "Prochaine séance"}</span>
      <span class="xs muted">${esc(nomSemaine(sem.onglet).titre)}${passee ? " · semaine dernière" : ""}</span></div>
    <div class="row" style="margin-top:12px;gap:12px"><div class="tile hero-tile">${ic(s.type === "course" ? "course" : "haltere", "lg")}</div>
      <div class="grow"><h2 class="hero-titre" style="margin:0">${esc(s.titre)}</h2>
        <p class="sm muted">${s.type === "course" ? "Course" : "Salle"} · ${s.exos.length} exos · ${series} séries</p></div></div>
    ${passee ? `<p class="xs muted" style="margin:12px 0 0">Le programme de cette semaine n'est pas encore arrivé : tu peux encore faire celle-ci.</p>` : ""}
    <p class="xs muted row" style="margin:12px 0 0">${videos}</p>
    <div class="row" style="margin-top:14px">
      <button class="btn lg grow hero-btn" data-a="commencer" data-ref="${esc(s.ref)}">Commencer</button>
      <button class="btn lg outline" data-a="ouvrir" data-ref="${esc(s.ref)}" aria-label="Voir la séance">Voir</button></div>
  </div>`;
}

/** « Ta semaine » : séances faites / prévues, et la charge de la semaine si le suivi est installé. */
function tuilesSemaine() {
  const sem = semaines()[0];
  if (!sem) return "";
  const total = sem.seances.length;
  const faites = sem.seances.filter((x) => seanceFaite(x) || enAttente(x.ref)).length;
  const points = sem.seances.map((x) => `<span class="point ${seanceFaite(x) || enAttente(x.ref) ? "on" : ""}"></span>`).join("");
  // Semaine dernière encore en tête (programme pas arrivé) : pas de séances
  // à compter cette semaine ; la tuile Charge, elle, est bien celle de la semaine.
  let h = `<h2>Ta semaine</h2><div class="tuiles">` + (quandSemaine(sem.onglet) === "passee"
    ? `<div class="tuile"><span class="xs muted">Séances</span>
      <b class="tnum muted">—</b><span class="xs muted">programme à venir</span></div>`
    : `<div class="tuile click" data-a="semaine" data-id="${sem.sheetId}"><span class="xs muted">Séances</span>
      <b class="tnum">${faites}<span class="muted">/${total}</span></b><div class="points">${points}</div></div>`);
  const C = etat.charge;
  if (C && C.equipe) {
    const zone = ZONES[C.analyse.alerte] || ["zone-neutre", ""];
    h += `<div class="tuile click" data-a="onglet-charge"><span class="xs muted">Charge</span>
      <b class="tnum">${C.semaines[0].charge || 0}</b>
      <span class="badge ${zone[0]}" style="align-self:flex-start"><span class="dot"></span>${esc(C.analyse.alerte)}</span></div>`;
  }
  return h + `</div>`;
}

function afficherEnvoiDemo(envoi) {
  const el = document.getElementById("demo-envoi");
  if (!el || !envoi) return;
  el.innerHTML = `<h2>Dernier envoi (démo)</h2><div class="liste recap">
    ${envoi.exos.map((x) => `<div class="item"><div class="grow"><b>${esc(x.nom)}</b>
      ${x.commentaire ? `<p class="comm">📱 ${esc(x.commentaire)}</p>` : ""}</div>
      <span class="badge">${x.rpe ? "RPE " + esc(x.rpe) : "—"}</span></div>`).join("")}</div>`;
}

function semaineCourante() {
  return semaines().find((s) => s.sheetId === etat.semaine) || semaines()[0];
}

function vueSemaine() {
  const sem = semaineCourante();
  if (!sem) return vueAccueil();
  const n = nomSemaine(sem.onglet);
  const cle = "sem-" + sem.sheetId;
  const t = etat.telechargements[cle];
  const v = videosDe(sem.seances);

  let h = `<button class="back" data-a="retour">${ic("gauche", "sm")}Semaines</button>
    <div class="top"><div><h1>${esc(n.titre)}</h1><p class="muted">${esc(n.dates)}</p></div>${statut()}</div>`;
  h += alertesEnvois();
  if (t) {
    h += `<div class="card stack"><div class="row between"><span class="sm">${t.total ? "Téléchargement des vidéos…" : "Recherche des vidéos…"}</span>
      <span class="sm muted tnum">${t.total ? t.fait + "/" + t.total : ""}</span></div>
      <div class="bar accent"><div style="width:${t.total ? Math.round(100 * t.fait / t.total) : 5}%"></div></div></div>`;
  } else if (v.ici < v.total || !v.total) {
    h += `<button class="btn outline block" data-a="preparer" data-id="${sem.sheetId}" ${etat.enLigne ? "" : "disabled"}>
      ${ic("telecharger")}Préparer hors réseau${v.total ? ` · ${v.total - v.ici} vidéo${v.total - v.ici > 1 ? "s" : ""}` : ""}</button>`;
  } else {
    h += `<p class="sm muted row">${ic("check", "sm")}Toutes les vidéos de la semaine sont sur le téléphone.</p>`;
  }

  h += `<h2>Séances</h2>`;
  if (!sem.seances.length) h += `<div class="card vide-etat">Aucune séance programmée.</div>`;
  const passee = semainePassee(sem, semaines().indexOf(sem));
  sem.seances.forEach((s) => {
    const series = s.exos.reduce((a, x) => a + (x.nbSeries || 1), 0);
    const vs = videosDe([s]);
    const encours = etat.seance && etat.seance.ref === s.ref;
    const badges = [
      encours ? '<span class="badge accent">En cours</span>' : "",
      seanceFaite(s) ? `<span class="badge ok">${ic("check", "sm")}Faite</span>` : "",
      enAttente(s.ref) ? '<span class="badge accent">À envoyer</span>' : "",
      passee && !encours && !seanceFaite(s) && !enAttente(s.ref) ? '<span class="badge">Pas faite</span>' : "",
      vs.total && vs.ici < vs.total ? `<span class="badge">${ic("sansvideo", "sm")}${vs.total - vs.ici}</span>` : ""
    ].join("");
    h += `<div class="card click" data-a="ouvrir" data-ref="${esc(s.ref)}">
      <div class="row"><div class="tile ${seanceFaite(s) ? "ok" : ""}">${ic(s.type === "course" ? "course" : "haltere")}</div>
        <div class="grow"><h3>${esc(s.titre)}</h3>
          <p class="sm muted">${s.type === "course" ? "Course" : "Salle"} · ${s.exos.length} exos · ${series} séries</p></div>
        ${ic("droite")}</div>
      ${badges ? `<div class="row wrap mt">${badges}</div>` : ""}</div>`;
  });
  return h;
}

function vueApercu() {
  const t = trouverSeance(etat.apercu);
  if (!t) return vueSemaine();
  const s = t.seance;
  const v = videosDe([s]);
  const series = s.exos.reduce((a, x) => a + (x.nbSeries || 1), 0);
  const etapes = etapesDe(s.exos);
  const encours = etat.seance && etat.seance.ref === s.ref;
  const tel = etat.telechargements[s.ref];
  const histo = etat.historique[s.ref];
  const faite = seanceFaite(s) || !!histo;
  const corrigeable = faite && !encours;

  let liste = "";
  let n = 0;
  etapes.forEach((e) => {
    if (e.length > 1) {
      const r = s.exos[e[0]].recup;
      liste += `<div class="groupe-label">${e.length === 2 ? "Superset" : "Circuit"}${r && r !== "-" ? " · récup " + esc(r) : ""}</div>`;
    }
    e.forEach((i) => {
      const x = s.exos[i];
      n++;
      const detail = [x.nbSeries + " × " + (x.reps || "—"), x.charge, e.length === 1 && x.recup && x.recup !== "-" ? "récup " + x.recup : ""]
        .filter(Boolean).join(" · ");
      // Séance faite : ce qui a été fait (détail gardé sur le téléphone, sinon la feuille).
      const h = exoHistorique(histo, x);
      const fait = h ? (h.saute ? "Sauté" + (h.raison ? " — " + h.raison : "") : h.resume) : "";
      const comm = h ? h.commentaire : x.commentaire;
      const rpe = h ? (h.rpe || "") : x.rpe;
      liste += `<div class="item" style="cursor:pointer" data-a="voir-exo" data-i="${i}"><span class="num">${n}</span>
        <div class="grow"><p class="trunc" style="font-weight:500">${esc(x.nom)}</p><p class="xs muted">${esc(detail)}</p>
          ${fait ? `<p class="xs ${fait === "aucune série" ? "subtle" : ""}" style="margin-top:2px">${ic(fait === "aucune série" || (h && h.saute) ? "x" : "check", "sm")} ${esc(fait)}</p>` : ""}
          ${faite && comm ? `<p class="xs subtle" style="margin-top:2px">${esc(comm.indexOf("📱") === -1 && h ? "📱 " + comm : comm)}</p>` : ""}</div>
        ${x.lien && !(x.yt && etat.videos.has(x.yt)) ? `<span class="subtle" title="Vidéo pas sur le téléphone">${ic("sansvideo", "sm")}</span>` : ""}
        ${s.type === "salle" && corrigeable && !(h && h.saute)
          ? boutonRPE(rpe, `data-ref="${esc(s.ref)}" data-i="${i}"`)
          : rpeRempli(rpe) ? `<span class="badge ${classeRPE(num(rpe))}">RPE ${esc(rpe)}</span>` : ""}</div>`;
    });
  });
  // Bloc course : un seul RPE, celui de la séance.
  const rpePied = histo && histo.rpePied ? histo.rpePied : s.rpePied;
  const pied = s.type !== "course" || !faite ? ""
    : `<div class="item"><div class="grow"><p style="font-weight:500">RPE de la séance</p></div>
        ${corrigeable ? boutonRPE(rpePied, `data-ref="${esc(s.ref)}"`)
          : rpeRempli(rpePied) ? `<span class="badge ${classeRPE(num(rpePied))}">RPE ${esc(rpePied)}</span>` : ""}</div>`;

  return `<button class="back" data-a="retour">${ic("gauche", "sm")}${esc(nomSemaine(t.semaine.onglet).titre)}</button>
    <div class="top"><div><h1>${esc(s.titre)}</h1><p class="muted">${s.type === "course" ? "Course" : "Salle"}${histo
        ? " · faite le " + new Date(histo.date).toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short" }) + (histo.duree ? " · " + histo.duree + " min" : "")
        : ""}</p></div>
      ${encours ? '<span class="badge accent">En cours</span>' : faite ? `<span class="badge ok">${ic("check", "sm")}Faite</span>` : ""}</div>
    <div class="stats"><div><b>${s.exos.length}</b><span>exercices</span></div><div><b>${series}</b><span>séries</span></div>
      <div><b class="tnum">${v.ici}/${v.total}</b><span>vidéos</span></div></div>
    ${barreVideos(s, v)}
    ${faite && !encours ? `<h2 class="row">${ic("historique", "sm")}Ce que tu as fait</h2>` : ""}
    <div class="liste">${liste}${pied}</div>
    ${corrigeable ? `<p class="xs subtle mt">Touche un RPE pour le corriger : ta feuille et ta charge suivront.</p>` : ""}
    <div class="pied">${encours
      ? `<button class="btn lg" data-a="reprendre">Reprendre la séance</button>`
      : faite ? `<button class="btn lg outline" data-a="commencer" data-ref="${esc(s.ref)}">${ic("rafraichir")}Refaire la séance</button>`
      : `<button class="btn lg" data-a="commencer" data-ref="${esc(s.ref)}">Commencer la séance</button>`}</div>`;
}

/**
 * Un exercice vu depuis le récap d'une séance, sans la commencer : ni chrono,
 * ni écran gardé allumé, ni son, et une séance en cours n'est pas touchée.
 */
function vueApercuExo() {
  const t = trouverSeance(etat.apercu);
  const s = t && t.seance;
  const x = s && s.exos[etat.apercuExo];
  if (!x) return vueApercu();
  const i = etat.apercuExo;
  const etape = etapesDe(s.exos).find((e) => e.includes(i)) || [];
  return `<button class="back" data-a="retour">${ic("gauche", "sm")}${esc(s.titre)}</button>
    <div class="etape">Exercice ${i + 1} / ${s.exos.length}${etape.length > 1 ? ` <span class="badge accent">${etape.length === 2 ? "Superset" : "Circuit"}</span>` : ""}</div>
    <div class="exo">${blocMedia(x)}
      <div class="exo-titre"><h2>${esc(x.nom)}</h2></div>
      <div class="chips">${chipsExo(x)}</div>
      ${x.consigne ? `<p class="consigne">${esc(x.consigne)}</p>` : ""}
      ${historiqueExo(x, t.semaine.onglet)}</div>
    <div class="pied">
      <button class="btn outline" data-a="apercu-exo-pas" data-v="-1" ${i ? "" : "disabled"}>${ic("gauche")}Précédent</button>
      <button class="btn outline" data-a="apercu-exo-pas" data-v="1" ${i < s.exos.length - 1 ? "" : "disabled"}>Suivant${ic("droite")}</button>
    </div>`;
}

function vueSeance() {
  const S = etat.seance;
  if (!S) return vueAccueil();
  const etape = S.etapes[S.etape];
  const dernier = S.etape === S.etapes.length - 1;
  const c = compteSeries(S);
  const superset = etape.length > 1;

  return `
    <div class="barre-seance">
      ${marque()}
      <div class="row between">
        <button class="btn icon" data-a="menu-seance" aria-label="Quitter">${ic("x")}</button>
        <div class="titre"><b>${esc(S.titre)}</b><span class="sm muted tnum"><span id="chrono">${mmss(Math.floor((Date.now() - S.debut) / 1000))}</span> · ${c.faites}/${c.total} séries</span></div>
        <button class="btn icon" data-a="terminer" aria-label="Terminer">${ic("check")}</button>
      </div>
      <div class="bar mt"><div style="width:${c.total ? Math.round(100 * c.faites / c.total) : 0}%"></div></div>
    </div>
    <div class="etape">Exercice ${S.etape + 1} / ${S.etapes.length}${superset ? ` <span class="badge accent">${etape.length === 2 ? "Superset" : "Circuit"} · récup après le tour</span>` : ""}</div>
    ${etape.map((i, k) => carteExo(S.exos[i], i, superset ? String.fromCharCode(65 + k) : "")).join("")}
    <div class="pied">
      <button class="btn outline" data-a="prec" ${S.etape ? "" : "disabled"}>${ic("gauche")}Précédent</button>
      <button class="btn" data-a="${dernier ? "terminer" : "suiv"}">${dernier ? "Terminer" : "Suivant"}${ic(dernier ? "check" : "droite")}</button>
    </div>`;
}

/** Vidéo d'un exercice, ou ce qu'on peut faire sans elle. Ne lit pas la séance en cours : sert aussi à l'aperçu. */
function blocMedia(x) {
  if (x.yt && etat.videos.has(x.yt)) return `<div class="media"><div class="vplace" data-yt="${esc(x.yt)}"></div></div>`;
  if (!x.lien) return "";
  const encours = etat.telechargements["v-" + x.yt];
  let actions = "";
  if (etat.enLigne && x.video) {
    actions = `<button class="btn sm" data-a="video-une" data-yt="${esc(x.yt)}" ${encours ? "disabled" : ""}>${ic("telecharger", "sm")}${encours ? "Téléchargement…" : "Télécharger"}</button>`;
  }
  if (etat.enLigne) actions += `<a class="btn sm outline" href="${esc(x.lien)}" target="_blank" rel="noopener">${ic("lien", "sm")}En ligne</a>`;
  const texte = !x.video ? "Vidéo pas encore dans le Drive" : etat.enLigne ? "Vidéo pas sur le téléphone" : "Vidéo pas téléchargée (pas de réseau)";
  return `<div class="media"><div class="vide">${ic("sansvideo", "lg")}<span>${texte}</span>
    ${actions ? `<div class="row">${actions}</div>` : ""}</div></div>`;
}

function chipsExo(x) {
  return [x.charge, x.series && x.series + (Number(x.series) > 1 ? " séries" : " série"),
          x.reps && (/^\d+$/.test(x.reps) ? x.reps + " reps" : x.reps), x.recup && x.recup !== "-" ? "récup " + x.recup : ""]
    .filter(Boolean).map((t) => `<span class="badge">${esc(t)}</span>`).join("");
}

/** Ce que l'élève a fait la dernière fois sur cet exercice, dans une semaine plus ancienne. */
function historiqueExo(x, onglet) {
  const h = historique(x.nom, onglet);
  return h ? `<p class="historique">${ic("historique", "sm")}${esc(h.semaine)} : ${esc([h.x.charge, h.x.reps && h.x.series + " × " + h.x.reps].filter(Boolean).join(" · "))}${rpeRempli(h.x.rpe) ? " · RPE " + esc(h.x.rpe) : ""}${h.x.commentaire ? " · « " + esc(h.x.commentaire) + " »" : ""}</p>` : "";
}

function carteExo(x, i, lettre) {
  const S = etat.seance;
  const titre = `<div class="exo-titre"><h2>${lettre ? `<span class="lettre">${lettre}</span>` : ""}${esc(x.nom)}</h2>
    <button class="btn icon" data-a="menu" data-i="${i}" aria-label="Options">${ic("plusieurs")}</button></div>`;

  if (x.saute) {
    return `<div class="exo">${titre}<div class="card row"><span class="muted grow">${ic("sauter", "sm")} Sauté${x.raison ? " — " + esc(x.raison) : ""}</span>
      <button class="btn sm outline" data-a="reprendre-exo" data-i="${i}">Je le fais</button></div></div>`;
  }

  const media = blocMedia(x);
  const chips = chipsExo(x);
  const hist = historiqueExo(x, S.onglet);

  const avecPoids = x.poidsPrevu !== null;
  const avecReps = !!x.repsPrevues;
  const colReps = !avecReps ? "Reps" : x.repsPrevues.unite === "s" ? "Secondes" : x.repsPrevues.unite === "min" ? "Minutes" : "Reps";
  const lignes = x.sets.map((se, s) => {
    const poids = avecPoids ? stepper(i, s, "poids", se.poids, se.poids !== x.poidsPrevu) : "";
    const reps = avecReps ? stepper(i, s, "reps", se.reps, se.reps !== x.repsPrevues.n)
                          : `<div class="stepper"><span class="fixe">${esc(x.reps || "—")}</span></div>`;
    return `<div class="set ${se.fait ? "fait" : ""}"><span class="n">${s + 1}</span>${poids}${reps}
      <button class="check ${se.fait ? "on" : ""}" data-a="valider" data-i="${i}" data-s="${s}" aria-label="Série ${s + 1} faite">${ic("check")}</button></div>`;
  }).join("");

  const montrerRPE = S.type === "salle" && (exoTermine(x) || x.rpe);
  const rpe = montrerRPE ? `<div class="rpe-bloc"><div class="row between"><h3>RPE de l'exercice</h3><span class="xs subtle">1 facile · 10 max</span></div>
    <div class="rpe">${[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((v) =>
      `<button class="${x.rpe === v ? "on" : ""}" data-a="rpe" data-i="${i}" data-v="${v}">${v}</button>`).join("")}</div></div>` : "";

  const ouvert = etat.commentaires[i] || x.commentaire;
  const comm = ouvert
    ? `<textarea class="mt" data-in="comm" data-i="${i}" placeholder="Pour Félix : sensation, douleur, matériel…">${esc(x.commentaire)}</textarea>`
    : `<button class="btn ghost sm mt" data-a="comm" data-i="${i}">${ic("bulle", "sm")}Ajouter un commentaire</button>`;

  return `<div class="exo">${media}${titre}
    <div class="chips">${chips}</div>
    ${x.consigne ? `<p class="consigne">${esc(x.consigne)}</p>` : ""}
    ${hist}
    <div class="sets ${avecPoids ? "" : "sans-poids"}">
      <div class="tete"><span>#</span>${avecPoids ? "<span>Poids (kg)</span>" : ""}<span>${colReps}</span><span></span></div>
      ${lignes}
      <div class="ajout"><button class="btn ghost sm" data-a="serie-plus" data-i="${i}">${ic("plus", "sm")}Série</button></div>
    </div>
    ${rpe}${comm}</div>`;
}

function stepper(i, s, champ, valeur, modif) {
  return `<div class="stepper ${modif ? "modif" : ""}">
    <button data-a="pas" data-i="${i}" data-s="${s}" data-champ="${champ}" data-v="-1" aria-label="Moins">${ic("moins", "sm")}</button>
    <input inputmode="decimal" data-in="${champ}" data-i="${i}" data-s="${s}" value="${valeur === null ? "" : fmtNum(valeur)}">
    <button data-a="pas" data-i="${i}" data-s="${s}" data-champ="${champ}" data-v="1" aria-label="Plus">${ic("plus", "sm")}</button></div>`;
}

/** Badge RPE qu'on touche pour le corriger (feuille de choix). */
function boutonRPE(rpe, attributs) {
  return rpeRempli(rpe)
    ? `<button class="badge ${classeRPE(num(rpe))}" style="cursor:pointer" data-a="rpe-feuille" ${attributs}>RPE ${esc(rpe)}${ic("crayon", "sm")}</button>`
    : `<button class="badge danger" style="cursor:pointer" data-a="rpe-feuille" ${attributs}>RPE ?</button>`;
}

/**
 * Feuille de choix du RPE : récapitulatif de la séance en cours (pas de ref),
 * ou séance déjà enregistrée. Ne dépend pas d'etat.seance dans le second cas.
 */
function feuilleRPE(m) {
  const t = m.ref ? trouverSeance(m.ref) : null;
  if (m.ref && !t) return "";
  const s = t ? t.seance : etat.seance;
  const x = s && s.exos[m.i];
  const h = t && etat.historique[m.ref];
  const pied = t && s.type === "course";
  if (!pied && !x) return "";
  const actuel = pied ? num((h && h.rpePied) || s.rpePied)
    : t ? num((exoHistorique(h, x) || x).rpe) : x.rpe;
  return `<div class="voile" data-a="menu-fermer"><div class="feuille" data-a="rien">
    <div class="poignee"></div><div class="titre">${esc(pied ? "RPE de la séance" : x.nom)}<br><span class="xs muted">1 facile · 10 max</span></div>
    <div class="rpe">${[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((v) =>
      `<button class="${actuel === v ? "on" : ""}" data-a="${actuel === v ? "menu-fermer" : "rpe-choisir"}" data-v="${v}">${v}</button>`).join("")}</div>
    <button data-a="menu-fermer">${ic("x")}Annuler</button></div></div>`;
}

function vueMenu() {
  if (etat.menu && etat.menu.rpe) return feuilleRPE(etat.menu);
  if (etat.menu === "seance") {
    return `<div class="voile" data-a="menu-fermer"><div class="feuille" data-a="rien">
      <div class="poignee"></div><div class="titre">${esc(etat.seance.titre)}</div>
      <button data-a="quitter">${ic("gauche")}<span>Quitter<br><span class="xs muted">La séance reste en cours, tu la reprends quand tu veux</span></span></button>
      <button data-a="terminer">${ic("check")}Terminer et voir le récapitulatif</button>
      <button class="danger" data-a="abandonner">${ic("x")}<span>Abandonner la séance<br><span class="xs muted">Rien n'est envoyé à ta feuille</span></span></button>
      <button data-a="menu-fermer">Annuler</button></div></div>`;
  }
  const x = etat.seance && etat.seance.exos[etat.menu];
  if (!x) return "";
  return `<div class="voile" data-a="menu-fermer"><div class="feuille" data-a="rien">
    <div class="poignee"></div><div class="titre">${esc(x.nom)}</div>
    <button data-a="serie-plus" data-i="${etat.menu}">${ic("plus")}Ajouter une série</button>
    ${x.lien && etat.enLigne ? `<button data-a="youtube" data-i="${etat.menu}">${ic("lien")}Voir sur YouTube</button>` : ""}
    ${x.saute ? `<button data-a="reprendre-exo" data-i="${etat.menu}">${ic("droite")}Finalement je le fais</button>`
              : `<button class="danger" data-a="sauter" data-i="${etat.menu}">${ic("sauter")}Sauter l'exercice</button>`}
    <button data-a="menu-fermer">${ic("x")}Annuler</button></div></div>`;
}

/** Les <video> survivent aux rendus : la lecture ne repart pas à chaque geste. */
async function brancherVideos() {
  for (const place of $app.querySelectorAll(".vplace")) {
    const yt = place.dataset.yt;
    let v = etat.videoEls[yt];
    if (!v) {
      const rec = await videoGet(yt);
      if (!rec) continue;
      v = etat.videoEls[yt];
      if (!v) {
        v = document.createElement("video");
        Object.assign(v, { muted: true, loop: true, playsInline: true, autoplay: true, controls: true });
        v.src = URL.createObjectURL(rec.blob);
        etat.videoEls[yt] = v;
      }
    }
    if (place.isConnected) { place.replaceWith(v); v.play().catch(() => {}); }
  }
}

/** Couleur d'un RPE (récapitulatif, écran d'une séance) : 1–4 facile, 5–6 modéré, 7–8 dur, 9–10 max. */
function classeRPE(v) {
  return v >= 9 ? "rpe-max" : v >= 7 ? "rpe-dur" : v >= 5 ? "rpe-modere" : "rpe-facile";
}

function vueRecap() {
  const S = etat.seance;
  if (!S) return vueAccueil();
  const minutes = Math.round((Date.now() - S.debut) / 60000);
  const c = compteSeries(S);
  const rpes = S.exos.filter((x) => !x.saute && x.rpe).map((x) => x.rpe);
  const moy = rpes.length ? fmtNum(Math.round(rpes.reduce((a, b) => a + b, 0) / rpes.length * 10) / 10) : "—";

  const lignes = S.exos.map((x, i) => {
    const comm = commentaireExo(x);
    const badge = x.saute ? '<span class="badge">Sauté</span>'
      : S.type !== "salle" ? "" : boutonRPE(x.rpe, `data-i="${i}"`);
    return `<div class="item"><div class="grow"><p style="font-weight:500">${esc(x.nom)}</p>
      ${comm ? `<p class="comm">📱 ${esc(comm)}</p>` : ""}</div>${badge}</div>`;
  }).join("");

  const rpeSeance = S.type === "course" ? `<div class="rpe-bloc"><h3>RPE de la séance</h3>
    <div class="rpe">${[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((v) =>
      `<button class="${S.rpePied === v ? "on" : ""}" data-a="rpe-pied" data-v="${v}">${v}</button>`).join("")}</div></div>` : "";

  return `<button class="back" data-a="continuer">${ic("gauche", "sm")}Revenir à la séance</button>
    <div class="top"><div><h1>Récapitulatif</h1><p class="muted">${esc(S.titre)} · ${esc(nomSemaine(S.onglet).titre)}</p></div></div>
    <div class="stats"><div><b class="tnum">${minutes} min</b><span>durée</span></div>
      <div><b class="tnum">${c.faites}/${c.total}</b><span>séries</span></div>
      <div><b class="tnum ${rpes.length ? "txt-" + classeRPE(num(moy)) : ""}">${moy}</b><span>RPE moyen</span></div></div>
    ${rpeSeance}
    <h2>Ce qui sera écrit dans ta feuille</h2>
    <div class="liste recap">${lignes}</div>
    <p class="xs subtle mt">RPE dans sa colonne, commentaire 📱 juste à droite. Tes notes manuelles sont gardées.</p>
    <div class="pied"><button class="btn lg success" data-a="enregistrer">${ic("envoi")}Enregistrer la séance</button></div>`;
}

/**
 * Thème, préférence de cet appareil : "couloirs" (Défaut, identité FLX Training), "dark" (Sombre) ou "auto"
 * (sombre si le téléphone est en sombre, sinon Défaut). themePrefere / resoudreTheme sont dans index.html.
 */
function themeActuel() {
  return window.themePrefere ? themePrefere() : "couloirs";
}

function appliquerTheme(t) {
  try { localStorage.setItem("theme", t); } catch (err) {}
  document.documentElement.dataset.theme = window.resoudreTheme ? resoudreTheme(t) : t;
  if (window.couleurBarre) couleurBarre();
}

function vueReglages() {
  const c = etat.config;
  if (navigator.serviceWorker && navigator.serviceWorker.controller) navigator.serviceWorker.controller.postMessage("version");
  const theme = themeActuel();
  const choix = [["couloirs", "Défaut"], ["dark", "Sombre"], ["auto", "Auto"]]
    .map(([v, l]) => `<button class="btn sm ${theme === v ? "" : "outline"}" data-a="theme" data-theme="${v}">${l}</button>`).join("");
  if (navigator.storage && navigator.storage.estimate) {
    navigator.storage.estimate().then((e) => {
      const el = document.getElementById("stockage");
      if (el) el.textContent = Math.round(e.usage / 1048576) + " Mo utilisés";
    });
  }
  return `<button class="back" data-a="retour">${ic("gauche", "sm")}Semaines</button>
    <div class="top"><h1>Réglages</h1></div>
    <div class="liste">
      <div class="item"><div class="grow"><p style="font-weight:500">Apparence</p>
        <p class="xs muted">Auto : sombre si ton téléphone est en mode sombre</p></div><div class="row">${choix}</div></div>
      <div class="item"><div class="grow"><p style="font-weight:500">Lien perso</p>
        <p class="xs muted trunc">${c.demo ? "Démo" : esc(c.url.replace(/^https:\/\//, "")) + "?cle=" + esc(c.cle.slice(0, 4)) + "…"}</p></div>
        <button class="btn sm outline" data-a="changer-lien">${c.demo ? "Quitter la démo" : "Changer"}</button></div>
      <div class="item"><div class="grow"><p style="font-weight:500">Sons de séance</p>
        <p class="xs muted">Ready to rumble, 3-2-1 GO, nouveau challenger, Victory Royale</p></div>
        <button class="btn sm ${etat.sons ? "" : "outline"}" data-a="sons">${etat.sons ? "Activés" : "Coupés"}</button></div>
      <div class="item"><div class="grow"><p style="font-weight:500">Vidéos sur le téléphone : ${etat.videos.size}</p>
        <p class="xs muted" id="stockage"></p></div>
        <button class="btn sm danger" data-a="vider-videos" ${etat.videos.size ? "" : "disabled"}>Supprimer</button></div>
    </div>
    <p class="xs subtle mt">Version de l'app : <span id="version">${esc(etat.versionApp || "…")}</span></p>`;
}


/* ============================ SUIVI DE CHARGE ============================ */

/** Barre du bas Séances / Charge. Masquée si le suivi de charge n'est pas installé. */
function onglets(actif) {
  if (etat.charge && etat.charge.equipe === false) return "";
  const b = (id, icone, libelle) => `<button class="${actif === id ? "on" : ""}" data-a="onglet-${id}">${ic(icone)}<span>${libelle}</span></button>`;
  return `<nav class="onglets">${b("seances", "haltere", "Séances")}${b("charge", "charge", "Charge")}</nav>`;
}

/** Zones ACWR : couleur et phrase, mêmes seuils que l'onglet « Charge » de Félix. */
const ZONES = {
  "Zone optimale": ["zone-ok", "Ta charge est dans la bonne zone par rapport à tes 4 semaines précédentes."],
  "Sous-charge": ["zone-bas", "Moins que d'habitude : parfait pour récupérer, à surveiller si ça dure."],
  "Vigilance": ["zone-vigilance", "Hausse marquée par rapport à d'habitude : écoute ta fatigue."],
  "Pic de charge": ["zone-pic", "Forte hausse d'un coup : risque de blessure, parles-en à Félix."],
  "Historique insuffisant": ["zone-neutre", "Il faut au moins 2 semaines d'historique pour comparer."],
  "Aucune séance (réf.)": ["zone-neutre", "Aucune séance la semaine dernière : rien à comparer."]
};

const envoisCharge = (action) => etat.envois.filter((e) => e.action === action && !e.refuse);

function vueCharge() {
  const C = etat.charge;
  let h = `<div class="top"><div><p class="muted sm">Suivi de fatigue</p>
      <h1 class="row">Ta charge<button class="btn icon plain" data-a="aide-charge" aria-label="Comment ça marche ?">${ic("aide")}</button></h1></div>${statut()}</div>`;
  if (!C) {
    return h + `<div class="card vide-etat stack"><p>Ta charge n'est pas encore sur le téléphone.</p>
      ${boutonActualiser("Télécharger")}</div>` + onglets("charge");
  }
  if (!C.equipe) {
    return h + `<div class="card stack"><h3>Pas encore activé</h3>
      <p class="muted sm">Le suivi de charge n'est pas installé dans ta feuille. Demande à Félix de l'activer.</p></div>`;
  }

  // Séances déclarées pas encore envoyées : comptées tout de suite dans la
  // semaine en cours (copie, le serveur fera foi au prochain rafraîchissement).
  const sem = C.semaines.map((w) => Object.assign({}, w));
  envoisCharge("declarer").forEach((e) => {
    const x = e.donnees.seance;
    if (sem[0] && x.date >= sem[0].lundi) { sem[0].charge = (sem[0].charge || 0) + x.duree * x.rpe; sem[0].nbSeances++; }
  });
  const a = C.analyse;
  const zone = ZONES[a.alerte] || ["zone-neutre", ""];
  const acwr = a.acwr === null ? "—" : fmtNum(a.acwr);
  h += `<div class="stats">
      <div><b class="tnum">${sem[0].charge || 0}</b><span>cette semaine · ${sem[0].nbSeances} séance${sem[0].nbSeances > 1 ? "s" : ""}</span></div>
      <div><b class="tnum">${sem[1] && sem[1].charge !== null ? sem[1].charge : "—"}</b><span>semaine dernière</span></div>
      <div><b class="tnum txt-${zone[0]}">${acwr}</b><span>ACWR</span></div></div>
    <div class="card stack"><div class="row between"><h3>${esc(a.alerte)}</h3><span class="badge ${zone[0]}"><span class="dot"></span>${acwr === "—" ? "—" : "ACWR " + acwr}</span></div>
      <p class="sm muted">${esc(zone[1])}</p>
      ${graphiqueCharge(sem, a.chronique)}
      <p class="xs subtle">Charge = durée (min) × RPE. ACWR = semaine dernière ÷ moyenne des 4 semaines d'avant.
        <button class="lien-txt" data-a="aide-charge">Comment ça marche ?</button></p></div>
    <button class="btn block lg mt" data-a="declarer">${ic("plus")}Déclarer une séance</button>`;

  // Séances programmées de la semaine (durée et date modifiables)
  const enCours = envoisCharge("programmee").map((e) => e.donnees.ref);
  const prog = C.page.programmees || [];
  if (prog.length) {
    // Ces séances sont celles du premier onglet semaine : le lundi, avant le
    // programme de Félix, c'est encore la semaine dernière. Semaine lue dans le
    // nom de l'onglet, sinon dans la date la plus ancienne (modifiable par l'élève).
    const quand = C.page.semaine && /\(\d/.test(C.page.semaine) ? quandSemaine(C.page.semaine)
      : (() => {
        const l = lundiIso(new Date(prog.map((p) => p.date).filter(Boolean).sort()[0] + "T12:00")), ici = lundiIso(new Date());
        return !/^\d{4}/.test(l) || l === ici ? "courante" : l < ici ? "passee" : "future";
      })();
    const titres = { courante: "Séances programmées cette semaine", passee: "Séances programmées la semaine dernière",
                     future: "Séances programmées la semaine prochaine" };
    h += `<h2>${titres[quand]}</h2>`;
    if (quand === "passee") h += `<p class="xs muted" style="margin:-4px 0 8px">Le programme de cette semaine n'est pas encore arrivé.</p>`;
    h += `<div class="liste">` + prog.map((p) => {
      const ch = p.rpe ? Math.round(p.duree * p.rpe) : null;
      return `<div class="item"><div class="grow"><p style="font-weight:500">${esc(p.titre)}</p>
        <p class="xs muted">${esc(jourCourt(p.date))} · ${esc(p.duree)} min${ch ? " · charge " + ch : " · pas encore faite"}</p></div>
        ${enCours.includes(p.ref) ? '<span class="badge accent">À envoyer</span>' : ""}
        ${p.rpe ? `<span class="badge ${classeRPE(Number(p.rpe))}">RPE ${esc(fmtNum(Number(p.rpe)))}</span>` : ""}
        <button class="btn icon plain" data-a="prog-editer" data-ref="${esc(p.ref)}" aria-label="Modifier">${ic("crayon", "sm")}</button></div>`;
    }).join("") + `</div>`;
  }

  // Séances déclarées : celles en attente d'envoi d'abord. Chacune garde une
  // clé pour être modifiée : l'id de l'envoi en attente, ou sa place dans la liste du serveur.
  const modifs = envoisCharge("declaree").map((e) => JSON.stringify(e.donnees.origine));
  const dernieres = envoisCharge("declarer").map((e) => {
    const x = e.donnees.seance;
    return { cle: e.id, jour: x.date, date: jourCourt(x.date), type: x.type, duree: x.duree, rpe: x.rpe,
             charge: x.duree * x.rpe, commentaire: x.commentaire, attente: true };
  }).concat((C.page.dernieres || []).map((x, i) => Object.assign({}, x, {
    cle: "srv-" + i, attente: modifs.includes(JSON.stringify(origineDe(x)))
  })));
  etat.declarees = dernieres;
  if (dernieres.length) {
    h += `<h2>Déclarées récemment</h2><div class="liste">` + dernieres.map((d) => `
      <div class="item"><div class="grow"><p style="font-weight:500">${esc(d.type)} <span class="muted xs">· ${esc(d.date)}</span></p>
        <p class="xs muted">${esc(d.duree)} min · charge ${esc(d.charge)}${d.commentaire ? " · " + esc(d.commentaire) : ""}</p></div>
        ${d.attente ? '<span class="badge accent">À envoyer</span>' : ""}
        <span class="badge ${classeRPE(Number(d.rpe))}">RPE ${esc(d.rpe)}</span>
        ${d.jour ? `<button class="btn icon plain" data-a="decl-editer" data-k="${esc(d.cle)}" aria-label="Modifier">${ic("crayon", "sm")}</button>` : ""}</div>`).join("") + `</div>`;
  }

  const d = new Date(C.maj);
  h += `<div class="row between mt"><span class="xs subtle">Mis à jour le ${d.toLocaleDateString("fr-FR")} à
      ${d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}</span>
    ${boutonActualiser()}</div>`;
  return h + onglets("charge");
}

/**
 * Charge des dernières semaines en barres (la plus ancienne à gauche). La
 * semaine en cours est en pointillés (pas finie) ; la ligne = moyenne des
 * 4 semaines qui servent de référence (charge chronique).
 */
function graphiqueCharge(semaines, chronique) {
  const liste = semaines.slice().reverse();
  const n = liste.length;
  const L = 340, H = 150, bas = 124, haut = 18, pas = L / n, larg = Math.min(34, pas * 0.56);
  const max = Math.max(1, chronique || 0, ...liste.map((w) => w.charge || 0)) * 1.08;
  const y = (v) => bas - (bas - haut) * v / max;
  let barres = "";
  liste.forEach((w, i) => {
    const x = i * pas + (pas - larg) / 2;
    const v = w.charge || 0;
    const encours = i === n - 1;
    const cls = encours ? "barre encours" : i === n - 2 ? "barre ref" : "barre";
    const m = /^\d{4}-(\d{2})-(\d{2})$/.exec(w.lundi || "");
    barres += `<rect class="${cls}" x="${x}" y="${y(v)}" width="${larg}" height="${Math.max(bas - y(v), v ? 2 : 0)}" rx="5"/>
      <text class="val" x="${x + larg / 2}" y="${y(v) - 5}" text-anchor="middle">${v || ""}</text>
      <text class="lib" x="${x + larg / 2}" y="${H - 6}" text-anchor="middle">${encours ? "en cours" : m ? m[2] + "/" + m[1] : ""}</text>`;
  });
  const ligne = chronique ? `<line class="chronique" x1="0" x2="${L}" y1="${y(chronique)}" y2="${y(chronique)}"/>
    <text class="lib" x="${L - 2}" y="${y(chronique) - 4}" text-anchor="end">moy. ${Math.round(chronique)}</text>` : "";
  return `<svg class="graphique" viewBox="0 0 ${L} ${H}" role="img" aria-label="Charge des ${n} dernières semaines">${ligne}${barres}</svg>`;
}

function vueDeclarer() {
  const C = etat.charge;
  const f = etat.form;
  if (!C || !f) return vueCharge();
  const types = (C.page && C.page.types) || ["Entraînement", "Match", "Course", "Mobilité / renfo", "Autre"];
  const min = new Date(); min.setDate(min.getDate() - 60);
  const edition = !!f.cle;
  return `<button class="back" data-a="retour">${ic("gauche", "sm")}Charge</button>
    <div class="top"><div><h1>${edition ? "Modifier la séance" : "Déclarer une séance"}</h1>
      <p class="muted">${edition ? "Corrige ce qui ne va pas, ou supprime-la." : "Hand, match, course… tout ce qui n'est pas dans l'app."}</p></div></div>
    <div class="card stack">
      <div><p class="sm" style="font-weight:600;margin-bottom:8px">Type</p>
        <div class="row wrap">${types.map((t) => `<button class="chip ${f.type === t ? "on" : ""}" data-a="form-type" data-t="${esc(t)}">${esc(t)}</button>`).join("")}</div></div>
      <div><p class="sm" style="font-weight:600;margin-bottom:8px">Date</p>
        <input class="champ" type="date" data-in="form-date" value="${esc(f.date)}" min="${isoLocal(min)}" max="${isoLocal(new Date())}"></div>
      <div><p class="sm" style="font-weight:600;margin-bottom:8px">Durée (min)</p>
        <div class="stepper" style="max-width:220px"><button data-a="form-duree" data-v="-5" aria-label="Moins">${ic("moins", "sm")}</button>
          <input inputmode="numeric" data-in="form-duree" value="${f.duree}">
          <button data-a="form-duree" data-v="5" aria-label="Plus">${ic("plus", "sm")}</button></div></div>
      <div><div class="row between"><p class="sm" style="font-weight:600">RPE de la séance</p><span class="xs subtle">1 facile · 10 max</span></div>
        <div class="rpe">${[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((v) => `<button class="${f.rpe === v ? "on" : ""}" data-a="form-rpe" data-v="${v}">${v}</button>`).join("")}</div></div>
      <div><p class="sm" style="font-weight:600;margin-bottom:8px">Commentaire (facultatif)</p>
        <textarea data-in="form-comm" placeholder="Match amical, terrain gras…">${esc(f.commentaire)}</textarea></div>
      ${f.rpe ? `<p class="sm muted">Charge : ${f.duree} min × ${f.rpe} = <b>${f.duree * f.rpe}</b></p>` : ""}
    </div>
    ${edition ? `<button class="btn danger block mt" data-a="decl-supprimer">${ic("x")}Supprimer cette séance</button>` : ""}
    <div class="pied"><button class="btn lg" data-a="declarer-ok">${ic("check")}Enregistrer</button></div>`;
}

/** « ? » de l'onglet Charge : le principe du suivi de fatigue, sans jargon. */
function vueAideCharge() {
  const s = (etat.charge && etat.charge.seuils) || { bas: 0.8, haut: 1.3, danger: 1.5 };
  return `<button class="back" data-a="retour">${ic("gauche", "sm")}Charge</button>
    <div class="top"><div><p class="muted sm">Suivi de fatigue</p><h1>Comment ça marche ?</h1></div></div>
    <div class="card stack aide">
      <h3>1. Chaque séance a une charge</h3>
      <p class="sm muted">Après une séance, tu notes ton <b>RPE</b> : ton ressenti d'effort de 1 (très facile) à 10 (impossible d'en faire plus).
        La charge, c'est <b>durée × RPE</b>. 60 min à RPE 7 = <b>420</b>. Une séance longue et facile peut donc peser autant qu'une courte et dure.</p>
    </div>
    <div class="card stack aide">
      <h3>2. Tout compte, pas seulement la muscu</h3>
      <p class="sm muted">Les séances de Félix arrivent toutes seules. Un match, un entraînement de club, un footing ?
        Déclare-le avec <b>Déclarer une séance</b> : ton corps, lui, fait le total de tout.</p>
    </div>
    <div class="card stack aide">
      <h3>3. On compare à tes habitudes</h3>
      <p class="sm muted">L'<b>ACWR</b> compare ta charge de la semaine dernière à la moyenne des 4 semaines d'avant.
        Le corps encaisse bien ce à quoi il est habitué ; ce qui blesse, c'est surtout une <b>hausse brutale</b>.</p>
      <div class="liste">
        <div class="item"><span class="badge zone-bas"><span class="dot"></span>moins de ${fmtNum(s.bas)}</span><span class="sm grow">Sous-charge : récup, ou reprise en douceur.</span></div>
        <div class="item"><span class="badge zone-ok"><span class="dot"></span>${fmtNum(s.bas)} à ${fmtNum(s.haut)}</span><span class="sm grow">Zone optimale : tu progresses sans trop tirer.</span></div>
        <div class="item"><span class="badge zone-vigilance"><span class="dot"></span>${fmtNum(s.haut)} à ${fmtNum(s.danger)}</span><span class="sm grow">Ça monte vite : lève un peu le pied.</span></div>
        <div class="item"><span class="badge zone-pic"><span class="dot"></span>plus de ${fmtNum(s.danger)}</span><span class="sm grow">Pic : risque de blessure, parles-en à Félix.</span></div>
      </div>
    </div>
    <div class="card stack aide">
      <h3>Bon à savoir</h3>
      <p class="sm muted">Il faut au moins 2 semaines d'historique pour calculer l'ACWR. C'est un repère, pas un verdict :
        fatigue, sommeil et douleurs comptent aussi, et Félix voit les mêmes chiffres que toi.</p>
    </div>`;
}

function vueProgrammee() {
  const e = etat.progEdit;
  if (!e) return vueCharge();
  const min = new Date(); min.setDate(min.getDate() - 60);
  return `<button class="back" data-a="retour">${ic("gauche", "sm")}Charge</button>
    <div class="top"><div><h1>${esc(e.titre)}</h1><p class="muted">Corrige le jour ou la durée réelle de la séance.</p></div></div>
    <div class="card stack">
      <div><p class="sm" style="font-weight:600;margin-bottom:8px">Date</p>
        <input class="champ" type="date" data-in="prog-date" value="${esc(e.date)}" min="${isoLocal(min)}" max="${isoLocal(new Date())}"></div>
      <div><p class="sm" style="font-weight:600;margin-bottom:8px">Durée (min)</p>
        <div class="stepper" style="max-width:220px"><button data-a="prog-duree" data-v="-5" aria-label="Moins">${ic("moins", "sm")}</button>
          <input inputmode="numeric" data-in="prog-duree" value="${e.duree}">
          <button data-a="prog-duree" data-v="5" aria-label="Plus">${ic("plus", "sm")}</button></div></div>
    </div>
    <div class="pied"><button class="btn lg" data-a="prog-ok">${ic("check")}Enregistrer</button></div>`;
}

/** Ce que le serveur doit retrouver dans « Mes séances » pour une séance déclarée. */
function origineDe(x) {
  if (x.origine) return x.origine;              // déjà modifiée ici : on vise la version du serveur
  return { jour: x.jour, type: x.type, duree: Number(x.duree), rpe: Number(x.rpe), commentaire: x.commentaire || "" };
}

/**
 * Modifie (seance) ou supprime (null) une séance déclarée de la liste.
 * Pas encore envoyée → on corrige l'envoi en attente. Déjà dans la feuille →
 * un envoi « declaree » (ou celui déjà en attente pour la même séance est mis à jour).
 */
async function changerDeclaree(cle, seance) {
  const d = (etat.declarees || []).find((x) => x.cle === cle);
  if (!d) return;
  const envoi = etat.envois.find((e) => e.id === cle && e.action === "declarer");
  if (envoi) {
    if (seance) { envoi.donnees.seance = seance; envoi.resume = seance.type + " · " + jourCourt(seance.date); await envoiMettre(envoi); }
    else await envoiSupprimer(envoi.id);
    await rafraichirLocaux();
    rendre();
    return;
  }

  const origine = origineDe(d);
  const liste = etat.charge.page.dernieres;
  const i = Number(cle.replace("srv-", ""));
  // Affiché tout de suite ; « origine » garde la version que le serveur connaît.
  if (seance) {
    liste[i] = { date: jourCourt(seance.date).split(" ")[1], jour: seance.date, type: seance.type, duree: seance.duree,
                 rpe: seance.rpe, charge: seance.duree * seance.rpe, commentaire: seance.commentaire, origine: origine };
  } else {
    liste.splice(i, 1);
  }
  await kvSet("charge", etat.charge);

  const deja = envoisCharge("declaree").find((e) => JSON.stringify(e.donnees.origine) === JSON.stringify(origine));
  if (deja) {
    deja.donnees.seance = seance;
    await envoiMettre(deja);
    await rafraichirLocaux();
    synchroniser();
  } else {
    await envoyerCharge("declaree", { origine: origine, seance: seance },
                        (seance ? "Modif " + seance.type : "Suppression " + d.type) + " · " + d.date);
  }
}

/** Met une écriture du suivi de charge dans la file d'envoi (part dès qu'il y a du réseau). */
async function envoyerCharge(action, donnees, resume) {
  const id = uuid();
  await envoiMettre({ id: id, action: action, donnees: Object.assign({ id: id }, donnees), resume: resume, cree: Date.now(), essais: 0 });
  await rafraichirLocaux();
  synchroniser();               // programme lui-même le Background Sync s'il reste des envois
}


/* =============================== ACTIONS ================================= */

function lireLien(texte) {
  try {
    const u = new URL(String(texte).trim());
    const h = new URLSearchParams(u.hash.slice(1));
    if (/^[0-9a-f]{32}$/.test(h.get("cle") || "")) {          // lien de l'app (#cle=…)
      return { url: h.get("serveur") || SERVEUR, cle: h.get("cle"), demo: false };
    }
    const cle = u.searchParams.get("cle") || "";
    if (!/\/exec$/.test(u.pathname) || !/^[0-9a-f]{32}$/.test(cle)) return null;
    return { url: u.origin + u.pathname, cle: cle, demo: false };
  } catch (err) {
    return null;
  }
}

async function changerConfig(config) {
  etat.config = config;
  etat.prog = null;
  await kvSet("config", config);
  await kvDel("programme");
  await kvDel("demoEnvoi");
  allerA("accueil");
  majProgramme(false);
}

/** Change une valeur de série. Un nouveau poids suit sur les séries suivantes pas encore faites. */
function changerValeur(i, s, champ, valeur) {
  const x = etat.seance.exos[i];
  const ancien = x.sets[s][champ];
  x.sets[s][champ] = valeur;
  if (champ === "poids") {
    for (let k = s + 1; k < x.sets.length; k++) {
      if (!x.sets[k].fait && x.sets[k].poids === ancien) x.sets[k].poids = valeur;
    }
  }
  sauver();
}

const actions = {
  "config-ok": () => {
    const c = lireLien(document.getElementById("lien").value);
    if (!c) { toast("Ce n'est pas un lien « …/exec?cle=… » valide."); return; }
    changerConfig(c);
  },
  "demo": () => changerConfig({ url: "", cle: "", demo: true }),
  "actualiser": () => actualiser(),
  "semaine": (d) => { etat.semaine = Number(d.id); naviguer("semaine"); },
  "ouvrir": (d) => {
    etat.apercu = d.ref;
    naviguer("apercu");
    if (etat.enLigne) preparerHorsLigne(d.ref, [d.ref], true);
  },
  "preparer": (d) => {
    const sem = semaines().find((s) => s.sheetId === Number(d.id));
    if (sem) preparerHorsLigne("sem-" + sem.sheetId, sem.seances.map((s) => s.ref));
  },
  "preparer-seance": (d) => preparerHorsLigne(d.ref, [d.ref]),
  "retour": () => history.back(),
  "reglages": () => naviguer("reglages"),
  "installer": async () => {
    const e = etat.installer;
    if (!e) return;
    e.prompt();
    try { await e.userChoice; } catch (err) {}
    etat.installer = null;
    rendre();
  },
  // Suivi de charge
  "onglet-seances": () => allerA("accueil"),
  "aide-charge": () => naviguer("aideCharge"),
  "onglet-charge": () => { naviguer("charge"); if (etat.enLigne && !etat.charge) majCharge(false); },

  "declarer": () => {
    etat.form = { type: "", date: isoLocal(new Date()), duree: (etat.charge && etat.charge.page.dureeDefaut) || 60, rpe: null, commentaire: "" };
    naviguer("declarer");
  },
  "form-type": (d) => { etat.form.type = d.t; rendre(); },
  "form-rpe": (d) => { etat.form.rpe = etat.form.rpe === d.v ? null : d.v; rendre(); },
  "form-duree": (d) => { etat.form.duree = Math.min(300, Math.max(5, etat.form.duree + d.v)); rendre(); },
  "decl-editer": (d) => {
    const x = (etat.declarees || []).find((y) => y.cle === d.k);
    if (!x) return;
    etat.form = { cle: x.cle, type: x.type, date: x.jour, duree: Number(x.duree), rpe: Number(x.rpe), commentaire: x.commentaire || "" };
    naviguer("declarer");
  },
  "decl-supprimer": async () => {
    if (!confirm("Supprimer cette séance de ton suivi ?")) return;
    const cle = etat.form.cle;
    etat.form = null;
    history.back();
    await changerDeclaree(cle, null);
    toast("Séance supprimée.");
  },
  "declarer-ok": async () => {
    const f = etat.form;
    if (!f.type) { toast("Choisis un type de séance."); return; }
    if (!f.rpe) { toast("Choisis un RPE."); return; }
    if (!(f.duree >= 1 && f.duree <= 300)) { toast("Durée entre 1 et 300 min."); return; }
    const seance = { date: f.date, type: f.type, duree: f.duree, rpe: f.rpe, commentaire: f.commentaire.trim() };
    const cle = f.cle;
    etat.form = null;
    history.back();
    if (cle) { await changerDeclaree(cle, seance); toast("Séance modifiée."); return; }
    await envoyerCharge("declarer", { seance: seance }, seance.type + " · " + jourCourt(seance.date));
    toast(etat.enLigne ? "Séance déclarée." : "Séance déclarée. Envoi dès que le réseau revient.");
  },
  "prog-editer": (d) => {
    const p = (etat.charge.page.programmees || []).find((x) => x.ref === d.ref);
    if (!p) return;
    etat.progEdit = { ref: p.ref, titre: p.titre, date: p.date, duree: Number(p.duree) || 60 };
    naviguer("programmee");
  },
  "prog-duree": (d) => { etat.progEdit.duree = Math.min(300, Math.max(5, etat.progEdit.duree + d.v)); rendre(); },
  "prog-ok": async () => {
    const e = etat.progEdit;
    if (!(e.duree >= 1 && e.duree <= 300)) { toast("Durée entre 1 et 300 min."); return; }
    // Affiché tout de suite, avant l'envoi.
    const p = (etat.charge.page.programmees || []).find((x) => x.ref === e.ref);
    if (p) { p.date = e.date; p.duree = e.duree; await kvSet("charge", etat.charge); }
    etat.progEdit = null;
    history.back();
    await envoyerCharge("programmee", { ref: e.ref, modif: { date: e.date, duree: e.duree } }, e.titre + " · " + jourCourt(e.date));
    toast("Séance modifiée.");
  },
  "theme": (d) => { appliquerTheme(d.theme); rendre(); },
  "sons": async () => {
    etat.sons = !etat.sons;
    await kvSet("sons", etat.sons);
    rendre();
    if (etat.sons) { activerSon(); preparerSons().then(() => jouerSon("exo")); }   // un aperçu
  },
  "commencer": (d) => commencer(d.ref),
  "reprendre": () => {
    activerSon();
    naviguer("seance");
    if (etat.enLigne) preparerHorsLigne(etat.seance.ref, [etat.seance.ref], true);
  },
  "video-une": async (d) => {
    if (etat.telechargements["v-" + d.yt]) return;
    etat.telechargements["v-" + d.yt] = { fait: 0, total: 1 };
    rendre();
    try { await telechargerVideo(d.yt); }
    catch (err) { toast("Vidéo non téléchargée : " + err.message, 4000); }
    delete etat.telechargements["v-" + d.yt];
    rendreDiscret();
  },
  "reessayer": async (d) => {
    const e = etat.envois.find((x) => x.id === d.id);
    if (!e) return;
    e.refuse = false;
    await envoiMettre(e);
    synchroniser();
  },
  "supprimer-envoi": async (d) => {
    if (!confirm("Supprimer cet envoi ? La séance ne sera pas écrite dans ta feuille.")) return;
    await envoiSupprimer(d.id);
    await rafraichirLocaux();
    rendre();
  },
  "changer-lien": async () => {
    const question = etat.seance ? "La séance en cours sera abandonnée. Continuer ?"
      : etat.config.demo ? "" : "Déconnecter ce téléphone ? Il te faudra ton lien perso pour revenir.";
    if (question && !confirm(question)) return;
    etat.seance = null;
    await kvDel("encours");
    await kvDel("config");
    etat.config = null;
    allerA("config");
  },
  "recharger": () => location.reload(),
  "vider-videos": async () => {
    if (!confirm("Supprimer toutes les vidéos du téléphone ?")) return;
    await videosVider();
    await rafraichirLocaux();
    rendre();
  },

  // Séance
  "menu-seance": () => { etat.menu = "seance"; history.pushState({ vue: etat.vue, menu: true }, ""); rendre(); },
  "quitter": () => {
    // Pas history.back() pour sortir : si l'app a rouvert sur la séance, ce serait la fermer.
    etat.menu = null;
    allerA(etat.semaine !== null ? "semaine" : "accueil");
    toast("Séance gardée : reprends-la quand tu veux.");
  },
  "abandonner": async () => {
    if (!confirm("Abandonner la séance ? Ce que tu as saisi sera perdu, rien n'est envoyé.")) return;
    etat.menu = null;
    await kvDel("encours");
    allerA(etat.semaine !== null ? "semaine" : "accueil");
    etat.seance = null;
    rendre();
  },
  "valider": (d) => {
    const se = etat.seance.exos[d.i].sets[d.s];
    se.fait = !se.fait;
    if (se.fait) apresSerie(d.s);
    sauver(); rendre();
  },
  "pas": (d) => {
    const x = etat.seance.exos[d.i];
    const se = x.sets[d.s];
    const base = se[d.champ] === null ? (d.champ === "poids" ? x.poidsPrevu : x.repsPrevues.n) || 0 : se[d.champ];
    const pas = d.champ === "poids" ? (Math.max(base, x.poidsPrevu || 0) >= 20 ? 2.5 : 1) : 1;
    changerValeur(d.i, d.s, d.champ, Math.max(0, Math.round((base + d.v * pas) * 100) / 100));
    rendre();
  },
  "serie-plus": (d) => {
    const x = etat.seance.exos[d.i];
    const der = x.sets[x.sets.length - 1] || { poids: x.poidsPrevu, reps: x.repsPrevues && x.repsPrevues.n };
    x.sets.push({ fait: false, poids: der.poids, reps: der.reps });
    sauver(); fermerMenuOuRendre();
  },
  "menu": (d) => { etat.menu = d.i; history.pushState({ vue: etat.vue, menu: true }, ""); rendre(); },
  "menu-fermer": () => { if (etat.menu !== null) history.back(); },
  "youtube": (d) => { window.open(etat.seance.exos[d.i].lien, "_blank", "noopener"); },
  "sauter": (d) => {
    const raison = prompt("Pourquoi tu sautes cet exercice ? (facultatif)", "");
    if (raison === null) return;
    Object.assign(etat.seance.exos[d.i], { saute: true, raison: raison.trim() });
    sauver(); fermerMenuOuRendre();
  },
  "reprendre-exo": (d) => {
    Object.assign(etat.seance.exos[d.i], { saute: false, raison: "" });
    sauver(); fermerMenuOuRendre();
  },
  "rpe": (d) => {
    const x = etat.seance.exos[d.i];
    x.rpe = x.rpe === d.v ? null : d.v;
    sauver(); rendre();
  },
  "comm": (d) => {
    etat.commentaires[d.i] = true;
    rendre();
    const z = document.querySelector(`textarea[data-i="${d.i}"]`);
    if (z) z.focus();
  },
  "prec": () => changerEtape(-1),
  "suiv": () => changerEtape(1),
  "terminer": () => {
    finRepos();
    sonFinSeance();
    sauver();
    if (etat.menu !== null) { etat.menu = null; history.replaceState({ vue: "seance" }, ""); }
    naviguer("recap");
  },
  "continuer": () => history.back(),
  "voir-exo": (d) => { etat.apercuExo = d.i; naviguer("apercuExo"); },
  "apercu-exo-pas": (d) => {
    etat.apercuExo += d.v;
    libererVideos();
    rendre();
    window.scrollTo(0, 0);
  },
  "rpe-feuille": (d) => {
    etat.menu = { rpe: true, ref: d.ref, i: d.i };
    history.pushState({ vue: etat.vue, menu: true }, "");
    rendre();
  },
  "rpe-choisir": (d) => {
    const m = etat.menu;
    if (!m) return;
    if (m.ref) corrigerRPE(m.ref, m.i, d.v);
    else { etat.seance.exos[m.i].rpe = d.v; sauver(); }
    fermerMenuOuRendre();
  },
  "rpe-pied": (d) => {
    etat.seance.rpePied = etat.seance.rpePied === d.v ? null : d.v;
    sauver(); rendre();
  },
  "enregistrer": () => enregistrerSeance(),

  // Minuteur
  // Le « 3, 2, 1 » déjà parti ne tomberait plus juste : on le coupe, il repartira à 3 s.
  "repos-moins": () => {
    const R = etat.seance.repos;
    if (!R) return;
    R.fin -= 15000;
    couperDecompte(); R.decompte = false;
    sauver();
  },
  "repos-plus": () => {
    const R = etat.seance.repos;
    if (!R) return;
    R.fin = Math.max(R.fin, Date.now()) + 15000;
    R.total = Math.max(R.total, Math.ceil((R.fin - Date.now()) / 1000));
    R.sonne = false;
    couperDecompte(); R.decompte = false;
    sauver();
  },
  "repos-fin": () => finRepos()
};

/** Après une action du menu : le retour d'historique le ferme (et redessine). */
function fermerMenuOuRendre() {
  if (etat.menu !== null) history.back();
  else rendre();
}

function changerEtape(delta) {
  const S = etat.seance;
  const avant = S.etape;
  S.etape = Math.min(Math.max(S.etape + delta, 0), S.etapes.length - 1);
  // « Un nouveau challenger arrive ! » en arrivant sur l'exo suivant (pas en revenant en arrière).
  if (S.etape > avant) jouerSon("exo");
  sauver();
  rendre();
  window.scrollTo(0, 0);
}

document.addEventListener("click", (ev) => {
  const el = ev.target.closest("[data-a]");
  if (!el || el.disabled) return;
  const fn = actions[el.dataset.a];
  if (!fn) return;
  if (etat.vue === "seance") activerSon();
  const d = Object.assign({}, el.dataset);
  ["i", "s", "v"].forEach((k) => { if (d[k] !== undefined) d[k] = Number(d[k]); });
  fn(d);
});

// Saisie au clavier : commentaire enregistré à la frappe ; poids / reps à la
// validation du champ (on ne redessine pas pendant la frappe).
document.addEventListener("input", (ev) => {
  const el = ev.target;
  if (el.dataset.in === "form-comm" && etat.form) { etat.form.commentaire = el.value; return; }
  if (el.dataset.in === "comm" && etat.seance) {
    etat.seance.exos[Number(el.dataset.i)].commentaire = el.value;
    sauver();
  }
});
document.addEventListener("change", (ev) => {
  const el = ev.target;
  if (el.dataset.in === "form-date" && etat.form) { etat.form.date = el.value; return; }
  if (el.dataset.in === "prog-date" && etat.progEdit) { etat.progEdit.date = el.value; return; }
  if ((el.dataset.in === "form-duree" || el.dataset.in === "prog-duree")) {
    const cible = el.dataset.in === "form-duree" ? etat.form : etat.progEdit;
    const v = Math.round(num(el.value));
    if (cible && v >= 1 && v <= 300) cible.duree = v;
    rendre();
    return;
  }
  if ((el.dataset.in === "poids" || el.dataset.in === "reps") && etat.seance) {
    const v = num(el.value);
    if (el.value.trim() !== "" && !isNaN(v) && v >= 0) changerValeur(Number(el.dataset.i), Number(el.dataset.s), el.dataset.in, v);
    rendre();
  }
});

// Stockage illisible au démarrage : un message plutôt qu'un écran vide.
demarrer().catch((err) => {
  $app.innerHTML = `<div class="top"><h1>Impossible d'ouvrir l'app</h1></div>
    <p class="muted">Le stockage du téléphone ne répond pas (${esc(err && err.message || "erreur inconnue")}). Tes données ne sont pas forcément perdues : réessaie.</p>
    <div class="pied"><button class="btn lg" data-a="recharger">Réessayer</button></div>`;
});
