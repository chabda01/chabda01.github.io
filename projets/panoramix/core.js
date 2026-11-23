/* Panoramix — cœur de la simulation, réécrit en JavaScript.
   Aucune dépendance, aucun accès au DOM : ce fichier se teste avec node.
   Les règles (arguments, mutex, sémaphores, textes affichés) reprennent
   le code C du projet : src/main.c, src/threads.c, src/villager.c, src/druid.c.

   Il n'y a pas de vrais threads ici. Chaque appel à Etat.step() rejoue
   UNE seule action atomique — ce qu'un thread ferait s'il tenait la
   fois le verrou (etat->verrou) ou s'il venait d'être réveillé par un
   sémaphore. Entre deux actions, rien d'autre ne change : c'est la
   même granularité que la zone protégée par pthread_mutex_lock/unlock
   dans le programme d'origine. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Panoramix = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* usage() + verifier_args() : message et règle identiques au programme C */
  var USAGE = 'USAGE: ./panoramix <nb_villagers> <pot_size> <nb_fights> <nb_refills>';

  function verifierArgs(nbVillageois, taillePot, nbCombats, nbRemplissages) {
    if (!(nbVillageois > 0) || !(taillePot > 0) || !(nbCombats > 0) || !(nbRemplissages > 0))
      return USAGE + '\nValues must be >0.';
    return null;
  }

  /* petit générateur pseudo-aléatoire reproductible (mulberry32), pour
     des tests déterministes avec node. La page utilise Math.random. */
  function creerRng(graine) {
    var a = graine >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function Villageois(id) {
    this.id = id;
    this.repas = 0;             /* boires réussis = combats gagnés */
    this.etat = 'actif';        /* actif | attente | resume | termine | abandon */
    this.raisonAbandon = null;  /* druide_parti | course_perdue */
  }

  /* etat_t : mêmes champs que la structure C, plus les listes nécessaires
     pour savoir QUI attend (le C se contente d'un compteur, nb_en_attente ;
     la simulation doit en plus savoir qui réveiller). */
  function Etat(nbVillageois, taillePot, nbCombats, nbRemplissages) {
    var err = verifierArgs(nbVillageois, taillePot, nbCombats, nbRemplissages);
    if (err) throw new Error(err);
    this.nbVillageois = Math.trunc(nbVillageois);
    this.taillePot = Math.trunc(taillePot);
    this.nbCombats = Math.trunc(nbCombats);
    this.nbRemplissagesInitial = Math.trunc(nbRemplissages);

    this.portions = this.taillePot;                 /* etat->portions */
    this.nbRemplissagesRestants = this.nbRemplissagesInitial; /* etat->nb_remplissages */
    this.druideParti = false;                        /* etat->druide_parti */
    this.druideEtat = 'dort';                        /* dort | parti (vivant hors etat_t, pour l'affichage) */
    this.appelEnCours = false;                       /* etat->appel_en_cours */
    this.arretDemande = false;                        /* etat->arret_demande */
    this.fileAttente = [];                            /* qui est bloqué dans sem_wait(pot_rempli) */
    this.appelsDruideEnAttente = 0;                   /* compte de sem_post(appel_druide) non consommés */
    this.tick = 0;

    this.villageois = [];
    for (var i = 0; i < this.nbVillageois; i++) this.villageois.push(new Villageois(i));
  }

  Etat.prototype.nbEnAttente = function () { return this.fileAttente.length; };

  Etat.prototype.estTousVillageoisFinis = function () {
    for (var i = 0; i < this.villageois.length; i++) {
      var e = this.villageois[i].etat;
      if (e !== 'termine' && e !== 'abandon') return false;
    }
    return true;
  };

  Etat.prototype.estTerminee = function () {
    return this.druideEtat === 'parti' && this.estTousVillageoisFinis();
  };

  /* Ce qu'un acteur ferait MAINTENANT s'il obtenait la main. L'ordre de
     cette liste n'a pas de sens : step() en tire un au hasard, comme le
     ferait l'ordonnanceur du système avec de vrais threads. */
  Etat.prototype.actionsPretes = function () {
    var actions = [], i, v;
    for (i = 0; i < this.villageois.length; i++) {
      v = this.villageois[i];
      if (v.etat === 'actif') actions.push({ type: 'tenter', v: v });
      else if (v.etat === 'resume') actions.push({ type: 'reprendre', v: v });
    }
    if (this.appelsDruideEnAttente > 0 && this.druideEtat === 'dort')
      actions.push({ type: 'druide' });
    if (actions.length === 0 && !this.arretDemande && this.druideEtat === 'dort' && this.estTousVillageoisFinis())
      actions.push({ type: 'arret' }); /* main() : attendre_threads() réveille le druide pour l'arrêt propre */
    return actions;
  };

  /* boire_et_combattre + attendre_potion : un villageois qui n'attendait pas encore */
  Etat.prototype._tenter = function (v) {
    var lignes = [];
    if (this.portions > 0) {
      this.portions--;
      v.repas++;
      lignes.push({ texte: 'Villager ' + v.id + ': I need a drink... I see ' + this.portions + ' servings left.', reel: true });
      lignes.push({ texte: 'Villager ' + v.id + ': Take that roman scum! Only ' + (this.nbCombats - v.repas) + ' left.', reel: true });
      var fini = v.repas >= this.nbCombats;
      if (fini) { v.etat = 'termine'; lignes.push({ texte: 'Villager ' + v.id + ": I'm going to sleep now.", reel: true }); }
      return { tick: this.tick, type: 'boire', id: v.id, fini: fini, lignes: lignes };
    }
    lignes.push({ texte: 'Villager ' + v.id + ': I need a drink... I see 0 servings left.', reel: true });
    if (this.druideParti) {
      v.etat = 'abandon'; v.raisonAbandon = 'druide_parti';
      return { tick: this.tick, type: 'abandon', id: v.id, raison: 'druide_parti', lignes: lignes };
    }
    var appelant = false;
    if (!this.appelEnCours) {
      this.appelEnCours = true;
      appelant = true;
      lignes.push({ texte: 'Villager ' + v.id + ': Hey Pano wake up! We need more potion.', reel: true });
      this.appelsDruideEnAttente++;
    }
    v.etat = 'attente';
    this.fileAttente.push(v);
    return { tick: this.tick, type: 'attente', id: v.id, appelant: appelant, lignes: lignes };
  };

  /* fin de attendre_potion, après le sem_wait(pot_rempli) : le villageois
     reprend le verrou et regarde si le pot a vraiment une portion pour lui. */
  Etat.prototype._reprendre = function (v) {
    if (this.portions > 0) {
      this.portions--;
      v.repas++;
      var lignes = [{ texte: 'Villager ' + v.id + ': Take that roman scum! Only ' + (this.nbCombats - v.repas) + ' left.', reel: true }];
      var fini = v.repas >= this.nbCombats;
      if (fini) { v.etat = 'termine'; lignes.push({ texte: 'Villager ' + v.id + ": I'm going to sleep now.", reel: true }); }
      else v.etat = 'actif';
      return { tick: this.tick, type: 'boire', id: v.id, fini: fini, reprise: true, lignes: lignes };
    }
    /* réveillé pour rien : d'autres ont vidé le pot avant lui. Le code
       d'origine ne réessaie pas : le thread s'arrête, sans rien afficher. */
    v.etat = 'abandon'; v.raisonAbandon = 'course_perdue';
    return { tick: this.tick, type: 'abandon', id: v.id, raison: 'course_perdue', reprise: true, lignes: [] };
  };

  /* L'ordre de réveil entre plusieurs sem_wait() n'est pas garanti par
     POSIX : on le tire au hasard plutôt que de supposer un ordre d'arrivée. */
  Etat.prototype._libererFile = function (rng) {
    var liste = this.fileAttente.slice();
    this.fileAttente = [];
    for (var i = liste.length - 1; i > 0; i--) {
      var j = Math.floor(rng() * (i + 1));
      var tmp = liste[i]; liste[i] = liste[j]; liste[j] = tmp;
    }
    liste.forEach(function (v) { v.etat = 'resume'; });
    return liste.map(function (v) { return v.id; });
  };

  /* druid_routine : soit remplir_pot(), soit l'arrêt demandé par main() */
  Etat.prototype._druide = function (rng) {
    this.appelsDruideEnAttente--;
    if (this.arretDemande) {
      var liberesFermeture = this._libererFile(rng);
      this.druideEtat = 'parti';
      return {
        tick: this.tick, type: 'fermeture', liberes: liberesFermeture,
        lignes: [{ texte: "Druid: I'm out of viscum. I'm going back to... zZz", reel: true }]
      };
    }
    this.nbRemplissagesRestants--;
    this.portions = this.taillePot;
    this.appelEnCours = false;
    var lignes = [{
      texte: "Druid: Ah! Yes, yes, I'm awake! Working on it! Beware I can only make " +
        this.nbRemplissagesRestants + ' more refills after this one.', reel: true
    }];
    var liberes = this._libererFile(rng);
    var termine = this.nbRemplissagesRestants === 0;
    if (termine) {
      this.druideParti = true;
      this.druideEtat = 'parti';
      lignes.push({ texte: "Druid: I'm out of viscum. I'm going back to... zZz", reel: true });
    }
    return { tick: this.tick, type: 'remplissage', liberes: liberes, termine: termine, restants: this.nbRemplissagesRestants, lignes: lignes };
  };

  /* attendre_threads() : tous les villageois ont fini, le programme réveille
     le druide pour qu'il sorte proprement. Ce n'est pas un printf du
     programme — c'est juste l'ordonnancement de main(), rien à afficher. */
  Etat.prototype._arret = function () {
    this.arretDemande = true;
    this.appelsDruideEnAttente++;
    return { tick: this.tick, type: 'arret_auto', lignes: [] };
  };

  /* Une action atomique, choisie au hasard parmi celles possibles.
     Renvoie null quand il n'y a plus rien à faire (simulation terminée). */
  Etat.prototype.step = function (rng) {
    rng = rng || Math.random;
    var actions = this.actionsPretes();
    if (actions.length === 0) return null;
    var action = actions[Math.floor(rng() * actions.length)];
    this.tick++;
    if (action.type === 'tenter') return this._tenter(action.v);
    if (action.type === 'reprendre') return this._reprendre(action.v);
    if (action.type === 'druide') return this._druide(rng);
    return this._arret();
  };

  /* Bouton « forcer un cas limite » : vide le chaudron d'un coup. Ce
     n'est pas une action du programme d'origine, seulement un déclencheur
     pour observer tout de suite la réaction réelle de l'algorithme.
     Renvoie false si le chaudron était déjà vide (rien à forcer). */
  Etat.prototype.forcerChaudronVide = function () {
    if (this.portions > 0) { this.portions = 0; return true; }
    return false;
  };

  /* Fait tourner la simulation jusqu'à la fin (ou jusqu'à maxTicks) : pour
     les tests avec node, et pour vérifier qu'on termine toujours. */
  function tourner(etat, rng, maxTicks) {
    maxTicks = maxTicks || 1000000;
    var faits = [];
    while (!etat.estTerminee() && etat.tick < maxTicks) {
      var f = etat.step(rng);
      if (!f) break;
      faits.push(f);
    }
    return faits;
  }

  return {
    USAGE: USAGE,
    verifierArgs: verifierArgs,
    creerRng: creerRng,
    Villageois: Villageois,
    Etat: Etat,
    tourner: tourner
  };
});
