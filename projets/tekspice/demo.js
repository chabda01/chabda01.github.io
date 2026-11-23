/* NanoTekSpice — interface de la démo.
   Le simulateur est dans core.js (fonctions pures, comparées au binaire C++).
   Ici : l'éditeur, le schéma dessiné automatiquement, le shell et le chronogramme. */
(function () {
'use strict';

var NTS = window.NTS, DATA = window.NTS_CIRCUITS;
var $ = function (id) { return document.getElementById(id); };
var U = NTS.U, T = NTS.T, F = NTS.F;

var stage = $('nts-stage'), editor = $('nts-src'), gutter = $('nts-gutter'), fileEl = $('nts-file');
var msgEl = $('nts-msg'), selEl = $('nts-select'), chipsEl = $('nts-chips'), hintEl = $('nts-hint');
var schemaBox = $('nts-schema'), termEl = $('nts-term'), cmdEl = $('nts-cmd'), formEl = $('nts-form');
var chronoEl = $('nts-chrono'), statusEl = $('nts-status');
var btnSim = $('nts-sim'), btnLoop = $('nts-loop'), btnPlay = $('nts-play'), btnReset = $('nts-reset'), btnRestart = $('nts-restart');
var speedEl = $('nts-speed'), speedOut = $('nts-speed-out'), autoEl = $('nts-auto');
var stTick = $('nts-tick'), stComp = $('nts-ncomp'), stLink = $('nts-nlink');

var small = (window.matchMedia && matchMedia('(pointer: coarse)').matches) || (navigator.hardwareConcurrency || 8) <= 4;

var current = null;        // exemple choisi
var circuit = null;        // circuit en cours (null si le fichier est refusé)
var layout = null;         // schéma calculé pour ce circuit
var history = [];          // valeurs à chaque tick, pour le chronogramme
var ended = false;         // « exit » tapé
var looping = false, loopAcc = 0, loopLast = 0, rafLoop = 0;
var visible = true, dirty = false, rafDraw = 0;
var scriptTimer = 0, parseTimer = 0;
var cmdHistory = [], cmdPos = 0;

function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
function cut(s, n) { return s.length > n ? s.slice(0, n - 1) + '…' : s; }
function vcls(v) { return v === T ? 'v1' : v === F ? 'v0' : 'vu'; }

/* ───────── terminal ───────── */
var termBuf = [];
function tprint(text, cls) { if (text) { termBuf.push([text, cls || '']); invalidate(); } }
function flushTerm() {
  if (!termBuf.length) return;
  var frag = document.createDocumentFragment();
  termBuf.forEach(function (c) {
    var s = document.createElement('span');
    if (c[1]) s.className = c[1];
    s.textContent = c[0];
    frag.appendChild(s);
  });
  termBuf = [];
  termEl.appendChild(frag);
  while (termEl.childNodes.length > 260) termEl.removeChild(termEl.firstChild);
  termEl.scrollTop = termEl.scrollHeight;
}
function tclear() { termBuf = []; termEl.textContent = ''; }

/* ───────── éditeur ───────── */
var gutterLines = 0, errLine = 0;
function drawGutter() {
  var n = editor.value.split('\n').length;
  if (n !== gutterLines || gutter.dataset.err !== String(errLine)) {
    var h = '';
    for (var i = 1; i <= n; i++) h += i === errLine ? '<b>' + i + '</b>\n' : i + '\n';
    gutter.innerHTML = h;
    gutterLines = n; gutter.dataset.err = String(errLine);
  }
  gutter.scrollTop = editor.scrollTop;
}
editor.addEventListener('scroll', function () { gutter.scrollTop = editor.scrollTop; }, { passive: true });

function showError(e) {
  errLine = e ? e.line : 0;
  msgEl.hidden = !e;
  msgEl.textContent = '';
  if (e) {
    var a = document.createElement('span'); a.className = 't-err'; a.textContent = 'Error: ' + e.message + '\n';
    var b = document.createElement('span'); b.className = 't-dim';
    b.textContent = (e.line ? 'Ligne ' + e.line + ' du fichier. ' : '') + 'Le programme s\'arrête avec le code 84.';
    msgEl.appendChild(a); msgEl.appendChild(b);
  }
  drawGutter();
}

/* ───────── chargement d'un fichier : comme relancer ./nanotekspice ───────── */
function fileName() {
  var changed = current && editor.value !== current.text;
  return (current ? current.file : 'circuit.nts') + (changed ? ' (modifié)' : '');
}
function restart() {
  stopLoop(true); stopScript();
  ended = false; history = [];
  tclear();
  fileEl.textContent = fileName();
  tprint('$ ./nanotekspice ' + (current ? current.file : 'circuit.nts') + '\n', 't-dim');
  try {
    circuit = NTS.parse(editor.value);
  } catch (e) {
    if (!(e instanceof NTS.NtsError)) throw e;
    circuit = null; layout = null;
    showError(e);
    tprint('Error: ' + e.message + '\n', 't-err');
    tprint('[programme terminé, code 84]\n', 't-dim');
    schemaBox.classList.add('is-off');
    setStatus('Fichier refusé');
    setEnabled();
    invalidate();
    return;
  }
  showError(null);
  schemaBox.classList.remove('is-off');
  buildSchema();
  record();
  tprint('> ');
  setStatus('Prêt — tick 0');
  setEnabled();
  invalidate();
}
function setEnabled() {
  var on = !!circuit && !ended;
  btnSim.disabled = !on || looping;
  btnLoop.disabled = !on;
  btnPlay.disabled = !on || looping || !(current && current.script && editor.value === current.text);
  cmdEl.disabled = !on || looping;
  cmdEl.placeholder = !circuit ? 'corrigez le fichier' : ended ? 'programme terminé : cliquez sur Relancer' : looping ? 'loop en cours (Ctrl+C pour arrêter)' : 'display, simulate, loop, a=1…';
  btnLoop.textContent = looping ? 'Arrêter (Ctrl+C)' : 'loop';
  btnLoop.setAttribute('aria-pressed', looping ? 'true' : 'false');
  Array.prototype.forEach.call(document.querySelectorAll('[data-cmd]'), function (b) { b.disabled = !on || looping; });
}
function setStatus(s) { statusEl.textContent = s; }

/* ───────── exécution d'une commande ───────── */
function record() {
  var vals = {};
  circuit.inputNames().forEach(function (n) { vals['i:' + n] = circuit.inputValues[n]; });
  circuit.outputs.forEach(function (n) { vals['o:' + n] = circuit.outputValues[n]; });
  history.push({ tick: circuit.tick, vals: vals });
  if (history.length > 240) history.shift();
}
function run(line, echo) {
  if (!circuit || ended) return;
  if (echo !== false) tprint(line + '\n', 't-in');
  var r = NTS.exec(circuit, line);
  tprint(r.out);
  tprint(r.err, 't-err');
  if (r.simulated) { record(); setStatus('tick ' + circuit.tick); }
  if (r.exit) {
    ended = true;
    tprint('[programme terminé, code 0]\n', 't-dim');
    setStatus('Programme terminé');
    setEnabled(); invalidate();
    return;
  }
  if (r.loop) { startLoop(); return; }
  tprint('> ');
  invalidate();
}

/* ───────── loop : simulate + display, en continu ─────────
   Le vrai programme tourne aussi vite que la machine. Ici le rythme est réglable,
   et la boucle se met en pause quand la scène n'est plus à l'écran ou que l'onglet est caché. */
function startLoop() {
  if (looping || !circuit || ended) return;
  looping = true; loopAcc = 0; loopLast = 0;
  setEnabled(); setStatus('loop en cours');
  if (visible) rafLoop = requestAnimationFrame(loopFrame);
}
function stopLoop(silent) {
  if (!looping) return;
  looping = false;
  cancelAnimationFrame(rafLoop); rafLoop = 0;
  if (!silent) { tprint('^C\n', 't-dim'); tprint('> '); setStatus('loop arrêté — tick ' + circuit.tick); }
  setEnabled(); invalidate();
}
function loopFrame(now) {
  rafLoop = 0;
  if (!looping) return;
  if (!loopLast) loopLast = now;
  var period = 1000 / (+speedEl.value || 2);
  loopAcc += Math.min(now - loopLast, 500);
  loopLast = now;
  var n = 0;
  while (loopAcc >= period && n < 3) {
    loopAcc -= period; n++;
    circuit.simulate(); record();
    tprint(circuit.display() + '\n');
  }
  if (loopAcc > period) loopAcc = 0;
  if (n) { setStatus('loop en cours — tick ' + circuit.tick); invalidate(); }
  if (visible) rafLoop = requestAnimationFrame(loopFrame);
}
function setVisible(v) {
  visible = v;
  if (looping) {
    if (v && !rafLoop) { loopLast = 0; rafLoop = requestAnimationFrame(loopFrame); setStatus('loop en cours'); }
    if (!v) { cancelAnimationFrame(rafLoop); rafLoop = 0; setStatus('loop en pause (hors écran)'); }
  }
}
if ('IntersectionObserver' in window) {
  var onScreen = true;
  new IntersectionObserver(function (es) { onScreen = es[0].isIntersecting; setVisible(onScreen && !document.hidden); }).observe(stage);
  document.addEventListener('visibilitychange', function () { setVisible(onScreen && !document.hidden); });
}

/* ───────── scénario d'un exemple : les commandes sont tapées une à une ───────── */
function stopScript() { clearTimeout(scriptTimer); scriptTimer = 0; }
function playScript() {
  if (!current || !current.script || !circuit) return;
  restart();
  var cmds = current.script.slice(), i = 0;
  (function next() {
    if (i >= cmds.length || !circuit || ended) { scriptTimer = 0; return; }
    run(cmds[i++]);
    if (!looping) scriptTimer = setTimeout(next, 420);
  })();
}

/* ───────── schéma : placement automatique ─────────
   Les sources (input, clock, true, false) à gauche, les sorties à droite,
   les portes au milieu, rangées par profondeur. */
var GATE_SYM = { and: '&', nand: '&', or: '≥1', nor: '≥1', xor: '=1', not: '1', '4081': '&', '4011': '&', '4071': '≥1', '4001': '≥1', '4030': '=1', '4069': '1' };
var INVERT = { nand: 1, nor: 1, not: 1, '4011': 1, '4001': 1, '4069': 1 };
var CHIP_ORDER = { quad: [3, 4, 10, 11], hex: [2, 4, 6, 8, 10, 12] };

function makeNode(c, idx) {
  var d = NTS.TYPES[c.type], n = { name: c.name, type: c.type, kind: d.kind, idx: idx, extra: [], pins: {}, x: 0, y: 0, level: 0 };
  var label = cut(c.name, 14);
  n.label = label;
  if (d.kind === 'source' || d.kind === 'sink') {
    n.w = Math.max(84, Math.min(170, label.length * 6.7 + 52)); n.h = 28;
  } else if (d.kind === 'gate') {
    var one = c.type === 'not';
    n.w = 56; n.top = 15; n.bh = one ? 28 : 38; n.h = n.top + n.bh;
    if (one) { n.pins[1] = [0, n.top + 14, 'l']; n.pins[2] = [n.w, n.top + 14, 'r']; }
    else { n.pins[1] = [0, n.top + 10, 'l']; n.pins[2] = [0, n.top + 28, 'l']; n.pins[3] = [n.w, n.top + 19, 'r']; }
  } else {
    var outs = c.type === '4069' ? CHIP_ORDER.hex : CHIP_ORDER.quad;
    n.rowH = c.type === '4069' ? 26 : 38; n.top = 24; n.w = 124;
    n.rows = outs.map(function (o, i) {
      var y0 = n.top + i * n.rowH, ins = d.gates[o], mid = y0 + n.rowH / 2;
      if (ins.length === 1) n.pins[ins[0]] = [0, mid, 'l'];
      else { n.pins[ins[0]] = [0, mid - 9, 'l']; n.pins[ins[1]] = [0, mid + 9, 'l']; }
      n.pins[o] = [n.w, mid, 'r'];
      return { out: o, ins: ins, y: y0, mid: mid };
    });
    n.h = n.top + outs.length * n.rowH + 6;
  }
  n.baseH = n.h;
  return n;
}
function pinPos(n, pin) {
  if (n.kind === 'source') return [n.x + n.w, n.y + 14, 'r'];
  if (n.kind === 'sink' && pin === 1) return [n.x, n.y + 14, 'l'];
  var p = n.pins[pin];
  if (p) return [n.x + p[0], n.y + p[1], p[2]];
  var k = n.extra.indexOf(pin);
  return [n.x, n.y + n.baseH + 10 + k * 14, 'l'];
}

function buildLayout(c) {
  var nodes = c.components.map(makeNode), by = {};
  nodes.forEach(function (n) { by[n.name] = n; });
  var W = NTS.wires(c);
  // broches qui n'existent pas sur le composant : dessinées à part
  W.forEach(function (w) {
    [w.a, w.b].forEach(function (e) {
      var n = by[e.name];
      if (e.role === null && n.extra.indexOf(e.pin) < 0) { n.extra.push(e.pin); n.h = n.baseH + 6 + n.extra.length * 14; }
    });
  });
  // sens des liens pour le rangement
  var edges = [];
  W.forEach(function (w) {
    var from = null, to = null;
    if (w.flow === 'ab' || (w.flow === 'none' && w.a.role === 'out' && w.b.role !== 'out')) { from = w.a; to = w.b; }
    else if (w.flow === 'ba' || (w.flow === 'none' && w.b.role === 'out' && w.a.role !== 'out')) { from = w.b; to = w.a; }
    w.from = from || w.a; w.to = to || w.b;
    if (from && from.name !== to.name) edges.push([by[from.name], by[to.name], from.pin, to.pin]);
  });
  // profondeur de chaque porte (les boucles sont coupées)
  var preds = {}, succs = {};
  nodes.forEach(function (n) { preds[n.name] = []; succs[n.name] = []; });
  edges.forEach(function (e) { preds[e[1].name].push(e); succs[e[0].name].push(e); });
  var state = {}, maxLevel = 0;
  function depth(n) {
    if (n.kind === 'source') return 0;
    if (state[n.name] === 2) return n.level;
    if (state[n.name] === 1) return 0;
    state[n.name] = 1;
    var l = 1;
    preds[n.name].forEach(function (e) { if (e[0].kind !== 'sink') l = Math.max(l, depth(e[0]) + 1); });
    state[n.name] = 2; n.level = l;
    return l;
  }
  nodes.forEach(function (n) { if (n.kind === 'gate' || n.kind === 'chip') maxLevel = Math.max(maxLevel, depth(n)); });
  nodes.forEach(function (n) { if (n.kind === 'sink') n.level = maxLevel + 1; if (n.kind === 'source') n.level = 0; });
  var cols = [];
  nodes.forEach(function (n) { (cols[n.level] = cols[n.level] || []).push(n); });
  for (var i = 0; i < cols.length; i++) cols[i] = cols[i] || [];
  // positions
  var GAPX = 62, GAPY = 16, PAD = 20, x = PAD;
  cols.forEach(function (col) {
    var w = 0; col.forEach(function (n) { w = Math.max(w, n.w); });
    col.forEach(function (n) { n.x = col === cols[0] ? x + w - n.w : x; });
    col.w = w; if (col.length) x += w + GAPX;
  });
  var totalW = x - GAPX + PAD;
  function stack() {
    var maxH = 0;
    cols.forEach(function (col) { col.hh = col.reduce(function (s, n) { return s + n.h + GAPY; }, -GAPY); maxH = Math.max(maxH, col.hh); });
    cols.forEach(function (col) {
      var y = PAD + (maxH - col.hh) / 2;
      col.forEach(function (n) { n.y = y; y += n.h + GAPY; });
    });
    return maxH;
  }
  function sortBy(col, list, mine, other, otherPin) {
    col.forEach(function (n, i) {
      var es = list[n.name], s = 0;
      es.forEach(function (e) { s += pinPos(e[other], e[otherPin])[1]; });
      n.key = es.length ? s / es.length : n.y + n.h / 2; n.ord = i;
    });
    col.sort(function (a, b) { return a.key - b.key || a.ord - b.ord; });
  }
  var contentH = stack();
  for (var pass = 0; pass < 2; pass++) {
    for (i = 1; i < cols.length; i++) { sortBy(cols[i], preds, 1, 0, 2); stack(); }
    for (i = cols.length - 2; i >= 0; i--) { sortBy(cols[i], succs, 0, 1, 3); stack(); }
  }
  contentH = stack();
  // tracé des fils
  var lane = 0, selfLane = {};
  W.forEach(function (w) {
    var A = by[w.from.name], B = by[w.to.name];
    var p = pinPos(A, w.from.pin), q = pinPos(B, w.to.pin);
    if (p[2] === 'l' && q[2] === 'r') { var t = p; p = q; q = t; t = A; A = B; B = t; }
    var d;
    if (p[2] === 'r' && q[2] === 'l') {
      if (q[0] - p[0] >= 30) {
        var dx = Math.max(24, (q[0] - p[0]) / 2);
        d = 'M' + p[0] + ' ' + p[1] + 'C' + (p[0] + dx) + ' ' + p[1] + ' ' + (q[0] - dx) + ' ' + q[1] + ' ' + q[0] + ' ' + q[1];
      } else {
        var ly, off = 12;
        if (A === B) { var k = selfLane[A.name] = (selfLane[A.name] || 0) + 1; ly = A.y - 4 - k * 5; off = 8 + k * 5; }
        else { ly = PAD + contentH + 12 + lane * 9; lane++; off = 10 + (lane % 4) * 4; }
        d = 'M' + p[0] + ' ' + p[1] + 'h' + off + 'V' + ly + 'H' + (q[0] - off) + 'V' + q[1] + 'h' + off;
      }
    } else {
      var s = p[2] === 'r' ? 1 : -1, b = 34 + Math.abs(q[1] - p[1]) / 4;
      d = 'M' + p[0] + ' ' + p[1] + 'C' + (p[0] + s * b) + ' ' + p[1] + ' ' + (q[0] + s * b) + ' ' + q[1] + ' ' + q[0] + ' ' + q[1];
    }
    w.d = d;
  });
  return { nodes: nodes, by: by, wires: W, w: Math.max(totalW, 240), h: PAD + contentH + (lane ? 14 + lane * 9 : 0) + PAD };
}

function nodeSvg(n) {
  var g = '', t = 'translate(' + n.x + ' ' + n.y + ')', i;
  if (n.kind === 'source' || n.kind === 'sink') {
    var click = n.type === 'input' || n.type === 'clock';
    g += '<g class="nd nd-' + n.type + (click ? ' nd-click' : '') + '" data-node="' + esc(n.name) + '" transform="' + t + '"' +
      (click ? ' tabindex="0" role="button"' : '') + '>';
    g += '<title>' + esc(n.type + ' ' + n.name) + '</title>';
    g += '<rect class="box" width="' + n.w + '" height="28" rx="14"/>';
    var vx = n.kind === 'sink' ? 16 : n.w - 16, tx = n.kind === 'sink' ? 32 : 12;
    g += '<circle class="led" cx="' + vx + '" cy="14" r="9"/><text class="val" x="' + vx + '" y="18" text-anchor="middle">U</text>';
    g += '<text class="nm" x="' + tx + '" y="18">' + esc(n.label) + '</text>';
    if (n.type === 'clock') g += '<path class="ico" d="M' + (n.w - 50) + ' 19h4v-9h5v9h5v-9h4"/>';
    g += '<text class="pend" x="' + (n.w - 16) + '" y="-4" text-anchor="middle"></text>';
  } else if (n.kind === 'gate') {
    g += '<g class="nd nd-gate" transform="' + t + '"><title>' + esc(n.type + ' ' + n.name) + '</title>';
    g += '<text class="cap" x="' + n.w / 2 + '" y="10" text-anchor="middle">' + esc(cut(n.name, 9)) + '</text>';
    g += gateSvg(n.type, 9, n.top, 36, n.bh, Object.keys(n.pins).map(function (p) { return n.pins[p]; }), n.w);
  } else {
    g += '<g class="nd nd-chip" transform="' + t + '"><title>' + esc('puce ' + n.type + ' ' + n.name) + '</title>';
    g += '<rect class="chip" width="' + n.w + '" height="' + n.baseH + '" rx="5"/>';
    g += '<text class="cap" x="' + n.w / 2 + '" y="15" text-anchor="middle">' + esc(n.type + ' · ' + cut(n.name, 9)) + '</text>';
    n.rows.forEach(function (r) {
      var pins = r.ins.map(function (p) { return n.pins[p]; }).concat([n.pins[r.out]]);
      g += gateSvg(n.type, 44, r.y + 4, 34, n.rowH - 8, pins, n.w);
      r.ins.forEach(function (p) { g += '<text class="pn" x="5" y="' + (n.pins[p][1] - 3) + '">' + p + '</text>'; });
      g += '<text class="pn" x="' + (n.w - 5) + '" y="' + (r.mid - 3) + '" text-anchor="end">' + r.out + '</text>';
    });
  }
  for (i = 0; i < n.extra.length; i++) {
    var y = n.baseH + 10 + i * 14;
    g += '<path class="stub" d="M0 ' + y + 'h14"/><text class="pn pn-x" x="18" y="' + (y + 3) + '">' + esc(cut(String(n.extra[i]), 8)) + ' : broche inconnue</text>';
  }
  return g + '</g>';
}
/* une porte : rectangle avec son symbole (& , ≥1 , =1 , 1) et un rond si la sortie est inversée */
function gateSvg(type, bx, by, bw, bh, pins, w) {
  var s = '', out = pins[pins.length - 1], inv = INVERT[type];
  for (var i = 0; i < pins.length - 1; i++) s += '<path class="leg" d="M0 ' + pins[i][1] + 'H' + bx + '"/>';
  s += '<path class="leg" d="M' + (bx + bw + (inv ? 7 : 0)) + ' ' + out[1] + 'H' + w + '"/>';
  s += '<rect class="gate" x="' + bx + '" y="' + by + '" width="' + bw + '" height="' + bh + '" rx="3"/>';
  if (inv) s += '<circle class="bub" cx="' + (bx + bw + 3.5) + '" cy="' + out[1] + '" r="3.5"/>';
  s += '<text class="sym" x="' + (bx + bw / 2) + '" y="' + (by + bh / 2 + 4) + '" text-anchor="middle">' + GATE_SYM[type] + '</text>';
  return s;
}

var wireEls = [], nodeEls = {};
function buildSchema() {
  try { layout = buildLayout(circuit); }
  catch (e) { if (!(e instanceof NTS.NtsError)) throw e; layout = null; schemaBox.innerHTML = '<p class="nts-empty">Circuit trop profond pour être dessiné ici.</p>'; return; }
  var L = layout, h = '<svg class="nts-svg" viewBox="0 0 ' + L.w + ' ' + L.h + '" width="' + L.w + '" height="' + L.h + '" role="img" aria-label="Schéma du circuit">';
  L.wires.forEach(function (w) {
    h += '<path class="w w-u" data-w="' + w.i + '" d="' + w.d + '"><title></title></path>';
  });
  L.nodes.forEach(function (n) { h += nodeSvg(n); });
  h += '</svg>';
  schemaBox.innerHTML = h;
  var svg = schemaBox.firstChild;
  svg.style.width = L.w + 'px'; svg.style.minWidth = Math.min(L.w, 280) + 'px';
  wireEls = Array.prototype.slice.call(svg.querySelectorAll('[data-w]'));
  nodeEls = {};
  Array.prototype.forEach.call(svg.querySelectorAll('[data-node]'), function (el) { nodeEls[el.getAttribute('data-node')] = el; });
  stComp.textContent = circuit.components.length;
  stLink.textContent = circuit.links.length;
}

function pinName(e) { return e.name + ':' + e.pin; }
function drawSchema() {
  if (!circuit || !layout) return;
  var W = null;
  if (circuit.tick > 0) { try { W = NTS.wires(circuit); } catch (e) { if (!(e instanceof NTS.NtsError)) throw e; } }
  layout.wires.forEach(function (lw, i) {
    var el = wireEls[i], w = W ? W[i] : null, dead = lw.flow === 'none';
    var v = w && w.value !== null ? w.value : U;
    el.setAttribute('class', 'w ' + (dead ? 'w-dead' : v === T ? 'w-1' : v === F ? 'w-0' : 'w-u'));
    el.firstChild.textContent = pinName(lw.from) + ' → ' + pinName(lw.to) + ' · ligne ' + lw.line +
      (dead ? ' · lien sans effet (remplacé par un autre lien, ou aucune broche ne le lit)' : ' · valeur ' + NTS.ch(v));
  });
  layout.nodes.forEach(function (n) {
    var el = nodeEls[n.name];
    if (!el) return;
    var v = n.type === 'true' ? T : n.type === 'false' ? F : n.kind === 'sink' ? circuit.outputValues[n.name] : circuit.inputValues[n.name];
    if ((n.type === 'true' || n.type === 'false') && circuit.tick === 0) v = n.type === 'true' ? T : F;
    el.setAttribute('class', el.getAttribute('class').replace(/ v[01u]\b/g, '') + ' ' + vcls(v));
    el.querySelector('.val').textContent = NTS.ch(v);
    var pend = el.querySelector('.pend');
    if (pend) {
      var has = Object.prototype.hasOwnProperty.call(circuit.pending, n.name);
      pend.textContent = has ? '→ ' + NTS.ch(circuit.pending[n.name]) : '';
    }
    if (n.type === 'input' || n.type === 'clock')
      el.setAttribute('aria-label', n.type + ' ' + n.name + ', valeur ' + NTS.ch(v) + '. Cliquer pour changer.');
  });
}

/* clic sur une entrée : tape « nom=valeur » dans le shell (puis « simulate » si la case est cochée) */
function toggleInput(name) {
  if (!circuit || ended) return;
  stopScript();
  var cur = Object.prototype.hasOwnProperty.call(circuit.pending, name) ? circuit.pending[name] : circuit.inputValues[name];
  var next = cur === T ? F : T;
  if (looping) {                     // pendant loop : la valeur est prise au tick suivant
    circuit.setValue(name, next); invalidate(); return;
  }
  run(name + '=' + NTS.ch(next));
  if (autoEl.checked) run('simulate');
}
schemaBox.addEventListener('click', function (e) {
  var g = e.target.closest ? e.target.closest('.nd-click') : null;
  if (g) toggleInput(g.getAttribute('data-node'));
});
schemaBox.addEventListener('keydown', function (e) {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  var g = e.target.closest ? e.target.closest('.nd-click') : null;
  if (g) { e.preventDefault(); toggleInput(g.getAttribute('data-node')); }
});

/* ───────── chronogramme ───────── */
function drawChrono() {
  if (!circuit) { chronoEl.innerHTML = ''; return; }
  var width = Math.max(240, chronoEl.clientWidth || 300);
  var rows = circuit.inputNames().map(function (n) { return ['i:' + n, n, 'in']; })
    .concat(circuit.outputs.map(function (n) { return ['o:' + n, n, 'out']; }));
  var LBL = width < 380 ? 70 : 96, RH = 24, TOP = 6, N = small || width < 380 ? 20 : 32;
  var step = (width - LBL - 8) / N, H = TOP + rows.length * RH + 18;
  var hist = history.slice(-N), h = '<svg viewBox="0 0 ' + width + ' ' + H + '" width="' + width + '" height="' + H + '" role="img" aria-label="Chronogramme des entrées et des sorties">';
  var i, x;
  for (i = 0; i < hist.length; i++) {
    if (hist[i].tick % 5 === 0) {
      x = LBL + i * step;
      h += '<path class="c-grid" d="M' + x + ' ' + TOP + 'V' + (H - 16) + '"/><text class="c-tick" x="' + x + '" y="' + (H - 4) + '">' + hist[i].tick + '</text>';
    }
  }
  rows.forEach(function (r, k) {
    var y0 = TOP + k * RH, hi = y0 + 5, lo = y0 + RH - 5, mid = (hi + lo) / 2;
    h += '<text class="c-name c-' + r[2] + '" x="0" y="' + (mid + 4) + '">' + esc(cut(r[1], LBL < 80 ? 9 : 12)) + '</text>';
    var d = '', du = '', prev = null;
    for (i = 0; i < hist.length; i++) {
      var v = hist[i].vals[r[0]], x0 = LBL + i * step, x1 = x0 + step;
      if (v === U || v === undefined) { du += 'M' + x0 + ' ' + mid + 'H' + x1; prev = null; continue; }
      var y = v === T ? hi : lo;
      d += prev === null ? 'M' + x0 + ' ' + y : 'L' + x0 + ' ' + y;
      d += 'H' + x1; prev = y;
    }
    if (du) h += '<path class="c-u" d="' + du + '"/>';
    if (d) h += '<path class="c-sig c-' + r[2] + '" d="' + d + '"/>';
  });
  chronoEl.innerHTML = h + '</svg>';
}

/* ───────── rendu : une seule passe par image ───────── */
function invalidate() {
  dirty = true;
  if (!rafDraw) rafDraw = requestAnimationFrame(draw);
}
function draw() {
  rafDraw = 0;
  if (!dirty) return;
  dirty = false;
  flushTerm();
  drawSchema();
  drawChrono();
  stTick.textContent = circuit ? circuit.tick : '–';
  if (!circuit) { stComp.textContent = '–'; stLink.textContent = '–'; }
}
if ('ResizeObserver' in window) new ResizeObserver(function () { invalidate(); }).observe(chronoEl);

/* ───────── exemples ───────── */
function choose(ex) {
  current = ex;
  editor.value = ex.text;
  editor.scrollTop = 0;
  selEl.value = ex.file;
  Array.prototype.forEach.call(chipsEl.children, function (b) { b.setAttribute('aria-pressed', b.dataset.file === ex.file ? 'true' : 'false'); });
  hintEl.textContent = ex.hint || (ex.file.indexOf('err_') >= 0
    ? 'Fichier de test du projet, faux exprès : le programme doit le refuser.'
    : 'Fichier de test du projet, copié tel quel. Cliquez sur une entrée du schéma pour lui donner une valeur.');
  gutterLines = 0;
  restart();
}
function fill() {
  var ok = document.createElement('optgroup'); ok.label = 'Fichiers du projet (dossier test/)';
  var ko = document.createElement('optgroup'); ko.label = 'Fichiers faux du projet (tests d\'erreur)';
  var pg = document.createElement('optgroup'); pg.label = 'Circuits écrits pour cette page';
  DATA.REPO.forEach(function (ex) {
    var o = document.createElement('option'); o.value = ex.file; o.textContent = ex.file.replace('test/', '');
    (ex.file.indexOf('err_') >= 0 ? ko : ok).appendChild(o);
  });
  DATA.PAGE.forEach(function (ex) {
    var o = document.createElement('option'); o.value = ex.file; o.textContent = ex.file + ' — ' + ex.label; pg.appendChild(o);
    var b = document.createElement('button'); b.type = 'button'; b.className = 'chip'; b.textContent = ex.label; b.dataset.file = ex.file;
    b.addEventListener('click', function () { choose(ex); });
    chipsEl.appendChild(b);
  });
  selEl.appendChild(pg); selEl.appendChild(ok); selEl.appendChild(ko);
}
function find(file) {
  var all = DATA.PAGE.concat(DATA.REPO);
  for (var i = 0; i < all.length; i++) if (all[i].file === file) return all[i];
  return null;
}

/* ───────── événements ───────── */
selEl.addEventListener('change', function () { var ex = find(selEl.value); if (ex) choose(ex); });
editor.addEventListener('input', function () {
  drawGutter();
  clearTimeout(parseTimer);
  parseTimer = setTimeout(restart, 450);
});
btnReset.addEventListener('click', function () { if (current) choose(current); });
btnRestart.addEventListener('click', function () { clearTimeout(parseTimer); restart(); });
btnSim.addEventListener('click', function () { stopScript(); run('simulate'); });
btnLoop.addEventListener('click', function () { stopScript(); if (looping) stopLoop(); else run('loop'); });
btnPlay.addEventListener('click', playScript);
Array.prototype.forEach.call(document.querySelectorAll('[data-cmd]'), function (b) {
  b.addEventListener('click', function () { stopScript(); run(b.getAttribute('data-cmd')); });
});
formEl.addEventListener('submit', function (e) {
  e.preventDefault();
  var line = cmdEl.value;
  cmdEl.value = '';
  if (!circuit || ended || looping) return;
  stopScript();
  if (line.trim() === '') { tprint('\n'); tprint('> '); return; }
  cmdHistory.push(line); cmdPos = cmdHistory.length;
  run(line);
});
cmdEl.addEventListener('keydown', function (e) {
  if (e.key === 'ArrowUp' && cmdPos > 0) { cmdPos--; cmdEl.value = cmdHistory[cmdPos]; e.preventDefault(); }
  else if (e.key === 'ArrowDown' && cmdPos < cmdHistory.length) { cmdPos++; cmdEl.value = cmdHistory[cmdPos] || ''; e.preventDefault(); }
});
stage.addEventListener('keydown', function (e) {
  if (looping && e.ctrlKey && (e.key === 'c' || e.key === 'C')) { e.preventDefault(); stopLoop(); }
});
function showSpeed() { speedOut.textContent = speedEl.value + ' tick' + (+speedEl.value > 1 ? 's' : '') + ' par seconde'; }
speedEl.addEventListener('input', showSpeed);
if (small) speedEl.value = 2;
showSpeed();

fill();
choose(find('additionneur.nts') || DATA.REPO[0]);
})();
