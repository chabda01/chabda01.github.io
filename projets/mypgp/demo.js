/* my_pgp — interface de la démo.
   Tout le calcul est dans core.js (fonctions pures, comparées au binaire C++). */
(function () {
'use strict';

var PGP = window.PGP;
var $ = function (id) { return document.getElementById(id); };
function el(tag, cls, text) {
  var e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined && text !== null) e.textContent = text;
  return e;
}

/* ───────── données d'exemple ───────── */
/* Paire RSA de 512 bits : celle des tests du dépôt (tests/run_tests.sh). */
var N512 = 'c9f91a9ff3bd6d84005b9cc8448296330bd23480f8cf8b36fd4edd0a8cd925de139a0076b962f4d57f50d6f9e64e7c41587784488f923dd60136c763fd602fb3';
var D512 = '81b08f4eb6dd8a4dd21728e5194dfc4e349829c9991c8b5e44b31e6ceee1e56a11d66ef23389be92ef7a4178470693f509c90b86d4a1e1831056ca0757f3e209';
var XOR_KEY = '576861742069732064656164206d6179206e6576657220646965';
var AES_KEY = '57696e74657220697320636f6d696e67';
var X_PRIV = '77076d0a7318a57d3c16c17251b26645df4c2f87ebc0992ab177fba51db92c2a';
var X_PUB = '8520f0098930a754748b7ddcb43ef75a0dbf3a0d26381af4eba4a98eaa9b4e6a';

var keyring = [
  { type: 'rsa', label: 'RSA 16 bits (README)', pub: '0101-19bb', priv: '9d5b-19bb' },
  { type: 'rsa', label: 'RSA 512 bits (tests du dépôt)', pub: '010001-' + N512, priv: D512 + '-' + N512 },
  { type: 'x25519', label: 'X25519 (README, RFC 7748)', pub: X_PUB, priv: X_PRIV }
];
function findPair(type, pub) {
  for (var i = keyring.length - 1; i >= 0; i--) if (keyring[i].type === type && keyring[i].pub === pub) return keyring[i];
  return null;
}

var SYSTEMS = ['xor', 'aes', 'rsa', 'x25519', 'pgp-xor', 'pgp-aes'];
function isSym(s) { return s === 'xor' || s === 'aes'; }
function isPgp(s) { return s === 'pgp-xor' || s === 'pgp-aes'; }
function isAsym(s) { return s === 'rsa' || s === 'x25519'; }

/* Les exemples du README, tels quels. */
var README = [
  { label: 'rsa -g d3 e3', s: { sys: 'rsa', mode: 'g', a: 'd3', b: 'e3' } },
  { label: 'rsa -c « WF »', s: { sys: 'rsa', mode: 'c', msg: 'WF', a: '0101-19bb' } },
  { label: 'rsa -d 8f84', s: { sys: 'rsa', mode: 'd', msg: '8f84', a: '9d5b-19bb' } },
  { label: 'xor -c -b', s: { sys: 'xor', mode: 'c', block: true, msg: 'You know nothing, Jon Snow', a: XOR_KEY } },
  { label: 'aes -c -b', s: { sys: 'aes', mode: 'c', block: true, msg: 'All men must die', a: AES_KEY } },
  { label: 'x25519 -g', s: { sys: 'x25519', mode: 'g', a: X_PRIV } },
  { label: 'pgp-aes -c -b', s: { sys: 'pgp-aes', mode: 'c', block: true, msg: 'All men must die', a: AES_KEY, b: '010001-' + N512 } }
];
/* Deux cas d'usage écrits pour cette page : textes fictifs. */
var USECASES = [
  { label: 'Fichier confidentiel', make: function () {
      return { sys: 'pgp-aes', mode: 'c', block: false,
        msg: 'CONFIDENTIEL - offre commerciale (exemple fictif)\nClient : Société Exemple SARL\nMontant : 12 500 000 FCFA\nValable jusqu\'au 30 novembre.',
        a: PGP.bytesToHex(PGP.randomBytes(32)), b: '010001-' + N512 };
    } },
  { label: 'Message à un collègue', make: function () {
      return { sys: 'x25519', mode: 'c', msg: 'Le code de la salle serveur change lundi : 4821 (exemple fictif).', a: X_PUB };
    } },
  { label: 'AES sur plusieurs blocs', make: function () {
      return { sys: 'aes', mode: 'c', block: false, msg: 'Un message plus long que seize octets est coupé en blocs.', a: AES_KEY };
    } }
];
/* Réglages de départ de chaque système. */
var DEFAULTS = {
  'xor': { c: README[3].s, d: { sys: 'xor', mode: 'd', block: true, msg: '20070f2700071c6a4449060a490515164e4e12190b190011063c', a: XOR_KEY } },
  'aes': { c: README[4].s, d: { sys: 'aes', mode: 'd', block: true, msg: '744ce22c385958348f0df26eceb62eef', a: AES_KEY } },
  'rsa': { c: README[1].s, d: README[2].s, g: README[0].s },
  'x25519': { c: { sys: 'x25519', mode: 'c', msg: 'You know nothing, Jon Snow', a: X_PUB }, g: README[5].s },
  'pgp-xor': { c: { sys: 'pgp-xor', mode: 'c', block: true, msg: 'You know nothing, Jon Snow', a: XOR_KEY, b: '010001-' + N512 } },
  'pgp-aes': { c: README[6].s }
};

var LABELS = {
  msgClear: 'Message en clair (entrée standard)',
  msgCiph: 'Message chiffré (entrée standard)',
  sym: 'Clé symétrique, en hexadécimal',
  rsaPub: 'Clé publique RSA, au format exposant-module',
  rsaPriv: 'Clé privée RSA, au format exposant-module',
  p: 'Nombre premier P, en hexadécimal petit-boutiste',
  q: 'Nombre premier Q',
  xPub: 'Clé publique du destinataire (32 octets en hexadécimal)',
  xPriv: 'Clé privée (32 octets en hexadécimal)',
  seed: 'Graine : la clé privée à utiliser (facultatif, 32 octets)',
  session: 'Clé symétrique (la clé de session), en hexadécimal',
  sessionCiph: 'Clé de session chiffrée (1re ligne de la sortie du chiffrement)'
};

/* ───────── éléments ───────── */
var sysChips = $('pg-systems'), modeChips = $('pg-modes'), blockBtn = $('pg-block');
var msgField = $('pg-msg-field'), msgLabel = $('pg-msg-label'), msgEl = $('pg-msg');
var aLabel = $('pg-a-label'), aEl = $('pg-a'), bField = $('pg-b-field'), bLabel = $('pg-b-label'), bEl = $('pg-b');
var term = $('pg-term'), statusEl = $('pg-status'), chainBtn = $('pg-chain'), runBtn = $('pg-run');
var toolKey = $('pg-tool-key'), toolSize = $('pg-tool-size'), toolPrimes = $('pg-tool-primes'), toolBits = $('pg-tool-bits'), toolSeed = $('pg-tool-seed');
var stepsEl = $('pg-steps'), ringSel = $('pg-ring'), ringField = $('pg-ring-field');
var stIn = $('pg-st-in'), stOut = $('pg-st-out'), stKey = $('pg-st-key'), stTime = $('pg-st-time');

var state = { sys: 'aes', mode: 'c', block: true, msg: '', a: '', b: '' };
var last = null;      /* dernier résultat : { state, argv, result } */
var aesRound = 0;
var timer = 0;

/* ───────── état -> page ───────── */
function setState(s, keepRound) {
  state = { sys: s.sys, mode: s.mode, block: !!s.block && !isAsym(s.sys), msg: s.msg || '', a: s.a || '', b: s.b || '' };
  msgEl.value = state.msg; aEl.value = state.a; bEl.value = state.b;
  if (!keepRound) aesRound = 0;
  syncControls();
  run();
}
function syncControls() {
  var s = state, i, chips;
  chips = sysChips.children;
  for (i = 0; i < chips.length; i++) chips[i].setAttribute('aria-pressed', chips[i].dataset.sys === s.sys ? 'true' : 'false');
  chips = modeChips.children;
  for (i = 0; i < chips.length; i++) {
    chips[i].setAttribute('aria-pressed', chips[i].dataset.mode === s.mode ? 'true' : 'false');
    if (chips[i].dataset.mode === 'g') chips[i].hidden = !isAsym(s.sys);
  }
  blockBtn.hidden = isAsym(s.sys);
  blockBtn.setAttribute('aria-pressed', s.block ? 'true' : 'false');
  msgField.hidden = s.mode === 'g';
  msgLabel.textContent = s.mode === 'd' ? LABELS.msgCiph : LABELS.msgClear;
  var la, lb = null;
  if (isSym(s.sys)) la = LABELS.sym;
  else if (s.sys === 'rsa') { la = s.mode === 'g' ? LABELS.p : s.mode === 'c' ? LABELS.rsaPub : LABELS.rsaPriv; if (s.mode === 'g') lb = LABELS.q; }
  else if (s.sys === 'x25519') la = s.mode === 'g' ? LABELS.seed : s.mode === 'c' ? LABELS.xPub : LABELS.xPriv;
  else { la = s.mode === 'c' ? LABELS.session : LABELS.sessionCiph; lb = s.mode === 'c' ? LABELS.rsaPub : LABELS.rsaPriv; }
  aLabel.textContent = la;
  bField.hidden = lb === null;
  if (lb) bLabel.textContent = lb;
  var symKeyTool = (isSym(s.sys) || isPgp(s.sys)) && (s.mode === 'c' || isSym(s.sys));
  toolKey.hidden = !symKeyTool;
  toolSize.hidden = !(symKeyTool && (s.sys === 'aes' || s.sys === 'pgp-aes'));
  toolPrimes.hidden = toolBits.hidden = !(s.sys === 'rsa' && s.mode === 'g');
  toolSeed.hidden = !(s.sys === 'x25519' && s.mode === 'g');
  fillRing();
}
/* Trousseau : les paires connues de la page, pour remplir le champ de clé. */
function fillRing() {
  var type = state.sys === 'x25519' ? 'x25519' : 'rsa', show = !isSym(state.sys) && state.mode !== 'g';
  ringField.hidden = !show;
  if (!show) return;
  ringSel.textContent = '';
  var first = el('option', null, state.mode === 'c' ? 'Choisir une clé publique…' : 'Choisir une clé privée…');
  first.value = '';
  ringSel.appendChild(first);
  keyring.forEach(function (k, i) {
    if (k.type !== type) return;
    var o = el('option', null, k.label);
    o.value = String(i);
    ringSel.appendChild(o);
  });
}

/* ───────── page -> ligne de commande ───────── */
function clean(v) { return v.replace(/\s+/g, ''); }
function buildArgv(s) {
  var argv = [s.sys, '-' + s.mode], a = clean(s.a), b = clean(s.b);
  if (s.mode === 'g') {
    if (a) argv.push(a);
    if (s.sys === 'rsa' && b) argv.push(b);
    return argv;
  }
  if (s.block) argv.push('-b');
  var key = isPgp(s.sys) ? ((a || b) ? a + ':' + b : '') : a;
  if (key) argv.push(key);
  return argv;
}

/* ───────── affichage de la sortie ───────── */
function appendOutput(parent, bytes) {
  var text = null;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(new Uint8Array(bytes)); } catch (e) { text = null; }
  var buf = '', i, c;
  function flush() { if (buf) { parent.appendChild(document.createTextNode(buf)); buf = ''; } }
  function dim(t) { flush(); parent.appendChild(el('span', 't-dim', t)); }
  if (text !== null) {
    for (i = 0; i < text.length; i++) {
      c = text.charCodeAt(i);
      if (c === 10 || c >= 32 && c !== 127) buf += text[i];
      else dim(c === 0 ? '\\0' : c === 13 ? '\\r' : c === 9 ? '\\t' : '\\x' + (c < 16 ? '0' : '') + c.toString(16));
    }
  } else {
    for (i = 0; i < bytes.length; i++) {
      c = bytes[i];
      if (c === 10 || c >= 32 && c < 127) buf += String.fromCharCode(c);
      else dim(c === 0 ? '\\0' : '\\x' + (c < 16 ? '0' : '') + c.toString(16));
    }
  }
  flush();
}
function fmtMs(ms) { return ms < 10 ? ms.toFixed(1).replace('.', ',') + ' ms' : Math.round(ms) + ' ms'; }
function bitLen(n) { return n.toString(2).length; }

