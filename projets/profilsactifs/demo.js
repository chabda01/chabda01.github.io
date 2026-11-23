// ============================================================================
// demo.js — l'écran. Tout le calcul vit dans core.js, toutes les données
// de départ dans donnees.js ; ce fichier ne fait que les relier au DOM.
//
// Trois espaces, un seul visible à la fois (comme les trois rails du vrai
// site) : #pa-vue-candidat, #pa-vue-recruteur, #pa-vue-admin.
//
// L'état tient en mémoire, dans `etat` plus bas — il n'y a pas de serveur
// pour le garder. Recharger la page ou cliquer sur « Réinitialiser la démo »
// revient au point de départ.
// ============================================================================

(function () {
  "use strict";

  const Core = window.CoreProfilsActifs;
  const D = window.DonneesProfilsActifs;

  const qs = (id) => document.getElementById(id);
  const TAILLE_PAGE = 20; // comme TAILLE_PAGE dans frontend/js/config.js

  // --- Échapper un texte avant de l'insérer en HTML --------------------------
  function echapper(texte) {
    const d = document.createElement("div");
    d.textContent = texte == null ? "" : String(texte);
    return d.innerHTML;
  }

  // --- « Aïcha Diop » → « AD », comme initiales() dans recruteur.js ----------
  function initiales(nom) {
    return (nom || "?").split(/[\s.-]+/).filter(Boolean).slice(0, 2)
      .map((m) => m[0]).join("").toUpperCase();
  }

  function classeRang(rang) {
    return { 3: "or", 2: "argent", 1: "bronze" }[rang] || "argent";
  }

  function formaterDate(iso) {
    return new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
  }

  // ============================================================ L'ÉTAT ======
  function donneesInitiales() {
    return JSON.parse(JSON.stringify([...D.PROFILS_REELS, ...D.PROFILS_INVENTES]));
  }

  const etat = {
    role: "candidat",
    profils: donneesInitiales(),
    candidatActifId: "p-jean", // Jean K. n'a pas encore de badge : bon point de départ pour le questionnaire.
    notifications: {},         // { idProfil: [texte, ...] }
    recruteurFiltres: {},
    recruteurRecherche: "",
    recruteurPage: 1,
    quiz: null,                // { rang, reponses } pendant une passation
    ficheOuverteId: null,
  };

  function profil(id) {
    return etat.profils.find((p) => p.id === id);
  }

  function notifier(idProfil, texte) {
    if (!etat.notifications[idProfil]) etat.notifications[idProfil] = [];
    etat.notifications[idProfil].unshift(texte);
  }

  // ======================================================= LES ONGLETS ======
  const onglets = {
    candidat: { bouton: "pa-role-candidat", vue: "pa-vue-candidat" },
    recruteur: { bouton: "pa-role-recruteur", vue: "pa-vue-recruteur" },
    admin: { bouton: "pa-role-admin", vue: "pa-vue-admin" },
  };

  function activerRole(role) {
    etat.role = role;
    for (const [nom, o] of Object.entries(onglets)) {
      const actif = nom === role;
      qs(o.bouton).classList.toggle("is-on", actif);
      qs(o.bouton).setAttribute("aria-selected", String(actif));
      qs(o.vue).hidden = !actif;
    }
    majStatut();
    if (role === "candidat") renderCandidat();
    if (role === "recruteur") renderRecruteur();
    if (role === "admin") renderAdmin();
  }

  function majStatut() {
    const span = qs("pa-status");
    if (etat.role === "candidat") {
      const p = profil(etat.candidatActifId);
      span.textContent = p ? `Connecté comme ${p.nomAffiche} (candidat)` : "—";
    } else if (etat.role === "recruteur") {
      span.textContent = "Connecté comme recruteur@example.com (recruteur)";
    } else {
      span.textContent = "Connecté comme admin@example.com (admin)";
    }
  }

  // ===================================================== ESPACE CANDIDAT ====

  function renderCandidatSelect() {
    const select = qs("pa-candidat-select");
    const comptesCandidats = D.COMPTES_TEST.filter((c) => c.role === "CANDIDAT");
    select.innerHTML = comptesCandidats.map((c) => {
      const p = profil(c.idProfil);
      const grade = p && p.badge ? ` — badge ${p.badge.libelle}` : " — sans badge";
      return `<option value="${c.idProfil}">${echapper(c.nom)} (${echapper(c.email)})${grade}</option>`;
    }).join("");
    select.value = etat.candidatActifId;
    select.addEventListener("change", () => {
      etat.candidatActifId = select.value;
      qs("pa-quiz").hidden = true;
      etat.quiz = null;
      renderCandidat();
    });
  }

  function badgeGrandHtml(p) {
    if (p.badge) {
      const classe = p.badge.libelle.toLowerCase();
      const carres = "<i></i>".repeat(p.badge.rang);
      return `
        <span class="pa-badge-grand ${classe}">
          Badge de certification JEB
          <span class="pa-rang" aria-hidden="true">${carres}</span>
          <span>${echapper(p.badge.libelle)}</span>
        </span>`;
    }
    return `<span class="pa-badge-grand absent">Sans badge de certification — questionnaire pas encore passé</span>`;
  }

  function videoZoneHtml(p, { boutonDepot } = {}) {
    const v = p.video;
    if (!v || v.statut === "AUCUNE") {
      if (boutonDepot) {
        return `<button type="button" class="pa-video pa-video--depot" id="pa-deposer-video">
                  <span class="pa-video__icone" aria-hidden="true">＋</span>
                  Déposer une vidéo de présentation<br><span style="opacity:.7">(zone factice — aucun vrai fichier)</span>
                </button>`;
      }
      return `<div class="pa-video is-vide">Aucune vidéo pour ce profil.</div>`;
    }
    if (v.statut === "EN_ATTENTE") {
      return `<div class="pa-video is-vide">Vidéo déposée (factice), <strong>en attente de modération</strong>.<br>Pas encore visible des recruteurs.</div>`;
    }
    if (v.statut === "REJETE") {
      return `<div class="pa-video is-vide">Vidéo refusée en modération. ${v.motifRefus ? `Motif : ${echapper(v.motifRefus)}.` : ""}</div>`;
    }
    // VALIDE : zone factice cliquable, qui simule une lecture.
    // Pas d'id ici : cette portion de HTML peut exister à deux endroits en
    // même temps (le profil candidat ET la fiche recruteur ouverte dans la
    // boîte de dialogue) — chaque appelant retrouve son bouton par la classe
    // pa-video--jouer, distincte de pa-video--depot pour ne jamais confondre
    // les deux boutons.
    return `<button type="button" class="pa-video pa-video--jouer" aria-pressed="false">
               <span class="pa-video__icone" aria-hidden="true">▶</span>
               ${echapper(v.titre)}<br><span style="opacity:.7">zone factice — cliquer simule la lecture</span>
             </button>`;
  }

  function notifsHtml(idProfil) {
    const liste = etat.notifications[idProfil] || [];
    if (liste.length === 0) return `<p class="vide" style="font-size:.8rem; color:var(--stage-ink-3)">Aucune notification pour l'instant.</p>`;
    return `<ul class="pa-notifs">${liste.map((t) => `<li>${echapper(t)}</li>`).join("")}</ul>`;
  }

  function renderCandidat() {
    if (etat.quiz) return; // le questionnaire est en cours : on ne redessine pas le profil dessous.
    const p = profil(etat.candidatActifId);
    const zone = qs("pa-profil-carte");
    if (!p) { zone.innerHTML = ""; return; }

    const peutPasser = true; // la démo autorise à (re)passer, pour pouvoir essayer plusieurs scores.
    const libelleBouton = p.badge ? "Repasser le questionnaire (confort de démo)" : "Passer le questionnaire de certification";

    zone.innerHTML = `
      <div class="pa-profil__tete">
        <span class="pa-avatar" aria-hidden="true">${echapper(initiales(p.nomAffiche))}</span>
        <div>
          <h3 class="pa-nom">${echapper(p.nomAffiche)}</h3>
          <p class="pa-lieu">${echapper(p.localisation)} · ${echapper(p.secteur)}</p>
        </div>
      </div>

      ${badgeGrandHtml(p)}
      ${peutPasser ? `<button class="btn btn--ghost" type="button" id="pa-lancer-quiz">${libelleBouton}</button>` : ""}

      <div>${videoZoneHtml(p, { boutonDepot: true })}</div>

      <ul class="pa-competences">${p.competences.map((c) => `<li>${echapper(c)}</li>`).join("")}</ul>

      <div>
        <p class="pa-notifs-titre">Vos notifications (vues, favoris et contacts reçus d'un recruteur)</p>
        ${notifsHtml(p.id)}
      </div>
    `;

    const boutonQuiz = qs("pa-lancer-quiz");
    if (boutonQuiz) boutonQuiz.addEventListener("click", () => demarrerQuiz(p.id));

    const boutonDepot = qs("pa-deposer-video");
    if (boutonDepot) boutonDepot.addEventListener("click", () => {
      p.video = { type: "UPLOAD", statut: "EN_ATTENTE", titre: `Présentation — ${p.nomAffiche}` };
      renderCandidat();
    });

    const boutonJouer = zone.querySelector(".pa-video--jouer");
    if (boutonJouer) boutonJouer.addEventListener("click", () => {
      const enLecture = boutonJouer.classList.toggle("is-playing");
      boutonJouer.setAttribute("aria-pressed", String(enLecture));
      boutonJouer.querySelector(".pa-video__icone").textContent = enLecture ? "❙❙" : "▶";
    });
  }

  // --- Le questionnaire, les 20 vraies questions ------------------------------
  function demarrerQuiz(idProfil) {
    etat.quiz = { idProfil, rang: 0, reponses: {} };
    qs("pa-profil-carte").style.display = "none";
    const zone = qs("pa-quiz");
    zone.hidden = false;
    afficherQuestionQuiz();
  }

  function afficherQuestionQuiz() {
    const { rang, reponses } = etat.quiz;
    const questions = D.LES_VINGT_QUESTIONS;
    const q = questions[rang];
    const avancee = Math.round((Object.keys(reponses).length / questions.length) * 100);
    const complet = Object.keys(reponses).length === questions.length;

    qs("pa-quiz").innerHTML = `
      <p class="pa-quiz__meta"><span>Question ${rang + 1} / ${questions.length}</span><span id="pa-quiz-enregistre" style="opacity:0; transition:opacity .3s">Réponse enregistrée</span></p>
      <div class="pa-quiz__barre"><i style="width:${avancee}%"></i></div>
      <p>${echapper(q.enonce)}</p>
      <ul class="pa-quiz__options">
        ${q.options.map((o) => `
          <li>
            <label>
              <input type="radio" name="pa-reponse" value="${o.id}" ${reponses[q.id] === o.id ? "checked" : ""}>
              <span><span class="pa-quiz__lettre">${o.id.toUpperCase()}.</span> ${echapper(o.texte)}</span>
            </label>
          </li>`).join("")}
      </ul>
      <div class="pa-quiz__nav">
        <button class="btn btn--ghost" type="button" id="pa-quiz-prec" ${rang === 0 ? "disabled" : ""}>Précédent</button>
        <button class="btn btn--ghost" type="button" id="pa-quiz-suiv" ${rang >= questions.length - 1 ? "disabled" : ""}>Suivant</button>
        <button class="btn" type="button" id="pa-quiz-terminer" ${complet ? "" : "disabled"}>Terminer et voir mon score</button>
        <button class="btn btn--ghost" type="button" id="pa-quiz-annuler">Annuler</button>
      </div>
    `;

    qs("pa-quiz").querySelectorAll('input[name="pa-reponse"]').forEach((input) => {
      input.addEventListener("change", () => {
        reponses[q.id] = input.value;
        const avis = qs("pa-quiz-enregistre");
        if (avis) { avis.style.opacity = "1"; setTimeout(() => { if (avis) avis.style.opacity = "0"; }, 1200); }
        afficherQuestionQuiz();
      });
    });
    qs("pa-quiz-prec").addEventListener("click", () => { etat.quiz.rang = Math.max(0, rang - 1); afficherQuestionQuiz(); });
    qs("pa-quiz-suiv").addEventListener("click", () => { etat.quiz.rang = Math.min(questions.length - 1, rang + 1); afficherQuestionQuiz(); });
    qs("pa-quiz-terminer").addEventListener("click", terminerQuiz);
    qs("pa-quiz-annuler").addEventListener("click", annulerQuiz);
  }

  function annulerQuiz() {
    etat.quiz = null;
    qs("pa-quiz").hidden = true;
    qs("pa-profil-carte").style.display = "";
    renderCandidat();
  }

  function terminerQuiz() {
    const { idProfil, reponses } = etat.quiz;
    const { score } = Core.calculerScore(D.LES_VINGT_QUESTIONS, reponses);
    const badge = Core.badgePourScore(score);

    const p = profil(idProfil);
    p.badge = badge ? { libelle: badge.libelle, rang: badge.rang } : null;
    p.score = score;

    const carres = badge ? "<i></i>".repeat(badge.rang) : "";
    qs("pa-quiz").innerHTML = `
      <div class="pa-quiz__resultat">
        <p>Questionnaire terminé.</p>
        <p class="pa-quiz__score">${score}<span> / 100</span></p>
        <span class="pa-badge-grand ${badge ? badge.libelle.toLowerCase() : "absent"}">
          Badge de certification JEB
          <span class="pa-rang" aria-hidden="true">${carres}</span>
          <span>${badge ? echapper(badge.libelle) : "non obtenu"}</span>
        </span>
        <p style="font-size:.8rem; color:var(--stage-ink-3)">Comme dans le vrai produit, finir le questionnaire donne toujours au moins le Bronze (les trois barèmes couvrent tout 0–100) : « sans badge » ne veut dire que « pas encore passé ».</p>
        <button class="btn" type="button" id="pa-quiz-retour">Retour au profil</button>
      </div>
    `;
    qs("pa-quiz-retour").addEventListener("click", () => {
      etat.quiz = null;
      qs("pa-quiz").hidden = true;
      qs("pa-profil-carte").style.display = "";
      renderCandidatSelect();
      renderCandidat();
    });
  }

  // ==================================================== ESPACE RECRUTEUR =====

  function renderListesSuggestions() {
    qs("pa-secteurs").innerHTML = D.SECTEURS_SUGGERES.map((s) => `<option value="${echapper(s)}">`).join("");
    qs("pa-villes").innerHTML = D.VILLES_SUGGEREES.map((v) => `<option value="${echapper(v)}">`).join("");
  }

  function lireFiltresRecruteur() {
    return {
      secteur: qs("pa-f-secteur").value.trim(),
      localisation: qs("pa-f-ville").value.trim(),
      competence: qs("pa-f-competence").value.trim(),
      avecBadge: qs("pa-f-badge").checked,
    };
  }

  function dessinerJetons(filtres, recherche) {
    const jetons = [];
    if (filtres.secteur) jetons.push(["secteur", "Secteur", filtres.secteur]);
    if (filtres.localisation) jetons.push(["localisation", "Ville", filtres.localisation]);
    if (filtres.competence) jetons.push(["competence", "Compétence", filtres.competence]);
    if (recherche) jetons.push(["q", "Recherche", recherche]);
    if (filtres.avecBadge) jetons.push(["avecBadge", "Badge", "obtenu"]);

    qs("pa-jetons").innerHTML = jetons.map(([cle, nom, valeur]) => `
      <li class="pa-jeton">
        <span><b>${nom}</b> : ${echapper(valeur)}</span>
        <button type="button" data-retirer="${cle}" aria-label="Retirer le filtre ${nom}">&times;</button>
      </li>`).join("");
  }

  function carteHtml(p) {
    const estVisible = p.video && p.video.statut === "VALIDE";
    const videoHtml = estVisible
      ? `<button type="button" class="pa-carte__video" data-jouer="${p.id}" aria-label="Lire la vidéo de ${echapper(p.nomAffiche)}">▶ Lire la vidéo</button>`
      : `<div class="pa-carte__video is-vide">${echapper(initiales(p.nomAffiche))}</div>`;

    const pill = p.badge
      ? `<span class="pa-pill ${p.badge.libelle.toLowerCase()}">${"●".repeat(p.badge.rang)} Badge ${echapper(p.badge.libelle)}</span>`
      : `<span class="pa-pill absent">Sans badge</span>`;

    return `
      <li class="pa-carte">
        ${videoHtml}
        <h3 class="pa-carte__nom">${echapper(p.nomAffiche)}</h3>
        <p class="pa-carte__lieu">${echapper(p.localisation)} · ${echapper(p.secteur)}</p>
        ${pill}
        <button type="button" class="pa-carte__lien" data-fiche="${p.id}" style="background:none; border:0; text-align:left; cursor:pointer">Voir la fiche →</button>
      </li>`;
  }

  function chercherRecruteur() {
    const filtres = lireFiltresRecruteur();
    const recherche = qs("pa-f-q").value.trim();
    etat.recruteurFiltres = filtres;
    etat.recruteurRecherche = recherche;

    dessinerJetons(filtres, recherche);

    const cotesServeur = Core.filtrerCatalogue(etat.profils, filtres);
    const resultats = Core.rechercheLibre(cotesServeur, recherche);
    const { items, page, totalPages, total } = Core.paginer(resultats, etat.recruteurPage, TAILLE_PAGE);
    etat.recruteurPage = page;

    const resume = qs("pa-resume");
    resume.textContent = recherche
      ? `${resultats.length} profil${resultats.length > 1 ? "s" : ""} trouvé${resultats.length > 1 ? "s" : ""} sur les ${cotesServeur.length} que renvoie le filtre serveur`
      : `${total} profil${total > 1 ? "s" : ""} trouvé${total > 1 ? "s" : ""}`;

    const grille = qs("pa-grille");
    if (items.length === 0) {
      grille.innerHTML = `<p style="color:var(--stage-ink-3); font-size:.85rem">Aucun profil ne correspond à ces filtres.</p>`;
    } else {
      grille.innerHTML = items.map(carteHtml).join("");
    }

    qs("pa-pagination").innerHTML = totalPages > 1 ? `
      <button class="btn btn--ghost" type="button" id="pa-page-prec" ${page <= 1 ? "disabled" : ""}>Précédente</button>
      <span>Page ${page} sur ${totalPages}</span>
      <button class="btn btn--ghost" type="button" id="pa-page-suiv" ${page >= totalPages ? "disabled" : ""}>Suivante</button>
    ` : "";

    const prec = qs("pa-page-prec"); if (prec) prec.addEventListener("click", () => { etat.recruteurPage -= 1; chercherRecruteur(); });
    const suiv = qs("pa-page-suiv"); if (suiv) suiv.addEventListener("click", () => { etat.recruteurPage += 1; chercherRecruteur(); });
  }

  function renderRecruteur() {
    renderListesSuggestions();
    etat.recruteurPage = 1;
    chercherRecruteur();
  }

  // --- La fiche publique, dans la boîte de dialogue ---------------------------
  function ouvrirFiche(idProfil) {
    const p = profil(idProfil);
    if (!p) return;
    etat.ficheOuverteId = idProfil;
    dessinerFiche();
    qs("pa-fiche").showModal();
  }

  function dessinerFiche(message) {
    const p = profil(etat.ficheOuverteId);
    if (!p) return;
    const corps = qs("pa-fiche-corps");
    corps.innerHTML = `
      <button type="button" class="pa-fiche__fermer" id="pa-fiche-fermer" aria-label="Fermer">✕</button>
      <div class="pa-profil__tete">
        <span class="pa-avatar" aria-hidden="true">${echapper(initiales(p.nomAffiche))}</span>
        <div>
          <h3 class="pa-nom">${echapper(p.nomAffiche)}</h3>
          <p class="pa-lieu">${echapper(p.localisation)} · ${echapper(p.secteur)}</p>
        </div>
      </div>
      ${badgeGrandHtml(p)}
      <div>${videoZoneHtml(p)}</div>
      <ul class="pa-competences">${p.competences.map((c) => `<li>${echapper(c)}</li>`).join("")}</ul>
      <p class="pa-fiche__dossier">Numéro de dossier : ${echapper(p.id)} · publié le ${formaterDate(p.updatedAt)}</p>
      <div class="pa-fiche__actions">
        <button class="btn" type="button" id="pa-fiche-contacter">Contacter</button>
        <button class="btn btn--ghost" type="button" id="pa-fiche-favori" aria-pressed="${p.favoriDemo ? "true" : "false"}">${p.favoriDemo ? "★ En favori" : "☆ Mettre en favori"}</button>
      </div>
      ${message ? `<p class="pa-fiche__message" role="status">${echapper(message)}</p>` : ""}
    `;
    qs("pa-fiche-fermer").addEventListener("click", () => qs("pa-fiche").close());
    const boutonVideo = corps.querySelector(".pa-video:not(.is-vide)");
    if (boutonVideo) boutonVideo.addEventListener("click", () => {
      const enLecture = boutonVideo.classList.toggle("is-playing");
      boutonVideo.querySelector(".pa-video__icone").textContent = enLecture ? "❙❙" : "▶";
    });
    qs("pa-fiche-contacter").addEventListener("click", () => {
      notifier(p.id, `Un recruteur vous a contacté — ${new Date().toLocaleTimeString("fr-FR")}`);
      dessinerFiche("Message envoyé (simulation — aucun message n'est réellement transmis).");
      if (etat.role === "candidat") renderCandidat();
    });
    qs("pa-fiche-favori").addEventListener("click", () => {
      p.favoriDemo = !p.favoriDemo;
      if (p.favoriDemo) notifier(p.id, `Un recruteur vous a mis en favori — ${new Date().toLocaleTimeString("fr-FR")}`);
      dessinerFiche(p.favoriDemo ? "Ajouté à vos favoris." : "Retiré de vos favoris.");
      if (etat.role === "candidat") renderCandidat();
    });
  }

  // ======================================================= ESPACE ADMIN ======

  function renderStats() {
    const s = Core.calculerStatistiques(
      etat.profils,
      Object.values(etat.notifications).reduce((n, l) => n + l.length, 0),
      1, // un seul compte recruteur de test dans le dépôt (recruteur@example.com)
    );
    qs("pa-stats").innerHTML = `
      <div class="stat"><b>${s.profilsActifs}</b><span>profils actifs</span></div>
      <div class="stat"><b>${s.tauxCertification}%</b><span>taux de certification</span></div>
      <div class="stat"><b>${s.interactions}</b><span>interactions</span></div>
      <div class="stat"><b>${s.videosEnAttente}</b><span>vidéos en attente</span></div>
      <div class="stat"><b>${s.profilsEnAttente}</b><span>profils en attente</span></div>
      <div class="stat"><b>${s.recruteursActifs}</b><span>recruteurs actifs</span></div>
    `;
  }

  function modeleProfilModeration(p) {
    return `
      <li class="pa-moderation" data-profil="${p.id}">
        <div class="pa-moderation__tete">
          <span class="pa-moderation__nom">${echapper(p.nomAffiche)}</span>
        </div>
        <p class="pa-moderation__meta">${echapper(p.secteur)} · ${echapper(p.localisation)} · ${p.competences.length} compétence(s)</p>
        <label>
          <span style="font-size:.74rem; color:var(--stage-ink-3)">Motif, en cas de refus</span>
          <input type="text" data-motif-profil="${p.id}" placeholder="Fiche incomplète : le secteur manque.">
        </label>
        <div class="pa-moderation__actions">
          <button class="btn" type="button" data-decision-profil="VALIDE" data-id="${p.id}">Valider</button>
          <button class="btn btn--ghost" type="button" data-decision-profil="REJETE" data-id="${p.id}">Refuser</button>
        </div>
      </li>`;
  }

  function modeleVideoModeration(p) {
    return `
      <li class="pa-moderation" data-video="${p.id}">
        <div class="pa-moderation__tete">
          <span class="pa-moderation__nom">${echapper(p.nomAffiche)}</span>
        </div>
        <p class="pa-moderation__meta">${echapper(p.video.titre)} · ${p.video.type === "LIEN" ? "lien externe" : "fichier déposé"} (factice — rien n'est réellement hébergé)</p>
        <label>
          <span style="font-size:.74rem; color:var(--stage-ink-3)">Motif, en cas de refus</span>
          <input type="text" data-motif-video="${p.id}" placeholder="Obligatoire pour refuser">
        </label>
        <div class="pa-moderation__actions">
          <button class="btn" type="button" data-decision-video="VALIDE" data-id="${p.id}">Valider</button>
          <button class="btn btn--ghost" type="button" data-decision-video="REJETE" data-id="${p.id}">Refuser</button>
        </div>
      </li>`;
  }

  function renderFileProfils() {
    const enAttente = etat.profils.filter((p) => p.statutProfil === "EN_ATTENTE");
    qs("pa-compte-profils").textContent = enAttente.length === 0 ? "aucun en attente" : `${enAttente.length} en attente`;
    qs("pa-file-profils").innerHTML = enAttente.length === 0
      ? `<li class="pa-vide-file">Rien à modérer. La file est vide.</li>`
      : enAttente.map(modeleProfilModeration).join("");
  }

  function renderFileVideos() {
    const enAttente = etat.profils.filter((p) => p.video && p.video.statut === "EN_ATTENTE");
    qs("pa-compte-videos").textContent = enAttente.length === 0 ? "aucune en attente" : `${enAttente.length} en attente`;
    qs("pa-file-videos").innerHTML = enAttente.length === 0
      ? `<li class="pa-vide-file">Rien à modérer. La file est vide.</li>`
      : enAttente.map(modeleVideoModeration).join("");
  }

  function renderAdmin() {
    renderStats();
    renderFileProfils();
    renderFileVideos();
  }

  function decisionProfil(id, decision, motif) {
    if (decision === "REJETE" && !motif) {
      const champ = document.querySelector(`[data-motif-profil="${id}"]`);
      if (champ) champ.setAttribute("aria-invalid", "true");
      return;
    }
    if (decision === "REJETE" && !window.confirm(`Refuser ce profil ?\n\nMotif : ${motif}`)) return;
    const p = profil(id);
    p.statutProfil = decision;
    if (decision === "REJETE") p.motifRefusProfil = motif;
    renderStats();
    renderFileProfils();
    if (etat.role === "recruteur") chercherRecruteur();
  }

  function decisionVideo(id, decision, motif) {
    if (decision === "REJETE" && !motif) {
      const champ = document.querySelector(`[data-motif-video="${id}"]`);
      if (champ) champ.setAttribute("aria-invalid", "true");
      return;
    }
    if (decision === "REJETE" && !window.confirm(`Refuser cette vidéo ?\n\nMotif : ${motif}`)) return;
    const p = profil(id);
    p.video.statut = decision;
    if (decision === "REJETE") p.video.motifRefus = motif;
    renderStats();
    renderFileVideos();
    if (etat.role === "recruteur") chercherRecruteur();
  }

  // ==================================================== LE CÔTÉ DE LA PAGE ===

  function renderComptesSide() {
    qs("pa-liste-comptes").innerHTML = D.COMPTES_TEST.map((c) => {
      const reel = D.PROFILS_REELS.find((p) => p.id === c.idProfil);
      const grade = reel ? (reel.badge ? reel.badge.libelle : "sans badge") : c.role.toLowerCase();
      return `<li><b>${echapper(c.nom)}</b><span>${echapper(grade)}</span></li>`;
    }).join("");
  }

  // =============================================================== DÉPART ====

  function reinitialiser() {
    etat.profils = donneesInitiales();
    etat.notifications = {};
    etat.candidatActifId = "p-jean";
    etat.recruteurFiltres = {};
    etat.recruteurRecherche = "";
    etat.recruteurPage = 1;
    etat.quiz = null;
    qs("pa-quiz").hidden = true;
    qs("pa-profil-carte").style.display = "";
    qs("pa-filtres").reset();
    renderCandidatSelect();
    activerRole(etat.role);
  }

  function initialiser() {
    renderComptesSide();
    renderCandidatSelect();
    activerRole("candidat");

    qs("pa-role-candidat").addEventListener("click", () => activerRole("candidat"));
    qs("pa-role-recruteur").addEventListener("click", () => activerRole("recruteur"));
    qs("pa-role-admin").addEventListener("click", () => activerRole("admin"));

    qs("pa-filtres").addEventListener("submit", (e) => { e.preventDefault(); etat.recruteurPage = 1; chercherRecruteur(); });
    qs("pa-f-effacer").addEventListener("click", () => { qs("pa-filtres").reset(); etat.recruteurPage = 1; chercherRecruteur(); });
    qs("pa-f-badge").addEventListener("change", () => { etat.recruteurPage = 1; chercherRecruteur(); });

    let minuteur;
    ["pa-f-competence", "pa-f-q"].forEach((id) => {
      qs(id).addEventListener("input", () => {
        clearTimeout(minuteur);
        minuteur = setTimeout(() => { etat.recruteurPage = 1; chercherRecruteur(); }, 200);
      });
    });

    qs("pa-jetons").addEventListener("click", (e) => {
      const bouton = e.target.closest("[data-retirer]");
      if (!bouton) return;
      const cle = bouton.dataset.retirer;
      if (cle === "avecBadge") qs("pa-f-badge").checked = false;
      else if (cle === "competence") qs("pa-f-competence").value = "";
      else if (cle === "q") qs("pa-f-q").value = "";
      else if (cle === "secteur") qs("pa-f-secteur").value = "";
      else if (cle === "localisation") qs("pa-f-ville").value = "";
      etat.recruteurPage = 1;
      chercherRecruteur();
    });

    qs("pa-grille").addEventListener("click", (e) => {
      const fiche = e.target.closest("[data-fiche]");
      if (fiche) { ouvrirFiche(fiche.dataset.fiche); return; }
      const jouer = e.target.closest("[data-jouer]");
      if (jouer) {
        const enLecture = jouer.textContent.includes("▶");
        jouer.textContent = enLecture ? "❙❙ Lecture simulée…" : "▶ Lire la vidéo";
      }
    });

    qs("pa-file-profils").addEventListener("click", (e) => {
      const bouton = e.target.closest("[data-decision-profil]");
      if (!bouton) return;
      const id = bouton.dataset.id;
      const champ = document.querySelector(`[data-motif-profil="${id}"]`);
      decisionProfil(id, bouton.dataset.decisionProfil, champ ? champ.value.trim() : "");
    });
    qs("pa-file-profils").addEventListener("input", (e) => {
      const champ = e.target.closest("[data-motif-profil]");
      if (champ) champ.removeAttribute("aria-invalid");
    });

    qs("pa-file-videos").addEventListener("click", (e) => {
      const bouton = e.target.closest("[data-decision-video]");
      if (!bouton) return;
      const id = bouton.dataset.id;
      const champ = document.querySelector(`[data-motif-video="${id}"]`);
      decisionVideo(id, bouton.dataset.decisionVideo, champ ? champ.value.trim() : "");
    });
    qs("pa-file-videos").addEventListener("input", (e) => {
      const champ = e.target.closest("[data-motif-video]");
      if (champ) champ.removeAttribute("aria-invalid");
    });

    qs("pa-reset").addEventListener("click", reinitialiser);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initialiser);
  } else {
    initialiser();
  }
})();
