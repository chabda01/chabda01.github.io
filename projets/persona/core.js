/* Persona — cœur du calcul (fonctions pures, sans DOM).
   Reprise fidèle de la vraie logique des deux workflows n8n du projet
   (« Persona - Chatbot.json » et « Persona - Newsletter.json ») :
   - détection de langue et textes du menu : copiés du nœud de code "State Machine"
   - machine à états du chatbot : réécrite d'après le même switch(session.state)
   - score par intérêts, recoupement de sources, secours sans IA, désinscription :
     réécrits d'après les nœuds "Load Users & Fetch News", "Fallback & Inject"
     et "Handle Unsubscribe" du workflow Newsletter.
   Ici, pas de MongoDB ni d'appel réseau : un petit magasin en mémoire les remplace.
   Marche dans le navigateur (window.PersonaCore) et sous node (require, pour les tests). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PersonaCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ════════════════════════════════════════════════════════════
     1. Détection de langue — copiée telle quelle du nœud "State Machine"
     ════════════════════════════════════════════════════════════ */
  function detectLanguage(text) {
    var t = text.toLowerCase();
    var lists = {
      fr: ['je','tu','il','le','la','les','est','sont','bonjour','salut','oui','non','merci','avec','pour','dans','que','qui','pas','sur','une','des','du','mon','ma','mes','nous','vous','leur','mais','comment','pourquoi','quoi'],
      es: ['yo','el','ella','los','las','hola','gracias','que','como','soy','para','con','una','por','pero','muy','bien','hoy','también','no','si','es','son','del','hay','más','esto','qué','cómo','dónde'],
      pt: ['eu','você','ele','ela','os','as','olá','oi','obrigado','obrigada','que','como','para','com','uma','por','mas','muito','bem','hoje','também','não','sim','é','são','do','da','meu','minha','isso'],
      de: ['ich','du','er','sie','das','der','die','ist','sind','hallo','bitte','danke','wie','was','mit','auf','ein','eine','guten','nicht','auch','noch','ja','nein','aber','oder','und','weil','wenn','dass'],
      it: ['io','tu','lui','lei','gli','ciao','grazie','come','cosa','per','con','una','sono','buongiorno','prego','molto','bene','ma','anche','non','si','no','che','questo','quello','mio','tuo','quando','perché','dove'],
      en: ['the','is','are','hello','hi','what','how','with','for','this','that','have','has','from','yes','no','thanks','thank','okay','good','and','but','not','can','will','you','your','my','we','they','just','would','could']
    };
    var words = t.replace(/[^a-záàâäéèêëíìîïóòôöúùûüçñ]/g, ' ').split(/\s+/).filter(function (w) { return w.length > 1; });
    var scores = {};
    Object.keys(lists).forEach(function (lang) {
      scores[lang] = words.filter(function (w) { return lists[lang].indexOf(w) !== -1; }).length;
    });
    var best = Object.keys(scores).map(function (l) { return [l, scores[l]]; }).sort(function (a, b) { return b[1] - a[1]; });
    return best[0][1] > 0 ? best[0][0] : 'en';
  }

  /* ════════════════════════════════════════════════════════════
     2. Textes du chatbot — copiés du nœud "State Machine" (objet T)
     Seuls le français et l'anglais sont repris en entier ici pour alléger
     la page ; le vrai projet gère aussi es/pt/de/it de la même façon.
     ════════════════════════════════════════════════════════════ */
  var T = {
    en: {
      main_menu: "Welcome to Persona! Your personalised AI news newsletter.\n\nWhat would you like to do?\n1. Register\n2. Login\n3. My profile\n4. Update interests\n5. Update email\n6. Update schedule\n7. Send newsletter now\n8. Delete my account\n9. Give feedback\n\nReply with a number.",
      logged_in: function (u) { return "Logged in as " + u + ".\n\n3. My profile\n4. Update interests\n5. Update email\n6. Update schedule\n7. Send newsletter now\n8. Delete my account\n9. Give feedback\n0. Logout"; },
      register_start: "Creating your account!\n\nYour email is stored only to deliver your newsletter (GDPR Art. 6(1)(a)).\n\nStep 1/5 — Enter a username (3-20 chars, letters/numbers/underscores only):",
      login_start: "Login — Enter your username:",
      need_login: "You need to be logged in first.\n\nEnter your username:",
      logged_out: "Logged out.",
      reg_invalid_username: "Invalid username — use 3-20 characters: letters, numbers, underscores only.\n\nTry again:",
      reg_taken_username: "Username already taken. Choose another:",
      reg_password: "Step 2/5 — Enter a password (minimum 6 characters):",
      reg_short_password: "Password too short — minimum 6 characters.\n\nTry again:",
      reg_email: "Step 3/5 — Enter your email address:",
      reg_invalid_email: "Invalid email address.\n\nTry again:",
      reg_interests: "Step 4/5 — Enter your topics of interest, comma-separated (e.g. AI, sports, climate):",
      reg_empty_interests: "Please enter at least one topic:",
      reg_schedule: "Step 5/5 — Enter your preferred daily delivery time in HH:MM (e.g. 08:00 or 19:30):",
      reg_invalid_schedule: "Invalid format — use HH:MM (e.g. 08:00).\n\nTry again:",
      reg_success: function (t, email) { return "Account created! Your newsletter will arrive daily at " + t + " to " + email + ".\n\n"; },
      login_invalid_format: "Invalid username format.\n\nEnter your username:",
      login_password: "Enter your password:",
      login_wrong: "Wrong username or password.\n\nEnter your username:",
      login_locked: "Account locked after 5 failed attempts.\n\n",
      login_wrong_pw: function (r) { return "Wrong password. " + r + " attempt(s) remaining.\n\nEnter your password:"; },
      login_success: function (u) { return "Welcome back, " + u + "!\n\n"; },
      profile: function (u) {
        return "Profile for " + u.username + ":\n• Email: " + u.email + "\n• Interests: " + (u.interests || []).join(', ') +
          "\n• Schedule: " + u.schedule + "\n• Member since: " + (u.createdAt ? u.createdAt.slice(0, 10) : '?') +
          "\n• Last newsletter: " + (u.lastSentAt || 'never') + "\n\n";
      },
      upd_int_prompt: function (u) { return "Current interests: " + (u.interests || []).join(', ') + "\n\nEnter new interests (comma-separated):"; },
      upd_int_empty: "Please enter at least one topic:",
      upd_int_done: function (i) { return "Interests updated to: " + i.join(', ') + "\n\n"; },
      upd_email_prompt: function (u) { return "Current email: " + u.email + "\n\nEnter new email address:"; },
      upd_email_invalid: "Invalid email address. Try again:",
      upd_email_done: function (e) { return "Email updated to " + e + ".\n\n"; },
      upd_sched_prompt: function (u) { return "Current schedule: " + u.schedule + "\n\nEnter new delivery time (HH:MM):"; },
      upd_sched_invalid: "Invalid format — use HH:MM. Try again:",
      upd_sched_done: function (t) { return "Delivery time updated to " + t + ".\n\n"; },
      newsletter_sent: "Newsletter dispatched! Check your inbox shortly.\n\n",
      newsletter_error: function (e) { return "Could not dispatch newsletter: " + e + "\n\n"; },
      delete_confirm: "This will permanently delete your account and all data (GDPR Art. 17).\n\nType DELETE to confirm, or anything else to cancel:",
      delete_word: 'DELETE',
      delete_cancelled: "Cancelled.\n\n",
      delete_done: "Your account and all data have been permanently deleted (GDPR Art. 17 — right to erasure).\n\n",
      feedback_prompt: "What did you think of your last newsletter?",
      feedback_done: "Feedback saved! It will improve your next newsletter.\n\n"
    },
    fr: {
      main_menu: "Bienvenue sur Persona ! Votre newsletter d'actualités personnalisée par IA.\n\nQue souhaitez-vous faire ?\n1. S'inscrire\n2. Se connecter\n3. Mon profil\n4. Mettre à jour mes intérêts\n5. Mettre à jour mon e-mail\n6. Mettre à jour l'heure d'envoi\n7. Envoyer la newsletter maintenant\n8. Supprimer mon compte\n9. Donner mon avis\n\nRépondez avec un chiffre.",
      logged_in: function (u) { return "Connecté en tant que " + u + ".\n\n3. Mon profil\n4. Mettre à jour mes intérêts\n5. Mettre à jour mon e-mail\n6. Mettre à jour l'heure d'envoi\n7. Envoyer la newsletter maintenant\n8. Supprimer mon compte\n9. Donner mon avis\n0. Se déconnecter"; },
      register_start: "Création de votre compte !\n\nVotre e-mail est uniquement utilisé pour envoyer votre newsletter (RGPD Art. 6(1)(a)).\n\nÉtape 1/5 — Choisissez un nom d'utilisateur (3-20 caractères : lettres, chiffres, underscores) :",
      login_start: "Connexion — Entrez votre nom d'utilisateur :",
      need_login: "Vous devez être connecté.\n\nEntrez votre nom d'utilisateur :",
      logged_out: "Déconnecté.",
      reg_invalid_username: "Nom d'utilisateur invalide — 3 à 20 caractères : lettres, chiffres, underscores.\n\nRéessayez :",
      reg_taken_username: "Nom d'utilisateur déjà pris. Choisissez-en un autre :",
      reg_password: "Étape 2/5 — Entrez un mot de passe (minimum 6 caractères) :",
      reg_short_password: "Mot de passe trop court — minimum 6 caractères.\n\nRéessayez :",
      reg_email: "Étape 3/5 — Entrez votre adresse e-mail :",
      reg_invalid_email: "Adresse e-mail invalide.\n\nRéessayez :",
      reg_interests: "Étape 4/5 — Entrez vos sujets d'intérêt, séparés par des virgules (ex : IA, sport, climat) :",
      reg_empty_interests: "Veuillez entrer au moins un sujet :",
      reg_schedule: "Étape 5/5 — Entrez votre heure de livraison quotidienne au format HH:MM (ex : 08:00 ou 19:30) :",
      reg_invalid_schedule: "Format invalide — utilisez HH:MM (ex : 08:00).\n\nRéessayez :",
      reg_success: function (t, email) { return "Compte créé ! Votre newsletter arrivera chaque jour à " + t + " sur " + email + ".\n\n"; },
      login_invalid_format: "Format de nom d'utilisateur invalide.\n\nEntrez votre nom d'utilisateur :",
      login_password: "Entrez votre mot de passe :",
      login_wrong: "Nom d'utilisateur ou mot de passe incorrect.\n\nEntrez votre nom d'utilisateur :",
      login_locked: "Compte bloqué après 5 tentatives échouées.\n\n",
      login_wrong_pw: function (r) { return "Mot de passe incorrect. " + r + " tentative(s) restante(s).\n\nEntrez votre mot de passe :"; },
      login_success: function (u) { return "Bon retour, " + u + " !\n\n"; },
      profile: function (u) {
        return "Profil de " + u.username + " :\n• E-mail : " + u.email + "\n• Intérêts : " + (u.interests || []).join(', ') +
          "\n• Horaire : " + u.schedule + "\n• Membre depuis : " + (u.createdAt ? u.createdAt.slice(0, 10) : '?') +
          "\n• Dernière newsletter : " + (u.lastSentAt || 'jamais') + "\n\n";
      },
      upd_int_prompt: function (u) { return "Intérêts actuels : " + (u.interests || []).join(', ') + "\n\nEntrez les nouveaux intérêts (séparés par des virgules) :"; },
      upd_int_empty: "Veuillez entrer au moins un sujet :",
      upd_int_done: function (i) { return "Intérêts mis à jour : " + i.join(', ') + "\n\n"; },
      upd_email_prompt: function (u) { return "E-mail actuel : " + u.email + "\n\nEntrez la nouvelle adresse e-mail :"; },
      upd_email_invalid: "Adresse e-mail invalide. Réessayez :",
      upd_email_done: function (e) { return "E-mail mis à jour : " + e + ".\n\n"; },
      upd_sched_prompt: function (u) { return "Horaire actuel : " + u.schedule + "\n\nEntrez le nouvel horaire (HH:MM) :"; },
      upd_sched_invalid: "Format invalide — utilisez HH:MM. Réessayez :",
      upd_sched_done: function (t) { return "Horaire mis à jour : " + t + ".\n\n"; },
      newsletter_sent: "Newsletter envoyée ! Vérifiez votre boîte de réception.\n\n",
      newsletter_error: function (e) { return "Impossible d'envoyer la newsletter : " + e + "\n\n"; },
      delete_confirm: "Cela supprimera définitivement votre compte et toutes vos données (RGPD Art. 17).\n\nTapez SUPPRIMER pour confirmer, ou autre chose pour annuler :",
      delete_word: 'SUPPRIMER',
      delete_cancelled: "Annulé.\n\n",
      delete_done: "Votre compte et toutes vos données ont été définitivement supprimés (RGPD Art. 17).\n\n",
      feedback_prompt: "Que pensez-vous de votre dernière newsletter ?",
      feedback_done: "Avis enregistré ! Il améliorera votre prochaine newsletter.\n\n"
    }
  };
  T.fr._isFull = true; T.en._isFull = true;

  /* ════════════════════════════════════════════════════════════
     3. Validateurs — mêmes expressions régulières que le vrai code
     ════════════════════════════════════════════════════════════ */
  var USERNAME_RE = /^[a-zA-Z0-9_]{3,20}$/;
  var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  var TIME_RE = /^([01]?\d|2[0-3]):[0-5]\d$/;

  /* ════════════════════════════════════════════════════════════
     4. Machine à états du chatbot — même switch(session.state) que
     le vrai nœud "State Machine", sans MongoDB (magasin en mémoire).
     ════════════════════════════════════════════════════════════ */
  function createStore() {
    return { users: {}, order: [] };
  }

  function createSession(lang) {
    return { state: 'menu', data: lang ? { lang: lang } : {} };
  }

  /* onSendNewsletter(username) : branchement vers le workflow Newsletter
     (dans le vrai projet, c'est un POST HTTP vers /webhook/persona-newsletter) */
  function chatbotStep(session, rawInput, store, lang, onSendNewsletter) {
    var input = (rawInput || '').trim();
    var data = {};
    for (var k in session.data) data[k] = session.data[k];
    var nextState = session.state;
    var response = '';
    var log = [];

    var forced = lang && T[lang] ? lang : null;
    if (forced) data.lang = forced;
    else if (!data.lang && input) data.lang = detectLanguage(input);
    var L = data.lang || 'en';
    var s = T[L] || T.en;

    function findUser(username) { return store.users[username]; }
    function handleLoggedIn(option) {
      var u = findUser(data.username);
      switch (option) {
        case '3': return { nextState: 'menu', response: s.profile(u) + s.logged_in(data.username) };
        case '4': return { nextState: 'update_interests', response: s.upd_int_prompt(u) };
        case '5': return { nextState: 'update_email', response: s.upd_email_prompt(u) };
        case '6': return { nextState: 'update_schedule', response: s.upd_sched_prompt(u) };
        case '7': {
          try {
            if (onSendNewsletter) onSendNewsletter(data.username);
            log.push({ op: 'http', detail: 'POST /webhook/persona-newsletter {username:"' + data.username + '"}' });
            return { nextState: 'menu', response: s.newsletter_sent + s.logged_in(data.username) };
          } catch (e) {
            return { nextState: 'menu', response: s.newsletter_error(e.message) + s.logged_in(data.username) };
          }
        }
        case '8': return { nextState: 'delete_confirm', response: s.delete_confirm };
        case '9': return { nextState: 'feedback', response: s.feedback_prompt };
        default: return { nextState: 'menu', response: s.logged_in(data.username) };
      }
    }

    switch (session.state) {
      case 'menu':
      default:
        if (input === '1') { nextState = 'reg_username'; response = s.register_start; }
        else if (input === '2') { nextState = 'login_username'; response = s.login_start; }
        else if (['3', '4', '5', '6', '7', '8', '9'].indexOf(input) !== -1) {
          if (!data.loggedIn) { data.afterLogin = input; nextState = 'login_username'; response = s.need_login; }
          else { var r = handleLoggedIn(input); nextState = r.nextState; response = r.response; }
        } else if (input === '0' && data.loggedIn) {
          data = { lang: L }; nextState = 'menu'; response = s.logged_out + '\n\n' + s.main_menu;
        } else { response = s.main_menu; }
        break;

      case 'reg_username':
        if (!USERNAME_RE.test(input)) response = s.reg_invalid_username;
        else if (findUser(input)) response = s.reg_taken_username;
        else { data.username = input; nextState = 'reg_password'; response = s.reg_password; }
        break;

      case 'reg_password':
        if (input.length < 6) response = s.reg_short_password;
        else { data.password = input; nextState = 'reg_email'; response = s.reg_email; }
        break;

      case 'reg_email':
        if (!EMAIL_RE.test(input)) response = s.reg_invalid_email;
        else { data.email = input; nextState = 'reg_interests'; response = s.reg_interests; }
        break;

      case 'reg_interests':
        if (!input) response = s.reg_empty_interests;
        else {
          data.interests = input.split(',').map(function (x) { return x.trim().toLowerCase(); }).filter(Boolean);
          nextState = 'reg_schedule'; response = s.reg_schedule;
        }
        break;

      case 'reg_schedule':
        if (!TIME_RE.test(input)) response = s.reg_invalid_schedule;
        else {
          store.users[data.username] = {
            username: data.username, password: data.password, email: data.email, interests: data.interests, schedule: input,
            lang: L, active: true, unsubscribed: false, failedLoginCount: 0, lastSentAt: null,
            lastFeedback: null, createdAt: new Date().toISOString(), gdprConsent: true, style: {}
          };
          log.push({ op: 'insertOne', detail: 'users.insertOne({username:"' + data.username + '", …})' });
          var username = data.username, email = data.email;
          data = { loggedIn: true, username: username, lang: L };
          nextState = 'menu'; response = s.reg_success(input, email) + s.logged_in(username);
        }
        break;

      case 'login_username':
        if (!USERNAME_RE.test(input)) response = s.login_invalid_format;
        else { data.loginUsername = input; nextState = 'login_password'; response = s.login_password; }
        break;

      case 'login_password': {
        var u = findUser(data.loginUsername);
        if (!u) { nextState = 'login_username'; data = { afterLogin: data.afterLogin, lang: L }; response = s.login_wrong; }
        else if ((u.failedLoginCount || 0) >= 5) { nextState = 'menu'; data = { lang: L }; response = s.login_locked + s.main_menu; }
        else if (u.password !== input) {
          u.failedLoginCount = (u.failedLoginCount || 0) + 1;
          log.push({ op: 'updateOne', detail: 'users.updateOne({username:"' + data.loginUsername + '"}, {$inc:{failedLoginCount:1}})' });
          response = s.login_wrong_pw(Math.max(0, 5 - u.failedLoginCount));
        } else {
          u.failedLoginCount = 0;
          var target = data.afterLogin, userLang = u.lang || L;
          data = { loggedIn: true, username: data.loginUsername, lang: userLang };
          var ls = T[userLang] || T.en;
          if (target) {
            var savedS = s; s = ls; var r2 = handleLoggedIn(target); s = savedS;
            nextState = r2.nextState; response = r2.response;
          } else { nextState = 'menu'; response = ls.login_success(data.username) + ls.logged_in(data.username); }
        }
        break;
      }

      case 'update_interests':
        if (!input) response = s.upd_int_empty;
        else {
          var interests = input.split(',').map(function (x) { return x.trim().toLowerCase(); }).filter(Boolean);
          store.users[data.username].interests = interests;
          log.push({ op: 'updateOne', detail: 'users.updateOne({username:"' + data.username + '"}, {$set:{interests}})' });
          nextState = 'menu'; response = s.upd_int_done(interests) + s.logged_in(data.username);
        }
        break;

      case 'update_email':
        if (!EMAIL_RE.test(input)) response = s.upd_email_invalid;
        else {
          store.users[data.username].email = input;
          log.push({ op: 'updateOne', detail: 'users.updateOne({username:"' + data.username + '"}, {$set:{email}})' });
          nextState = 'menu'; response = s.upd_email_done(input) + s.logged_in(data.username);
        }
        break;

      case 'update_schedule':
        if (!TIME_RE.test(input)) response = s.upd_sched_invalid;
        else {
          store.users[data.username].schedule = input;
          log.push({ op: 'updateOne', detail: 'users.updateOne({username:"' + data.username + '"}, {$set:{schedule}})' });
          nextState = 'menu'; response = s.upd_sched_done(input) + s.logged_in(data.username);
        }
        break;

      case 'delete_confirm':
        if (input.toUpperCase() === s.delete_word) {
          delete store.users[data.username];
          log.push({ op: 'deleteOne', detail: 'users.deleteOne({username:"' + data.username + '"})  — RGPD art. 17' });
          return { response: s.delete_done + s.main_menu, state: { state: 'menu', data: {} }, log: log };
        } else { nextState = 'menu'; response = s.delete_cancelled + s.logged_in(data.username); }
        break;

      case 'feedback':
        if (!input) response = s.feedback_prompt;
        else {
          store.users[data.username].lastFeedback = input;
          log.push({ op: 'updateOne', detail: 'users.updateOne({username:"' + data.username + '"}, {$set:{lastFeedback}})  — réinjecté dans le prochain prompt, texte non filtré' });
          nextState = 'menu'; response = s.feedback_done + s.logged_in(data.username);
        }
        break;
    }

    return { response: response, state: { state: nextState, data: data }, log: log };
  }

  /* ════════════════════════════════════════════════════════════
     5. Newsletter — score par intérêts, recoupement de sources,
     secours sans IA, désinscription. Réécrits d'après les nœuds
     "Load Users & Fetch News" et "Fallback & Inject" du vrai workflow.
     ════════════════════════════════════════════════════════════ */

  /* score = 3 points par mot-clé d'intérêt trouvé dans titre+description (identique au vrai code) */
  function scoreArticles(articles, interests) {
    var kws = (interests || []).map(function (i) { return i.toLowerCase(); });
    return articles.map(function (a) {
      var txt = (a.title + ' ' + a.description).toLowerCase();
      var score = kws.reduce(function (sum, kw) { return sum + (txt.indexOf(kw) !== -1 ? 3 : 0); }, 0);
      var copy = {}; for (var k in a) copy[k] = a[k]; copy.score = score; return copy;
    }).sort(function (a, b) { return b.score - a.score; });
  }

  /* un article est "vérifié" si un autre article d'une AUTRE source partage ≥40% de ses mots-clés (>4 lettres) */
  function normalize(t) { return t.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim(); }
  function keyWords(t) {
    var set = {}; normalize(t).split(/\s+/).forEach(function (w) { if (w.length > 4) set[w] = true; });
    return set;
  }
  function overlap(a, b) {
    var wa = keyWords(a), wb = keyWords(b), count = 0, na = 0, nb = 0;
    for (var k in wa) { na++; if (wb[k]) count++; }
    for (var k2 in wb) nb++;
    return count / Math.max(na, nb, 1);
  }
  function factCheck(articles) {
    return articles.map(function (a, i) {
      var corroborated = false;
      for (var j = 0; j < articles.length; j++) {
        if (i === j || articles[i].source === articles[j].source) continue;
        if (overlap(articles[i].title, articles[j].title) >= 0.4) { corroborated = true; break; }
      }
      var copy = {}; for (var k in a) copy[k] = a[k]; copy.verified = corroborated; return copy;
    });
  }

  /* fenêtre d'envoi : ±15 min autour de l'heure choisie (cyclique sur 24h), une fois par jour */
  function isEligibleForSend(user, currentMinutes, todayStr) {
    if (user.lastSentAt && user.lastSentAt.indexOf(todayStr) === 0) return false;
    var parts = (user.schedule || '08:00').split(':').map(Number);
    var schedMins = parts[0] * 60 + (isNaN(parts[1]) ? 0 : parts[1]);
    var diff = Math.min(Math.abs(currentMinutes - schedMins), 1440 - Math.abs(currentMinutes - schedMins));
    return diff <= 15;
  }

  /* fenêtre de pré-chargement : 30 min avant l'heure choisie, ± 7 min (le planificateur passe toutes les 15 min) */
  function isEligibleForPrefetch(user, currentMinutes, todayStr) {
    if (user.lastSentAt && user.lastSentAt.indexOf(todayStr) === 0) return false;
    var parts = (user.schedule || '08:00').split(':').map(Number);
    var schedMins = parts[0] * 60 + (isNaN(parts[1]) ? 0 : parts[1]);
    var diff = ((schedMins - currentMinutes) + 1440) % 1440;
    return diff >= 23 && diff <= 37;
  }

  /* contenu renvoyé par le modèle jugé exploitable : au moins 100 caractères et une balise HTML */
  function isValidAiHtml(text) {
    var t = (text || '').trim();
    return t.length > 100 && /<[a-z][\s\S]*>/i.test(t);
  }

  var SOURCE_COLORS = { 'BBC News': '#bb1919', 'Reuters': '#f26522', 'Hacker News': '#ff6600', 'Reddit WorldNews': '#ff4500' };

  /* secours sans IA — identique au vrai code de "Fallback & Inject" */
  function buildFallbackHtml(user, articles, date, unsubUrl) {
    var top = articles.slice(0, 6);
    var articlesHtml = top.map(function (a) {
      var badge = SOURCE_COLORS[a.source] || '#2c3e50';
      return '<div style="margin-bottom:24px;padding-bottom:24px;border-bottom:1px solid #eee;"><div style="margin-bottom:6px;"><span style="background:' + badge + ';color:#fff;font-size:11px;padding:2px 8px;border-radius:3px;">' + a.source + '</span></div><h3 style="margin:8px 0;font-size:16px;"><a href="' + a.link + '" style="color:#2c3e50;text-decoration:none;">' + a.title + '</a></h3><p style="color:#555;font-size:14px;line-height:1.5;margin:0;">' + a.description + '</p></div>';
    }).join('');
    var interests = (user.interests || []).join(', ');
    return '<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#333;"><div style="background:#2c3e50;padding:24px;text-align:center;"><h1 style="color:#fff;margin:0;font-size:24px;">Persona Newsletter</h1><p style="color:#bbb;margin:8px 0 0;font-size:13px;">' + date + '</p></div><div style="padding:24px;"><p style="color:#555;font-size:14px;margin-bottom:24px;">Here is your daily digest' + (interests ? ' on ' + interests : '') + '.</p>' + articlesHtml + '</div><div style="background:#f5f5f5;padding:16px;text-align:center;font-size:12px;color:#999;"><a href="' + unsubUrl + '" style="color:#999;">Unsubscribe</a></div></div>';
  }

  /* jeton de désinscription = username encodé en base64 (identique au vrai code, pas un vrai secret) */
  function encodeUnsubToken(username) {
    if (typeof btoa === 'function') return btoa(username);
    return Buffer.from(username).toString('base64');
  }
  function decodeUnsubToken(token) {
    try {
      if (typeof atob === 'function') return atob(token);
      return Buffer.from(token, 'base64').toString('utf8');
    } catch (e) { return null; }
  }
  function buildUnsubscribePageHtml() {
    return '<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Unsubscribed</title></head><body><h1>Unsubscribed</h1><p>You have been removed from the Persona Newsletter.</p><p>Your data is retained until you delete your account (GDPR right to erasure available via chatbot).</p></body></html>';
  }

  return {
    detectLanguage: detectLanguage, T: T,
    USERNAME_RE: USERNAME_RE, EMAIL_RE: EMAIL_RE, TIME_RE: TIME_RE,
    createStore: createStore, createSession: createSession, chatbotStep: chatbotStep,
    scoreArticles: scoreArticles, factCheck: factCheck,
    isEligibleForSend: isEligibleForSend, isEligibleForPrefetch: isEligibleForPrefetch,
    isValidAiHtml: isValidAiHtml, buildFallbackHtml: buildFallbackHtml, SOURCE_COLORS: SOURCE_COLORS,
    encodeUnsubToken: encodeUnsubToken, decodeUnsubToken: decodeUnsubToken, buildUnsubscribePageHtml: buildUnsubscribePageHtml
  };
});