function run() {
  clearTimeout(timer); timer = 0;
  var s = { sys: state.sys, mode: state.mode, block: state.block, msg: state.msg, a: state.a, b: state.b };
  var argv = buildArgv(s), stdin = s.mode === 'g' ? [] : PGP.utf8Encode(s.msg + '\n');
  var t0 = performance.now(), res;
  try { res = PGP.run(argv, stdin); }
  catch (e) { res = { code: 84, stdout: [], stderr: 'erreur de la page : ' + e.message + '\n', trace: null }; }
  var dt = performance.now() - t0;
  last = { state: s, argv: argv, result: res };

  term.textContent = '';
  term.appendChild(el('span', 't-dim', '$> '));
  term.appendChild(el('span', 't-in', PGP.commandLine(argv, s.mode === 'g' ? null : s.msg) + '\n'));
  if (res.code === 0) appendOutput(term, res.stdout);
  else term.appendChild(el('span', 't-err', res.stderr));
  term.appendChild(el('span', 't-dim', '[code de sortie ' + res.code + ']'));

  statusEl.textContent = res.code === 0 ? 'Terminé en ' + fmtMs(dt) : 'Refusé, comme le ferait le programme (code 84)';
  stIn.textContent = s.mode === 'g' ? '–' : String(stdin.length - 1);
  stOut.textContent = res.code === 0 ? String(res.stdout.length) : '–';
  stKey.textContent = keyBits(res.trace);
  stTime.textContent = fmtMs(dt);

  if (res.code === 0 && s.mode === 'g') rememberPair(s, res);
  var canChain = res.code === 0 && s.mode !== 'd';
  chainBtn.disabled = !canChain;
  chainBtn.textContent = s.mode === 'g' ? 'Chiffrer avec cette clé publique' : 'Déchiffrer cette sortie';
  renderSteps(res, s);
}
function keyBits(t) {
  if (!t || !t.kind) return '–';
  if (t.kind === 'xor' || t.kind === 'aes') return String(t.key.length * 8);
  if (t.kind === 'rsa-gen' || t.kind === 'rsa-c' || t.kind === 'rsa-d') return String(bitLen(t.n));
  if (t.kind === 'pgp') return (t.symKey ? t.symKey.length * 8 : '?') + ' + ' + (t.rsa && t.rsa.n !== undefined ? bitLen(t.rsa.n) : '?');
  return '255';
}
function parsePair(res) {
  var lines = String.fromCharCode.apply(null, res.stdout).split('\n');
  return { pub: lines[0].replace('public key: ', ''), priv: lines[1].replace('private key: ', '') };
}
function rememberPair(s, res) {
  var p = parsePair(res);
  if (findPair(s.sys, p.pub)) return;
  var count = keyring.filter(function (k) { return k.generated; }).length + 1;
  keyring.push({ type: s.sys, label: (s.sys === 'rsa' ? 'RSA' : 'X25519') + ' générée ici n° ' + count, pub: p.pub, priv: p.priv, generated: true });
  if (keyring.length > 12) keyring.splice(3, 1);
}

