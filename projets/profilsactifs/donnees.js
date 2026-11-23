// ============================================================================
// donnees.js — ce que la démo affiche, séparé du calcul (core.js) et de
// l'affichage (demo.js). Trois sortes de contenu, et ils ne se mélangent pas :
//
//   1. COMPTES_TEST et LES_VINGT_QUESTIONS : repris TELS QUELS du dépôt
//      source (G-SVR-500-COT-5-1-survivor-29) — README section 7 pour les
//      comptes, certification/questions.v1.json pour les questions (les 20
//      marquées "actifParDefaut": true, dans leur ordre et avec leurs vrais
//      points par option).
//
//   2. PROFILS_REELS : les 5 candidats du seed (backend/prisma/seed.js) —
//      déjà des comptes de test fictifs dans le dépôt, pas de vraies
//      personnes. Les badges affichés sont ceux du seed ; aucun score
//      précis n'est inventé pour eux (le seed n'en donne pas).
//
//   3. PROFILS_INVENTES : pour peupler une recherche avec plus de cinq
//      résultats, j'ai inventé des profils supplémentaires — noms, villes et
//      compétences fictifs, aucun rapport avec une personne réelle. Ils sont
//      marqués `invente: true` et la page le dit.
// ============================================================================

// --- Le nom du produit, comme frontend/js/config.js ------------------------
const NOM_PRODUIT = "Compétences+";
const ANCIEN_NOM = "ProfilsActifs";
const DATE_RENOMMAGE = "9 septembre 2026";

// --- Les comptes de test, README section 7 ----------------------------------
// Mot de passe commun à tous : motdepasse123 (affiché pour information ; la
// démo n'a pas de vraie authentification, il n'y a pas de serveur derrière).
const COMPTES_TEST = [
  { email: "aicha.diop@example.com", nom: "Aïcha Diop", role: "CANDIDAT", idProfil: "p-aicha" },
  { email: "sarah.b@example.com", nom: "Sarah B.", role: "CANDIDAT", idProfil: "p-sarah" },
  { email: "moussa.toure@example.com", nom: "Moussa Touré", role: "CANDIDAT", idProfil: "p-moussa" },
  { email: "fatou.sy@example.com", nom: "Fatou Sy", role: "CANDIDAT", idProfil: "p-fatou" },
  { email: "jean.k@example.com", nom: "Jean K.", role: "CANDIDAT", idProfil: "p-jean" },
  { email: "recruteur@example.com", nom: "Compte recruteur de test", role: "RECRUTEUR" },
  { email: "admin@example.com", nom: "Compte admin de test", role: "ADMIN" },
];
const MOT_DE_PASSE_TEST = "motdepasse123";

