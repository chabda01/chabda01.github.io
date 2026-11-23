/* Stone Analysis — la page. Le calcul est dans core.js. */
(function () {
  'use strict';
  var C = window.StoneCore;
  var $ = function (id) { return document.getElementById(id); };
  var MAX_SAMPLES = 1 << 22;            // au-delà, on ne garde que le début
  var COL = { s1: '#C98500', s2: '#3987E5', ref: '#8D8477', ink: '#F0EADF', ink2: '#B9AF9D', ink3: '#8D8477', grid: 'rgba(240,234,224,.08)' };
  var FONT = '11px "Instrument Sans",system-ui,sans-serif';

  var st = {
    src: null, name: '', wav: null, spec: null, ref: null, filtered: null,
    range: [0, 2000], db: false, tab: 'analyse', motor: 'bad', key: '5',
    hoverX: null, heat: null, zoom: false, urls: {}, benchRun: 0
  };

  /* ───────────── petits outils ───────────── */

  function fr(x, d) {
    return x.toLocaleString('fr-FR', { minimumFractionDigits: d || 0, maximumFractionDigits: d || 0 });
  }
  function hz(f) { return fr(f, f < 1000 ? 1 : 0) + ' Hz'; }
  function ms(t) {
    if (t >= 1000) return fr(t / 1000, 2) + ' s';
    if (t >= 100) return fr(t, 0) + ' ms';
    if (t >= 1) return fr(t, 1) + ' ms';
    return fr(t, 3) + ' ms';
  }
  function long(t) {                     // durée lisible, pour une estimation
    var s = t / 1000;
    if (s < 90) return fr(s, 0) + ' s';
    if (s < 5400) return fr(s / 60, 0) + ' min';
    if (s < 172800) return fr(s / 3600, 0) + ' h';
    return fr(s / 86400, 0) + ' jours';
  }
  function big(v) {
    if (v >= 1e9) return fr(v / 1e9, 1) + ' Md';
    if (v >= 1e6) return fr(v / 1e6, v >= 1e7 ? 0 : 1) + ' M';
    if (v >= 1e3) return fr(v / 1e3, v >= 1e4 ? 0 : 1) + ' k';
    return fr(v, 0);
  }
  function esc(s) { return String(s).replace(/[&<>]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]; }); }
  function status(t) { $('status').textContent = t; }
  function wavUrl(slot, wav) {
    if (st.urls[slot]) URL.revokeObjectURL(st.urls[slot]);
    st.urls[slot] = URL.createObjectURL(new Blob([C.wavWrite(wav)], { type: 'audio/wav' }));
    return st.urls[slot];
  }
  function fit(canvas) {
    var r = canvas.parentNode.getBoundingClientRect(), d = window.devicePixelRatio || 1;
    var w = Math.max(50, Math.round(r.width)), h = Math.max(50, Math.round(r.height));
    if (canvas.width !== w * d || canvas.height !== h * d) { canvas.width = w * d; canvas.height = h * d; }
    var ctx = canvas.getContext('2d');
    ctx.setTransform(d, 0, 0, d, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.font = FONT;
    return { ctx: ctx, w: w, h: h };
  }
  function niceStep(span, maxTicks) {
    var raw = span / maxTicks, p = Math.pow(10, Math.floor(Math.log10(raw))), m = raw / p;
    return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * p;
  }

  /* ───────────── forme d'onde ───────────── */

  function drawWave() {
    var g = fit($('wave')), ctx = g.ctx, w = g.w, h = g.h;
    if (!st.wav) return;
    var L = 8, R = 8, T = 6, B = 18, pw = w - L - R, ph = h - T - B, mid = T + ph / 2;
    var all = st.wav.samples, rate = st.wav.sampleRate, off = 0, zn = Math.round(0.02 * rate);
    var zoom = st.zoom && all.length > zn;
    if (zoom) off = Math.floor(all.length / 4);
    var s = zoom ? all.subarray(off, off + zn) : all, n = s.length;
    var peak = 1, i;
    for (i = 0; i < all.length; i += Math.max(1, all.length >> 16)) if (Math.abs(all[i]) > peak) peak = Math.abs(all[i]);
    peak = Math.min(32768, peak * 1.15);
    ctx.strokeStyle = COL.grid; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(L, mid + .5); ctx.lineTo(L + pw, mid + .5); ctx.stroke();
    function env(arr, color, alpha) {
      var x, a, b, lo, hi, k, step;
      if (zoom) arr = arr.subarray(off, off + zn);
      ctx.fillStyle = color; ctx.strokeStyle = color; ctx.globalAlpha = alpha;
      if (n <= pw * 2) {                 // peu de points : une vraie courbe
        ctx.lineWidth = 1.6; ctx.lineJoin = 'round'; ctx.beginPath();
        for (k = 0; k < n; k++) {
          x = L + k / (n - 1) * pw; lo = mid - arr[k] / peak * ph / 2;
          if (k) ctx.lineTo(x, lo); else ctx.moveTo(x, lo);
        }
        ctx.stroke(); ctx.globalAlpha = 1; return;
      }
      for (x = 0; x < pw; x++) {
        a = Math.floor(x * n / pw); b = Math.max(a + 1, Math.floor((x + 1) * n / pw));
        lo = 32767; hi = -32768; step = Math.max(1, Math.floor((b - a) / 64));
        for (k = a; k < b; k += step) { if (arr[k] < lo) lo = arr[k]; if (arr[k] > hi) hi = arr[k]; }
        lo = mid - lo / peak * ph / 2; hi = mid - hi / peak * ph / 2;
        ctx.fillRect(L + x, hi, 1, Math.max(1, lo - hi));
      }
      ctx.globalAlpha = 1;
    }
    env(all, COL.s1, st.filtered ? 0.45 : 0.95);
    if (st.filtered) env(st.filtered.samples, COL.s2, 0.95);
    ctx.fillStyle = COL.ink3; ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left'; ctx.fillText(fr(off / rate, 2) + ' s', L, h - 5);
    ctx.textAlign = 'right'; ctx.fillText(fr((off + n) / rate, 2) + ' s', L + pw, h - 5);
    $('waveLegend').innerHTML = st.filtered
      ? '<span style="--c:' + COL.s1 + '">avant</span><span style="--c:' + COL.s2 + '">après filtrage</span>' : '';
  }

  /* ───────────── spectre ───────────── */

  var specGeo = null;

  function visibleRange() {
    var ny = st.wav.sampleRate / 2;
    var lo = Math.min(st.range[0], ny * 0.9), hi = Math.min(st.range[1], ny);
    return [lo, hi];
  }
  // Une valeur par colonne de pixels : la case la plus forte de la colonne.
  function columns(mag, size, rate, lo, hi, pw) {
    var out = new Float64Array(pw), bins = new Int32Array(pw), x, a, b, k, m, bk;
    var half = size / 2;
    for (x = 0; x < pw; x++) {
      a = Math.max(1, Math.round((lo + (hi - lo) * x / pw) * size / rate));
      b = Math.min(half, Math.round((lo + (hi - lo) * (x + 1) / pw) * size / rate));
      if (b <= a) b = Math.min(half, a + 1);
      m = 0; bk = a;
      for (k = a; k < b; k++) if (mag[k] > m) { m = mag[k]; bk = k; }
      out[x] = m; bins[x] = bk;
    }
    return { v: out, bins: bins };
  }

  function drawSpec() {
    var g = fit($('spec')), ctx = g.ctx, w = g.w, h = g.h;
    if (!st.spec) return;
    var L = w < 480 ? 40 : 50, R = 12, T = 22, B = 26, pw = w - L - R, ph = h - T - B;
    var rate = st.wav.sampleRate, size = st.spec.fftSize, rg = visibleRange(), lo = rg[0], hi = rg[1];
    var series = [];
    if (st.ref && st.src === 'motor') series.push({ m: st.ref.magnitudes, size: st.ref.fftSize, c: COL.ref, fill: false, lw: 1 });
    series.push({ m: st.spec.magnitudes, size: size, c: COL.s1, fill: !st.filtered, lw: st.filtered ? 1.2 : 1.6, main: true });
    if (st.filtered) series.push({ m: st.filtered.magnitudes, size: st.filtered.fftSize, c: COL.s2, fill: true, lw: 1.6, after: true });
    var top = 0, i, x;
    series.forEach(function (s) {
      s.col = columns(s.m, s.size, rate, lo, hi, pw);
      for (i = 0; i < pw; i++) if (s.col.v[i] > top) top = s.col.v[i];
    });
    if (top <= 0) top = 1;
    var floorDb = -90;
    function yOf(v) {
      if (st.db) {
        var d = v > 0 ? 20 * Math.log10(v / top) : floorDb;
        if (d < floorDb) d = floorDb;
        return T + ph * (d / floorDb);
      }
      return T + ph * (1 - v / (top * 1.08));
    }
    // grille et axes, discrets
    ctx.lineWidth = 1; ctx.strokeStyle = COL.grid; ctx.fillStyle = COL.ink3;
    ctx.textBaseline = 'middle'; ctx.textAlign = 'right';
    var t, y;
    if (st.db) {
      for (t = 0; t >= floorDb; t -= 30) {
        y = Math.round(T + ph * (t / floorDb)) + .5;
        ctx.beginPath(); ctx.moveTo(L, y); ctx.lineTo(L + pw, y); ctx.stroke();
        ctx.fillText(t + ' dB', L - 6, y);
      }
    } else {
      var ys = niceStep(top * 1.08, 4);
      for (t = 0; t <= top * 1.08; t += ys) {
        y = Math.round(yOf(t)) + .5;
        ctx.beginPath(); ctx.moveTo(L, y); ctx.lineTo(L + pw, y); ctx.stroke();
        ctx.fillText(big(t), L - 6, y);
      }
    }
    ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'center';
    var xs = niceStep(hi - lo, Math.max(2, Math.floor(pw / 80))), khz = hi - lo > 3000;
    for (t = Math.ceil(lo / xs) * xs; t <= hi + 1e-6; t += xs) {
      x = L + (t - lo) / (hi - lo) * pw;
      var tl = khz ? fr(t / 1000, xs < 1000 ? 1 : 0) + ' kHz' : fr(t, 0) + ' Hz';
      ctx.fillText(tl, Math.min(x, w - 3 - ctx.measureText(tl).width / 2), h - 8);
    }
    ctx.textAlign = 'left';
    ctx.fillText(st.db ? 'niveau par rapport au pic' : 'amplitude', 4, 12);
    // les courbes
    series.forEach(function (s) {
      ctx.beginPath();
      for (i = 0; i < pw; i++) {
        y = yOf(s.col.v[i]);
        if (i === 0) ctx.moveTo(L + .5, y); else ctx.lineTo(L + i + .5, y);
      }
      ctx.strokeStyle = s.c; ctx.lineWidth = s.lw; ctx.lineJoin = 'round';
      ctx.globalAlpha = s.main && st.filtered ? 0.6 : 1;
      ctx.stroke();
      if (s.fill) {
        ctx.lineTo(L + pw, T + ph); ctx.lineTo(L, T + ph); ctx.closePath();
        ctx.globalAlpha = 0.14; ctx.fillStyle = s.c; ctx.fill();
      }
      ctx.globalAlpha = 1;
    });
    // étiquettes des pics du signal (quelques-unes seulement)
    var lab = st.filtered ? series[series.length - 1] : series.filter(function (s) { return s.main; })[0];
    var peaks = C.findPeaks(lab.m, lab.size, rate, 5, (hi - lo) * 0.035, lo, hi), placed = [];
    ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    peaks.forEach(function (p) {
      if (p.magnitude < top * (st.db ? 0.001 : 0.06)) return;
      var px = L + (p.freq - lo) / (hi - lo) * pw, py = yOf(p.magnitude), txt = hz(p.freq);
      var tw = ctx.measureText(txt).width, tx = Math.max(L + tw / 2, Math.min(L + pw - tw / 2, px)), ty = Math.max(12, py - 8);
      for (i = 0; i < placed.length; i++)
        if (Math.abs(placed[i][0] - tx) < (placed[i][2] + tw) / 2 + 6 && Math.abs(placed[i][1] - ty) < 13) return;
      placed.push([tx, ty, tw]);
      ctx.fillStyle = '#0F0D0A'; ctx.beginPath(); ctx.arc(px, py, 4.5, 0, 6.3); ctx.fill();
      ctx.fillStyle = lab.c; ctx.beginPath(); ctx.arc(px, py, 3, 0, 6.3); ctx.fill();
      ctx.fillStyle = COL.ink; ctx.fillText(txt, tx, ty);
    });
    specGeo = { L: L, T: T, pw: pw, ph: ph, lo: lo, hi: hi, series: series, yOf: yOf, rate: rate };
    // repère de survol
    if (st.hoverX !== null && st.hoverX >= 0 && st.hoverX < pw) {
      x = L + st.hoverX + .5;
      ctx.strokeStyle = 'rgba(240,234,224,.35)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x, T); ctx.lineTo(x, T + ph); ctx.stroke();
      series.forEach(function (s) {
        if (s.c === COL.ref) return;
        ctx.fillStyle = '#0F0D0A'; ctx.beginPath(); ctx.arc(x, yOf(s.col.v[st.hoverX]), 5, 0, 6.3); ctx.fill();
        ctx.fillStyle = s.c; ctx.beginPath(); ctx.arc(x, yOf(s.col.v[st.hoverX]), 3.5, 0, 6.3); ctx.fill();
      });
    }
    var lg = '';
    if (series.length > 1) {
      series.forEach(function (s) {
        lg += '<span style="--c:' + s.c + '">' + (s.c === COL.ref ? 'référence : moteur sain' : s.after ? 'après filtrage' : st.filtered ? 'avant' : 'signal') + '</span>';
      });
    }
    $('specLegend').innerHTML = lg;
  }

  function specHover(ev) {
    if (!specGeo) return;
    var r = $('spec').getBoundingClientRect(), x = Math.round(ev.clientX - r.left - specGeo.L);
    var tip = $('specTip');
    if (x < 0 || x >= specGeo.pw) { st.hoverX = null; tip.style.display = 'none'; drawSpec(); return; }
    st.hoverX = x; drawSpec();
    var html = '', main = null;
    specGeo.series.forEach(function (s) {
      if (s.main) main = s;
      var name = s.c === COL.ref ? 'référence' : s.after ? 'après' : specGeo.series.length > 1 ? (st.filtered ? 'avant' : 'signal') : 'amplitude';
      html += '<br><i>' + name + ' :</i> ' + big(s.col.v[x]);
    });
    tip.innerHTML = '<b>' + hz(main.col.bins[x] * specGeo.rate / main.size) + '</b>' + html;
    tip.style.display = 'block';
    var tw = tip.offsetWidth, left = specGeo.L + x + 14;
    if (left + tw > r.width - 4) left = specGeo.L + x - tw - 14;
    tip.style.left = Math.max(4, left) + 'px'; tip.style.top = '26px';
  }

  function specClick(ev) {
    if (!specGeo || st.tab !== 'filtre') return;
    var r = $('spec').getBoundingClientRect(), x = Math.round(ev.clientX - r.left - specGeo.L), i, best = -1, bm = 0;
    var main = specGeo.series.filter(function (s) { return s.main; })[0];
    for (i = Math.max(0, x - 8); i <= Math.min(specGeo.pw - 1, x + 8); i++)
      if (main.col.v[i] > bm) { bm = main.col.v[i]; best = i; }
    if (best < 0) return;
    var f = main.col.bins[best] * specGeo.rate / main.size, inp = $('notchList');
    var txt = String(Math.round(f * 10) / 10).replace('.', ',');
    inp.value = inp.value.trim() ? inp.value.trim().replace(/[;\s]+$/, '') + ' ; ' + txt : txt;
  }

  /* ───────────── fréquences dominantes ───────────── */

  function runAnalyse() {
    if (!st.spec) return;
    var n = parseInt($('topN').value, 10), out = $('analyseOut');
    var cmd = '<span class="t-in">$ ./stone_analysis --analyze ' + esc(st.name) + ' ' + esc($('topN').value) + '</span>\n';
    if (!(n > 0) || String(n) !== $('topN').value.trim()) {
      out.innerHTML = cmd + '<span class="t-err">Invalid N value: \'' + esc($('topN').value) + '\' (must be a positive integer)</span>';
      return;
    }
    if (n > 100) { n = 100; $('topN').value = '100'; }
    try {
      var e = C.topFrequencies(st.spec.magnitudes, st.spec.fftSize, n, st.wav.sampleRate);
      out.innerHTML = cmd + esc(C.formatAnalyze(n, e)).replace(/\n$/, '');
    } catch (err) {
      out.innerHTML = cmd + '<span class="t-err">' + esc(err.message) + '</span>';
    }
    verdict();
  }

  // Lecture « métier » du spectre : ajout de la version web.
  function verdict() {
    var v = $('verdict'), html = '', sp = st.spec, rate = st.wav.sampleRate;
    if (st.src === 'dtmf') {
      var d = C.dtmfDetect(sp.magnitudes, sp.fftSize, rate);
      html = d ? 'Touche retrouvée : <b>' + esc(d.key) + '</b> (' + d.low + ' Hz + ' + d.high + ' Hz)'
               : 'Aucune touche reconnue dans ce signal.';
      html += '<small>La liste du programme répète des fréquences voisines : ce sont les cases collées au même pic. La démo, elle, cherche les 8 fréquences normalisées du clavier.</small>';
    } else if (st.src === 'motor' && st.ref) {
      var c = C.compareToReference(sp.magnitudes, st.ref.magnitudes, sp.fftSize, rate, 200);
      html = c ? 'Bande anormale entre ' + fr(Math.round(c.fromHz / 10) * 10, 0) + ' et ' + fr(Math.round(c.toHz / 10) * 10, 0) + ' Hz : <b>× ' + fr(c.ratio, 0) + '</b> d\'énergie par rapport au moteur sain. Pic vers ' + hz(c.peakHz) + '.'
               : 'Rien d\'anormal : aucune bande ne dépasse 4 fois l\'énergie de la référence.';
      html += '<small>Les fréquences dominantes restent celles de la rotation (24,75 Hz). Le défaut ne se voit qu\'en comparant, bande par bande, avec la référence. Passez sur « 0–6 kHz » pour le voir.</small>';
    } else {
      var p = C.findPeaks(sp.magnitudes, sp.fftSize, rate, 4, Math.max(20, rate / sp.fftSize * 4));
      if (p.length) html = 'Pics distincts les plus forts : ' + p.map(function (q) { return hz(q.freq); }).join(' · ') +
        '<small>Le programme liste les cases les plus fortes, même voisines. Ici, je regroupe par pic.</small>';
    }
    v.innerHTML = html;
  }

  /* ───────────── charger un signal ───────────── */

  function setSignal(wav, name, note, keep) {
    st.wav = wav; st.name = name; st.filtered = null; st.hoverX = null;
    var t0 = performance.now();
    st.spec = C.spectrum(wav.samples);
    var dt = performance.now() - t0;
    $('stN').textContent = fr(wav.numSamples);
    $('stDur').textContent = fr(wav.numSamples / wav.sampleRate, 2) + ' s';
    $('stRate').textContent = fr(wav.sampleRate);
    $('stSize').textContent = fr(st.spec.fftSize);
    $('stMethod').textContent = st.spec.method === 'dft' ? 'DFT naïve' : 'FFT';
    $('stTime').textContent = ms(dt);
    if (note) $('srcNote').innerHTML = note;
    $('player').src = wavUrl('main', wav);
    $('notchResult').hidden = true; $('notchReset').hidden = true; $('notchVerdict').innerHTML = '';
    if (!keep) {
      $('msgResult').hidden = true;
      $('msgOut').innerHTML = '<span class="t-dim">Cachez un message, ou cherchez-en un dans le signal affiché.</span>';
    }
    var frames = Math.floor(wav.numSamples / C.FRAME_SIZE) - 2;
    $('msgIn').maxLength = Math.max(1, Math.min(60, frames));
    status(st.spec.method === 'dft' ? 'Spectre calculé par DFT naïve en ' + ms(dt) : 'Spectre calculé par FFT en ' + ms(dt));
    syncRange(); drawWave(); drawSpec(); runAnalyse();
  }

  function setRange(r) { st.range = r; syncRange(); if (st.spec) drawSpec(); }
  function syncRange() {
    var ny = st.wav ? st.wav.sampleRate / 2 : 24000;
    Array.prototype.forEach.call($('ranges').querySelectorAll('[data-range]'), function (b) {
      var v = b.getAttribute('data-range'), on = v === 'all' ? st.range[1] >= ny : v === st.range.join(',');
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }
  function markSource(src) {
    st.src = src;
    Array.prototype.forEach.call($('sources').children, function (b) {
      b.setAttribute('aria-pressed', b.getAttribute('data-src') === src ? 'true' : 'false');
    });
    $('dtmfBlock').hidden = src !== 'dtmf';
    $('motorBlock').hidden = src !== 'motor';
  }
  var SYNTH = '<span class="tagsynth">Signal de synthèse</span>';

  function loadSource(src) {
    if (src === 'file') { $('fileIn').click(); return; }
    if (src === 'test') {
      status('Chargement de test.wav…');
      fetch('test.wav').then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.arrayBuffer();
      }).then(function (buf) {
        markSource('test'); st.range = [0, 2000];
        setSignal(C.wavRead(buf, { name: 'test.wav' }), 'test.wav',
          '<span class="tagsynth tagsynth--real">Fichier réel</span><b>test.wav</b>, le fichier de test du dépôt d\'origine, copié tel quel : une note pure de 3 secondes.');
      }).catch(function () {
        status('test.wav introuvable (page ouverte sans serveur ?). Signal de synthèse à la place.');
        loadSource('dtmf');
      });
      return;
    }
    markSource(src);
    if (src === 'dtmf') {
      st.range = [0, 2000];
      setSignal(C.makeWav(C.synthDtmf(st.key), C.RATE), 'touche.wav',
        SYNTH + 'Tonalité de la touche <b>' + esc(st.key) + '</b> d\'un clavier téléphonique (norme DTMF) : deux fréquences jouées ensemble pendant une demi-seconde.');
      Array.prototype.forEach.call($('pad').children, function (b) { b.classList.toggle('is-on', b.textContent === st.key); });
    } else if (src === 'motor') {
      st.range = [0, 6000];
      if (!st.ref) st.ref = C.spectrum(C.synthMotor(false, 3));
      setSignal(C.makeWav(C.synthMotor(st.motor === 'bad', 7), C.RATE), 'moteur.wav',
        SYNTH + 'Vibrations d\'un moteur à 1485 tr/min' + (st.motor === 'bad'
          ? ', avec un <b>roulement abîmé</b> : un petit choc à chaque passage d\'une bille, qui fait sonner la machine vers 3200 Hz.'
          : ', <b>en bon état</b> : la rotation, ses multiples et le 100 Hz électrique.'));
      Array.prototype.forEach.call(document.querySelectorAll('[data-motor]'), function (b) {
        b.setAttribute('aria-pressed', b.getAttribute('data-motor') === st.motor ? 'true' : 'false');
      });
    } else if (src === 'hum') {
      st.range = [0, 1000];
      $('notchList').value = '50 ; 150 ; 250';
      setSignal(C.makeWav(C.synthHum(), C.RATE), 'ronflette.wav',
        SYNTH + 'Une petite mélodie couverte par la <b>ronflette du secteur</b> : 50 Hz et ses multiples 150 et 250 Hz. À nettoyer dans l\'onglet « Retirer une fréquence ».');
    }
  }

  function loadFile(file) {
    if (!file) return;
    status('Lecture de ' + file.name + '…');
    var rd = new FileReader();
    rd.onerror = function () { status('Impossible de lire ce fichier.'); };
    rd.onload = function () {
      var wav, refused = '', cut = '';
      try { C.wavRead(rd.result, { name: file.name }); } catch (e) { refused = e.message; }
      try { wav = C.wavRead(rd.result, { name: file.name, strict: false }); }
      catch (e2) {
        status('Fichier refusé.');
        $('srcNote').innerHTML = '<span class="tagsynth" style="color:var(--bad);box-shadow:inset 0 0 0 1px var(--bad)">Refusé</span>' +
          esc(e2.message) + '. La démo lit les WAV non compressés (PCM) en 16 bits.';
        return;
      }
      if (wav.numSamples < 2) { status('Fichier trop court.'); return; }
      if (wav.numSamples > MAX_SAMPLES) {
        wav = C.makeWav(wav.samples.slice(0, MAX_SAMPLES), wav.sampleRate);
        cut = ' Fichier long : je ne garde que les ' + fr(MAX_SAMPLES / wav.sampleRate, 0) + ' premières secondes.';
      }
      markSource('file'); st.range = [0, wav.sampleRate / 2];
      var note = '<span class="tagsynth tagsynth--real">Votre fichier</span><b>' + esc(file.name) + '</b>, lu dans votre navigateur.';
      if (refused) note += ' Le programme d\'origine l\'aurait refusé (« ' + esc(refused.replace(/^.*?: /, '')) + ' ») : il n\'accepte que le mono 16 bits à 48 000 Hz. La version web est plus souple' + (wav.mixedDown ? ' et fait la moyenne des canaux.' : '.');
      setSignal(wav, file.name.replace(/\s+/g, '_'), note + cut);
    };
    rd.readAsArrayBuffer(file);
  }

  /* ───────────── DFT naïve contre FFT ───────────── */

  var BENCH_SIZES = [256, 512, 1024, 2048, 4096, 8192];

  function benchRow(n) {
    var tr = document.createElement('tr');
    tr.innerHTML = '<td>' + fr(n) + '</td>' +
      '<td><span class="t is-wait">en attente</span><span class="bar bar--dft"></span></td>' +
      '<td><span class="t is-wait">en attente</span><span class="bar bar--fft"></span></td>' +
      '<td><span class="x"></span></td>';
    return { tr: tr, n: n, dft: null, fft: null, cells: tr.querySelectorAll('.t'), bars: tr.querySelectorAll('.bar'), x: tr.querySelector('.x') };
  }
  function benchBars(rows) {
    var top = 0;
    rows.forEach(function (r) { top = Math.max(top, r.dft || 0, r.fft || 0); });
    rows.forEach(function (r) {
      if (r.dft !== null) r.bars[0].style.width = Math.max(0.3, r.dft / top * 100) + '%';
      if (r.fft !== null) r.bars[1].style.width = Math.max(0.3, r.fft / top * 100) + '%';
    });
  }

  function runBench() {
    if (!st.wav) return;
    var run = ++st.benchRun, body = $('benchTable').tBodies[0], rows = [], src = st.wav.samples;
    body.innerHTML = ''; $('benchVerdict').innerHTML = '';
    BENCH_SIZES.forEach(function (n) { var r = benchRow(n); rows.push(r); body.appendChild(r.tr); });
    $('benchGo').disabled = true; $('benchStop').hidden = false;
    // petit échauffement, pour que le navigateur ait compilé les deux fonctions
    var warm = new Int16Array(256); warm.set(src.subarray(0, Math.min(256, src.length)));
    C.dftMagnitude(warm, 256); for (var w = 0; w < 200; w++) C.fftMagnitude(warm, 256, 256);
    var worst = 0, idx = 0;

    function finish(stopped) {
      $('benchGo').disabled = false; $('benchStop').hidden = true;
      var done = rows.filter(function (r) { return r.dft !== null && r.fft !== null; });
      if (!done.length) { status('Comparaison arrêtée.'); return; }
      var last = done[done.length - 1], full = st.spec.fftSize, html;
      html = 'Pour ' + fr(last.n) + ' points : ' + ms(last.dft) + ' en version naïve, ' + ms(last.fft) + ' avec la FFT. Soit <b>× ' + fr(last.dft / last.fft, 0) + '</b>.';
      html += '<small>Les deux méthodes donnent le même spectre : écart relatif maximal mesuré ' + worst.toExponential(1).replace('.', ',') + '. La FFT est trop rapide pour un seul chronométrage : je la répète et je garde la moyenne.</small>';
      if (!stopped && full > last.n && C.isPow2(full)) {
        var t0 = performance.now(); C.fftMagnitude(src, src.length, full); var tf = performance.now() - t0;
        var est = last.dft * (full / last.n) * (full / last.n);
        var tr = document.createElement('tr'); tr.className = 'is-est';
        tr.innerHTML = '<td>' + fr(full) + '</td><td><span class="t">≈ ' + long(est) + '</span>estimation, non lancée</td>' +
          '<td><span class="t">' + ms(tf) + '</span>mesuré</td><td></td>';
        body.appendChild(tr);
        html += '<small>Dernière ligne : le signal entier (' + fr(full) + ' points). La FFT est mesurée. La version naïve n\'est pas lancée : son temps est estimé à partir de la mesure à ' + fr(last.n) + ' points, en comptant « taille × 2 = temps × 4 ».</small>';
      }
      $('benchVerdict').innerHTML = html;
      status(stopped ? 'Comparaison arrêtée.' : 'Comparaison terminée.');
    }

    function next() {
      if (run !== st.benchRun) { finish(true); return; }
      if (idx >= rows.length) { finish(false); return; }
      var r = rows[idx], n = r.n, s = new Int16Array(n), i;
      s.set(src.subarray(0, Math.min(n, src.length)));
      // FFT : répétée jusqu'à 40 ms, on garde la moyenne
      var reps = 0, t0 = performance.now(), f, el;
      do { f = C.fftMagnitude(s, n, n); reps++; el = performance.now() - t0; } while (el < 40);
      r.fft = el / reps;
      r.cells[1].textContent = ms(r.fft); r.cells[1].classList.remove('is-wait');
      // DFT naïve : par morceaux, pour que la page reste vivante
      var mag = new Float64Array(n), k = 0, spent = 0, chunk = Math.max(1, Math.floor(60000 / n));
      r.cells[0].classList.remove('is-wait');
      status('DFT naïve sur ' + fr(n) + ' points…');
      function slice() {
        if (run !== st.benchRun) { finish(true); return; }
        var a = performance.now(), b;
        do { var k1 = Math.min(n, k + chunk); C.dftMagnitudeRange(s, n, mag, k, k1); k = k1; b = performance.now(); } while (k < n && b - a < 30);
        spent += b - a;
        r.dft = spent;
        r.cells[0].textContent = ms(spent) + (k < n ? ' …' : '');
        benchBars(rows);
        if (k < n) { setTimeout(slice, 0); return; }
        var top = 0;
        for (i = 0; i < n; i++) if (mag[i] > top) top = mag[i];
        if (top > 0) for (i = 0; i < n; i++) worst = Math.max(worst, Math.abs(mag[i] - f[i]) / top);
        r.x.textContent = '× ' + fr(r.dft / r.fft, 0);
        idx++; setTimeout(next, 30);
      }
      setTimeout(slice, 30);
    }
    setTimeout(next, 30);
  }

  /* ───────────── retirer une fréquence ───────────── */

  function runNotch() {
    if (!st.wav) return;
    var v = $('notchVerdict'), rate = st.wav.sampleRate;
    var list = $('notchList').value.split(/[;\s]+/).map(function (x) { return parseFloat(x.replace(',', '.')); })
      .filter(function (x) { return x > 0 && x < rate / 2; });
    var width = parseFloat(String($('notchWidth').value).replace(',', '.'));
    if (!list.length) { v.innerHTML = 'Donnez au moins une fréquence, entre 0 et ' + fr(rate / 2) + ' Hz. Exemple : 50 ; 150 ; 250'; return; }
    if (!(width > 0)) width = 4;
    var t0 = performance.now();
    var r = C.removeFrequencies(st.wav.samples, rate, list, width);
    var dt = performance.now() - t0;
    st.filtered = r;
    $('playerAfter').src = $('notchDl').href = wavUrl('after', Object.assign({}, st.wav, { samples: r.samples }));
    $('notchResult').hidden = false; $('notchReset').hidden = false;
    v.innerHTML = 'Retiré : ' + list.map(function (f) { return fr(f, f % 1 ? 1 : 0) + ' Hz'; }).join(' · ') + ' (± ' + fr(width, width % 1 ? 1 : 0) + ' Hz). ' + fr(r.binsCut) + ' cases mises à zéro sur ' + fr(r.fftSize / 2) +
      ', puis FFT inverse. Temps mesuré : ' + ms(dt) + '.<small>En bleu : le signal après filtrage. Écoutez les deux lecteurs pour comparer.</small>';
    status('Fréquences retirées en ' + ms(dt));
    drawWave(); drawSpec();
  }

  /* ───────────── message caché ───────────── */

  function showFrames(res) {
    st.heat = res; $('msgResult').hidden = false; drawHeat();
  }
  function runHide() {
    if (!st.wav) return;
    var msg = $('msgIn').value, out = $('msgOut');
    var cmd = '<span class="t-in">$ ./stone_analysis --cypher ' + esc(st.name) + ' out.wav "' + esc(msg) + '"</span>\n';
    try {
      var t0 = performance.now(), coded = C.cypher(st.wav.samples, msg), dt = performance.now() - t0;
      var wav = Object.assign({}, st.wav, { samples: coded });
      out.innerHTML = cmd + '<span class="t-ok">out.wav écrit : ' + (msg.length + 2) + ' tranches modifiées (début + ' + msg.length + ' caractères + fin) en ' + ms(dt) + '.</span>\n' +
        '<span class="t-dim">Le signal affiché est maintenant out.wav. Cliquez sur « Retrouver le message ».</span>';
      setSignal(wav, 'out.wav', $('srcNote').innerHTML.replace(/ <i>.*$/, '') + ' <i>+ un message caché.</i>', true);
      $('msgDl').href = st.urls.main;
      showFrames(C.decypher(coded, 64));
      status('Message caché en ' + ms(dt));
    } catch (e) {
      out.innerHTML = cmd + '<span class="t-err">' + esc(e.message) + '</span>';
    }
  }
  function runFind() {
    if (!st.wav) return;
    var t0 = performance.now(), res = C.decypher(st.wav.samples, 64), dt = performance.now() - t0;
    var prev = $('msgOut').innerHTML.indexOf('--cypher') >= 0 && st.name === 'out.wav' ? $('msgOut').innerHTML.replace(/\n<span class="t-dim">[^]*$/, '') + '\n' : '';
    $('msgOut').innerHTML = prev + '<span class="t-in">$ ./stone_analysis --decypher ' + esc(st.name) + '</span>\n' +
      (res.message !== null ? esc(res.message) : '<span class="t-err">No hidden message found</span>') +
      '\n<span class="t-dim">' + fr(res.numFrames) + ' tranches disponibles, lecture en ' + ms(dt) + '.</span>';
    $('msgDl').href = st.urls.main;
    showFrames(res);
  }

  var heatGeo = null;
  function drawHeat() {
    if (!st.heat || $('msgResult').hidden || $('p-message').hidden) return;
    var g = fit($('heat')), ctx = g.ctx, w = g.w, h = g.h, fs = st.heat.frames, F = fs.length;
    if (!F) return;
    var L = w < 480 ? 58 : 66, R = 8, T = 22, B = 22, pw = w - L - R, ph = h - T - B, cw = pw / F, ch = ph / 39, f, i, a, x, y;
    var rate = st.wav.sampleRate;
    for (f = 0; f < F; f++) {
      x = L + f * cw;
      for (i = 0; i <= 38; i++) {
        a = Math.min(1, fs[f].mags[i] / (C.DETECT_THRESHOLD * 2));
        y = T + ph - (i + 1) * ch;
        ctx.fillStyle = 'rgba(233,168,85,' + (0.04 + 0.96 * a).toFixed(3) + ')';
        ctx.fillRect(x + (cw > 4 ? 1 : 0), y + .5, Math.max(1, cw - (cw > 4 ? 2 : 0)), Math.max(1, ch - 1));
      }
      if (fs[f].idx >= 0 && cw >= 9) {
        ctx.fillStyle = COL.ink; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
        ctx.fillText(fs[f].idx === C.IDX_START ? '▸' : fs[f].idx === C.IDX_END ? '■' : (C.idxToChar(fs[f].idx) === ' ' ? '␣' : C.idxToChar(fs[f].idx)), x + cw / 2, T - 7);
      }
    }
    ctx.fillStyle = COL.ink3; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    ctx.fillText(fr((C.BASE_BIN + 38) * rate / C.FRAME_SIZE, 0) + ' Hz', L - 6, T + 5);
    ctx.fillText(fr(C.BASE_BIN * rate / C.FRAME_SIZE, 0) + ' Hz', L - 6, T + ph - 5);
    ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left';
    ctx.fillText('tranche 1', L, h - 6);
    ctx.textAlign = 'right';
    ctx.fillText('tranche ' + F + (st.heat.numFrames > F ? ' (sur ' + fr(st.heat.numFrames) + ')' : ''), L + pw, h - 6);
    heatGeo = { L: L, T: T, pw: pw, ph: ph, cw: cw, ch: ch, F: F };
  }
  function heatHover(ev) {
    var tip = $('heatTip');
    if (!heatGeo || !st.heat) return;
    var r = $('heat').getBoundingClientRect(), x = ev.clientX - r.left - heatGeo.L, y = ev.clientY - r.top - heatGeo.T;
    var f = Math.floor(x / heatGeo.cw), i = 38 - Math.floor(y / heatGeo.ch);
    if (f < 0 || f >= heatGeo.F || i < 0 || i > 38) { tip.style.display = 'none'; return; }
    var fm = st.heat.frames[f], what = fm.idx < 0 ? 'rien au-dessus du seuil' : fm.idx === C.IDX_START ? 'marque de début' : fm.idx === C.IDX_END ? 'marque de fin' : 'caractère « ' + C.idxToChar(fm.idx) + ' »';
    tip.innerHTML = '<b>Tranche ' + (f + 1) + '</b> : ' + what + '<br><i>case ' + (C.BASE_BIN + i) + ' (' + fr((C.BASE_BIN + i) * st.wav.sampleRate / C.FRAME_SIZE, 0) + ' Hz) :</i> ' + big(fm.mags[i]) + '<br><i>seuil :</i> ' + big(C.DETECT_THRESHOLD);
    tip.style.display = 'block';
    var left = ev.clientX - r.left + 14;
    if (left + tip.offsetWidth > r.width - 4) left = ev.clientX - r.left - tip.offsetWidth - 14;
    tip.style.left = Math.max(4, left) + 'px'; tip.style.top = '8px';
  }

  /* ───────────── branchements ───────────── */

  function setTab(tab) {
    st.tab = tab;
    Array.prototype.forEach.call(document.querySelectorAll('[data-tab]'), function (b) {
      var on = b.getAttribute('data-tab') === tab;
      b.setAttribute('aria-selected', on ? 'true' : 'false'); b.classList.toggle('is-on', on);
      $('p-' + b.getAttribute('data-tab')).hidden = !on;
    });
    $('spec').parentNode.style.cursor = tab === 'filtre' ? 'copy' : 'crosshair';
    if (tab === 'message') drawHeat();
  }

  function init() {
    var pad = $('pad');
    C.DTMF_KEYS.join('').split('').forEach(function (k) {
      var b = document.createElement('button');
      b.type = 'button'; b.textContent = k; b.setAttribute('aria-label', 'Touche ' + k);
      b.addEventListener('click', function () {
        st.key = k; loadSource('dtmf');
        var p = $('player'); p.currentTime = 0; var pr = p.play(); if (pr && pr.catch) pr.catch(function () {});
      });
      pad.appendChild(b);
    });
    $('sources').addEventListener('click', function (e) {
      var b = e.target.closest('[data-src]'); if (b) loadSource(b.getAttribute('data-src'));
    });
    Array.prototype.forEach.call(document.querySelectorAll('[data-motor]'), function (b) {
      b.addEventListener('click', function () { st.motor = b.getAttribute('data-motor'); loadSource('motor'); });
    });
    $('ranges').addEventListener('click', function (e) {
      var b = e.target.closest('[data-range]'); if (!b) return;
      var v = b.getAttribute('data-range');
      setRange(v === 'all' ? [0, st.wav ? st.wav.sampleRate / 2 : 24000] : v.split(',').map(Number));
    });
    $('zooms').addEventListener('click', function (e) {
      var b = e.target.closest('[data-zoom]'); if (!b) return;
      st.zoom = b.getAttribute('data-zoom') === '1';
      Array.prototype.forEach.call(this.children, function (c) { c.setAttribute('aria-pressed', c === b ? 'true' : 'false'); });
      drawWave();
    });
    $('dbToggle').addEventListener('click', function () {
      st.db = !st.db; this.setAttribute('aria-pressed', st.db ? 'true' : 'false'); drawSpec();
    });
    Array.prototype.forEach.call(document.querySelectorAll('[data-tab]'), function (b) {
      b.addEventListener('click', function () { setTab(b.getAttribute('data-tab')); });
    });
    $('topN').addEventListener('input', runAnalyse);
    $('benchGo').addEventListener('click', runBench);
    $('benchStop').addEventListener('click', function () { st.benchRun++; });
    $('notchGo').addEventListener('click', runNotch);
    $('notchReset').addEventListener('click', function () {
      st.filtered = null; $('notchResult').hidden = true; this.hidden = true; $('notchVerdict').innerHTML = '';
      drawWave(); drawSpec();
    });
    $('msgHide').addEventListener('click', runHide);
    $('msgFind').addEventListener('click', runFind);
    $('fileBtn').addEventListener('click', function () { $('fileIn').click(); });
    $('fileIn').addEventListener('change', function () { loadFile(this.files[0]); this.value = ''; });

    var stage = $('stage');
    ['dragenter', 'dragover'].forEach(function (t) {
      stage.addEventListener(t, function (e) { e.preventDefault(); stage.classList.add('is-drop'); });
    });
    ['dragleave', 'drop'].forEach(function (t) {
      stage.addEventListener(t, function (e) { e.preventDefault(); stage.classList.remove('is-drop'); });
    });
    stage.addEventListener('drop', function (e) { if (e.dataTransfer && e.dataTransfer.files[0]) loadFile(e.dataTransfer.files[0]); });

    var spec = $('spec');
    spec.addEventListener('pointermove', specHover);
    spec.addEventListener('pointerdown', specHover);
    spec.addEventListener('pointerleave', function () { st.hoverX = null; $('specTip').style.display = 'none'; drawSpec(); });
    spec.addEventListener('click', specClick);
    $('heat').addEventListener('pointermove', heatHover);
    $('heat').addEventListener('pointerdown', heatHover);
    $('heat').addEventListener('pointerleave', function () { $('heatTip').style.display = 'none'; });

    var timer = null;
    window.addEventListener('resize', function () {
      clearTimeout(timer);
      timer = setTimeout(function () { drawWave(); drawSpec(); drawHeat(); }, 80);
    });
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { drawWave(); drawSpec(); drawHeat(); });

    setTab('analyse');
    loadSource('test');
  }

  if (!C) { status('core.js n\'a pas pu être chargé.'); return; }
  init();
})();