/* ───────── enchaîner : la sortie devient l'entrée de la commande suivante ───────── */
function chainState(l) {
  var s = l.state, out = String.fromCharCode.apply(null, l.result.stdout).replace(/\n$/, ''), pair;
  if (l.result.code !== 0) return null;
  if (s.mode === 'g') {
    var p = parsePair(l.result);
    return { sys: s.sys, mode: 'c', msg: DEFAULTS[s.sys].c.msg, a: p.pub };
  }
  if (s.mode !== 'c') return null;
  if (isSym(s.sys)) return { sys: s.sys, mode: 'd', block: s.block, msg: out, a: clean(s.a) };
  if (isAsym(s.sys)) {
    pair = findPair(s.sys, clean(s.a));
    return { sys: s.sys, mode: 'd', msg: out, a: pair ? pair.priv : '', missing: !pair };
  }
  var lines = out.split('\n');
  pair = findPair('rsa', clean(s.b));
  return { sys: s.sys, mode: 'd', block: s.block, msg: lines[1] || '', a: lines[0], b: pair ? pair.priv : '', missing: !pair };
}
function chain() {
  if (timer) { state.msg = msgEl.value; state.a = aEl.value; state.b = bEl.value; run(); }
  if (!last) return;
  var next = chainState(last);
  if (!next) return;
  setState(next);
  if (next.missing) statusEl.textContent = 'Clé privée inconnue de la page : collez-la dans le champ de clé.';
}
function defaultState(sys, mode) {
  var d = DEFAULTS[sys];
  if (d[mode]) return d[mode];
  /* pas d'exemple de déchiffrement tout prêt : on chiffre l'exemple, puis on enchaîne */
  var c = d.c, res = PGP.run(buildArgv(c), PGP.utf8Encode(c.msg + '\n'));
  return chainState({ state: c, result: res }) || c;
}

