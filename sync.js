/*
 * Envoi de la file des séances vers la page web du Pilotage.
 * Appelé par la page (ouverture, retour du réseau, fin de séance) ET par le
 * service worker (Background Sync : Android envoie même l'app fermée).
 *
 * Un envoi n'est retiré de la file qu'après une réponse « ok » du serveur.
 * Erreur réseau → on s'arrête et on réessaiera plus tard ; refus du serveur
 * (séance introuvable…) → l'envoi est marqué « refusé » et attend l'élève.
 * Le serveur ignore un envoi déjà traité (même id) : renvoyer est sans risque.
 */
let envoiEnCours = null;

function envoyerFile() {
  if (!envoiEnCours) {
    envoiEnCours = envoyerFile_().finally(function () { envoiEnCours = null; });
  }
  return envoiEnCours;
}

async function envoyerFile_() {
  const config = await kvGet("config");
  const bilan = { envoyes: 0, rapports: [] };
  if (!config) return bilan;

  for (const e of await envoisTous()) {
    if (e.refuse) continue;

    if (config.demo) {
      // Démo : rien ne part, on garde l'envoi pour l'afficher.
      await kvSet("demoEnvoi", e.envoi);
      await envoiSupprimer(e.id);
      bilan.envoyes++;
      continue;
    }

    let rep;
    try {
      rep = await posterJSON(config.url, { action: "enregistrer", cle: config.cle, envoi: e.envoi });
    } catch (err) {
      e.essais = (e.essais || 0) + 1;
      e.erreur = "Pas de réseau (" + err.message + ")";
      await envoiMettre(e);
      break;
    }
    if (rep && rep.ok) {
      await envoiSupprimer(e.id);
      bilan.envoyes++;
      if (rep.rapport) bilan.rapports.push({ resume: e.resume, rapport: rep.rapport });
    } else {
      e.refuse = true;
      e.erreur = (rep && rep.erreur) || "Réponse inattendue du serveur";
      await envoiMettre(e);
    }
  }
  if (bilan.rapports.length) await kvSet("derniersRapports", bilan.rapports);
  return bilan;
}

/** POST en text/plain : pas de requête préalable CORS, qu'Apps Script refuse. */
async function posterJSON(url, donnees) {
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify(donnees),
    redirect: "follow"
  });
  if (!r.ok) throw new Error("HTTP " + r.status);
  return r.json();
}
