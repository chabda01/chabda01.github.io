/* Interstonar — interface de la démo. Le calcul est dans core.js. */
(function () {
  'use strict';
  var C = window.Interstonar, S = window.InterstonarScenes;
  function $(id) { return document.getElementById(id); }

  var reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  var coarse = matchMedia('(pointer: coarse)').matches;
  var light = coarse || (navigator.hardwareConcurrency || 8) <= 4;
  var HANDLE = coarse ? 28 : 16;
  var DELTAS = [1, 10, 60, 120, 300, 600];
  var PLANES = { xy: [0, 1], xz: [0, 2], yz: [1, 2] };
  var COLORS = ['#6FA3C7', '#B9AF9D', '#C98F6B', '#8FB59A', '#A99BC9'];
  var BOXES = { formes: [-9, -9, 23, 18] };   // cadrage de départ quand une forme est très haute

  var cv = $('is-canvas'), ctx = cv.getContext('2d');
  var ch = $('is-chart'), cx2 = ch.getContext('2d');
  var term = $('is-term'), cmdIn = $('is-cmd'), src = $('is-src');
  var fields = ['px', 'py', 'pz', 'vx', 'vy', 'vz'].map(function (k) { return $('is-' + k); });

  var files = {}, k0;
  for (k0 in S.files) files[k0] = S.files[k0];

  var st = {
    preset: null, file: '', sim: null, args: null, drift: null, ref: null,
    k: 0, playing: false, acc: 0, rate: 60, plane: 'xy',
    ou: 0, ov: 0, scale: 1, arrowK: 1, W: 300, H: 200,
    drag: null, move: null, dirty: true, visible: true, low: light,
    termShown: -1, termTail: false, slow: 0
  };
  var raf = 0, last = 0, pts = {}, armed = false, timer = 0;

  /* ───────── textes ───────── */
  function fr(v, d) { return v.toLocaleString('fr-FR', { maximumFractionDigits: d === undefined ? 0 : d }); }
  function ns(v) { var n = Number(v.toPrecision(5)); return String(n === 0 ? 0 : n); }
  function fmtDur(s) {
    if (s < 120) return fr(s, 1) + ' s';
    if (s < 7200) return fr(s / 60, 1) + ' min';
    if (s < 172800) return fr(s / 3600, 1) + ' h';
    return fr(s / 86400, 1) + ' j';
  }
  function fmtPct(v) {
    var p = v * 100, a = Math.abs(p);
    if (!isFinite(p)) return '–';
    var s = a === 0 ? '0' : a < 0.01 ? a.toExponential(1).replace('.', ',') : a < 10 ? fr(a, 2) : fr(a, 0);
    return (p > 0 ? '+' : p < 0 ? '−' : '') + s + ' %';
  }
  function setText(el, t) { if (el.textContent !== t) el.textContent = t; }

  /* ───────── commande ↔ champs ───────── */
  function buildCmd() {
    var a = st.args, mode = a ? a.mode : 1, file = a ? a.config : st.file;
    var s = './interstonar ' + (mode === 1 ? '--global ' : '--local ') + file;
    if (mode === 1) s += ' -d ' + (a ? a.delta : 1);
    fields.forEach(function (f) { s += ' ' + (f.value.trim() || '0'); });
    cmdIn.value = s;
  }
  function syncFromArgs(a) {
    var v = a.pos.concat(a.vel);
    fields.forEach(function (f, i) { if (document.activeElement !== f) f.value = String(v[i]); });
    var chips = $('is-deltas').children;
    for (var i = 0; i < chips.length; i++) {
      chips[i].disabled = a.mode !== 1;
      chips[i].setAttribute('aria-pressed', a.mode === 1 && Number(chips[i].dataset.d) === a.delta ? 'true' : 'false');
    }
    setText($('is-dlabel'), a.mode === 1 ? 'Pas de temps, en secondes (option -d)' : 'Pas de temps : le mode local n\'en a pas, le programme refuse -d');
    $('is-ref').disabled = a.mode !== 1;
    if (a.config !== st.file && files[a.config] !== undefined) showFile(a.config);
  }
  function showFile(name) { st.file = name; src.value = files[name]; setText($('is-fname'), name); }
  function argv() { return C.splitCommand(cmdIn.value).slice(1); }

  /* ───────── lancer le programme ───────── */
  // play : rejoue l'animation ; refit : recadre la vue.
  function runFull(play, refit) {
    var r = C.runProgram(argv(), files);
    st.termShown = -1; st.termTail = false;
    if (!r.sim) {
      st.playing = false;
      term.textContent = '';
      addTerm('$ ' + cmdIn.value + '\n', 't-in');
      if (r.stdout) addTerm(r.stdout);
      if (r.stderr) addTerm(r.stderr, 't-err');
      addTerm('(code de sortie : ' + r.code + ')\n', 't-dim');
      st.termShown = -2;
      setText($('is-status'), r.code ? 'Le programme a refusé la commande' : 'Aide affichée');
      setText($('is-play'), 'Lancer');
      return;
    }
    st.sim = r.sim; st.args = r.args;
    st.drift = r.sim.mode === 1 ? C.energyDrift(r.sim) : null;
    computeRef();
    syncFromArgs(r.args);
    var n = r.sim.n;
    st.rate = Math.max(3, Math.min(600, n / 6));
    if (refit) fit(true);
    if (play && !reduce) { st.k = 0; st.acc = 0; st.playing = true; }
    else { st.k = n; st.playing = false; }
    setLabels();
    st.dirty = true; request();
    if (!st.playing) { draw(); st.dirty = false; }
  }
  function computeRef() {
    st.ref = null;
    var s = st.sim;
    if (s && s.mode === 1 && $('is-ref').checked)
      st.ref = C.runReference(st.args, s.bodies, 50, s.n);
  }
  function runPreview() {
    var r = C.runProgram(argv(), files, { text: false });
    if (!r.sim) return;
    st.sim = r.sim; st.args = r.args; st.drift = null; st.ref = null;
    st.k = r.sim.n; st.playing = false;
  }
  function setLabels() {
    var g = st.sim.mode === 1;
    setText($('is-l2'), g ? 'temps simulé' : 'distance parcourue');
    setText($('is-l4'), g ? 'écart d\'énergie' : 'distance libre au dernier pas');
    setText($('is-ctitle'), g ? 'Énergie de la roche, écart par rapport au départ' : 'Distance libre autour de la roche, à chaque pas');
    setText($('is-cnote'), g ? 'Avec un calcul exact, la courbe resterait à zéro. Mesure ajoutée par cette page.'
                             : 'Échelle logarithmique. Sous 0,1 la forme est touchée ; au-dessus de 1000 la roche est sortie.');
  }

  /* ───────── terminal ───────── */
  function addTerm(text, cls) {
    var n = document.createTextNode(text);
    if (cls) { var sp = document.createElement('span'); sp.className = cls; sp.appendChild(n); n = sp; }
    term.appendChild(n);
  }
  function termSync() {
    var s = st.sim;
    if (!s || st.termShown === -2 || !s.lines.length) return;
    var target = s.head + 1 + st.k;
    if (st.termShown < 0 || target < st.termShown) {
      term.textContent = '';
      addTerm('$ ' + cmdIn.value + '\n', 't-in');
      st.termShown = 0; st.termTail = false;
    }
    var changed = false;
    if (target > st.termShown) {
      addTerm(s.lines.slice(st.termShown, target).join('\n') + '\n');
      st.termShown = target; changed = true;
    }
    if (st.k >= s.n && !st.termTail) {
      addTerm(s.tail.join('\n') + '\n', s.hit >= 0 ? 't-ok' : 't-err');
      st.termTail = true; changed = true;
    }
    if (changed) term.scrollTop = term.scrollHeight;
  }

  /* ───────── vue ───────── */
  function resize() {
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var w = cv.clientWidth, h = cv.clientHeight;
    if (!w || !h) return;
    if (st.W !== w || st.H !== h || cv.width !== Math.round(w * dpr)) {
      if (st.W && st.H && st.sim) st.scale *= Math.min(w / st.W, h / st.H) || 1;
      st.W = w; st.H = h;
      cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    var cw = ch.clientWidth, chh = ch.clientHeight;
    if (cw && ch.width !== Math.round(cw * dpr)) {
      ch.width = Math.round(cw * dpr); ch.height = Math.round(chh * dpr);
      cx2.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    st.dirty = true; request();
  }
  function sx(u) { return st.W / 2 + (u - st.ou) * st.scale; }
  function sy(v) { return st.H / 2 - (v - st.ov) * st.scale; }
  function extent(b, axis, mode) {
    if (mode === 1 || b.type === 'sphere') return b.radius;
    if (b.type === 'box') return b.sides[axis] / 2;
    if (b.type === 'cylinder') return axis === 2 ? (b.height < 0 ? b.radius : b.height / 2) : b.radius;
    if (b.type === 'torus') return axis === 2 ? b.outer_r : b.inner_r + b.outer_r;
    return 0;
  }
  function fit(usePresetBox) {
    var s = st.sim; if (!s) return;
    var ax = PLANES[st.plane], a = ax[0], b = ax[1];
    var u0 = Infinity, v0 = Infinity, u1 = -Infinity, v1 = -Infinity;
    function add(u, v, ru, rv) {
      if (!isFinite(u) || !isFinite(v)) return;
      u0 = Math.min(u0, u - ru); u1 = Math.max(u1, u + ru); v0 = Math.min(v0, v - rv); v1 = Math.max(v1, v + rv);
    }
    var box = usePresetBox !== false && st.preset && BOXES[st.preset.id];
    if (box && st.plane === st.preset.plane && st.file === st.preset.file) { u0 = box[0]; v0 = box[1]; u1 = box[2]; v1 = box[3]; }
    else {
      s.bodies.forEach(function (bd) { add(bd.pos[a], bd.pos[b], extent(bd, a, s.mode), extent(bd, b, s.mode)); });
      add(s.P[a], s.P[b], 0, 0);
      var size = Math.max(u1 - u0, v1 - v0, 1e-9), cu = (u0 + u1) / 2, cvv = (v0 + v1) / 2, lim = size * 2.5;
      for (var i = 1; i <= s.n; i++) {
        var u = s.P[3 * i + a], v = s.P[3 * i + b];
        if (Math.abs(u - cu) <= lim && Math.abs(v - cvv) <= lim) add(u, v, 0, 0);
      }
    }
    var w = Math.max(u1 - u0, 1e-9), h = Math.max(v1 - v0, 1e-9), pad = 44;
    st.ou = (u0 + u1) / 2; st.ov = (v0 + v1) / 2;
    st.scale = Math.min((st.W - 2 * pad) / w, (st.H - 2 * pad) / h);
    var vl = Math.hypot(st.args.vel[a], st.args.vel[b]) || Math.hypot.apply(null, st.args.vel) || 1;
    st.arrowK = Math.min(st.W, st.H) * 0.22 / vl;
    st.dirty = true;
  }
  function zoomAt(px, py, f) {
    var u = st.ou + (px - st.W / 2) / st.scale, v = st.ov - (py - st.H / 2) / st.scale;
    st.scale *= f;
    st.ou = u - (px - st.W / 2) / st.scale; st.ov = v + (py - st.H / 2) / st.scale;
    st.dirty = true; request();
  }
  function handles() {
    var ax = PLANES[st.plane], a = st.args;
    var x = sx(a.pos[ax[0]]), y = sy(a.pos[ax[1]]);
    return { x: x, y: y, tx: x + a.vel[ax[0]] * st.arrowK, ty: y - a.vel[ax[1]] * st.arrowK };
  }

  /* ───────── dessin ───────── */
  function label(t, x, y, col) {
    ctx.font = '11px "Instrument Sans",system-ui,sans-serif';
    ctx.fillStyle = col || '#B9AF9D'; ctx.fillText(t, x, y);
  }
  function drawShape(b, a, c, col) {
    var x = sx(b.pos[a]), y = sy(b.pos[c]), k = st.scale, r;
    ctx.beginPath();
    if (b.type === 'sphere') ctx.arc(x, y, Math.max(b.radius * k, 1), 0, 6.2832);
    else if (b.type === 'box') ctx.rect(x - b.sides[a] * k / 2, y - b.sides[c] * k / 2, b.sides[a] * k, b.sides[c] * k);
    else if (b.type === 'cylinder') {
      r = b.radius * k;
      if (c !== 2) ctx.arc(x, y, Math.max(r, 1), 0, 6.2832);
      else if (b.height < 0) ctx.rect(x - r, -10, 2 * r, st.H + 20);
      else ctx.rect(x - r, y - b.height * k / 2, 2 * r, b.height * k);
    } else if (b.type === 'torus') {
      var R = b.inner_r * k, t = b.outer_r * k;
      if (c !== 2) {
        ctx.arc(x, y, Math.max(R + t, 1), 0, 6.2832);
        if (R > t) { ctx.moveTo(x + R - t, y); ctx.arc(x, y, R - t, 0, 6.2832, true); }
      } else {
        ctx.moveTo(x - R, y - t); ctx.lineTo(x + R, y - t); ctx.arc(x + R, y, t, -1.5708, 1.5708);
        ctx.lineTo(x - R, y + t); ctx.arc(x - R, y, t, 1.5708, 4.7124);
      }
    } else return;
    ctx.fillStyle = col + '2B'; ctx.fill('evenodd');
    ctx.strokeStyle = col; ctx.lineWidth = 1.2; ctx.stroke();
  }
  function path(P, n, a, b, stepBy) {
    var open = false;
    ctx.beginPath();
    for (var i = 0; i <= n; i += (i + stepBy > n && i < n ? n - i : stepBy)) {
      var x = sx(P[3 * i + a]), y = sy(P[3 * i + b]);
      if (!isFinite(x) || !isFinite(y) || Math.abs(x) > 1e7 || Math.abs(y) > 1e7) { open = false; continue; }
      if (open) ctx.lineTo(x, y); else { ctx.moveTo(x, y); open = true; }
    }
    ctx.stroke();
  }
  function niceBar() {
    var target = 110 / st.scale, p = Math.pow(10, Math.floor(Math.log10(target))), m = target / p;
    var len = (m >= 5 ? 5 : m >= 2 ? 2 : 1) * p, t;
    if (st.sim.mode === 2) t = fr(len, 6) + ' unité' + (len > 1 ? 's' : '');
    else t = len >= 1000 ? fr(len / 1000, 3) + ' km' : fr(len, 6) + ' m';
    return { px: len * st.scale, text: t };
  }
  function draw() {
    var W = st.W, H = st.H, s = st.sim, i;
    ctx.fillStyle = '#0C0A08'; ctx.fillRect(0, 0, W, H);
    if (!s) return;
    var ax = PLANES[st.plane], a = ax[0], b = ax[1], k = st.k, g = s.mode === 1;
    ctx.lineJoin = 'round';

    if (g) {
      ctx.setLineDash([3, 3]);
      s.merges.forEach(function (m) {
        [m.a, m.b].forEach(function (o) {
          if (s.bodies.indexOf(o) >= 0) return;
          ctx.beginPath(); ctx.arc(sx(o.pos[a]), sy(o.pos[b]), Math.max(o.radius * st.scale, 2), 0, 6.2832);
          ctx.strokeStyle = '#8D8477'; ctx.lineWidth = 1; ctx.stroke();
        });
      });
      ctx.setLineDash([]);
      s.bodies.forEach(function (bd, j) {
        var r = Math.max(bd.radius * st.scale, 3), x = sx(bd.pos[a]), y = sy(bd.pos[b]), col = COLORS[j % COLORS.length];
        ctx.beginPath(); ctx.arc(x, y, r, 0, 6.2832);
        ctx.fillStyle = col + (s.merges.length ? '66' : 'CC'); ctx.fill();
        ctx.strokeStyle = col; ctx.lineWidth = 1; ctx.stroke();
        if (bd.name) label(bd.name, x + Math.min(r, 60) * 0.72 + 5, y - Math.min(r, 60) * 0.72 - 4);
      });
      if (st.ref) {
        ctx.setLineDash([4, 4]); ctx.strokeStyle = 'rgba(240,234,223,.5)'; ctx.lineWidth = 1;
        path(st.ref.P, st.ref.n, a, b, 1); ctx.setLineDash([]);
      }
      ctx.strokeStyle = '#E9A855'; ctx.lineWidth = 1.6;
      path(s.P, k, a, b, st.low && s.n > 400 && st.playing ? 2 : 1);
    } else {
      s.bodies.forEach(function (bd, j) {
        var col = COLORS[j % COLORS.length];
        drawShape(bd, a, b, col);
        if (bd.name) label(bd.name, sx(bd.pos[a] + extent(bd, a, 2)) + 5, Math.max(14, Math.min(H - 6, sy(bd.pos[b]) - 4 - 13 * (j % 3))), col);
      });
      var from = st.low && k > 200 ? k - 200 : 1;
      ctx.strokeStyle = 'rgba(233,168,85,.3)'; ctx.lineWidth = 1;
      for (i = from; i <= k; i++) {
        var rr = s.D[i] * st.scale;
        if (!(rr > 0.5) || rr > 4000) continue;
        ctx.beginPath(); ctx.arc(sx(s.P[3 * i - 3 + a]), sy(s.P[3 * i - 3 + b]), rr, 0, 6.2832); ctx.stroke();
      }
      ctx.strokeStyle = '#E9A855'; ctx.lineWidth = 1.4; path(s.P, k, a, b, 1);
      ctx.fillStyle = '#E9A855';
      if (k <= 300) for (i = 1; i < k; i++) { ctx.beginPath(); ctx.arc(sx(s.P[3 * i + a]), sy(s.P[3 * i + b]), 2, 0, 6.2832); ctx.fill(); }
    }

    // départ et flèche de vitesse
    var h = handles(), dx = h.tx - h.x, dy = h.ty - h.y, L = Math.hypot(dx, dy);
    ctx.strokeStyle = '#F0EADF'; ctx.fillStyle = '#F0EADF'; ctx.lineWidth = 1.5;
    if (L > 1 && isFinite(L)) {
      ctx.beginPath(); ctx.moveTo(h.x, h.y); ctx.lineTo(h.tx, h.ty); ctx.stroke();
      var ux = dx / L, uy = dy / L;
      ctx.beginPath(); ctx.moveTo(h.tx + ux * 9, h.ty + uy * 9);
      ctx.lineTo(h.tx - uy * 5, h.ty + ux * 5); ctx.lineTo(h.tx + uy * 5, h.ty - ux * 5); ctx.fill();
    }
    ctx.beginPath(); ctx.arc(h.x, h.y, 5.5, 0, 6.2832); ctx.fillStyle = '#0C0A08'; ctx.fill(); ctx.stroke();

    // la roche
    var rx = sx(s.P[3 * k + a]), ry = sy(s.P[3 * k + b]), done = k >= s.n;
    if (isFinite(rx) && isFinite(ry)) {
      ctx.beginPath(); ctx.arc(rx, ry, 4, 0, 6.2832); ctx.fillStyle = '#E9A855'; ctx.fill();
      if (done && s.hit >= 0) {
        ctx.beginPath(); ctx.arc(rx, ry, 10, 0, 6.2832); ctx.strokeStyle = '#E0775F'; ctx.lineWidth = 2; ctx.stroke();
      }
    }

    // échelle, axes, message final
    var bar = niceBar();
    ctx.strokeStyle = '#8D8477'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(12, H - 14); ctx.lineTo(12 + bar.px, H - 14);
    ctx.moveTo(12, H - 18); ctx.lineTo(12, H - 10); ctx.moveTo(12 + bar.px, H - 18); ctx.lineTo(12 + bar.px, H - 10); ctx.stroke();
    label(bar.text + '   ·   ' + 'xyz'.charAt(a) + ' →  ' + 'xyz'.charAt(b) + ' ↑', 12, H - 23, '#8D8477');
    if (done && !st.drag) {
      var msg = s.tail.filter(function (t) { return t; });
      ctx.font = '12px "JetBrains Mono",ui-monospace,monospace';
      ctx.fillStyle = s.hit >= 0 ? '#7FB77E' : '#E0775F'; ctx.textAlign = 'right';
      var my = W < 520 ? H - 44 : H - 12;
      msg.forEach(function (t, j) { ctx.fillText(t, W - 12, my - 16 * (msg.length - 1 - j)); });
      ctx.textAlign = 'left';
    }
    drawChart(); stats(); if (!st.drag) termSync();
  }

  function drawChart() {
    var W = ch.clientWidth, H = ch.clientHeight, s = st.sim, i;
    cx2.fillStyle = '#0C0A08'; cx2.fillRect(0, 0, W, H);
    if (!s) return;
    var g = s.mode === 1, data = g ? st.drift : s.D, n = s.n, i0 = g ? 0 : 1;
    cx2.font = '11px "Instrument Sans",system-ui,sans-serif'; cx2.fillStyle = '#8D8477';
    if (!data) { cx2.fillText('Relâchez pour recalculer la courbe.', 10, 20); return; }
    function val(j) { var v = data[j]; return g ? v : Math.log10(Math.max(v, 1e-3)); }
    var lo = g ? 0 : -1.3, hi = g ? 0 : 0;
    for (i = i0; i <= n; i++) { var v = val(i); if (isFinite(v)) { if (v < lo) lo = v; if (v > hi) hi = v; } }
    if (hi - lo < 1e-15) { hi += 1e-15; lo -= 1e-15; }
    var pl = 8, pr = 8, pt = 16, pb = 16;
    function X(j) { return pl + (W - pl - pr) * (n > i0 ? (j - i0) / (n - i0) : 0.5); }
    function Y(v) { return pt + (H - pt - pb) * (1 - (v - lo) / (hi - lo)); }
    cx2.strokeStyle = 'rgba(240,234,223,.25)'; cx2.lineWidth = 1; cx2.setLineDash([3, 3]);
    var ref = g ? 0 : -1;
    cx2.beginPath(); cx2.moveTo(pl, Y(ref)); cx2.lineTo(W - pr, Y(ref)); cx2.stroke(); cx2.setLineDash([]);
    function curve(a, b, col) {
      cx2.beginPath(); var open = false;
      for (var j = a; j <= b; j++) {
        var v = val(j); if (!isFinite(v)) { open = false; continue; }
        if (open) cx2.lineTo(X(j), Y(v)); else { cx2.moveTo(X(j), Y(v)); open = true; }
      }
      cx2.strokeStyle = col; cx2.stroke();
      if (b === a && isFinite(val(a))) { cx2.beginPath(); cx2.arc(X(a), Y(val(a)), 2.5, 0, 6.2832); cx2.fillStyle = col; cx2.fill(); }
    }
    cx2.lineWidth = 1; curve(i0, n, 'rgba(233,168,85,.28)');
    cx2.lineWidth = 1.6; if (st.k >= i0) curve(i0, st.k, '#E9A855');
    cx2.fillStyle = '#8D8477';
    if (g) { cx2.fillText(fmtPct(hi), pl, 11); cx2.fillText(fmtPct(lo), pl, H - 4); }
    else { cx2.fillText(fr(Math.pow(10, hi), 2), pl, 11); cx2.fillText('0,1 : touché', pl, Math.min(H - 4, Y(-1) + 12)); }
    cx2.textAlign = 'right'; cx2.fillText('pas ' + n, W - pr, H - 4); cx2.textAlign = 'left';
  }

  function stats() {
    var s = st.sim, k = st.k, g = s.mode === 1, done = k >= s.n, res, i;
    setText($('is-s1'), k + ' / ' + C.MAX_STEPS);
    if (g) {
      setText($('is-s2'), fmtDur(k * s.delta));
      setText($('is-s4'), st.drift ? fmtPct(st.drift[k]) : '…');
      res = !done ? 'en vol' : s.hit >= 0 ? 'Collision : ' + (s.bodies[s.hit].name || 'corps sans nom') : 'Aucune collision';
    } else {
      var d = 0; for (i = 1; i <= k; i++) d += s.D[i];
      setText($('is-s2'), isFinite(d) ? fr(d, 2) : '–');
      setText($('is-s4'), k ? fr(s.D[k], 3) : '–');
      res = !done ? 'en vol' : s.result === 'hit' ? 'Touche ' + s.bodies[s.hit].name : s.result === 'out' ? 'Sortie de scène' : 'Limite de pas atteinte';
    }
    setText($('is-s3'), res);
    setText($('is-play'), st.playing ? 'Pause' : done ? 'Relancer' : 'Lancer');
    if (st.termShown !== -2)
      setText($('is-status'), st.drag ? 'Relâchez pour lancer' : done ? s.tail.filter(function (t) { return t; }).join(' — ') : st.playing ? 'Calcul affiché pas à pas…' : 'En pause au pas ' + k);
  }

  /* ───────── boucle d'animation : ne tourne que s'il y a quelque chose à faire ───────── */
  function request() { if (!raf && st.visible && !document.hidden) raf = requestAnimationFrame(frame); }
  function frame(t) {
    raf = 0;
    var dt = Math.min(t - (last || t), 100); last = t;
    if (st.playing && dt > 30) { if (++st.slow > 20) st.low = true; } else if (st.slow > 0) st.slow--;
    if (st.move) applyMove();
    if (st.playing && st.sim) {
      st.acc += dt * st.rate / 1000;
      var adv = Math.floor(st.acc);
      if (adv > 0) { st.acc -= adv; st.k = Math.min(st.sim.n, st.k + adv); }
      if (st.k >= st.sim.n) st.playing = false;
      st.dirty = true;
    }
    if (st.dirty) { st.dirty = false; draw(); }
    if (st.playing || st.move) request(); else last = 0;
  }

  /* ───────── gestes sur la vue ───────── */
  function pos(e) { var r = cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
  function ptList() { return Object.keys(pts).map(function (k) { return pts[k]; }); }
  function applyMove() {
    var m = st.move, d = st.drag; st.move = null;
    if (!d || !st.args) return;
    if (d.type === 'pan') {
      st.ou = d.ou - (m.x - d.x) / st.scale; st.ov = d.ov + (m.y - d.y) / st.scale;
    } else {
      var ax = PLANES[st.plane], a = ax[0], b = ax[1];
      if (d.type === 'pos') {
        fields[a].value = ns(st.ou + (m.x - st.W / 2) / st.scale);
        fields[b].value = ns(st.ov - (m.y - st.H / 2) / st.scale);
      } else {
        var h = handles();
        fields[3 + a].value = ns((m.x - h.x) / st.arrowK);
        fields[3 + b].value = ns(-(m.y - h.y) / st.arrowK);
      }
      buildCmd(); runPreview();     // aperçu : trajectoire seule, sans texte ni courbe
    }
    st.dirty = true;
  }
  cv.addEventListener('pointerdown', function (e) {
    if (!st.sim) return;
    try { cv.setPointerCapture(e.pointerId); } catch (err) {}
    var p = pos(e); pts[e.pointerId] = p; armed = true;
    var l = ptList();
    if (l.length === 2) {
      st.drag = { type: 'pinch', d: Math.hypot(l[0].x - l[1].x, l[0].y - l[1].y) || 1 };
      return;
    }
    var h = handles();
    if (Math.hypot(p.x - h.tx, p.y - h.ty) <= HANDLE) st.drag = { type: 'vel' };
    else if (Math.hypot(p.x - h.x, p.y - h.y) <= HANDLE) st.drag = { type: 'pos' };
    else st.drag = { type: 'pan', x: p.x, y: p.y, ou: st.ou, ov: st.ov };
    if (st.drag.type !== 'pan') { st.playing = false; e.preventDefault(); }
  });
  cv.addEventListener('pointermove', function (e) {
    var p = pos(e);
    if (!st.drag) {
      if (st.sim && e.pointerType === 'mouse') {
        var h = handles();
        cv.style.cursor = Math.hypot(p.x - h.tx, p.y - h.ty) <= HANDLE || Math.hypot(p.x - h.x, p.y - h.y) <= HANDLE ? 'grab' : 'move';
      }
      return;
    }
    if (!pts[e.pointerId]) return;
    pts[e.pointerId] = p;
    if (st.drag.type === 'pinch') {
      var l = ptList(); if (l.length < 2) return;
      var d = Math.hypot(l[0].x - l[1].x, l[0].y - l[1].y) || 1;
      zoomAt((l[0].x + l[1].x) / 2, (l[0].y + l[1].y) / 2, d / st.drag.d);
      st.drag.d = d;
      return;
    }
    st.move = p; request();
  });
  function endDrag(e) {
    if (!pts[e.pointerId]) return;
    delete pts[e.pointerId];
    var d = st.drag; if (!d) return;
    if (st.move) applyMove();
    st.drag = null;
    if (d.type === 'pos' || d.type === 'vel') runFull(true, false);
    else { st.dirty = true; request(); }
  }
  cv.addEventListener('pointerup', endDrag);
  cv.addEventListener('pointercancel', endDrag);
  cv.addEventListener('pointerleave', function () { if (!st.drag) armed = false; });
  cv.addEventListener('wheel', function (e) {
    if (!armed || !st.sim) return;       // la molette ne zoome qu'après un clic dans la vue
    e.preventDefault();
    var p = pos(e); zoomAt(p.x, p.y, e.deltaY < 0 ? 1.15 : 1 / 1.15);
  }, { passive: false });

  /* ───────── boutons et champs ───────── */
  $('is-play').addEventListener('click', function () {
    var s = st.sim;
    if (!s || st.termShown === -2) { runFull(true, false); return; }
    if (st.playing) st.playing = false;
    else if (st.k >= s.n) { if (reduce) return; st.k = 0; st.acc = 0; st.playing = true; }
    else st.playing = true;
    st.dirty = true; request();
  });
  $('is-step').addEventListener('click', function () {
    var s = st.sim; if (!s) return;
    st.playing = false;
    st.k = st.k >= s.n ? 0 : st.k + 1;
    st.dirty = true; request();
  });
  $('is-end').addEventListener('click', function () {
    if (!st.sim) return;
    st.playing = false; st.k = st.sim.n; st.dirty = true; request();
  });
  $('is-zin').addEventListener('click', function () { zoomAt(st.W / 2, st.H / 2, 1.4); });
  $('is-zout').addEventListener('click', function () { zoomAt(st.W / 2, st.H / 2, 1 / 1.4); });
  $('is-fit').addEventListener('click', function () { fit(false); request(); });
  function setPlane(p, usePreset) {
    st.plane = p;
    Array.prototype.forEach.call(document.querySelectorAll('[data-plane]'), function (b) {
      b.setAttribute('aria-pressed', b.dataset.plane === p ? 'true' : 'false');
    });
    if (st.sim) { fit(usePreset); request(); }
  }
  Array.prototype.forEach.call(document.querySelectorAll('[data-plane]'), function (b) {
    b.addEventListener('click', function () { setPlane(b.dataset.plane, true); });
  });

  function later(fn, ms) { clearTimeout(timer); timer = setTimeout(fn, ms); }
  cmdIn.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); clearTimeout(timer); runFull(true, true); } });
  cmdIn.addEventListener('change', function () { runFull(true, true); });
  fields.forEach(function (f) {
    f.addEventListener('input', function () { buildCmd(); later(function () { runFull(false, false); }, 300); });
    f.addEventListener('keydown', function (e) { if (e.key === 'Enter') { clearTimeout(timer); buildCmd(); runFull(true, false); } });
  });
  DELTAS.forEach(function (d) {
    var b = document.createElement('button');
    b.type = 'button'; b.className = 'chip'; b.textContent = String(d); b.dataset.d = d;
    b.addEventListener('click', function () {
      if (!st.args || st.args.mode !== 1) return;
      st.args.delta = d; buildCmd(); runFull(true, false);
    });
    $('is-deltas').appendChild(b);
  });
  $('is-ref').addEventListener('change', function () { computeRef(); st.dirty = true; request(); });
  src.addEventListener('input', function () {
    files[st.file] = src.value;
    later(function () { runFull(false, false); }, 450);
  });
  $('is-reset').addEventListener('click', function () {
    if (S.files[st.file] === undefined) return;
    files[st.file] = S.files[st.file]; src.value = files[st.file];
    runFull(true, true);
  });

  /* ───────── lancements prêts ───────── */
  function loadPreset(p) {
    st.preset = p; st.args = null;
    Array.prototype.forEach.call(document.querySelectorAll('[data-preset]'), function (b) {
      b.setAttribute('aria-pressed', b.dataset.preset === p.id ? 'true' : 'false');
    });
    setText($('is-note'), p.note);
    showFile(p.file);
    cmdIn.value = p.cmd;
    st.plane = p.plane;
    Array.prototype.forEach.call(document.querySelectorAll('[data-plane]'), function (b) {
      b.setAttribute('aria-pressed', b.dataset.plane === p.plane ? 'true' : 'false');
    });
    runFull(true, true);
  }
  S.presets.forEach(function (p) {
    var b = document.createElement('button');
    b.type = 'button'; b.className = 'chip'; b.textContent = p.label; b.dataset.preset = p.id;
    b.addEventListener('click', function () { loadPreset(p); });
    var box = p.group === 'repo' ? 'is-chips-repo' : p.cmd.indexOf('--local') > 0 ? 'is-chips-local' : 'is-chips-global';
    $(box).appendChild(b);
  });

  /* ───────── cycle de vie ───────── */
  if (window.ResizeObserver) new ResizeObserver(resize).observe(cv); else window.addEventListener('resize', resize);
  if (window.IntersectionObserver) new IntersectionObserver(function (en) {
    st.visible = en[0].isIntersecting; if (st.visible) request();
  }).observe($('is-stage'));
  document.addEventListener('visibilitychange', function () { last = 0; request(); });

  resize();
  loadPreset(S.presets[0]);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { st.dirty = true; request(); });
})();