/* ───────── étapes internes ───────── */
function hx(b) { return (b < 16 ? '0' : '') + b.toString(16); }
function fmtBig(n) {
  var bits = bitLen(n);
  if (bits <= 50) return n.toString(10) + '  (0x' + n.toString(16) + ')';
  var h = n.toString(16);
  if (h.length > 40) h = h.slice(0, 18) + '…' + h.slice(-18);
  return '0x' + h + '  (' + bits + ' bits)';
}
function shortHex(bytes) {
  var h = PGP.bytesToHex(bytes);
  return h.length > 64 ? h.slice(0, 30) + '…' + h.slice(-30) : h;
}
function row(dl, name, value, note) {
  var d = el('div', 'pg-kv');
  d.appendChild(el('dt', null, name));
  var dd = el('dd', 'mono', value);
  if (note) dd.appendChild(el('small', null, note));
  d.appendChild(dd);
  dl.appendChild(d);
}
function title(parent, text) { parent.appendChild(el('h3', 'pg-h', text)); }
function para(parent, text, cls) { parent.appendChild(el('p', cls || 'pg-p', text)); }

function grid(stateBytes, prev, caption) {
  var f = el('figure', 'pg-state'), g = el('div', 'pg-grid');
  for (var r = 0; r < 4; r++)
    for (var c = 0; c < 4; c++) {
      var v = stateBytes[r + 4 * c], cell = el('span', null, hx(v));
      if (prev && prev[r + 4 * c] !== v) cell.className = 'is-new';
      g.appendChild(cell);
    }
  f.appendChild(g);
  f.appendChild(el('figcaption', null, caption));
  return f;
}
function aesGroups(steps) {
  var groups = [];
  steps.forEach(function (st, i) {
    var gLast = groups[groups.length - 1];
    if (!gLast || gLast.round !== st.round) { gLast = { round: st.round, items: [] }; groups.push(gLast); }
    gLast.items.push({ op: st.op, state: st.state, prev: i > 0 ? steps[i - 1].state : null });
  });
  return groups;
}
function renderAes(parent, t) {
  if (!t.steps) return;
  var groups = aesGroups(t.steps), nb = t.blockCount || 1;
  title(parent, 'AES-' + t.key.length * 8 + ' : ' + t.rounds + ' tours sur un état de 4 × 4 octets');
  para(parent, (nb > 1 ? 'Le message fait ' + nb + ' blocs de 16 octets (le dernier est complété par des zéros). Voici le premier. ' : '') +
    'Les 16 octets du bloc remplissent la grille colonne par colonne. Une case dorée a changé à cette étape.');
  var dl = el('dl', 'pg-dl');
  row(dl, 'Clé tapée', PGP.bytesToHex(t.key));
  row(dl, 'Clé lue par AES', PGP.bytesToHex(t.internalKey), ' chaque mot de 4 octets est retourné (convention petit-boutiste du sujet)');
  parent.appendChild(dl);

  var nav = el('div', 'pg-nav');
  var prevB = el('button', 'chip', '◀ Tour précédent'), nextB = el('button', 'chip', 'Tour suivant ▶');
  prevB.type = nextB.type = 'button';
  var range = el('input'); range.type = 'range'; range.min = '0'; range.max = String(groups.length - 1); range.step = '1';
  range.setAttribute('aria-label', 'Étape du calcul AES');
  var lab = el('span', 'pg-nav__lab');
  nav.appendChild(prevB); nav.appendChild(range); nav.appendChild(nextB); nav.appendChild(lab);
  parent.appendChild(nav);
  var box = el('div', 'pg-states');
  parent.appendChild(box);

  function show(i) {
    aesRound = Math.max(0, Math.min(groups.length - 1, i));
    var g = groups[aesRound];
    range.value = String(aesRound);
    prevB.disabled = aesRound === 0; nextB.disabled = aesRound === groups.length - 1;
    lab.textContent = 'Tour ' + g.round + ' sur ' + t.rounds + (aesRound === 0 ? ' (départ)' : aesRound === groups.length - 1 ? ' (dernier)' : '');
    box.textContent = '';
    g.items.forEach(function (it) {
      if (it.op === 'AddRoundKey') box.appendChild(grid(t.roundKeys[g.round], null, 'clé du tour ' + g.round));
      box.appendChild(grid(it.state, it.op === 'Entrée' ? null : it.prev, it.op === 'Entrée' ? 'bloc en entrée' : it.op));
    });
  }
  range.addEventListener('input', function () { show(+range.value); });
  prevB.addEventListener('click', function () { show(aesRound - 1); });
  nextB.addEventListener('click', function () { show(aesRound + 1); });
  show(aesRound);

  var dl2 = el('dl', 'pg-dl');
  if (t.decipher) {
    row(dl2, 'Bloc tapé', PGP.bytesToHex(t.input));
    row(dl2, 'Bloc lu par AES', PGP.bytesToHex(t.raw), ' mots retournés');
    row(dl2, 'Clair retrouvé', PGP.bytesToHex(t.output));
  } else {
    row(dl2, 'Sortie d\'AES', PGP.bytesToHex(t.raw));
    row(dl2, 'Sortie affichée', PGP.bytesToHex(t.output), ' mots retournés, comme la clé');
  }
  parent.appendChild(dl2);
}
function ch(b) { return b >= 32 && b < 127 ? String.fromCharCode(b) : '·'; }
function renderXor(parent, t) {
  if (!t.input) { para(parent, 'Message vide : rien à calculer.'); return; }
  var nb = t.blockCount || 1, top = t.decipher ? t.input : t.reversed, res = t.decipher ? t.xored : t.output, n = Math.min(top.length, 48);
  title(parent, 'XOR : un bloc de la taille de la clé (' + t.key.length + ' octet' + (t.key.length > 1 ? 's' : '') + ')');
  para(parent, (t.decipher
    ? 'Chaque octet du chiffré est combiné avec l\'octet de clé de même rang. Le résultat est ensuite retourné pour retrouver le texte.'
    : 'Le bloc est d\'abord retourné (le premier caractère passe à la fin), puis chaque octet est combiné avec l\'octet de clé de même rang.') +
    (nb > 1 ? ' Le message fait ' + nb + ' blocs ; voici le premier.' : ''));
  var legend = el('div', 'pg-legend');
  [t.decipher ? 'chiffré' : 'message retourné', 'clé', t.decipher ? 'XOR (texte à l\'envers)' : 'XOR = sortie'].forEach(function (x, i) {
    legend.appendChild(el('span', 'pg-leg pg-leg--' + i, 'ligne ' + (i + 1) + ' : ' + x));
  });
  parent.appendChild(legend);
  var wrap = el('div', 'pg-bytes');
  for (var i = 0; i < n; i++) {
    var col = el('div', 'pg-col');
    col.appendChild(el('span', 'pg-c0', hx(top[i])));
    col.appendChild(el('span', 'pg-c1', hx(t.key[i])));
    col.appendChild(el('span', 'pg-c2', hx(res[i])));
    col.appendChild(el('span', 'pg-cc', ch(t.decipher ? res[i] : top[i])));
    wrap.appendChild(col);
  }
  parent.appendChild(wrap);
  if (top.length > n) para(parent, '… ' + (top.length - n) + ' octets de plus, non affichés.');
  var first = top[0], k = t.key[0];
  para(parent, 'Premier octet : ' + hx(first) + ' XOR ' + hx(k) + ' = ' + hx(first ^ k) + '. Refaire le même XOR avec la même clé redonne ' + hx(first) + ' : c\'est pour cela que la même clé sert dans les deux sens.');
}
function renderRsa(parent, t) {
  var dl = el('dl', 'pg-dl');
  if (t.kind === 'rsa-gen') {
    title(parent, 'RSA : fabriquer la paire de clés');
    row(dl, 'p', fmtBig(t.p));
    row(dl, 'q', fmtBig(t.q));
    row(dl, 'n = p × q', fmtBig(t.n), ' le module, commun aux deux clés ; affiché ' + shortHex(PGP.hexToBytes(PGP.bigToLEHex(t.n))));
    row(dl, 'λ = ppcm(p−1, q−1)', fmtBig(t.lambda));
    row(dl, 'e', fmtBig(t.e), ' le plus grand de 65537, 257, 17, 5, 3 qui n\'a aucun diviseur commun avec λ');
    row(dl, 'd = e⁻¹ mod λ', fmtBig(t.d), ' l\'exposant privé : e × d laisse un reste de 1 quand on divise par λ');
    parent.appendChild(dl);
    para(parent, 'La clé publique est « e-n », la clé privée « d-n ». Chaque nombre est écrit octet de poids faible en premier : 0xbb19 s\'affiche 19bb.');
    para(parent, 'Le programme ne vérifie pas que P et Q sont premiers. S\'ils ne le sont pas, les clés sortent quand même, mais le déchiffrement est faux.', 'pg-p pg-warn');
  } else if (t.kind === 'rsa-c') {
    title(parent, 'RSA : chiffrer avec la clé publique');
    row(dl, 'm', fmtBig(t.m), ' les octets du message lus comme un seul nombre, premier caractère = poids faible');
    row(dl, 'e', fmtBig(t.e));
    row(dl, 'n', fmtBig(t.n));
    row(dl, 'c = mᵉ mod n', fmtBig(t.c), ' affiché en hexadécimal petit-boutiste');
    parent.appendChild(dl);
    if (t.wraps) para(parent, 'Attention : le message est un nombre plus grand que n. Le calcul « boucle » (m mod n) et le déchiffrement ne redonnera pas le texte. Il faut une clé plus longue. Le programme d\'origine se comporte de la même façon.', 'pg-p pg-warn');
  } else {
    title(parent, 'RSA : déchiffrer avec la clé privée');
    row(dl, 'c', fmtBig(t.c));
    row(dl, 'd', fmtBig(t.d));
    row(dl, 'n', fmtBig(t.n));
    row(dl, 'm = cᵈ mod n', fmtBig(t.m), ' ce nombre, relu octet par octet, redonne le texte');
    parent.appendChild(dl);
  }
}
function renderX(parent, t) {
  var dl = el('dl', 'pg-dl');
  if (t.kind === 'x-gen') {
    title(parent, 'X25519 : fabriquer la paire de clés');
    row(dl, 'Clé privée', PGP.bytesToHex(t.priv), t.random ? ' 32 octets tirés au hasard par le navigateur' : ' la graine donnée');
    row(dl, 'Clé publique', PGP.bytesToHex(t.pub), ' clé privée × le point de base de la courbe (u = 9)');
    parent.appendChild(dl);
    para(parent, 'Multiplier un point de la courbe est facile. Retrouver le multiplicateur à partir du résultat ne l\'est pas : c\'est ce qui protège la clé privée.');
    return;
  }
  title(parent, t.kind === 'x-c' ? 'X25519 : chiffrer pour le destinataire' : 'X25519 : vérifier puis déchiffrer');
  row(dl, 'Clé éphémère publique', PGP.bytesToHex(t.ephemeralPub), t.kind === 'x-c' ? ' tirée au hasard à chaque chiffrement : la sortie change à chaque fois' : ' lue au début du message');
  row(dl, 'Secret partagé', PGP.bytesToHex(t.shared), t.kind === 'x-c' ? ' clé éphémère privée × clé publique du destinataire' : ' clé privée × clé éphémère publique : le même nombre que chez l\'expéditeur');
  if (t.encKey) row(dl, 'Clé de chiffrement', PGP.bytesToHex(t.encKey), ' HMAC-SHA256(secret, 01 + les deux clés publiques)');
  row(dl, 'Clé de contrôle', PGP.bytesToHex(t.macKey), ' HMAC-SHA256(secret, 02 + les deux clés publiques)');
  if (t.kind === 'x-c') {
    row(dl, 'Message chiffré', shortHex(t.ciphertext) || '(vide)', ' ' + t.length + ' octets, XOR avec un flux fabriqué par HMAC-SHA256');
    row(dl, 'Étiquette', PGP.bytesToHex(t.tag), ' 16 octets : HMAC-SHA256(clé de contrôle, clé éphémère + chiffré)');
  } else {
    row(dl, 'Étiquette reçue', PGP.bytesToHex(t.tag));
    row(dl, 'Étiquette recalculée', PGP.bytesToHex(t.expectedTag), t.tagOk ? ' identique : le message n\'a pas été modifié' : ' différente : mauvaise clé ou message modifié, rien n\'est déchiffré');
  }
  parent.appendChild(dl);
  if (t.kind === 'x-c') para(parent, 'La sortie tient sur une ligne : clé éphémère, message chiffré, étiquette, séparés par « : ».');
}
function renderPgp(parent, t, res) {
  var sym = t.name === 'pgp-aes' ? 'AES' : 'XOR';
  title(parent, 'Mode hybride : RSA protège la clé, ' + sym + ' protège le message');
  var lanes = el('div', 'pg-lanes');
  function lane(from, box, to) {
    var l = el('div', 'pg-lane');
    l.appendChild(el('span', 'pg-lane__io', from));
    l.appendChild(el('span', 'pg-lane__arrow', '→'));
    l.appendChild(el('span', 'pg-lane__box', box));
    l.appendChild(el('span', 'pg-lane__arrow', '→'));
    l.appendChild(el('span', 'pg-lane__io', to));
    lanes.appendChild(l);
  }
  var keyHex = t.symKey ? shortHex(t.symKey) : '?';
  if (!t.decipher) {
    lane('clé de session ' + keyHex, 'RSA, clé publique du destinataire', 'ligne 1 de la sortie');
    lane('message en clair', sym + ', clé de session', 'ligne 2 de la sortie');
  } else {
    lane('clé de session chiffrée', 'RSA, clé privée', 'clé de session ' + keyHex);
    lane('message chiffré', sym + ' inverse, clé de session', 'message en clair');
  }
  parent.appendChild(lanes);
  if (t.rsa && t.rsa.kind) {
    var sub = el('div', 'pg-sub'); renderRsa(sub, t.rsa); parent.appendChild(sub);
  }
  if (res.code === 0 && t.sym && t.sym.kind) {
    var sub2 = el('div', 'pg-sub');
    if (t.sym.kind === 'aes') renderAes(sub2, t.sym); else renderXor(sub2, t.sym);
    parent.appendChild(sub2);
  }
}
function renderSteps(res, s) {
  stepsEl.textContent = '';
  var t = res.trace;
  if (!t || !t.kind) {
    para(stepsEl, res.code === 0 ? 'Rien à détailler pour cette commande.' : 'La commande est refusée avant tout calcul. Corrigez la clé ou le message : les étapes s\'afficheront ici.');
    return;
  }
  if (t.kind === 'aes') {
    if (res.code !== 0) { para(stepsEl, 'La commande est refusée : en mode bloc (-b), AES attend exactement 16 octets.'); return; }
    renderAes(stepsEl, t);
  } else if (t.kind === 'xor') {
    if (res.code !== 0) { para(stepsEl, 'La commande est refusée : en mode bloc (-b), le message et la clé doivent avoir la même taille.'); return; }
    renderXor(stepsEl, t);
  }
  else if (t.kind.indexOf('rsa') === 0) renderRsa(stepsEl, t);
  else if (t.kind.charAt(0) === 'x') renderX(stepsEl, t);
  else if (t.kind === 'pgp') renderPgp(stepsEl, t, res);
}

