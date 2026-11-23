/* SensAI — interface de la démo. Le calcul est dans core.js (SensaiCore). */
(function () {
  'use strict';
  var C = window.SensaiCore;
  var $ = function (id) { return document.getElementById(id); };

  /* ───────────── données reprises du dépôt ───────────── */

  // sensai.toml : [behavior] et [scenarios.*] (préréglages écrits par l'équipe)
  var SCENARIOS = {
    '': 'Tu es SENSAI, un assistant IA local. Sois concis, précis et utile.',
    coding: 'Tu es un expert en développement logiciel. Fournis du code clair avec de brèves explications techniques.',
    robotics: 'Tu es un expert en robotique et systèmes embarqués (ROS, Arduino, Raspberry Pi). Utilise un vocabulaire technique précis.',
    tutor: 'Tu es un tuteur pédagogue patient. Explique étape par étape, pose des questions pour vérifier la compréhension.',
    concis: 'Réponds en 1 à 3 phrases maximum. Sois direct, pas de contexte superflu.'
  };
  var TRIGGER = 0.9;            // TokenBudget(trigger_ratio=0.9)
  var DEMO = { session: 'default', scenario: '', maxTokens: 500, keepLast: 6 };

  var EX = 'ex', TEST = 'test', REAL = 'real';
  var ORIGIN = {
    ex: ['réponse d\'exemple', 'Écrite à la main pour la démo. Aucun modèle ne l\'a générée.'],
    test: ['exemple des tests du dépôt', 'Valeur utilisée dans tests/test_store.py. Pas générée ici.'],
    real: ['réponse réelle enregistrée', 'Réponse de qwen3:8b relevée dans doc/work/model_benchmark.md (1er nov. 2026). Rejouée, pas générée ici.']
  };
  var FREE_REPLY = 'Réponse d\'exemple : aucun modèle ne tourne dans cette page.';

  // Conversation guidée. Les messages sont fictifs, sauf mention contraire.
  var SCRIPT = [
    { u: 'Bonjour. Je prépare l\'ouverture de notre boutique en ligne. La date retenue est le 14 mars 2027.',
      a: 'C\'est noté : ouverture le 14 mars 2027. Pour bien préparer cette date, il nous faut trois choses : un budget publicité, un moyen de paiement qui marche, et un plan pour la dernière semaine. Par quoi voulez-vous commencer ?',
      note: 'Premier tour. Les deux messages sont écrits tout de suite dans la base (onglet « Base SQLite »). Le message contient une date : score 2, important.' },
    { u: 'merci', a: 'Avec plaisir. Dites-moi la suite.',
      note: '« merci » ne porte aucune information : score 0. Il reste dans la base, mais il sera écarté avant un résumé.' },
    { u: 'Le budget publicité est de 1 500 euros. Décision prise avec l\'équipe.',
      a: 'Budget publicité : 1 500 euros, validé par l\'équipe. Je vous propose de le partager en deux : une moitié avant l\'ouverture pour faire connaître la boutique, l\'autre moitié la première semaine pour relancer les visiteurs qui n\'ont pas commandé.',
      note: 'Un chiffre et le mot « décision » : score 2. Regardez la jauge : le budget de tokens se remplit.' },
    { u: 'Il y a un problème : le paiement mobile échoue une fois sur trois.',
      a: 'Compris. Un paiement mobile qui échoue une fois sur trois, c\'est le point à corriger en premier : un client qui n\'arrive pas à payer ne revient pas. Les causes les plus courantes sont un délai d\'attente trop court chez le prestataire, un numéro mal saisi, ou un message d\'erreur que le client ne comprend pas. Voulez-vous une liste de points à vérifier ?',
      note: 'Le mot « problème » donne un score 2. La réponse est longue : la jauge monte vite.' },
    { u: 'oui',
      a: 'Voici la liste. Un : mesurer le délai de réponse du prestataire aux heures de pointe. Deux : vérifier le format du numéro avant d\'envoyer la demande. Trois : afficher un message clair quand le paiement échoue, avec un bouton pour réessayer. Quatre : noter chaque échec dans un journal pour voir s\'il vient toujours du même opérateur.',
      note: '« oui » : encore un score 0. La jauge a dépassé la moitié du budget.' },
    { u: 'Propose-moi un plan pour la dernière semaine.',
      a: 'Voici un plan simple. Lundi et mardi : corriger le paiement mobile et le tester avec les trois opérateurs. Mercredi : passer une commande complète, du panier à la livraison. Jeudi : lancer la première moitié de la publicité. Vendredi : relire les pages, vérifier les prix et prévenir l\'équipe. Samedi : repos, sauf urgence.',
      note: 'Avec cette réponse, la liste dépasse le seuil de 90 %. Le contrôle se fait au début du tour suivant.' },
    { u: 'Quelle heure est-il ?', a: '14:30', v: true, o: TEST,
      note: 'Deux choses ici. Le seuil était dépassé : les 7 plus anciens messages sont remplacés par un résumé (détail dans l\'onglet « Journal »). Et ce tour passe par un outil, l\'horloge : ses deux lignes sont enregistrées avec volatile = 1.' },
    { u: 'What is the capital of Benin?', a: 'The capital of Benin is Porto-Novo.', o: REAL,
      note: 'Question du banc d\'essai du projet. La réponse affichée est celle que qwen3:8b a vraiment donnée ce jour-là. Elle est rejouée, pas générée ici.' },
    { u: 'Rappelle-moi la date d\'ouverture et le budget.',
      a: 'Ouverture le 14 mars 2027. Budget publicité : 1 500 euros.',
      note: 'Fin du scénario. Cliquez sur « Fermer et relancer » : l\'historique revient du disque, sans le tour de l\'horloge et sans le résumé.' }
  ];

  /* ───────────── état ───────────── */

  var KEY = 'sensai-demo-v1';
  var store, cfg, messages, step, nComp;
  var chatCount = 0;

  function load() {
    try {
      var raw = JSON.parse(localStorage.getItem(KEY));
      if (raw && raw.store && raw.cfg && Array.isArray(raw.store.messages)) return raw;
    } catch (e) { /* stockage indisponible : on repart de zéro */ }
    return null;
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify({ store: store.dump(), cfg: cfg, step: step })); }
    catch (e) { /* tant pis : la démo marche sans */ }
  }
  function now() { return new Date().toISOString().slice(0, 19).replace('T', ' '); }  // CURRENT_TIMESTAMP

  /* ───────────── petits outils d'affichage ───────────── */

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function short(s, n) { s = s.replace(/\s+/g, ' '); return s.length > n ? s.slice(0, n - 1) + '…' : s; }
  var SCORE = ['score 0 · remplissage', 'score 1 · normal', 'score 2 · important'];
  var ROLE = { user: 'utilisateur', assistant: 'assistant', system: 'système' };

  function log(text, cls) {
    var t = $('log'), s = el('span', cls || '', text + '\n');
    t.appendChild(s);
    while (t.childNodes.length > 400) t.removeChild(t.firstChild);
    t.scrollTop = t.scrollHeight;
  }
  function status(text) { $('status').textContent = text; }

  /* ───────────── fil de discussion ───────────── */

  function chatSep(text) {
    var c = $('chat');
    Array.prototype.forEach.call(c.children, function (n) { n.classList.add('is-old'); });
    c.appendChild(el('div', 'sep', text));
    trimChat(); c.scrollTop = c.scrollHeight;
  }
  function chatMsg(role, content, volatile, origin) {
    var c = $('chat'), m = el('div', 'msg msg--' + role);
    m.appendChild(el('span', 'msg__who', ROLE[role]));
    m.appendChild(el('p', 'msg__txt', content));
    var tags = el('div', 'msg__tags');
    var nt = C.estimateTokens(content);
    tags.appendChild(el('span', 'tag', '≈ ' + nt + (nt > 1 ? ' tokens' : ' token')));
    var sc = C.importanceScore({ role: role, content: content });
    tags.appendChild(el('span', 'tag tag--s' + sc, SCORE[sc]));
    if (volatile) tags.appendChild(el('span', 'tag tag--vol', 'volatile'));
    if (origin) {
      var o = el('span', 'tag tag--' + origin, ORIGIN[origin][0]);
      o.title = ORIGIN[origin][1];
      tags.appendChild(o);
    }
    m.appendChild(tags);
    c.appendChild(m);
    trimChat(); c.scrollTop = c.scrollHeight;
  }
  function trimChat() {
    var c = $('chat');
    while (c.children.length > 160) c.removeChild(c.firstChild);
  }

  /* ───────────── panneaux ───────────── */

  function kindOf(m, i) {
    if (m.role !== 'system') return null;
    if (m.content.indexOf('Summary of earlier conversation:\n') === 0) return ['résumé · M2', 'sum'];
    if (m.content.indexOf('User profile (persisted preferences and instructions):\n') === 0) return ['profil · M1', 'prof'];
    if (i === 0) return ['prompt système · sensai.toml', 'sys'];
    return ['système', 'sys'];
  }

  function renderPrompt() {
    var box = $('prompt'), frag = document.createDocumentFragment();
    messages.forEach(function (m, i) {
      var b = el('div', 'pm pm--' + m.role), k = kindOf(m, i);
      var head = el('div', 'pm__head');
      head.appendChild(el('span', 'pm__role', m.role));
      if (k) { b.classList.add('pm--' + k[1]); head.appendChild(el('span', 'pm__kind', k[0])); }
      head.appendChild(el('span', 'pm__tok', '≈ ' + C.estimateTokens(m.content)));
      b.appendChild(head);
      b.appendChild(el('pre', 'pm__txt', m.content));
      frag.appendChild(b);
    });
    if (!messages.length) frag.appendChild(el('p', 'empty', 'La liste est vide.'));
    box.textContent = '';
    box.appendChild(frag);
  }

  function renderDb() {
    var tb = $('db-rows'), frag = document.createDocumentFragment();
    store.messages.slice(-80).forEach(function (r) {
      var tr = el('tr', (r.session_id === cfg.session ? 'is-on' : '') + (r.volatile ? ' is-vol' : ''));
      tr.appendChild(el('td', 'num', String(r.id)));
      tr.appendChild(el('td', '', r.session_id));
      tr.appendChild(el('td', '', r.role));
      var td = el('td', 'txt', short(r.content, 90)); td.title = r.content; tr.appendChild(td);
      tr.appendChild(el('td', 'num', String(r.volatile)));
      frag.appendChild(tr);
    });
    tb.textContent = '';
    tb.appendChild(frag);
    $('db-empty').hidden = store.messages.length > 0;
    $('db-more').hidden = store.messages.length <= 80;

    var pb = $('prof-rows'); pb.textContent = '';
    store.getProfile().forEach(function (p) {
      var tr = el('tr'); tr.appendChild(el('td', '', p[0])); tr.appendChild(el('td', 'txt', p[1])); pb.appendChild(tr);
    });
    $('prof-empty').hidden = store.profile.length > 0;
  }

  function renderStats() {
    var tok = C.countTokens(messages), thr = cfg.maxTokens * TRIGGER;
    var pct = Math.min(100, tok / cfg.maxTokens * 100);
    $('meter-fill').style.width = pct.toFixed(1) + '%';
    $('meter').classList.toggle('is-hot', tok >= thr);
    $('meter-txt').textContent = tok + ' / ' + cfg.maxTokens + ' tokens estimés · seuil à ' + Math.round(thr);
    $('st-tok').textContent = tok;
    $('st-mem').textContent = messages.length;
    $('st-disk').textContent = store.messages.length;
    $('st-comp').textContent = nComp;
    $('cmd').textContent = 'python main.py chat --session ' + cfg.session + (cfg.scenario ? ' --scenario ' + cfg.scenario : '');
    $('next').disabled = step >= SCRIPT.length;
    $('next').textContent = step >= SCRIPT.length ? 'Scénario terminé' : 'Message suivant (' + (step + 1) + '/' + SCRIPT.length + ')';
  }

  function renderAll() { renderPrompt(); renderDb(); renderStats(); }

  /* ───────────── actions ───────────── */

  // Début de cli.run() : on relit le disque.
  function launch(why) {
    var all = store.loadHistory(cfg.session, true).length;
    messages = C.startRun(store, cfg.session, SCENARIOS[cfg.scenario]);
    var kept = store.loadHistory(cfg.session).length;
    nComp = 0;
    log('$ python main.py chat --session ' + cfg.session + (cfg.scenario ? ' --scenario ' + cfg.scenario : ''), 't-in');
    log('load_history("' + cfg.session + '") → ' + kept + ' message' + (kept > 1 ? 's' : '') +
        (all > kept ? '  (' + (all - kept) + ' volatils laissés de côté)' : ''), all > kept ? 't-ok' : '');
    log('get_profile() → ' + (store.profile.length ? store.profile.length + ' entrée(s), injectées en message système' : 'vide, rien à injecter'));
    log('max_tokens = ' + cfg.maxTokens + ' · seuil = ' + TRIGGER + ' × ' + cfg.maxTokens + ' = ' + Math.round(cfg.maxTokens * TRIGGER) + ' · keep_last = ' + cfg.keepLast, 't-dim');
    chatSep((why || 'Programme lancé') + ' · session « ' + cfg.session + ' » · ' + kept + ' message' + (kept > 1 ? 's' : '') + ' relu' + (kept > 1 ? 's' : '') + ' sur le disque' +
            (all > kept ? ' · ' + (all - kept) + ' volatils ignorés' : ''));
    save(); renderAll();
  }

  // Résumeur de remplacement : le vrai demande le résumé au modèle.
  function stubSummary(turns) {
    return '[Exemple de résumé, non généré]\n' +
      turns.map(function (t) { return '- ' + short(t.content, 40); }).join('\n');
  }

  function turn(line, reply, volatile, origin) {
    var b = C.beginTurn(messages, line, { maxTokens: cfg.maxTokens, keepLast: cfg.keepLast }, stubSummary);
    var info = b.info, thr = Math.round(cfg.maxTokens * TRIGGER);
    chatMsg('user', line, volatile, null);
    log('> ' + short(line, 70), 't-in');
    log('count_tokens(messages) = ' + info.tokensBefore + ' · seuil = ' + thr);
    if (!info.triggered) log('needs_compression → False', 't-dim');
    else {
      log('needs_compression → True', 't-err');
      var p = info.plan;
      if (p.noop) log('compress_history(keep_last=' + cfg.keepLast + ') : pas plus de ' + cfg.keepLast + ' tours, rien à condenser', 't-dim');
      else {
        nComp++;
        log('compress_history(keep_last=' + cfg.keepLast + ') : ' + p.toCompress.length + ' anciens tours, ' + p.recent.length + ' gardés mot pour mot');
        p.dropped.forEach(function (t) { log('  écarté (score 0) : ' + t.role + ' « ' + short(t.content, 40) + ' »', 't-dim'); });
        if (info.summaryPrompt) {
          log('  ' + p.meaningful.length + ' tours envoyés au résumeur. Demande exacte du projet :');
          log(info.summaryPrompt.split('\n').map(function (l) { return '  │ ' + l; }).join('\n'), 't-dim');
          log('  → ici, pas de modèle : un résumé d\'exemple prend sa place', 't-ok');
        } else log('  tout était du remplissage : aucun résumé, les anciens tours sont retirés', 't-dim');
        log('après compression : ' + info.tokensAfter + ' tokens estimés', 't-ok');
      }
    }
    messages = C.endTurn(store, cfg.session, b.messages, line, reply, volatile, now());
    chatMsg('assistant', reply, volatile, origin);
    var v = volatile ? 'True' : 'False';
    log('save_turn("' + cfg.session + '", "user", …, volatile=' + v + ')', volatile ? 't-ok' : 't-dim');
    log('save_turn("' + cfg.session + '", "assistant", …, volatile=' + v + ')', volatile ? 't-ok' : 't-dim');
    save(); renderAll();
    return info;
  }

  $('next').addEventListener('click', function () {
    if (step >= SCRIPT.length) return;
    var s = SCRIPT[step++];
    var info = turn(s.u, s.a, !!s.v, s.o || EX);
    $('note').textContent = s.note;
    status(info.triggered && !info.plan.noop ? 'Compression faite' : 'Tour enregistré');
  });

  $('composer').addEventListener('submit', function (e) {
    e.preventDefault();
    var inp = $('line'), line = inp.value.trim();     // validate_input : entrée vide refusée
    if (!line) { status('Message vide : refusé, comme dans le projet'); return; }
    if (line.charAt(0) === '/') { status('Les commandes « / » ne passent pas par la mémoire : non reprises ici'); return; }
    var vol = $('vol').checked;
    var info = turn(line, FREE_REPLY, vol, EX);
    inp.value = ''; $('vol').checked = false;
    var sc = C.importanceScore({ role: 'user', content: line });
    $('note').textContent = 'Votre message : ' + SCORE[sc] + ', ≈ ' + C.estimateTokens(line) + ' tokens' +
      (vol ? ', enregistré comme volatile' : '') + '. ' +
      (info.triggered && !info.plan.noop ? 'Le seuil était dépassé : compression faite.' : 'La réponse affichée est un texte fixe : aucun modèle ne tourne ici.');
    status(info.triggered && !info.plan.noop ? 'Compression faite' : 'Tour enregistré');
  });

  $('restart').addEventListener('click', function () {
    launch('Programme fermé puis relancé');
    $('note').textContent = 'La liste en mémoire a été reconstruite depuis la base. Les tours volatils n\'y sont plus. Le résumé non plus : la compression ne s\'écrit jamais sur le disque.';
    status('Relancé');
  });

  $('reset').addEventListener('click', function () {
    store = new C.SessionStore();
    cfg = Object.assign({}, DEMO); step = 0;
    $('chat').textContent = ''; $('log').textContent = '';
    syncControls(); launch('Base vidée');
    $('note').textContent = 'Base vide, réglages de la démo. Cliquez sur « Message suivant ».';
    status('Prêt');
  });

  function onSetting() {
    cfg.session = $('session').value;
    cfg.scenario = $('scenario').value;
    cfg.maxTokens = +$('maxtok').value;
    cfg.keepLast = +$('keep').value;
    launch('Relancé avec de nouveaux réglages');
    $('note').textContent = 'Ces réglages sont lus au lancement. Le programme a donc été relancé : l\'historique revient du disque.';
    status('Relancé');
  }
  ['session', 'scenario', 'maxtok', 'keep'].forEach(function (id) { $(id).addEventListener('change', onSetting); });

  $('prof-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var k = $('pkey').value.trim(), v = $('pval').value.trim();
    if (!k || !v) { status('Il faut une clé et une valeur'); return; }
    var had = store.profile.some(function (p) { return p.key === k; });
    store.setProfileValue(k, v);
    log('set_profile_value("' + k + '", "' + short(v, 40) + '")  ' + (had ? '→ valeur remplacée' : '→ nouvelle ligne'), 't-ok');
    $('pkey').value = ''; $('pval').value = '';
    save(); renderAll();
    $('note').textContent = 'Profil enregistré dans la base. Il est lu au lancement : cliquez sur « Fermer et relancer » pour le voir injecté en tête de liste.';
    status('Profil enregistré');
  });

  // onglets
  var tabs = document.querySelectorAll('#tabs .chip');
  Array.prototype.forEach.call(tabs, function (t) {
    t.addEventListener('click', function () {
      Array.prototype.forEach.call(tabs, function (o) {
        var on = o === t;
        o.setAttribute('aria-pressed', on ? 'true' : 'false');
        $(o.getAttribute('data-pane')).hidden = !on;
      });
    });
  });

  function syncControls() {
    function ensure(sel, val, label) {
      var s = $(sel), i;
      for (i = 0; i < s.options.length; i++) if (s.options[i].value === String(val)) { s.value = String(val); return; }
      s.value = s.options[0].value; cfg[label] = sel === 'maxtok' || sel === 'keep' ? +s.value : s.value;
    }
    ensure('session', cfg.session, 'session');
    ensure('scenario', cfg.scenario, 'scenario');
    ensure('maxtok', cfg.maxTokens, 'maxTokens');
    ensure('keep', cfg.keepLast, 'keepLast');
  }

  /* ───────────── démarrage ───────────── */

  var saved = load();
  store = new C.SessionStore(saved ? saved.store : null);
  cfg = Object.assign({}, DEMO, saved ? saved.cfg : null);
  step = saved && saved.step >= 0 ? Math.min(saved.step, SCRIPT.length) : 0;
  nComp = 0;
  syncControls();
  launch(saved && store.messages.length ? 'Page rechargée : programme relancé' : 'Programme lancé');
  if (saved && store.messages.length) {
    $('note').textContent = 'Votre base de la dernière visite a été retrouvée dans ce navigateur. « Tout effacer » repart de zéro.';
  }
})();