// --- Les 20 questions actives, reprises de certification/questions.v1.json -
// (fichier versionné du dépôt — voir §6 du README). Chaque option porte son
// vrai nombre de points (0, 1 ou 2) ; calculerScore() dans core.js fait le
// même calcul que le serveur réel.
const LES_VINGT_QUESTIONS = [
  {"id":"q001","enonce":"Face à un imprévu concernant la gestion du temps avec des ressources limitées, comment réagissez-vous ?","options":[{"id":"a","texte":"Je cherche un compromis constructif et gagnant-gagnant","points":2},{"id":"b","texte":"J'envoie un email pour me couvrir","points":1},{"id":"c","texte":"Je signale simplement le problème sans proposer aucune solution","points":0}]},
  {"id":"q003","enonce":"En cas de désaccord technique concernant la gestion du temps à la veille d'une échéance, comment réagissez-vous ?","options":[{"id":"a","texte":"Je critique l'organisation actuelle","points":0},{"id":"b","texte":"Je demande conseil à mon manager avant de faire quoi que ce soit","points":1},{"id":"c","texte":"J'adapte mes priorités et communique de façon transparente","points":2}]},
  {"id":"q011","enonce":"Face à un imprévu concernant le travail en équipe avec des ressources limitées, comment réagissez-vous ?","options":[{"id":"a","texte":"Je montre mon agacement ouvertement","points":0},{"id":"b","texte":"Je mets le problème en pause en attendant plus d'informations","points":1},{"id":"c","texte":"Je prends l'initiative de documenter le problème et la solution","points":2}]},
  {"id":"q013","enonce":"En cas de désaccord technique concernant le travail en équipe à la veille d'une échéance, comment réagissez-vous ?","options":[{"id":"a","texte":"Je me concentre uniquement sur mes propres tâches","points":1},{"id":"b","texte":"J'identifie l'origine du problème pour éviter qu'il ne se reproduise","points":2},{"id":"c","texte":"J'attends des instructions détaillées sans bouger","points":0}]},
  {"id":"q021","enonce":"Face à un imprévu concernant la communication interne avec des ressources limitées, comment réagissez-vous ?","options":[{"id":"a","texte":"Je fais de mon mieux avec les moyens du bord","points":1},{"id":"b","texte":"J'ignore le problème en espérant qu'il se résolve seul","points":0},{"id":"c","texte":"Je prends du recul et propose une solution structurée","points":2}]},
  {"id":"q023","enonce":"En cas de désaccord technique concernant la communication interne à la veille d'une échéance, comment réagissez-vous ?","options":[{"id":"a","texte":"Je sollicite l'avis d'experts tout en proposant mes propres hypothèses","points":2},{"id":"b","texte":"J'applique les procédures standards sans chercher plus loin","points":1},{"id":"c","texte":"Je délègue immédiatement la responsabilité à quelqu'un d'autre","points":0}]},
  {"id":"q031","enonce":"Face à un imprévu concernant la résolution de problèmes complexes avec des ressources limitées, comment réagissez-vous ?","options":[{"id":"a","texte":"Je critique l'organisation actuelle","points":0},{"id":"b","texte":"Je demande conseil à mon manager avant de faire quoi que ce soit","points":1},{"id":"c","texte":"J'adapte mes priorités et communique de façon transparente","points":2}]},
  {"id":"q033","enonce":"En cas de désaccord technique concernant la résolution de problèmes complexes à la veille d'une échéance, comment réagissez-vous ?","options":[{"id":"a","texte":"J'organise un point rapide pour réaligner l'équipe","points":2},{"id":"b","texte":"J'attends que la situation se calme pour intervenir","points":1},{"id":"c","texte":"Je continue mon travail comme si de rien n'était","points":0}]},
  {"id":"q041","enonce":"Face à un imprévu concernant la gestion du stress avec des ressources limitées, comment réagissez-vous ?","options":[{"id":"a","texte":"J'identifie l'origine du problème pour éviter qu'il ne se reproduise","points":2},{"id":"b","texte":"Je me concentre uniquement sur mes propres tâches","points":1},{"id":"c","texte":"J'attends des instructions détaillées sans bouger","points":0}]},
  {"id":"q043","enonce":"En cas de désaccord technique concernant la gestion du stress à la veille d'une échéance, comment réagissez-vous ?","options":[{"id":"a","texte":"Je signale simplement le problème sans proposer aucune solution","points":0},{"id":"b","texte":"Je cherche un compromis constructif et gagnant-gagnant","points":2},{"id":"c","texte":"J'envoie un email pour me couvrir","points":1}]},
  {"id":"q051","enonce":"Face à un imprévu concernant l'adaptation au changement avec des ressources limitées, comment réagissez-vous ?","options":[{"id":"a","texte":"Je sollicite l'avis d'experts tout en proposant mes propres hypothèses","points":2},{"id":"b","texte":"J'applique les procédures standards sans chercher plus loin","points":1},{"id":"c","texte":"Je délègue immédiatement la responsabilité à quelqu'un d'autre","points":0}]},
  {"id":"q053","enonce":"En cas de désaccord technique concernant l'adaptation au changement à la veille d'une échéance, comment réagissez-vous ?","options":[{"id":"a","texte":"Je montre mon agacement ouvertement","points":0},{"id":"b","texte":"Je prends l'initiative de documenter le problème et la solution","points":2},{"id":"c","texte":"Je mets le problème en pause en attendant plus d'informations","points":1}]},
  {"id":"q061","enonce":"Face à un imprévu concernant la prise d'initiative avec des ressources limitées, comment réagissez-vous ?","options":[{"id":"a","texte":"J'organise un point rapide pour réaligner l'équipe","points":2},{"id":"b","texte":"J'attends que la situation se calme pour intervenir","points":1},{"id":"c","texte":"Je continue mon travail comme si de rien n'était","points":0}]},
  {"id":"q063","enonce":"En cas de désaccord technique concernant la prise d'initiative à la veille d'une échéance, comment réagissez-vous ?","options":[{"id":"a","texte":"J'ignore le problème en espérant qu'il se résolve seul","points":0},{"id":"b","texte":"Je fais de mon mieux avec les moyens du bord","points":1},{"id":"c","texte":"Je prends du recul et propose une solution structurée","points":2}]},
  {"id":"q071","enonce":"Face à un imprévu concernant le leadership bienveillant avec des ressources limitées, comment réagissez-vous ?","options":[{"id":"a","texte":"Je signale simplement le problème sans proposer aucune solution","points":0},{"id":"b","texte":"J'envoie un email pour me couvrir","points":1},{"id":"c","texte":"Je cherche un compromis constructif et gagnant-gagnant","points":2}]},
  {"id":"q073","enonce":"En cas de désaccord technique concernant le leadership bienveillant à la veille d'une échéance, comment réagissez-vous ?","options":[{"id":"a","texte":"J'adapte mes priorités et communique de façon transparente","points":2},{"id":"b","texte":"Je demande conseil à mon manager avant de faire quoi que ce soit","points":1},{"id":"c","texte":"Je critique l'organisation actuelle","points":0}]},
  {"id":"q081","enonce":"Face à un imprévu concernant la relation client avec des ressources limitées, comment réagissez-vous ?","options":[{"id":"a","texte":"Je montre mon agacement ouvertement","points":0},{"id":"b","texte":"Je mets le problème en pause en attendant plus d'informations","points":1},{"id":"c","texte":"Je prends l'initiative de documenter le problème et la solution","points":2}]},
  {"id":"q083","enonce":"En cas de désaccord technique concernant la relation client à la veille d'une échéance, comment réagissez-vous ?","options":[{"id":"a","texte":"J'identifie l'origine du problème pour éviter qu'il ne se reproduise","points":2},{"id":"b","texte":"Je me concentre uniquement sur mes propres tâches","points":1},{"id":"c","texte":"J'attends des instructions détaillées sans bouger","points":0}]},
  {"id":"q091","enonce":"Face à un imprévu concernant l'organisation du travail quotidien avec des ressources limitées, comment réagissez-vous ?","options":[{"id":"a","texte":"J'ignore le problème en espérant qu'il se résolve seul","points":0},{"id":"b","texte":"Je fais de mon mieux avec les moyens du bord","points":1},{"id":"c","texte":"Je prends du recul et propose une solution structurée","points":2}]},
  {"id":"q093","enonce":"En cas de désaccord technique concernant l'organisation du travail quotidien à la veille d'une échéance, comment réagissez-vous ?","options":[{"id":"a","texte":"Je délègue immédiatement la responsabilité à quelqu'un d'autre","points":0},{"id":"b","texte":"J'applique les procédures standards sans chercher plus loin","points":1},{"id":"c","texte":"Je sollicite l'avis d'experts tout en proposant mes propres hypothèses","points":2}]},
];