/* ───────── événements ───────── */
function scheduleRun() {
  state.msg = msgEl.value; state.a = aEl.value; state.b = bEl.value;
  clearTimeout(timer);
  statusEl.textContent = 'Calcul…';
  timer = setTimeout(run, 220);   /* une seule tâche en attente : la dernière frappe gagne */
}
[msgEl, aEl, bEl].forEach(function (e) { e.addEventListener('input', scheduleRun); });
[aEl, bEl].forEach(function (e) {
  e.addEventListener('keydown', function (ev) { if (ev.key === 'Enter') { ev.preventDefault(); scheduleRun(); clearTimeout(timer); run(); } });
});
msgEl.addEventListener('keydown', function (ev) { if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) { ev.preventDefault(); state.msg = msgEl.value; run(); } });

SYSTEMS.forEach(function (sys) {
  var c = el('button', 'chip', sys);
  c.type = 'button'; c.dataset.sys = sys;
  c.addEventListener('click', function () { setState(defaultState(sys, 'c')); });
  sysChips.appendChild(c);
});
Array.prototype.forEach.call(modeChips.children, function (c) {
  c.addEventListener('click', function () {
    var mode = c.dataset.mode;
    if (mode === state.mode) return;
    /* passer à -d après un chiffrement réussi : on déchiffre ce qu'on vient de produire */
    if (last && last.result.code === 0 && ((mode === 'd' && state.mode === 'c') || (mode === 'c' && state.mode === 'g'))) { chain(); return; }
    setState(defaultState(state.sys, mode));
  });
});
blockBtn.addEventListener('click', function () { state.block = !state.block; syncControls(); run(); });
runBtn.addEventListener('click', function () { state.msg = msgEl.value; state.a = aEl.value; state.b = bEl.value; run(); });
chainBtn.addEventListener('click', chain);

