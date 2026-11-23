/* SensAI — cœur de la démo.
   Réécriture en JavaScript de la partie « Memory & Persona » du projet (Python) :
   memory/store.py (M1), memory/budget.py (M2), et les lignes de core/cli.py qui les
   branchent dans la boucle de discussion. Fonctions pures : aucune ne touche à la page.
   Marche dans le navigateur (window.SensaiCore) et sous node (require). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SensaiCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ───────────── M2 — budget de tokens (memory/budget.py) ───────────── */

  var CHARS_PER_TOKEN = 4;

  // len() de Python compte des caractères Unicode, pas des unités UTF-16.
  function pyLen(text) {
    var n = 0, i, c;
    for (i = 0; i < text.length; i++) {
      c = text.charCodeAt(i);
      if (c >= 0xD800 && c <= 0xDBFF && i + 1 < text.length) {
        var d = text.charCodeAt(i + 1);
        if (d >= 0xDC00 && d <= 0xDFFF) i++;
      }
      n++;
    }
    return n;
  }

  // estimate_tokens : max(1, len(text) // 4)
  function estimateTokens(text) {
    return Math.max(1, Math.floor(pyLen(text) / CHARS_PER_TOKEN));
  }

  // count_tokens : somme sur tous les messages
  function countTokens(messages) {
    var s = 0, i;
    for (i = 0; i < messages.length; i++) s += estimateTokens(messages[i].content);
    return s;
  }

  // Les classes \s, \d, \w et \b de Python (chaînes Unicode) ne sont pas celles de JavaScript.
  // On les réécrit pour obtenir exactement les mêmes réponses.
  var WS = '\\t\\n\\v\\f\\r\\x1c-\\x1f \\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000';
  var W = '\\p{L}\\p{N}_';
  var B = '(?:(?<=[' + W + '])(?![' + W + '])|(?<![' + W + '])(?=[' + W + ']))';
  var D = '\\p{Nd}';

  // _FILLER_PATTERNS : tours courts sans information.
  var FILLER = new RegExp(
    '^[' + WS + ']*(ok|okay|oui|non|merci|thanks|sure|yes|no|d\'accord|cool|super' +
    '|bien|parfait|alright|got it|je vois|je comprends|ça marche' +
    '|c\'est bon|continue|vas-y|go|noted|ok\\.|ok !)[' + WS + ']*$', 'iu');

  // _IMPORTANT_SIGNALS : chiffres, décisions, problèmes…
  var IMPORTANT = new RegExp(
    D + '{4}|' +
    B + D + '+[' + WS + ',]*' + D + '*' + B + '|' +
    B + '(donc|décision|important|retenir|note|rappelle|remember|' +
    'critique|deadline|objectif|goal|résultat|résoudre|problème|' +
    'error|erreur|bug|fix|solution|conclusion|résumé)' + B, 'iu');

  // Python traite « ı » et « İ » comme un « i » quand la casse est ignorée ; JavaScript non.
  function foldI(text) { return text.replace(/[ıİ]/g, 'i'); }

  // _importance_score : 0 = remplissage, 1 = normal, 2 = important.
  // (Ce filtre a été ajouté par un coéquipier au-dessus de ma compression.)
  function importanceScore(turn) {
    var content = foldI(turn.content == null ? '' : turn.content);
    if (FILLER.test(content)) return 0;
    if (IMPORTANT.test(content)) return 2;
    return 1;
  }

  // TokenBudget.needs_compression
  function needsCompression(messages, maxTokens, triggerRatio) {
    if (triggerRatio === undefined) triggerRatio = 0.9;
    return countTokens(messages) >= maxTokens * triggerRatio;
  }

  // Le découpage que fait compress_history, sans appeler le résumeur.
  function compressPlan(messages, keepLast) {
    var noop = { noop: true };
    if (messages.length <= keepLast) return noop;
    var systemMsgs = messages.filter(function (m) { return m.role === 'system'; });
    var chatMsgs = messages.filter(function (m) { return m.role !== 'system'; });
    if (chatMsgs.length <= keepLast) return noop;
    // Python : chat_msgs[:-keep_last] et chat_msgs[-keep_last:] (avec keep_last = 0, -0 vaut 0)
    var cut = keepLast === 0 ? 0 : chatMsgs.length - keepLast;
    var toCompress = chatMsgs.slice(0, cut);
    var recent = chatMsgs.slice(cut);
    var meaningful = [], dropped = [];
    toCompress.forEach(function (t) { (importanceScore(t) > 0 ? meaningful : dropped).push(t); });
    return { noop: false, systemMsgs: systemMsgs, toCompress: toCompress, recent: recent,
             meaningful: meaningful, dropped: dropped };
  }

  // compress_history : tout sauf les keep_last derniers tours devient un seul résumé.
  function compressHistory(messages, keepLast, summarize) {
    var p = compressPlan(messages, keepLast);
    if (p.noop) return messages.slice();
    if (!p.meaningful.length) return p.systemMsgs.concat(p.recent);
    var summary = { role: 'system', content: 'Summary of earlier conversation:\n' + summarize(p.meaningful) };
    return p.systemMsgs.concat([summary], p.recent);
  }

  // La demande de résumé que build_ollama_summarizer envoie au modèle (texte exact du projet).
  function summarizerPrompt(turns) {
    var transcript = turns.map(function (t) { return t.role + ': ' + t.content; }).join('\n');
    return 'Summarize the following conversation turns into a short, factual ' +
      'block. Preserve names, numbers, decisions, and commitments. Drop ' +
      'small talk and filler.\n\n' + transcript;
  }

  /* ───────────── M1 — sessions et profil (memory/store.py) ───────────── */

  // Le projet range tout dans SQLite. Ici, deux tableaux en mémoire avec les mêmes
  // colonnes et les mêmes requêtes.
  //   messages(id AUTOINCREMENT, session_id, role, content, volatile, created_at)
  //   profile(key PRIMARY KEY, value)
  function SessionStore(dump) {
    this.messages = [];
    this.profile = [];
    this.seq = 0;
    if (dump) {
      this.messages = dump.messages.map(function (r) { return Object.assign({}, r); });
      this.profile = dump.profile.map(function (r) { return Object.assign({}, r); });
      this.seq = dump.seq;
    }
  }

  SessionStore.prototype.dump = function () {
    return { messages: this.messages, profile: this.profile, seq: this.seq };
  };

  // INSERT INTO messages (session_id, role, content, volatile) VALUES (?, ?, ?, ?)
  SessionStore.prototype.saveTurn = function (sessionId, role, content, volatile, createdAt) {
    var row = { id: ++this.seq, session_id: sessionId, role: role, content: content,
                volatile: volatile ? 1 : 0, created_at: createdAt || '' };
    this.messages.push(row);
    return row;
  };

  // SELECT role, content FROM messages WHERE session_id = ? [AND volatile = 0] ORDER BY id
  SessionStore.prototype.loadHistory = function (sessionId, includeVolatile) {
    return this.messages
      .filter(function (r) { return r.session_id === sessionId && (includeVolatile || r.volatile === 0); })
      .map(function (r) { return { role: r.role, content: r.content }; });
  };

  // Ordre de SQLite (BINARY) : octets UTF-8, donc ordre des points de code.
  function cmpCodePoints(a, b) {
    var x = Array.from(a), y = Array.from(b), i, n = Math.min(x.length, y.length);
    for (i = 0; i < n; i++) {
      if (x[i] !== y[i]) return x[i].codePointAt(0) - y[i].codePointAt(0);
    }
    return x.length - y.length;
  }

  // SELECT DISTINCT session_id FROM messages ORDER BY session_id
  SessionStore.prototype.listSessions = function () {
    var seen = {}, out = [];
    this.messages.forEach(function (r) {
      if (!Object.prototype.hasOwnProperty.call(seen, r.session_id)) { seen[r.session_id] = 1; out.push(r.session_id); }
    });
    return out.sort(cmpCodePoints);
  };

  // SELECT key, value FROM profile  → liste de paires, dans l'ordre d'insertion
  SessionStore.prototype.getProfile = function () {
    return this.profile.map(function (r) { return [r.key, r.value]; });
  };

  // INSERT … ON CONFLICT(key) DO UPDATE SET value = excluded.value
  SessionStore.prototype.setProfileValue = function (key, value) {
    var i;
    for (i = 0; i < this.profile.length; i++) {
      if (this.profile[i].key === key) { this.profile[i].value = value; return; }
    }
    this.profile.push({ key: key, value: value });
  };

  // profile_to_system_message : null si le profil est vide.
  function profileToSystemMessage(profile) {
    if (!profile.length) return null;
    var lines = profile.map(function (p) { return '- ' + p[0] + ': ' + p[1]; });
    return { role: 'system',
             content: 'User profile (persisted preferences and instructions):\n' + lines.join('\n') };
  }

  /* ───────────── La boucle de discussion (core/cli.py, partie mémoire) ───────────── */

  // Début de run() : prompt système, profil, puis l'historique relu sur le disque.
  function startRun(store, sessionId, systemPrompt) {
    var history = store.loadHistory(sessionId);
    var profileMsg = profileToSystemMessage(store.getProfile());
    var sys = [];
    if (systemPrompt) sys.push({ role: 'system', content: systemPrompt });
    if (profileMsg) sys.push(profileMsg);
    return sys.concat(history);
  }

  // Première moitié d'un tour : on ajoute le message, on regarde le budget, on compresse.
  // Rend la liste exacte envoyée au modèle.
  function beginTurn(messages, line, opts, summarize) {
    var out = messages.concat([{ role: 'user', content: line }]);
    var before = countTokens(out);
    var info = { tokensBefore: before, triggered: false, plan: null, summaryPrompt: null };
    if (needsCompression(out, opts.maxTokens)) {
      info.triggered = true;
      info.plan = compressPlan(out, opts.keepLast);
      if (!info.plan.noop && info.plan.meaningful.length) info.summaryPrompt = summarizerPrompt(info.plan.meaningful);
      out = compressHistory(out, opts.keepLast, summarize);
    }
    info.tokensAfter = countTokens(out);
    return { messages: out, info: info };
  }

  // Seconde moitié : la réponse rejoint la liste, et les deux messages vont sur le disque.
  function endTurn(store, sessionId, messages, line, reply, volatile, createdAt) {
    var out = messages.concat([{ role: 'assistant', content: reply }]);
    store.saveTurn(sessionId, 'user', line, volatile, createdAt);
    store.saveTurn(sessionId, 'assistant', reply, volatile, createdAt);
    return out;
  }

  return {
    CHARS_PER_TOKEN: CHARS_PER_TOKEN,
    pyLen: pyLen,
    estimateTokens: estimateTokens,
    countTokens: countTokens,
    importanceScore: importanceScore,
    needsCompression: needsCompression,
    compressPlan: compressPlan,
    compressHistory: compressHistory,
    summarizerPrompt: summarizerPrompt,
    SessionStore: SessionStore,
    profileToSystemMessage: profileToSystemMessage,
    startRun: startRun,
    beginTurn: beginTurn,
    endTurn: endTurn
  };
});
