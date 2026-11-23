// ============================================================================
// core.js — le calcul, sans rien qui touche à l'écran.
//
// Reproduit trois règles du vrai backend (Node/Express/Prisma), lues dans
// backend/src/modules/questionnaire/questionnaire.service.js et
// backend/src/modules/profil/profil.service.js du dépôt source :
//
//   1. Le score du questionnaire : somme des points obtenus sur somme des
//      points maximum possibles, ramenée sur 100, arrondie.
//   2. Le badge : le premier barème (Bronze/Argent/Or) dont le score tombe
//      dans l'intervalle [seuilMin, seuilMax].
//   3. Le filtre recruteur : secteur / localisation / compétence en
//      "contient" (comme le `contains` Prisma du vrai serveur), le badge en
//      présence/absence, la recherche libre sur plusieurs champs à la fois
//      (comme frontend/js/recruteur.js), insensible aux accents et à la casse.
//
// Fonctions pures, testées avec node (voir scratchpad/profilsactifs/test-core.js).
// Pas d'accès au DOM ici : demo.js s'en charge.
// ============================================================================

// --- Les barèmes de badge, repris de backend/prisma/seed.js ----------------
// (Certifié JEB - Bronze/Argent/Or, mêmes seuils que les comptes de test.)
const BAREMES_BADGE = [
  { libelle: "Bronze", rang: 1, seuilMin: 0, seuilMax: 49 },
  { libelle: "Argent", rang: 2, seuilMin: 50, seuilMax: 79 },
  { libelle: "Or", rang: 3, seuilMin: 80, seuilMax: 100 },
];

// --- Le score, question par question -----------------------------------
// questions : [{ id, options: [{ id, points }], poids }]
// reponses  : { [idQuestion]: idOption }
//
// Même calcul que questionnaire.service.js#soumettre : pour chaque question,
// le maximum possible est le plus haut nombre de points de ses options,
// multiplié par son poids ; le score est le rapport obtenu/maximum, sur 100.
//
// Lève une erreur si une question active n'a pas de réponse — comme le vrai
// serveur, qui refuse de soumettre un questionnaire incomplet.
function calculerScore(questions, reponses) {
  let pointsObtenus = 0;
  let pointsMaxPossibles = 0;

  for (const question of questions) {
    const poids = question.poids || 1;
    const pointsMaxQuestion = Math.max(...question.options.map((o) => o.points));
    pointsMaxPossibles += pointsMaxQuestion * poids;

    const idOptionChoisie = reponses[question.id];
    if (idOptionChoisie === undefined) {
      throw new Error(`Question ${question.id} sans réponse.`);
    }
    const optionChoisie = question.options.find((o) => o.id === idOptionChoisie);
    const pointsQuestion = optionChoisie ? optionChoisie.points : 0;
    pointsObtenus += pointsQuestion * poids;
  }

  const score = pointsMaxPossibles > 0
    ? Math.round((pointsObtenus / pointsMaxPossibles) * 100)
    : 0;

  return { score, pointsObtenus, pointsMaxPossibles };
}

// --- Le badge pour un score ----------------------------------------------
// Renvoie null seulement si aucun barème ne couvre le score (ne devrait pas
// arriver avec les trois barèmes ci-dessus, qui couvrent 0 à 100 en entier —
// comme dans le vrai produit, finir le questionnaire donne toujours au moins
// le Bronze ; « sans badge » veut dire « questionnaire pas encore passé »).
function badgePourScore(score, baremes = BAREMES_BADGE) {
  return baremes.find((b) => score >= b.seuilMin && score <= b.seuilMax) || null;
}

// --- Normaliser un texte pour une comparaison insensible --------------------
// Identique à normaliser() dans frontend/js/recruteur.js : enlève la casse
// et les accents, pour que « developpement » trouve « Développement ».
function normaliser(texte) {
  return (texte || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

// --- Le filtre recruteur, côté "serveur" -----------------------------------
// Reproduit listerProfils() de backend/src/modules/profil/profil.service.js :
// un profil n'est renvoyé que s'il est VALIDE et pas retiré du catalogue
// (article 21 RGPD), puis secteur/localisation/competence en "contient"
// (insensible à la casse, comme le `contains` Prisma sur la collation
// utf8mb4_unicode_ci de la base), avecBadge en présence du badge.
function filtrerCatalogue(profils, filtres = {}) {
  const { secteur, localisation, competence, avecBadge } = filtres;

  return profils.filter((p) => {
    if (p.statutProfil !== "VALIDE" || p.retireDuCatalogue) return false;
    if (secteur && !normaliser(p.secteur).includes(normaliser(secteur))) return false;
    if (localisation && !normaliser(p.localisation).includes(normaliser(localisation))) return false;
    if (competence && !normaliser((p.competences || []).join(",")).includes(normaliser(competence))) return false;
    if (avecBadge && !p.badge) return false;
    return true;
  });
}

// --- La recherche libre, côté page (pas le serveur) -------------------------
// Reproduit filtrerSurPage() de frontend/js/recruteur.js : tous les mots
// doivent se retrouver dans le même "foin" (nom, secteur, ville, compétences,
// libellé du badge). C'est une limite réelle du vrai produit — la recherche
// libre ne porte que sur la page déjà reçue, pas sur toute la base — que
// l'écran affiche plutôt que de la cacher.
function rechercheLibre(profils, texte) {
  const mots = normaliser(texte).split(/\s+/).filter(Boolean);
  if (mots.length === 0) return profils;

  return profils.filter((p) => {
    const foin = normaliser([
      p.nomAffiche, p.secteur, p.localisation,
      ...(p.competences || []),
      p.badge && p.badge.libelle,
    ].filter(Boolean).join(" "));
    return mots.every((m) => foin.includes(m));
  });
}

// --- La pagination, 20 par page comme le vrai catalogue --------------------
function paginer(liste, page, taille) {
  const total = liste.length;
  const totalPages = Math.max(1, Math.ceil(total / taille));
  const pageCorrigee = Math.min(Math.max(1, page), totalPages);
  const depart = (pageCorrigee - 1) * taille;
  return {
    items: liste.slice(depart, depart + taille),
    page: pageCorrigee,
    totalPages,
    total,
  };
}

// --- Les six chiffres du tableau de bord admin ------------------------------
// Mêmes libellés que frontend/html/admin-tableau-de-bord.html.
function calculerStatistiques(profils, interactionsTotal, recruteursActifs) {
  const valides = profils.filter((p) => p.statutProfil === "VALIDE");
  const certifies = valides.filter((p) => p.badge);
  const tauxCertification = valides.length > 0
    ? Math.round((certifies.length / valides.length) * 100)
    : 0;
  const videosEnAttente = profils.reduce(
    (n, p) => n + (p.video && p.video.statut === "EN_ATTENTE" ? 1 : 0), 0,
  );
  const profilsEnAttente = profils.filter((p) => p.statutProfil === "EN_ATTENTE").length;

  return {
    profilsActifs: valides.length,
    tauxCertification,
    interactions: interactionsTotal,
    videosEnAttente,
    profilsEnAttente,
    recruteursActifs,
  };
}

// --- Exposer les fonctions, au navigateur comme à node ----------------------
const CoreProfilsActifs = {
  BAREMES_BADGE,
  calculerScore,
  badgePourScore,
  normaliser,
  filtrerCatalogue,
  rechercheLibre,
  paginer,
  calculerStatistiques,
};

if (typeof module !== "undefined" && module.exports) {
  module.exports = CoreProfilsActifs;
}
if (typeof window !== "undefined") {
  window.CoreProfilsActifs = CoreProfilsActifs;
}