toolKey.addEventListener('click', function () {
  var n;
  if (state.sys === 'aes' || state.sys === 'pgp-aes') n = +toolSize.value / 8;
  else n = state.block && state.mode === 'c' ? Math.max(1, PGP.utf8Encode(msgEl.value).length) : 8;
  state.a = PGP.bytesToHex(PGP.randomBytes(Math.min(n, 4096)));
  aEl.value = state.a; state.msg = msgEl.value; state.b = bEl.value;
  run();
});
toolPrimes.addEventListener('click', function () {
  var bits = +toolBits.value;
  statusEl.textContent = 'Recherche de deux nombres premiers…';
  toolPrimes.disabled = true;
  setTimeout(function () {   /* laisse le message s'afficher avant le calcul */
    var p = PGP.randomPrimeHex(bits), q = PGP.randomPrimeHex(bits);
    while (q === p) q = PGP.randomPrimeHex(bits);
    toolPrimes.disabled = false;
    setState({ sys: 'rsa', mode: 'g', a: p, b: q });
  }, 20);
});
toolSeed.addEventListener('click', function () { setState({ sys: 'x25519', mode: 'g', a: PGP.bytesToHex(PGP.randomBytes(32)) }); });
ringSel.addEventListener('change', function () {
  var k = keyring[+ringSel.value];
  if (ringSel.value === '' || !k) return;
  var v = state.mode === 'c' ? k.pub : k.priv;
  if (isPgp(state.sys)) { state.b = v; bEl.value = v; } else { state.a = v; aEl.value = v; }
  state.msg = msgEl.value;
  ringSel.value = '';
  run();
});

function addExamples(box, list) {
  list.forEach(function (ex) {
    var c = el('button', 'chip', ex.label);
    c.type = 'button';
    c.addEventListener('click', function () {
      setState(ex.make ? ex.make() : ex.s);
      if (window.matchMedia('(max-width: 980px)').matches) $('pg-top').scrollIntoView({ block: 'start' });
    });
    box.appendChild(c);
  });
}
addExamples($('pg-readme'), README);
addExamples($('pg-usecases'), USECASES);

if (!PGP.HAS_BIGINT) {
  $('pg-nobig').hidden = false;
  Array.prototype.forEach.call(sysChips.children, function (c) { if (!isSym(c.dataset.sys)) c.disabled = true; });
  setState(DEFAULTS.aes.c);
} else {
  setState(README[4].s);
}
})();
