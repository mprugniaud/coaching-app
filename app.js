/*
 * « Ma séance » — l'app de l'élève.
 *
 * Avant la salle (avec réseau) : le programme et les vidéos des séances sont
 * copiés sur le téléphone (IndexedDB). À la salle (sans réseau) : on fait la
 * séance exercice par exercice, série par série, avec le minuteur de récup.
 * À la fin : RPE et commentaires partent dans une file, envoyée à la page web
 * du Pilotage dès que le réseau revient (voir sync.js).
 *
 * Le commentaire écrit dans la feuille est composé ICI (commentaireExo) pour
 * être montré tel quel dans le récapitulatif avant l'envoi.
 */
"use strict";

const $app = document.getElementById("app");
const $repos = document.getElementById("repos");
const $toast = document.getElementById("toast");

const etat = {
  config: null,        // {url, cle, demo}
  prog: null,          // réponse de ?api=programme
  seance: null,        // séance en cours (sauvée à chaque geste)
  envois: [],          // file d'envoi
  videos: new Set(),   // vidéos présentes sur le téléphone
  vue: "accueil",
  apercu: null,        // ref de la séance affichée avant de commencer
  edition: null,       // {i, s} : série en cours de correction
  telechargements: {}, // ref → {fait, total, erreurs}
  videoEls: {},        // yt → <video>, gardées d'un rendu à l'autre
  enLigne: navigator.onLine
};


/* ================================ OUTILS ================================= */

const esc = (v) => String(v === null || v === undefined ? "" : v)
  .replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const mmss = (s) => Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");

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


/* ============================== DÉMARRAGE ================================ */

async function demarrer() {
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});

  etat.config = await kvGet("config");
  etat.prog = await kvGet("programme");
  etat.seance = await kvGet("encours");
  await rafraichirLocaux();

  if (!etat.config) etat.vue = "config";
  else if (etat.seance) etat.vue = "seance";
  history.replaceState({ vue: etat.vue }, "");
  rendre();

  if (etat.config) {
    synchroniser();
    if (navigator.onLine) majProgramme(true);
  }
}

async function rafraichirLocaux() {
  etat.envois = await envoisTous();
  etat.videos = new Set(await videoCles());
}

window.addEventListener("online", () => { etat.enLigne = true; synchroniser(); rendreEntete(); });
window.addEventListener("offline", () => { etat.enLigne = false; rendreEntete(); });
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible") return;
  synchroniser();
  if (etat.vue === "seance") garderEcran(true);
});

// Bouton retour d'Android : revenir d'un écran plutôt que fermer l'app.
window.addEventListener("popstate", (e) => {
  const vue = (e.state && e.state.vue) || "accueil";
  if (etat.vue === "seance" || etat.vue === "recap") sortirSeance();
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
    toast("✓ " + bilan.envoyes + (bilan.envoyes > 1 ? " séances écrites" : " séance écrite") +
          " dans ta feuille" + (ignores.length ? " — non retrouvés : " + ignores.join(", ") : ""), 5000);
  }
  if (etat.envois.some((e) => !e.refuse)) syncArrierePlan();
  if (etat.vue === "accueil") rendre(); else rendreEntete();
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
    etat.prog = rep;
    await kvSet("programme", rep);
    if (!silencieux) toast("Programme à jour");
  } catch (err) {
    if (!silencieux) toast("Mise à jour impossible : " + err.message, 5000);
  }
  if (etat.vue === "accueil" || etat.vue === "apercu") rendre();
}

async function preparerHorsLigne(ref) {
  const s = trouverSeance(ref);
  if (!s || etat.telechargements[ref]) return;
  const yts = [...new Set(s.seance.exos.filter((x) => x.video && x.yt).map((x) => x.yt))]
    .filter((yt) => !etat.videos.has(yt));
  if (!yts.length) { toast("Toutes les vidéos disponibles sont déjà sur le téléphone."); return; }

  // Sans ça, Android peut vider le stockage d'une app peu utilisée.
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});

  const t = { fait: 0, total: yts.length, erreurs: 0, message: "" };
  etat.telechargements[ref] = t;
  rendre();
  for (const yt of yts) {
    try {
      const r = await fetch(etat.config.url + "?api=video&cle=" + encodeURIComponent(etat.config.cle) +
                            "&yt=" + encodeURIComponent(yt));
      const rep = await r.json();
      if (!rep.ok) throw new Error(rep.erreur);
      const blob = await (await fetch("data:" + rep.mime + ";base64," + rep.base64)).blob();
      await videoSet({ yt: yt, blob: blob, taille: blob.size, date: Date.now() });
      etat.videos.add(yt);
    } catch (err) {
      t.erreurs++;
      t.message = err.message;
    }
    t.fait++;
    rendre();
  }
  delete etat.telechargements[ref];
  toast(t.erreurs ? t.erreurs + " vidéo(s) en échec : " + t.message : "✓ Séance prête hors réseau", 5000);
  rendre();
}