// --- Les secteurs et villes proposés, comme frontend/html/recruteur.html ---
const SECTEURS_SUGGERES = ["Ressources humaines", "Communication", "Informatique", "Finance", "Commerce", "Santé", "Éducation", "Bâtiment"];
const VILLES_SUGGEREES = ["Cotonou", "Porto-Novo", "Abomey-Calavi", "Parakou", "Bohicon"];

function competencesEnTableau(texte) {
  return texte.split(",").map((c) => c.trim()).filter(Boolean);
}

// --- Les 5 candidats du seed (backend/prisma/seed.js) -----------------------
// Déjà des comptes de test fictifs du dépôt — pas des personnes réelles.
// Le badge est celui du seed ; aucun score précis n'est inventé pour eux.
const PROFILS_REELS = [
  {
    id: "p-aicha", nomAffiche: "Aïcha Diop", secteur: "RH", localisation: "Cotonou",
    competences: competencesEnTableau("Communication, Gestion de projet"),
    statutProfil: "VALIDE", retireDuCatalogue: false,
    badge: { libelle: "Or", rang: 3 }, score: null,
    video: { type: "LIEN", statut: "VALIDE", titre: "Présentation — Aïcha Diop" },
    reel: true, updatedAt: "2026-09-10",
  },
  {
    id: "p-moussa", nomAffiche: "Moussa Touré", secteur: "Informatique", localisation: "Porto-Novo",
    competences: competencesEnTableau("Développement web, JavaScript"),
    statutProfil: "VALIDE", retireDuCatalogue: false,
    badge: { libelle: "Argent", rang: 2 }, score: null,
    video: { type: "UPLOAD", statut: "VALIDE", titre: "Présentation — Moussa Touré" },
    reel: true, updatedAt: "2026-09-09",
  },
  {
    id: "p-fatou", nomAffiche: "Fatou Sy", secteur: "Finance", localisation: "Cotonou",
    competences: competencesEnTableau("Comptabilité, Excel"),
    statutProfil: "VALIDE", retireDuCatalogue: false,
    badge: { libelle: "Bronze", rang: 1 }, score: null,
    video: { type: "LIEN", statut: "VALIDE", titre: "Présentation — Fatou Sy" },
    reel: true, updatedAt: "2026-09-08",
  },
  {
    id: "p-jean", nomAffiche: "Jean K.", secteur: "IT", localisation: "Abomey-Calavi",
    competences: competencesEnTableau("Support technique, Réseaux"),
    statutProfil: "VALIDE", retireDuCatalogue: false,
    badge: null, score: null,
    video: { type: null, statut: "AUCUNE", titre: null },
    reel: true, updatedAt: "2026-09-03",
  },
  {
    id: "p-sarah", nomAffiche: "Sarah B.", secteur: "Communication", localisation: "Cotonou",
    competences: competencesEnTableau("Marketing digital, SEO"),
    statutProfil: "VALIDE", retireDuCatalogue: false,
    badge: { libelle: "Argent", rang: 2 }, score: null,
    video: { type: "UPLOAD", statut: "VALIDE", titre: "Présentation — Sarah B." },
    reel: true, updatedAt: "2026-09-07",
  },
];

