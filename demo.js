/*
 * Programme de démonstration (mode « Essayer en démo ») : même forme que la
 * réponse de « …/exec?api=programme ». Rien n'est envoyé en démo.
 */
function exoDemo(ligne, nom, charge, reps, series, recup, recupSec, consigne, groupe, rpe) {
  return {
    ligne: ligne, nom: nom, lien: "", yt: "", video: false, charge: charge, reps: reps,
    series: String(series), nbSeries: series, recup: recup, recupSec: recupSec,
    consigne: consigne, rpe: rpe || "", commentaire: "", groupe: groupe || ""
  };
}

const PROGRAMME_DEMO = {
  ok: true,
  nom: "Démo",
  maj: new Date().toISOString(),
  programme: {
    semaines: [{
      onglet: "S4 (19/10-25/10)",
      sheetId: 4,
      seances: [{
        ref: "bloc-4-2-3", titre: "Séance 1", type: "salle", rpePied: "",
        exos: [
          exoDemo(3, "Knee to wall", "PDC", "8/côté", 1, "-", 0, "Talon au sol, amplitude contrôlée", "g3"),
          exoDemo(4, "Shin Box lift", "PDC", "6/côté", 1, "-", 0, "Rotation de hanche contrôlée", "g3"),
          exoDemo(5, "Fente iso", "PDC", "35 s/côté", 2, "45 s", 45, "Tibia relativement vertical, bassin stable"),
          exoDemo(6, "High Pull + Clean", "Barre +27,5 kg", "4", 4, "2'30", 150,
                  "Extension des hanches totale, barre la plus rapide possible"),
          exoDemo(7, "Bulgarian Split Squat", "14 kg/haltère", "7/côté", 3, "2' après les deux exercices", 120,
                  "Grande amplitude, remontée explosive", "g7"),
          exoDemo(8, "Fente bulgare sautée", "PDC", "4/côté", 3, "2' après les deux exercices", 120,
                  "Descends sous contrôle puis pousse explosivement", "g7"),
          exoDemo(9, "Rowing Pendlay à la barre", "30 kg + barre olympique", "5", 3, "1'30", 90,
                  "Chaque rep explosive")
        ]
      }, {
        ref: "bloc-4-2-12", titre: "Séance 2", type: "course", rpePied: "",
        exos: [
          exoDemo(3, "Footing progressif", "Entre 6'15–6'20/km", "8 min", 1, "-", 0, "Très facile"),
          exoDemo(4, "Lignes progressives", "Passe de 70% à 85%", "15 s en accélérant", 3, "45 s footing", 45,
                  "Relâché, jamais sprint"),
          exoDemo(5, "Retour au calme", "Au-dessus de 6'30/km", "5 min", 1, "-", 0, "Faire redescendre la FC")
        ]
      }]
    }, {
      onglet: "S3 (12/10-18/10)",
      sheetId: 3,
      seances: [{
        ref: "bloc-3-2-3", titre: "Séance 1", type: "salle", rpePied: "",
        exos: [
          exoDemo(3, "Fente iso", "PDC", "35 s/côté", 2, "45 s", 45, "", "", "7"),
          exoDemo(4, "High Pull + Clean", "Barre +25 kg", "4", 4, "2'30", 150, "", "", "7"),
          exoDemo(5, "Bulgarian Split Squat", "14 kg/haltère", "6/côté", 3, "2'", 120, "", "g5", "8"),
          exoDemo(6, "Fente bulgare sautée", "PDC", "4/côté", 3, "2'", 120, "", "g5", "6"),
          exoDemo(7, "Rowing Pendlay à la barre", "25 kg + barre olympique", "6", 3, "1'30", 90, "", "", "7")
        ]
      }]
    }]
  }
};

/* Suivi de charge de démonstration : même forme que « …/exec?api=charge ». */
const CHARGE_DEMO = (function () {
  const iso = (d) => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  const lundi = new Date(); lundi.setDate(lundi.getDate() - ((lundi.getDay() + 6) % 7));
  const charges = [420, 1210, 980, 1040, null, 860];
  return {
    ok: true, equipe: true,
    semaines: charges.map((c, i) => {
      const d = new Date(lundi); d.setDate(d.getDate() - 7 * i);
      return { lundi: iso(d), charge: c, nbSeances: c ? Math.round(c / 330) : 0 };
    }),
    analyse: { ref: 1210, chronique: 960, acwr: 1.26, alerte: "Zone optimale" },
    seuils: { bas: 0.8, haut: 1.3, danger: 1.5 },
    page: {
      types: ["Entraînement", "Match", "Course", "Mobilité / renfo", "Autre"],
      dureeDefaut: 60, dureeMax: 300,
      programmees: [
        { ref: "bloc-4-2-3", titre: "Muscu Séance 1", type: "Muscu", date: iso(lundi), duree: 72, rpe: 6.4 },
        { ref: "bloc-4-2-12", titre: "Course Séance 2", type: "Course (programme)", date: iso(lundi), duree: 60, rpe: "" }
      ],
      dernieres: [
        { date: "22/10", jour: "2026-10-22", type: "Match", duree: 70, rpe: 8, charge: 560, commentaire: "Victoire 31-27" },
        { date: "20/10", jour: "2026-10-20", type: "Entraînement", duree: 90, rpe: 6, charge: 540, commentaire: "" }
      ]
    }
  };
})();
