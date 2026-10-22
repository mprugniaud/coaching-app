/*
 * Programme de démonstration (mode « Essayer en démo ») : même forme que la
 * réponse de « …/exec?api=programme ». Rien n'est envoyé en démo.
 */
function exoDemo(ligne, nom, charge, reps, series, recup, recupSec, consigne, groupe) {
  return {
    ligne: ligne, nom: nom, lien: "", yt: "", video: false, charge: charge, reps: reps,
    series: String(series), nbSeries: series, recup: recup, recupSec: recupSec,
    consigne: consigne, rpe: "", commentaire: "", groupe: groupe || ""
  };
}

const PROGRAMME_DEMO = {
  ok: true,
  nom: "Démo",
  maj: new Date().toISOString(),
  programme: {
    semaines: [{
      onglet: "S4 (19/10-25/10)",
      sheetId: 1,
      seances: [{
        ref: "bloc-1-2-3", titre: "Séance 1", type: "salle", rpePied: "",
        exos: [
          exoDemo(3, "Knee to wall", "PDC", "8/côté", 1, "-", 0, "Talon au sol, amplitude contrôlée", "g3"),
          exoDemo(4, "Shin Box lift", "PDC", "6/côté", 1, "-", 0, "Rotation de hanche contrôlée", "g3"),
          exoDemo(5, "Wall Slides", "PDC", "8", 1, "-", 0, "Omoplates contrôlées", "g3"),
          exoDemo(6, "Fente iso", "PDC", "35 s/côté", 2, "45 s", 45, "Tibia relativement vertical, bassin stable"),
          exoDemo(7, "High Pull + Clean", "Barre +27,5 kg", "4", 4, "2'30", 150,
                  "Extension des hanches totale, barre la plus rapide possible"),
          exoDemo(8, "Bulgarian Split Squat", "14 kg/haltère", "7/côté", 3, "2' après les deux exercices", 120,
                  "Grande amplitude, remontée explosive", "g8"),
          exoDemo(9, "Fente bulgare sautée", "PDC", "4/côté", 3, "2' après les deux exercices", 120,
                  "Descends sous contrôle puis pousse explosivement", "g8")
        ]
      }, {
        ref: "bloc-1-2-12", titre: "Séance 2", type: "course", rpePied: "",
        exos: [
          exoDemo(3, "Footing progressif", "Entre 6'15–6'20/km", "8 min", 1, "-", 0, "Très facile"),
          exoDemo(4, "Lignes progressives", "Passe de 70% à 85%", "15 s en accélérant", 3, "45 s footing", 45,
                  "Relâché, jamais sprint"),
          exoDemo(5, "Retour au calme", "Au-dessus de 6'30/km", "5 min", 1, "-", 0, "Faire redescendre la FC")
        ]
      }]
    }]
  }
};