/* =============================== PROGRAMME =============================== */

function trouverSeance(ref) {
  if (!etat.prog) return null;
  for (const sem of etat.prog.programme.semaines) {
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

function videosSeance(s) {
  const avec = [...new Set(s.exos.filter((x) => x.video && x.yt).map((x) => x.yt))];
  return { total: avec.length, ici: avec.filter((yt) => etat.videos.has(yt)).length };
}


/* ============================ SÉANCE EN COURS ============================ */

function nouvelleSeance(s, onglet) {
  const exos = s.exos.map((x) => Object.assign({}, x, {
    faites: Array.from({ length: x.nbSeries || 1 }, () => ({ etat: "afaire", reps: "", charge: "" })),
    saute: false, raison: "", rpe: null, commentaire: "", rpeVisible: false
  }));
  // Un superset (Séries fusionnées dans la feuille) = une seule étape.
  const etapes = [];
  exos.forEach((x, i) => {
    const prec = etapes[etapes.length - 1];
    if (x.groupe && prec && exos[prec[0]].groupe === x.groupe) prec.push(i);
    else etapes.push([i]);
  });
  return {
    ref: s.ref, titre: s.titre, type: s.type, onglet: onglet,
    debut: Date.now(), exos: exos, etapes: etapes, etape: 0, repos: null, rpePied: null
  };
}

function exoTermine(x) {
  return x.saute || x.faites.every((se) => se.etat !== "afaire");
}

/**
 * Après une série : la récup démarre quand le TOUR est fini (tous les exos
 * du superset ont fait cette série) et qu'il reste des séries à faire.
 */
function apresSerie(s) {
  const S = etat.seance;
  const groupe = S.etapes[S.etape].map((k) => S.exos[k]).filter((x) => !x.saute);
  const tourFini = groupe.every((x) => s >= x.faites.length || x.faites[s].etat !== "afaire");
  const reste = groupe.some((x) => x.faites.some((se) => se.etat === "afaire"));
  if (!reste) { finRepos(); return; }      // dernière série : place au RPE
  if (!tourFini) return;
  const sec = Math.max(0, ...groupe.map((x) => x.recupSec || 0));
  if (sec > 0) demarrerRepos(sec);
}

/** Commentaire écrit dans la feuille, à droite du RPE. */
function commentaireExo(x) {
  const libre = (x.commentaire || "").trim();
  if (x.saute) {
    return ["⏭ sauté" + (x.raison ? " — " + x.raison : ""), libre].filter(Boolean).join(" · ");
  }
  const parts = [];
  x.faites.forEach((se, i) => {
    const n = "S" + (i + 1);
    const enPlus = i >= (x.nbSeries || 1);
    if (se.etat === "afaire" || se.etat === "nonfaite") {
      if (!enPlus) parts.push(n + " : non faite");
    } else if (se.etat === "modif" || enPlus) {
      parts.push(n + (enPlus ? " (en plus)" : "") + " : " + resumeSerie(se, x));
    }
  });
  if (libre) parts.push(libre);
  return parts.join(" · ");
}

function resumeSerie(se, x) {
  const reps = se.reps || (se.charge ? "" : x.reps);
  const r = reps ? (/^\d+$/.test(reps) ? reps + " reps" : reps) : "";
  const c = se.charge ? (r ? "@ " : "") + se.charge : "";
  return [r, c].filter(Boolean).join(" ") || "faite";
}

/** Dernière charge corrigée avant la série s : proposée pour la suivante. */
function chargePrecedente(x, s) {
  for (let k = s - 1; k >= 0; k--) if (x.faites[k].charge) return x.faites[k].charge;
  return "";
}

function commencer(ref) {
  const t = trouverSeance(ref);
  if (!t) return;
  if (etat.seance && !confirm("Une autre séance est en cours. L'abandonner ?")) return;
  etat.seance = nouvelleSeance(t.seance, t.semaine.onglet);
  sauver();
  activerSon();
  naviguer("seance");
}

function sortirSeance() {
  garderEcran(false);
  Object.values(etat.videoEls).forEach((v) => { v.pause(); URL.revokeObjectURL(v.src); });
  etat.videoEls = {};
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

  await kvDel("encours");
  sortirSeance();
  etat.seance = null;
  etat.vue = "accueil";
  history.replaceState({ vue: "accueil" }, "");
  await rafraichirLocaux();
  rendre();
  window.scrollTo(0, 0);
  toast(etat.enLigne ? "Séance enregistrée, envoi en cours…" : "Séance enregistrée. Envoi dès que le réseau revient.", 4000);
  synchroniser();
  syncArrierePlan();
}


/* ======================== MINUTEUR, SON, ÉCRAN =========================== */

let minuteurRepos = null;
let audio = null;
let verrouEcran = null;

function demarrerRepos(sec) {
  etat.seance.repos = { fin: Date.now() + sec * 1000, sonne: false };
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
  $repos.innerHTML =
    '<div class="doux">Récup</div><div class="temps"></div>' +
    '<div class="ligne"><button data-a="repos-moins">−15 s</button>' +
    '<button data-a="repos-plus">+15 s</button>' +
    '<button class="principal" data-a="repos-fin">Passer</button></div>';
  const $t = $repos.querySelector(".temps");
  const tic = () => {
    const reste = Math.ceil((R.fin - Date.now()) / 1000);
    if (reste > 0) { $t.textContent = mmss(reste); return; }
    $t.textContent = "C'est reparti !";
    $repos.classList.add("fini");
    if (!R.sonne) { R.sonne = true; sauver(); signalFin(); }
    if (reste < -8) finRepos();
  };
  $repos.classList.remove("fini");
  tic();
  minuteurRepos = setInterval(tic, 250);
}

function finRepos() {
  clearInterval(minuteurRepos);
  if (etat.seance && etat.seance.repos) { etat.seance.repos = null; sauver(); }
  $repos.hidden = true;
  document.body.classList.remove("avec-repos");
}

/** Le son n'est permis qu'après un geste : on prépare l'AudioContext au clic. */
function activerSon() {
  try {
    if (!audio) audio = new (window.AudioContext || window.webkitAudioContext)();
    if (audio.state === "suspended") audio.resume();
  } catch (err) { audio = null; }
}

function signalFin() {
  if (navigator.vibrate) navigator.vibrate([400, 150, 400, 150, 400]);
  if (!audio) return;
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
  const vues = { config: vueConfig, accueil: vueAccueil, apercu: vueApercu,
                 seance: vueSeance, recap: vueRecap, reglages: vueReglages };
  $app.innerHTML = (vues[etat.vue] || vueAccueil)();
  if (etat.vue === "seance") {
    brancherVideos();
    afficherRepos();
    garderEcran(true);
  } else {
    $repos.hidden = true;
  }
}

function pastilleStatut() {
  const attente = etat.envois.filter((e) => !e.refuse).length;
  if (attente) return '<span class="pastille attente" id="statut">⏳ ' + attente + " à envoyer</span>";
  if (!etat.enLigne) return '<span class="pastille off" id="statut">Hors réseau</span>';
  return '<span class="pastille ok" id="statut">✓ À jour</span>';
}

function rendreEntete() {
  const p = document.getElementById("statut");
  if (p) p.outerHTML = pastilleStatut();
}

function vueConfig() {
  return `
    <h1>Ma séance</h1>
    <p class="doux">Colle ton lien perso, celui de « 📱 Déclarer mes séances » en haut de ta feuille
      (il se termine par <b>?cle=…</b>).</p>
    <div class="pile">
      <textarea id="lien" placeholder="https://script.google.com/macros/s/…/exec?cle=…"></textarea>
      <button class="principal plein" data-a="config-ok">Enregistrer</button>
      <button class="plein" data-a="demo">Essayer en démo</button>
    </div>`;
}

function vueAccueil() {
  const p = etat.prog;
  let h = `<div class="entete"><h1>Ma séance</h1>${pastilleStatut()}</div>`;
  if (etat.config.demo) h += '<p class="doux">Mode démo : rien n\'est envoyé à ta feuille.</p>';

  etat.envois.filter((e) => e.refuse).forEach((e) => {
    h += `<div class="carte alerte"><b>Envoi refusé : ${esc(e.resume)}</b>
      <p class="doux">${esc(e.erreur)}</p>
      <div class="ligne"><button data-a="reessayer" data-id="${esc(e.id)}">Réessayer</button>
      <button class="danger" data-a="supprimer-envoi" data-id="${esc(e.id)}">Supprimer</button></div></div>`;
  });

  if (etat.seance) {
    h += `<div class="carte encours"><h3>En cours : ${esc(etat.seance.titre)}</h3>
      <p class="doux">${esc(etat.seance.onglet)}</p>
      <div class="ligne"><button class="principal pousse" data-a="reprendre">Reprendre</button>
      <button class="danger" data-a="abandonner">Abandonner</button></div></div>`;
  }

  if (!p) {
    h += `<p class="doux">Pas encore de programme sur le téléphone.</p>
      <button class="principal plein" data-a="maj">Télécharger mon programme</button>`;
  } else {
    p.programme.semaines.forEach((sem) => {
      h += `<h2>${esc(sem.onglet)}</h2>`;
      if (!sem.seances.length) h += '<p class="doux">Aucune séance programmée.</p>';
      sem.seances.forEach((s) => { h += carteSeance(s); });
    });
    const d = new Date(p.maj);
    h += `<p class="doux petit">Programme du ${d.toLocaleDateString("fr-FR")} à
      ${d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}</p>
      <button class="plein" data-a="maj" ${etat.enLigne ? "" : "disabled"}>↻ Mettre à jour le programme</button>`;
  }

  if (etat.config.demo) h += '<div id="demo-envoi"></div>';
  h += '<p><button class="lien" data-a="reglages">Réglages</button></p>';
  if (etat.config.demo) kvGet("demoEnvoi").then(afficherEnvoiDemo);
  return h;
}

function afficherEnvoiDemo(envoi) {
  const el = document.getElementById("demo-envoi");
  if (!el || !envoi) return;
  el.innerHTML = `<h2>Dernier envoi (démo)</h2><div class="carte">
    ${envoi.exos.map((x) => `<div class="recap-ligne"><b>${esc(x.nom)}</b> — RPE ${esc(x.rpe || "—")}
      ${x.commentaire ? `<div class="comm">📱 ${esc(x.commentaire)}</div>` : ""}</div>`).join("")}
    ${envoi.rpePied ? `<p>RPE séance : ${esc(envoi.rpePied)}</p>` : ""}</div>`;
}

function carteSeance(s) {
  const v = videosSeance(s);
  const t = etat.telechargements[s.ref];
  const attente = etat.envois.some((e) => e.envoi.ref === s.ref && !e.refuse);
  const badges = [
    `<span class="badge">${s.type === "course" ? "Course" : "Salle"} · ${s.exos.length} exos</span>`,
    seanceFaite(s) ? '<span class="badge ok">✓ faite</span>' : "",
    attente ? '<span class="badge">⏳ à envoyer</span>' : "",
    v.total ? `<span class="badge ${v.ici === v.total ? "ok" : ""}">🎬 ${v.ici}/${v.total} hors réseau</span>`
            : '<span class="badge">sans vidéo</span>'
  ].join(" ");
  let bas;
  if (t) {
    bas = `<p class="doux">Téléchargement des vidéos ${t.fait}/${t.total}…</p>
      <div class="progression"><div style="width:${Math.round(100 * t.fait / t.total)}%"></div></div>`;
  } else {
    bas = `<div class="ligne">
      <button class="principal pousse" data-a="ouvrir" data-ref="${esc(s.ref)}">Ouvrir</button>
      ${v.ici < v.total ? `<button data-a="preparer" data-ref="${esc(s.ref)}" ${etat.enLigne ? "" : "disabled"}>⬇ Préparer hors réseau</button>` : ""}
    </div>`;
  }
  return `<div class="carte"><h3>${esc(s.titre)}</h3><div class="ligne">${badges}</div>
    <p class="doux petit">${esc(s.exos.map((x) => x.nom).join(" · "))}</p>${bas}</div>`;
}

function vueApercu() {
  const t = trouverSeance(etat.apercu);
  if (!t) return vueAccueil();
  const s = t.seance;
  const v = videosSeance(s);
  return `
    <p><button class="lien" data-a="retour">← Séances</button></p>
    <h1>${esc(s.titre)}</h1><p class="doux">${esc(t.semaine.onglet)}</p>
    ${v.ici < v.total ? `<div class="carte"><b>${v.total - v.ici} vidéo(s) pas encore sur le téléphone.</b>
      <p class="doux">À faire avant la salle, avec du réseau.</p>
      <button class="plein" data-a="preparer" data-ref="${esc(s.ref)}" ${etat.enLigne ? "" : "disabled"}>⬇ Préparer hors réseau</button></div>` : ""}
    <div class="carte">${s.exos.map((x) => `
      <div class="recap-ligne"><b>${esc(x.nom)}</b> ${x.yt && etat.videos.has(x.yt) ? "🎬" : ""}
        <div class="doux">${esc([x.charge, x.reps && (/^\d+$/.test(x.reps) ? x.reps + " reps" : x.reps), x.series && x.series + " séries", x.recup && x.recup !== "-" && "récup " + x.recup].filter(Boolean).join(" · "))}</div>
        ${rpeRempli(x.rpe) ? `<div class="doux petit">RPE déjà noté : ${esc(x.rpe)}</div>` : ""}
      </div>`).join("")}</div>
    <div class="navbas"><button class="principal" data-a="commencer" data-ref="${esc(s.ref)}">Commencer la séance</button></div>`;
}

function vueSeance() {
  const S = etat.seance;
  if (!S) return vueAccueil();
  const etape = S.etapes[S.etape];
  const dernier = S.etape === S.etapes.length - 1;
  const lettres = etape.length > 1;
  return `
    <div class="entete"><button class="lien" data-a="quitter">← Séances</button>
      <span class="doux">${S.etape + 1} / ${S.etapes.length}</span></div>
    <div class="progression"><div style="width:${Math.round(100 * S.etape / S.etapes.length)}%"></div></div>
    <h1>${esc(S.titre)}${lettres ? ' <span class="doux petit">— enchaîne les exos, récup après le tour</span>' : ""}</h1>
    ${etape.map((i, k) => carteExo(S.exos[i], i, lettres ? String.fromCharCode(65 + k) : "")).join("")}
    <div class="navbas">
      <button data-a="prec" ${S.etape ? "" : "disabled"}>← Précédent</button>
      <button class="principal" data-a="${dernier ? "terminer" : "suiv"}">${dernier ? "Terminer" : "Suivant →"}</button>
    </div>`;
}

function carteExo(x, i, lettre) {
  const titre = `<h3>${lettre ? `<span class="lettre">${lettre}</span>` : ""}${esc(x.nom)}</h3>`;
  if (x.saute) {
    return `<div class="exo saute"><div class="corps">${titre}
      <p>⏭ Sauté${x.raison ? " — " + esc(x.raison) : ""}</p>
      <button data-a="reprendre-exo" data-i="${i}">Finalement je le fais</button></div></div>`;
  }
  let video;
  if (x.yt && etat.videos.has(x.yt)) video = `<div class="vplace" data-yt="${esc(x.yt)}"></div>`;
  else if (x.lien) video = `<div class="sansvideo">Vidéo pas sur le téléphone${etat.enLigne ? ` — <a href="${esc(x.lien)}" target="_blank" rel="noopener">la voir en ligne</a>` : ""}</div>`;
  else video = "";

  const params = [["Charge", x.charge], ["Reps", x.reps], ["Séries", x.series], ["Récup", x.recup]]
    .map(([k, v]) => `<div><span>${k}</span><b>${esc(v || "—")}</b></div>`).join("");

  const series = x.faites.map((se, s) => ligneSerie(x, se, i, s)).join("");
  const montrerRPE = etat.seance.type === "salle" && (exoTermine(x) || x.rpe || x.rpeVisible);
  const rpe = montrerRPE ? `<p><b>RPE de l'exo</b> <span class="doux petit">(1 = très facile, 10 = max)</span></p>
    <div class="rpe">${[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((v) =>
      `<button class="${x.rpe === v ? "choisi" : ""}" data-a="rpe" data-i="${i}" data-v="${v}">${v}</button>`).join("")}</div>`
    : (etat.seance.type === "salle" ? `<button class="lien" data-a="rpe-montrer" data-i="${i}">Donner le RPE maintenant</button>` : "");

  return `<div class="exo">${video}<div class="corps">${titre}
    <div class="params">${params}</div>
    ${x.consigne ? `<p class="consigne">${esc(x.consigne)}</p>` : ""}
    ${series}
    <div class="ligne"><button class="lien" data-a="serie-plus" data-i="${i}">+ série</button>
      <span class="pousse"></span><button class="lien" data-a="sauter" data-i="${i}">⏭ Sauter l'exo</button></div>
    ${rpe}
    <p class="doux petit" style="margin-top:12px">Commentaire pour Félix (facultatif)</p>
    <textarea data-in="comm" data-i="${i}" placeholder="Douleur, sensation, matériel…">${esc(x.commentaire)}</textarea>
  </div></div>`;
}

function ligneSerie(x, se, i, s) {
  const prevu = [x.reps && (/^\d+$/.test(x.reps) ? x.reps + " reps" : x.reps), x.charge].filter(Boolean).join(" @ ");
  let detail = esc(prevu || "Série");
  let cls = "";
  if (se.etat === "modif") { detail = esc(resumeSerie(se, x)); cls = "modif"; }
  if (se.etat === "nonfaite") { cls = "nonfaite"; }
  const enPlus = s >= (x.nbSeries || 1) ? ' <span class="doux petit">(en plus)</span>' : "";
  const classe = { afaire: "", ok: "ok", modif: "ok", nonfaite: "rate" }[se.etat];
  let h = `<div class="serie ${classe}">
    <span class="num">S${s + 1}</span><span class="detail ${cls}">${detail}${enPlus}</span>
    <button data-a="editer" data-i="${i}" data-s="${s}" aria-label="Corriger">✎</button>
    <button class="coche" data-a="coche" data-i="${i}" data-s="${s}" aria-label="Série faite">${se.etat === "nonfaite" ? "✗" : "✓"}</button></div>`;
  if (etat.edition && etat.edition.i === i && etat.edition.s === s) {
    h += `<div class="edition">
      <div class="ligne"><label>Reps faites<input id="ed-reps" inputmode="numeric" value="${esc(se.reps)}" placeholder="${esc(x.reps)}"></label>
      <label>Charge<input id="ed-charge" value="${esc(se.charge || chargePrecedente(x, s))}" placeholder="${esc(x.charge)}"></label></div>
      <div class="ligne" style="margin-top:8px"><button class="vert pousse" data-a="edit-ok">Valider</button>
      <button data-a="edit-nonfaite">Pas faite</button><button data-a="edit-annuler">Annuler</button></div></div>`;
  }
  return h;
}

/** Les <video> survivent aux rendus : la lecture ne repart pas à chaque geste. */
async function brancherVideos() {
  for (const place of $app.querySelectorAll(".vplace")) {
    const yt = place.dataset.yt;
    let v = etat.videoEls[yt];
    if (!v) {
      const rec = await videoGet(yt);
      if (!rec) continue;
      if (etat.videoEls[yt]) { v = etat.videoEls[yt]; } else {
        v = document.createElement("video");
        Object.assign(v, { muted: true, loop: true, playsInline: true, autoplay: true, controls: true });
        v.className = "video";
        v.src = URL.createObjectURL(rec.blob);
        etat.videoEls[yt] = v;
      }
    }
    if (place.isConnected) { place.replaceWith(v); v.play().catch(() => {}); }
  }
}

function vueRecap() {
  const S = etat.seance;
  if (!S) return vueAccueil();
  const minutes = Math.round((Date.now() - S.debut) / 60000);
  const lignes = S.exos.map((x) => {
    const etapeIdx = S.etapes.findIndex((e) => e.includes(S.exos.indexOf(x)));
    const manque = S.type === "salle" && !x.saute && !x.rpe;
    const comm = commentaireExo(x);
    return `<div class="recap-ligne"><div class="entete"><b>${esc(x.nom)}</b>
      <span class="${manque ? "manque" : ""}">${x.saute ? "sauté" : S.type === "salle" ? "RPE " + (x.rpe || "?") : ""}</span></div>
      ${comm ? `<div class="comm">📱 ${esc(comm)}</div>` : ""}
      ${manque ? `<button class="lien" data-a="aller" data-v="${etapeIdx}">Donner le RPE</button>` : ""}</div>`;
  }).join("");
  const rpeSeance = S.type === "course" ? `<h2>RPE de la séance</h2>
    <div class="rpe">${[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((v) =>
      `<button class="${S.rpePied === v ? "choisi" : ""}" data-a="rpe-pied" data-v="${v}">${v}</button>`).join("")}</div>` : "";
  return `
    <p><button class="lien" data-a="continuer">← Revenir à la séance</button></p>
    <h1>Récapitulatif</h1><p class="doux">${esc(S.titre)} · ${esc(S.onglet)} · ${minutes} min</p>
    <p class="doux petit">Voici ce qui sera écrit dans ta feuille (RPE dans sa colonne, commentaire 📱 à droite).</p>
    <div class="carte">${lignes}</div>
    ${rpeSeance}
    <div class="navbas"><button class="vert" data-a="enregistrer">Enregistrer la séance</button></div>`;
}

function vueReglages() {
  const c = etat.config;
  const h = `
    <p><button class="lien" data-a="retour">← Séances</button></p>
    <h1>Réglages</h1>
    <div class="carte pile">
      <div><b>Lien</b><p class="doux petit">${c.demo ? "Démo" : esc(c.url) + "?cle=" + esc(c.cle.slice(0, 4)) + "…"}</p></div>
      <button class="plein" data-a="changer-lien">${c.demo ? "Quitter la démo" : "Changer de lien"}</button>
    </div>
    <div class="carte pile">
      <div><b>Vidéos sur le téléphone : ${etat.videos.size}</b><p class="doux petit" id="stockage"></p></div>
      <button class="plein danger" data-a="vider-videos" ${etat.videos.size ? "" : "disabled"}>Supprimer les vidéos du téléphone</button>
    </div>`;
  if (navigator.storage && navigator.storage.estimate) {
    navigator.storage.estimate().then((e) => {
      const el = document.getElementById("stockage");
      if (el) el.textContent = "Espace utilisé par l'app : " + Math.round(e.usage / 1048576) + " Mo";
    });
  }
  return h;
}


/* =============================== ACTIONS ================================= */

function lireLien(texte) {
  try {
    const u = new URL(String(texte).trim());
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
  etat.vue = "accueil";
  history.replaceState({ vue: "accueil" }, "");
  rendre();
  majProgramme(false);
}

const actions = {
  "config-ok": () => {
    const c = lireLien(document.getElementById("lien").value);
    if (!c) { toast("Ce n'est pas un lien « …/exec?cle=… » valide."); return; }
    changerConfig(c);
  },
  "demo": () => changerConfig({ url: "", cle: "", demo: true }),
  "maj": () => majProgramme(false),
  "ouvrir": (d) => { etat.apercu = d.ref; naviguer("apercu"); },
  "preparer": (d) => preparerHorsLigne(d.ref),
  "retour": () => history.back(),
  "reglages": () => naviguer("reglages"),
  "commencer": (d) => commencer(d.ref),
  "reprendre": () => { activerSon(); naviguer("seance"); },
  "abandonner": async () => {
    if (!confirm("Abandonner la séance en cours ? Rien ne sera envoyé.")) return;
    etat.seance = null;
    await kvDel("encours");
    rendre();
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
    if (etat.seance && !confirm("La séance en cours sera abandonnée. Continuer ?")) return;
    etat.seance = null;
    await kvDel("encours");
    await kvDel("config");
    etat.config = null;
    etat.vue = "config";
    history.replaceState({ vue: "config" }, "");
    rendre();
  },
  "vider-videos": async () => {
    if (!confirm("Supprimer toutes les vidéos du téléphone ?")) return;
    await videosVider();
    await rafraichirLocaux();
    rendre();
  },

  // Séance
  // Pas history.back() : si l'app a rouvert sur la séance, ce serait la fermer.
  "quitter": () => {
    sortirSeance();
    etat.vue = "accueil";
    history.replaceState({ vue: "accueil" }, "");
    rendre();
  },
  "coche": (d) => {
    const x = etat.seance.exos[d.i];
    const se = x.faites[d.s];
    etat.edition = null;
    if (se.etat === "afaire") { se.etat = "ok"; apresSerie(d.s); }
    else { Object.assign(se, { etat: "afaire", reps: "", charge: "" }); }
    sauver(); rendre();
  },
  "editer": (d) => {
    const ouvert = etat.edition && etat.edition.i === d.i && etat.edition.s === d.s;
    etat.edition = ouvert ? null : { i: d.i, s: d.s };
    rendre();
    const champ = document.getElementById("ed-reps");
    if (champ) champ.focus();
  },
  "edit-ok": () => {
    const { i, s } = etat.edition;
    const x = etat.seance.exos[i];
    const se = x.faites[s];
    const avant = se.etat;
    se.reps = document.getElementById("ed-reps").value.trim();
    se.charge = document.getElementById("ed-charge").value.trim();
    se.etat = se.reps || se.charge ? "modif" : "ok";
    etat.edition = null;
    if (avant === "afaire") apresSerie(s);
    sauver(); rendre();
  },
  "edit-nonfaite": () => {
    const { i, s } = etat.edition;
    const se = etat.seance.exos[i].faites[s];
    const avant = se.etat;
    Object.assign(se, { etat: "nonfaite", reps: "", charge: "" });
    etat.edition = null;
    if (avant === "afaire") apresSerie(s);
    sauver(); rendre();
  },
  "edit-annuler": () => { etat.edition = null; rendre(); },
  "serie-plus": (d) => {
    etat.seance.exos[d.i].faites.push({ etat: "afaire", reps: "", charge: "" });
    sauver(); rendre();
  },
  "sauter": (d) => {
    const raison = prompt("Pourquoi tu sautes cet exo ? (facultatif)", "");
    if (raison === null) return;
    Object.assign(etat.seance.exos[d.i], { saute: true, raison: raison.trim() });
    sauver(); rendre();
  },
  "reprendre-exo": (d) => {
    Object.assign(etat.seance.exos[d.i], { saute: false, raison: "" });
    sauver(); rendre();
  },
  "rpe": (d) => {
    const x = etat.seance.exos[d.i];
    x.rpe = x.rpe === d.v ? null : d.v;
    sauver(); rendre();
  },
  "rpe-montrer": (d) => { etat.seance.exos[d.i].rpeVisible = true; rendre(); },
  "prec": () => changerEtape(-1),
  "suiv": () => changerEtape(1),
  "terminer": () => { finRepos(); naviguer("recap"); },
  "continuer": () => history.back(),
  "aller": (d) => { etat.seance.etape = d.v; sauver(); history.back(); },
  "rpe-pied": (d) => {
    etat.seance.rpePied = etat.seance.rpePied === d.v ? null : d.v;
    sauver(); rendre();
  },
  "enregistrer": () => enregistrerSeance(),

  // Minuteur
  "repos-moins": () => { if (etat.seance.repos) { etat.seance.repos.fin -= 15000; sauver(); } },
  "repos-plus": () => {
    const R = etat.seance.repos;
    if (!R) return;
    R.fin = Math.max(R.fin, Date.now()) + 15000;
    R.sonne = false;
    $repos.classList.remove("fini");
    sauver();
  },
  "repos-fin": () => finRepos()
};

function changerEtape(delta) {
  const S = etat.seance;
  S.etape = Math.min(Math.max(S.etape + delta, 0), S.etapes.length - 1);
  etat.edition = null;
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

// Commentaire : enregistré à la frappe, sans redessiner (on garderait mal le curseur).
document.addEventListener("input", (ev) => {
  const el = ev.target;
  if (el.dataset.in === "comm" && etat.seance) {
    etat.seance.exos[Number(el.dataset.i)].commentaire = el.value;
    sauver();
  }
});

demarrer();