// --- Profils inventés pour peupler la recherche -----------------------------
// Noms, villes et compétences fictifs, écrits pour cette démo — aucun lien
// avec une personne réelle. Deux cas servent la page Admin : un profil et une
// vidéo encore EN_ATTENTE de modération.
const PROFILS_INVENTES = [
  {
    id: "i-chimene", nomAffiche: "Chimène Agbodjan", secteur: "Commerce", localisation: "Parakou",
    competences: competencesEnTableau("Vente, Négociation"),
    statutProfil: "VALIDE", retireDuCatalogue: false,
    badge: { libelle: "Or", rang: 3 }, score: null,
    video: { type: "LIEN", statut: "VALIDE", titre: "Présentation — Chimène Agbodjan" },
    reel: false, updatedAt: "2026-09-06",
  },
  {
    id: "i-idrissa", nomAffiche: "Idrissa Boukari", secteur: "Santé", localisation: "Bohicon",
    competences: competencesEnTableau("Soins infirmiers, Premiers secours"),
    statutProfil: "VALIDE", retireDuCatalogue: false,
    badge: { libelle: "Argent", rang: 2 }, score: null,
    video: { type: "UPLOAD", statut: "VALIDE", titre: "Présentation — Idrissa Boukari" },
    reel: false, updatedAt: "2026-09-05",
  },
  {
    id: "i-nadege", nomAffiche: "Nadège Houenou", secteur: "Éducation", localisation: "Cotonou",
    competences: competencesEnTableau("Pédagogie, Prise de parole"),
    statutProfil: "VALIDE", retireDuCatalogue: false,
    badge: { libelle: "Bronze", rang: 1 }, score: null,
    video: { type: "LIEN", statut: "VALIDE", titre: "Présentation — Nadège Houenou" },
    reel: false, updatedAt: "2026-09-04",
  },
  {
    id: "i-romuald", nomAffiche: "Romuald Dossou", secteur: "Bâtiment", localisation: "Porto-Novo",
    competences: competencesEnTableau("Génie civil, AutoCAD"),
    // EN_ATTENTE : invisible côté recruteur, visible côté admin — comme le
    // vrai produit (voir docs/admin-moderation.html du dépôt).
    statutProfil: "EN_ATTENTE", retireDuCatalogue: false,
    badge: null, score: null,
    video: { type: null, statut: "AUCUNE", titre: null },
    reel: false, updatedAt: "2026-09-11",
  },
  {
    id: "i-carine", nomAffiche: "Carine Zinsou", secteur: "Informatique", localisation: "Abomey-Calavi",
    competences: competencesEnTableau("Réseaux, Cybersécurité"),
    statutProfil: "VALIDE", retireDuCatalogue: false,
    badge: { libelle: "Argent", rang: 2 }, score: null,
    // Profil publié, mais la vidéo déposée n'est pas encore passée en
    // modération : elle ne se voit nulle part pour l'instant (même règle que
    // le vrai produit).
    video: { type: "UPLOAD", statut: "EN_ATTENTE", titre: "Présentation — Carine Zinsou" },
    reel: false, updatedAt: "2026-09-11",
  },
  {
    id: "i-edem", nomAffiche: "Edem Koukpemedji", secteur: "Finance", localisation: "Cotonou",
    competences: competencesEnTableau("Audit, Contrôle de gestion"),
    statutProfil: "VALIDE", retireDuCatalogue: false,
    badge: { libelle: "Or", rang: 3 }, score: null,
    video: { type: "LIEN", statut: "VALIDE", titre: "Présentation — Edem Koukpemedji" },
    reel: false, updatedAt: "2026-09-02",
  },
  {
    id: "i-fifame", nomAffiche: "Fifamè Adjahoui", secteur: "Commerce", localisation: "Bohicon",
    competences: competencesEnTableau("Relation client, Export"),
    statutProfil: "VALIDE", retireDuCatalogue: false,
    badge: null, score: null,
    video: { type: "LIEN", statut: "VALIDE", titre: "Présentation — Fifamè Adjahoui" },
    reel: false, updatedAt: "2026-09-01",
  },
];

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    NOM_PRODUIT, ANCIEN_NOM, DATE_RENOMMAGE, COMPTES_TEST, MOT_DE_PASSE_TEST,
    LES_VINGT_QUESTIONS, SECTEURS_SUGGERES, VILLES_SUGGEREES, PROFILS_REELS, PROFILS_INVENTES,
  };
}
if (typeof window !== "undefined") {
  window.DonneesProfilsActifs = {
    NOM_PRODUIT, ANCIEN_NOM, DATE_RENOMMAGE, COMPTES_TEST, MOT_DE_PASSE_TEST,
    LES_VINGT_QUESTIONS, SECTEURS_SUGGERES, VILLES_SUGGEREES,
    PROFILS_REELS, PROFILS_INVENTES,
  };
}
