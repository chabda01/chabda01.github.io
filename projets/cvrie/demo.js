/* DR CVRIE — interface de la démo. Le calcul est dans core.js. */
(function () {
  'use strict';
  var Core = window.CvrieCore;
  var $ = function (id) { return document.getElementById(id); };
  // nombre à la française : virgule, espace fine entre les milliers
  var fr = function (x, d) {
    var p = x.toFixed(d || 0).split('.');
    p[0] = p[0].replace(/\B(?=(\d{3})+$)/g, '\u202f');
    return p.join(',');
  };
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  // Couleurs des groupes : validées sur le fond sombre de la scène (toutes paires).
  var COLORS = ['#069ce4', '#d37812', '#44a781', '#d23855', '#7361e4', '#5c6c14', '#c46dbd', '#0e6a9b'];
  var INK = '#F0EADF', INK3 = '#8D8477', GOLD = '#E9A855', STAGE = '#0F0D0A', GREY = '#6F685D';

  /* ═════════════ Volet 1 : textes ═════════════ */

  var SHORT = ['Tête', 'Muscles, articulations', 'Oreille', 'Rhume', 'Démangeaisons', 'Poitrine, souffle', 'Brûlures'];
  var EXAMPLES = [
    ['Genou', 'My knee hurts when I climb stairs and it feels stiff in the morning.'],
    ['Brûlure', 'I spilled boiling water on my hand, the skin is red with a blister.'],
    ['Urticaire', 'Itchy red bumps appeared on my arms after eating shrimp.'],
    ['Rhume', 'Runny nose, sneezing and a sore throat since yesterday.'],
    ['Oreille', 'My ear is throbbing and I can barely hear on that side.'],
    ['Souffle', "Tight chest, wheeze at night, can't catch my breath after stairs."],
    ['Migraine', 'A throbbing ache in my head, my vision flickers and I get nauseous.']
  ];

  var T = null; // état du volet textes

  function initText(d) {
    var m = Core.loadTextModel(d), n = d.n, dim = d.nComp, i;
    var xb = Core.b64ToBytes(d.X), X = new Float32Array(xb.length);
    for (i = 0; i < xb.length; i++) X[i] = xb[i] / 255;
    var tq = Core.b64ToU16(d.tsne), pos = new Float32Array(tq.length);
    for (i = 0; i < tq.length; i++) pos[i] = tq[i] / 65535;
    // chaque témoignage repasse par la chaîne « nouveau texte » : sert à trouver les voisins
    var docs = d.texts.map(function (t) { return Core.tfidf(t, m); });
    var Xn = new Float32Array(n * dim);
    docs.forEach(function (sp, r) { Xn.set(Core.project(sp, m), r * dim); });

    var project = {
      mode: 'projet', k: d.k, labels: Int32Array.from(d.labels), centroids: m.centroids,
      names: d.names, short: SHORT, tops: d.tops, colors: d.names.map(function (_, c) { return c; }),
      sizes: d.sizes
    };
    T = { d: d, m: m, n: n, dim: dim, X: X, pos: pos, docs: docs, Xn: Xn, project: project, view: project,
          query: null, isolate: -1, hover: -1, km: null, timer: null };

    $('t-n').textContent = fr(n);
    EXAMPLES.forEach(function (ex) {
      var b = el('button', 'chip', ex[0]);
      b.type = 'button';
      b.addEventListener('click', function () { $('t-input').value = ex[1]; classify(); });
      $('t-examples').appendChild(b);
    });
    $('t-go').addEventListener('click', classify);
    $('t-input').addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) classify();
    });
    $('t-random').addEventListener('click', function () {
      $('t-input').value = d.texts[Math.floor(Math.random() * n)];
      classify();
    });
    $('k-range').addEventListener('input', function () { $('k-val').textContent = this.value; });
    $('k-run').addEventListener('click', function () { startKmeans(true); });
    $('k-step').addEventListener('click', function () {
      if (T.timer) { clearInterval(T.timer); T.timer = null; }
      if (!T.km || T.km.done || T.km.k !== +$('k-range').value) startKmeans(false);
      else stepKmeans();
    });
    $('k-reset').addEventListener('click', function () {
      if (T.timer) { clearInterval(T.timer); T.timer = null; }
      T.km = null; T.view = T.project; T.isolate = -1;
      $('k-range').value = T.project.k; $('k-val').textContent = T.project.k;
      $('k-reset').disabled = true;
      refreshView();
    });

    var cv = $('t-map');
    cv.addEventListener('pointermove', onHover);
    cv.addEventListener('pointerdown', onHover);
    cv.addEventListener('pointerleave', function (e) {
      if (e.pointerType !== 'mouse') return; // au doigt, la bulle reste jusqu'au prochain toucher
      T.hover = -1; $('t-tip').hidden = true; drawMap();
    });
    if (window.ResizeObserver) new ResizeObserver(drawMap).observe($('t-mapbox'));
    else window.addEventListener('resize', drawMap);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(drawMap);

    refreshView();
    $('t-status').textContent = 'Prêt';
  }

  function groupName(v, c) { return v.names[c]; }
  function groupColor(v, c) { return c < 0 ? GREY : COLORS[v.colors[c]]; }

  // Tableau des groupes + stats + carte, après tout changement de vue.
  function refreshView() {
    var v = T.view, body = $('t-legend');
    body.textContent = '';
    for (var c = 0; c < v.k; c++) (function (c) {
      var tr = el('tr'), td1 = el('td'), b = el('button');
      b.type = 'button';
      b.setAttribute('aria-pressed', String(T.isolate === c));
      var dot = el('span', 'cv-dot'); dot.style.background = groupColor(v, c);
      b.appendChild(dot); b.appendChild(document.createTextNode(groupName(v, c)));
      b.addEventListener('click', function () { T.isolate = T.isolate === c ? -1 : c; refreshView(); });
      td1.appendChild(b); tr.appendChild(td1);
      tr.appendChild(el('td', '', fr(v.sizes[c])));
      tr.appendChild(el('td', 'cv-words', v.tops[c].slice(0, 6).join(', ')));
      if (T.isolate === c) tr.className = 'is-on';
      body.appendChild(tr);
    })(c);

    var st = $('k-stats');
    st.textContent = '';
    function stat(label, value) { var s = el('span', '', label + ' '); s.appendChild(el('b', '', value)); st.appendChild(s); }
    if (v.mode === 'projet') {
      stat('Affiché :', 'le résultat du projet, k = ' + v.k);
      $('t-legendnote').textContent = "Les noms des groupes sont posés par moi, après coup, en lisant leurs mots dominants. Le modèle n'a jamais vu d'étiquette. Cliquez sur un groupe pour l'isoler sur la carte.";
    } else {
      stat('Tour', String(T.km.iter));
      stat('Points qui ont changé de groupe :', T.km.iter ? fr(T.km.moved) : '—');
      stat('Écart total aux centres :', T.km.iter ? fr(T.km.inertia, 2) : '—');
      stat('', T.km.done ? 'Stable : plus rien ne bouge.' : (T.km.iter ? 'En cours…' : 'Centres de départ posés.'));
      $('t-legendnote').textContent = "Groupes calculés à l'instant dans votre navigateur. Chaque nom reprend les trois mots les plus marquants du groupe. Le point de départ est tiré au hasard : deux essais peuvent donner des groupes un peu différents.";
    }
    if (T.query) showResult();
    drawMap();
  }

  /* ───── classer un texte ───── */

  function classify() {
    var text = $('t-input').value.trim();
    if (!text) { $('t-status').textContent = "Écrivez d'abord un texte."; return; }
    var sp = Core.tfidf(text, T.m);
    if (!sp.idx.length) {
      T.query = null;
      $('t-status').textContent = 'Aucun mot connu du modèle.';
      $('t-found').textContent = '—';
      $('t-foundnote').textContent = "Le modèle ne connaît aucun mot de ce texte. Il a appris sur des témoignages médicaux en anglais : essayez « itchy rash on my arms ».";
      $('t-words').textContent = ''; $('t-near').textContent = '';
      drawMap();
      return;
    }
    var vec = Core.project(sp, T.m);
    var near = Core.neighbours(vec, T.Xn, T.dim, 5);
    // place sur la carte : moyenne des voisins, le plus proche compte le plus
    var x = 0, y = 0, tw = 0;
    near.forEach(function (nb) {
      var w = Math.exp((nb.sim - near[0].sim) / 0.02);
      x += w * T.pos[2 * nb.i]; y += w * T.pos[2 * nb.i + 1]; tw += w;
    });
    T.query = { text: text, sp: sp, vec: vec, near: near, x: x / tw, y: y / tw };
    showResult();
    drawMap();
  }

  function showResult() {
    var q = T.query, v = T.view;
    if (v.mode !== 'projet' && !T.km.iter) return; // pas encore de groupes
    var r = Core.nearestCentroid(q.vec, v.centroids), k = r.k;
    q.k = k;
    var mm = Object.create(T.m); mm.centroids = v.centroids;
    var contrib = Core.contributions(q.sp, mm, k);

    var found = $('t-found'); found.textContent = '';
    var dot = el('span', 'cv-dot'); dot.style.background = groupColor(v, k);
    found.appendChild(dot); found.appendChild(document.createTextNode(groupName(v, k)));
    $('t-foundnote').textContent = fr(v.sizes[k]) + ' témoignages dans ce groupe. Mots reconnus dans votre texte : ' + q.sp.idx.length + '.';
    var st = $('t-status'); st.textContent = 'Groupe : ';
    st.appendChild(el('b', '', groupName(v, k)));

    // barres : mots qui tirent vers le groupe (couleur du groupe) ou ailleurs (gris)
    var ul = $('t-words'); ul.textContent = '';
    var pos = contrib.filter(function (c) { return c.weight > 0; }).slice(0, 5);
    var neg = contrib.filter(function (c) { return c.weight < 0; }).slice(-2);
    var max = Math.max.apply(null, pos.concat(neg).map(function (c) { return Math.abs(c.weight); }).concat([1e-12]));
    pos.concat(neg).forEach(function (c) {
      var li = el('li'), w = el('span', 'cv-w', c.term), tr = el('span', 'cv-track'), f = el('span', 'cv-fill');
      if (c.weight < 0) w.appendChild(el('small', '', 'tire ailleurs'));
      f.style.width = (Math.abs(c.weight) / max * 100).toFixed(1) + '%';
      f.style.background = c.weight > 0 ? groupColor(v, k) : GREY;
      li.title = c.term + ' : ' + (c.weight > 0 ? 'vers ce groupe' : 'vers un autre groupe');
      tr.appendChild(f); li.appendChild(w); li.appendChild(tr); ul.appendChild(li);
    });
    if (!pos.length) ul.appendChild(el('li', '', 'Aucun mot ne tire nettement vers ce groupe.'));

    var nl = $('t-near'); nl.textContent = '';
    q.near.slice(0, 3).forEach(function (nb) {
      var li = el('li', '', T.d.texts[nb.i]), g = v.labels[nb.i];
      li.style.setProperty('--c', groupColor(v, g));
      li.appendChild(el('small', '', g < 0 ? 'pas encore de groupe' : groupName(v, g)));
      nl.appendChild(li);
    });
  }

  /* ───── k-means en direct ───── */

  function startKmeans(auto) {
    if (T.timer) { clearInterval(T.timer); T.timer = null; }
    var k = +$('k-range').value;
    T.km = Core.kmeansInit(T.X, T.dim, k, (Date.now() ^ (Math.random() * 1e9)) >>> 0);
    T.isolate = -1;
    T.view = { mode: 'direct', k: k, labels: T.km.labels, centroids: [], names: [], short: [], tops: [], colors: [], sizes: [] };
    for (var c = 0; c < k; c++) {
      T.view.names.push('Groupe ' + (c + 1)); T.view.short.push(''); T.view.tops.push([]); T.view.colors.push(c); T.view.sizes.push(0);
    }
    $('k-reset').disabled = false;
    refreshView();
    if (auto) T.timer = setInterval(stepKmeans, 700);
  }

  function stepKmeans() {
    var km = T.km, v = T.view, k = km.k, c, i;
    if (km.done || km.iter >= 60) { if (T.timer) { clearInterval(T.timer); T.timer = null; } return; }
    Core.kmeansStep(km);
    v.centroids = [];
    for (c = 0; c < k; c++) v.centroids.push(km.C.subarray(c * T.dim, (c + 1) * T.dim));
    v.sizes = Array.from(km.counts);
    v.tops = Core.topTerms(T.docs, km.labels, k, T.m, 6);
    v.names = v.tops.map(function (t) { return t.slice(0, 3).join(' · '); });
    v.short = v.tops.map(function (t) { return t.slice(0, 2).join(', '); });
    if (km.iter === 1) {
      // couleur : celle du groupe du projet qui recouvre le plus ce groupe (la couleur suit le sujet)
      var pairs = [], used = {}, taken = {};
      var over = [];
      for (c = 0; c < k; c++) over.push(new Int32Array(T.project.k));
      for (i = 0; i < T.n; i++) over[km.labels[i]][T.project.labels[i]]++;
      for (c = 0; c < k; c++) for (i = 0; i < T.project.k; i++) pairs.push([over[c][i], c, i]);
      pairs.sort(function (a, b) { return b[0] - a[0]; });
      pairs.forEach(function (p) { if (!(p[1] in used) && !(p[2] in taken)) { used[p[1]] = p[2]; taken[p[2]] = 1; } });
      var free = COLORS.map(function (_, j) { return j; }).filter(function (j) { return !(j in taken); });
      for (c = 0; c < k; c++) v.colors[c] = (c in used) ? used[c] : free.shift();
    }
    if (km.done && T.timer) { clearInterval(T.timer); T.timer = null; }
    refreshView();
  }

  /* ───── carte ───── */

  var MAP = { w: 0, h: 0, pad: 18 };
  function px(i) {
    return [MAP.pad + T.pos[2 * i] * (MAP.w - 2 * MAP.pad), MAP.pad + T.pos[2 * i + 1] * (MAP.h - 2 * MAP.pad)];
  }
  function drawMap() {
    if (!T) return;
    var cv = $('t-map'), box = $('t-mapbox'), w = box.clientWidth;
    if (!w) return;
    var h = Math.round(Math.max(280, Math.min(w * (w < 520 ? 0.95 : 0.66), 540)));
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
      cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); cv.style.height = h + 'px';
    }
    MAP.w = w; MAP.h = h;
    var g = cv.getContext('2d'), v = T.view, i, c, p;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    var r = w < 520 ? 2.3 : 3;

    // points : groupes estompés d'abord, groupe isolé au-dessus
    for (var pass = 0; pass < 2; pass++) {
      for (i = 0; i < T.n; i++) {
        c = v.labels[i];
        var dim = T.isolate >= 0 && c !== T.isolate;
        if ((pass === 0) !== dim && T.isolate >= 0) continue;
        if (pass === 1 && T.isolate < 0) continue;
        p = px(i);
        g.globalAlpha = dim ? 0.16 : 0.88;
        g.fillStyle = groupColor(v, c);
        g.beginPath(); g.arc(p[0], p[1], r, 0, 6.2832); g.fill();
      }
    }
    g.globalAlpha = 1;

    // nom de chaque groupe, posé au milieu de ses points
    g.font = '600 ' + (w < 520 ? 11 : 12.5) + 'px "Instrument Sans", system-ui, sans-serif';
    g.textBaseline = 'middle'; g.lineJoin = 'round';
    var boxes = [];
    for (c = 0; c < v.k; c++) {
      if (!v.short[c] || (T.isolate >= 0 && T.isolate !== c)) continue;
      var xs = [], ys = [];
      for (i = 0; i < T.n; i++) if (v.labels[i] === c) { p = px(i); xs.push(p[0]); ys.push(p[1]); }
      if (!xs.length) continue;
      xs.sort(function (a, b) { return a - b; }); ys.sort(function (a, b) { return a - b; });
      var tw = g.measureText(v.short[c]).width + 14;
      var bx = Math.max(4, Math.min(w - tw - 4, xs[xs.length >> 1] - tw / 2)), by = ys[ys.length >> 1];
      for (var tries = 0; tries < 12; tries++) {
        var hit = boxes.some(function (b) { return bx < b[0] + b[2] && b[0] < bx + tw && Math.abs(by - b[1]) < 17; });
        if (!hit) break;
        by += 17;
      }
      by = Math.max(10, Math.min(h - 10, by));
      boxes.push([bx, by, tw]);
      g.strokeStyle = STAGE; g.lineWidth = 4;
      g.strokeText(v.short[c], bx + 12, by);
      g.fillStyle = INK; g.fillText(v.short[c], bx + 12, by);
      g.fillStyle = groupColor(v, c); g.strokeStyle = STAGE; g.lineWidth = 2;
      g.beginPath(); g.arc(bx + 4, by, 4, 0, 6.2832); g.fill(); g.stroke();
    }

    // survol
    if (T.hover >= 0) {
      p = px(T.hover);
      g.strokeStyle = INK; g.lineWidth = 1.5;
      g.beginPath(); g.arc(p[0], p[1], r + 3.5, 0, 6.2832); g.stroke();
    }

    // le texte du visiteur
    if (T.query) {
      var q = T.query, qx = MAP.pad + q.x * (w - 2 * MAP.pad), qy = MAP.pad + q.y * (h - 2 * MAP.pad);
      g.strokeStyle = GOLD; g.lineWidth = 1; g.globalAlpha = 0.55;
      q.near.slice(0, 3).forEach(function (nb) {
        var n2 = px(nb.i);
        g.beginPath(); g.moveTo(qx, qy); g.lineTo(n2[0], n2[1]); g.stroke();
      });
      g.globalAlpha = 1;
      q.near.slice(0, 3).forEach(function (nb) {
        var n2 = px(nb.i);
        g.beginPath(); g.arc(n2[0], n2[1], r + 3, 0, 6.2832); g.stroke();
      });
      g.fillStyle = GOLD; g.strokeStyle = STAGE; g.lineWidth = 2.5;
      g.beginPath(); g.arc(qx, qy, 7, 0, 6.2832); g.fill(); g.stroke();
      g.strokeStyle = GOLD; g.lineWidth = 1.5;
      g.beginPath(); g.arc(qx, qy, 11.5, 0, 6.2832); g.stroke();
      var lab = 'Votre texte', lw = g.measureText(lab).width;
      var lx = qx + 16 + lw > w - 4 ? qx - 16 - lw : qx + 16;
      var ly = qy < 14 ? qy + 16 : qy - 1;
      g.strokeStyle = STAGE; g.lineWidth = 4; g.strokeText(lab, lx, ly);
      g.fillStyle = GOLD; g.fillText(lab, lx, ly);
    }
  }

  function onHover(e) {
    var rect = $('t-map').getBoundingClientRect(), x = e.clientX - rect.left, y = e.clientY - rect.top;
    var best = -1, bd = 24 * 24, v = T.view;
    for (var i = 0; i < T.n; i++) {
      if (T.isolate >= 0 && v.labels[i] !== T.isolate) continue;
      var p = px(i), d = (p[0] - x) * (p[0] - x) + (p[1] - y) * (p[1] - y);
      if (d < bd) { bd = d; best = i; }
    }
    var tip = $('t-tip');
    if (best !== T.hover) { T.hover = best; drawMap(); }
    if (best < 0) { tip.hidden = true; return; }
    var g = v.labels[best], t = T.d.texts[best];
    tip.textContent = '';
    var head = el('b'), dot = el('span', 'cv-dot'); dot.style.background = groupColor(v, g);
    head.appendChild(dot); head.appendChild(document.createTextNode(g < 0 ? 'Pas encore de groupe' : groupName(v, g)));
    tip.appendChild(head);
    tip.appendChild(document.createTextNode(t.length > 190 ? t.slice(0, 188) + '…' : t));
    tip.hidden = false;
    var pp = px(best), tw = tip.offsetWidth, th = tip.offsetHeight;
    tip.style.left = Math.max(4, Math.min(MAP.w - tw - 4, pp[0] - tw / 2)) + 'px';
    tip.style.top = (pp[1] + 14 + th > MAP.h ? Math.max(4, pp[1] - th - 12) : pp[1] + 14) + 'px';
  }

  /* ═════════════ Volet 2 : images ═════════════ */

  var CLASS_FR = { glioma: 'Gliome', meningioma: 'Méningiome', notumor: 'Pas de tumeur', pituitary: "Tumeur de l'hypophyse" };
  var I = null;

  function initImages(d) {
    var m = Core.loadImageModel(d);
    I = { d: d, m: m, names: d.classes.map(function (c) { return CLASS_FR[c] || c; }) };
    var box = $('i-thumbs');
    d.samples.forEach(function (s, n) {
      var b = el('button', 'cv-thumb'), img = new Image();
      b.type = 'button';
      img.alt = 'IRM de test n° ' + (n + 1); img.width = 128; img.height = 128; img.loading = 'lazy';
      img.src = s.file;
      b.appendChild(img);
      b.addEventListener('click', function () {
        if (!img.complete || !img.naturalWidth) return;
        Array.prototype.forEach.call(box.children, function (x) { x.classList.remove('is-on'); });
        b.classList.add('is-on');
        var r = analyse(img, s.truth);
        if (!b.querySelector('span')) {
          var ok = r.k === s.truth;
          b.appendChild(el('span', ok ? 'ok' : 'bad', ok ? '✓ juste' : '✗ raté'));
        }
      });
      box.appendChild(b);
    });

    $('i-file').addEventListener('change', function () { if (this.files[0]) loadFile(this.files[0]); this.value = ''; });
    var drop = $('i-drop');
    ['dragenter', 'dragover'].forEach(function (ev) {
      drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add('is-over'); });
    });
    ['dragleave', 'drop'].forEach(function (ev) {
      drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove('is-over'); });
    });
    drop.addEventListener('drop', function (e) {
      var f = e.dataTransfer && e.dataTransfer.files[0];
      if (f) loadFile(f);
    });

    // précision : modèle de la page (mesuré) et les trois modèles du projet
    var acc = d.measured.acc * 100;
    $('h-acc').textContent = fr(acc, 2);
    var rows = [['Cette page · petit réseau', acc, true], ['Projet · forêt aléatoire', 85.38], ['Projet · SVC', 83.12], ['Projet · KNN', 78.38]];
    rows.forEach(function (r) { $('i-models').appendChild(barRow(r[0], r[1], 100, fr(r[1], 2) + ' %', r[2] ? GOLD : GREY)); });
    $('i-modelsnote').textContent = 'Première ligne : mesurée sur le modèle de cette page (' + fr(d.measured.correct) + ' bonnes réponses sur ' +
      fr(d.measured.total) + '). Les trois autres viennent du projet d\'origine. Le modèle web est une version allégée, pas la forêt aléatoire du projet.';
    renderProbs(null, -1, -1);
    $('i-status').textContent = 'Prêt';
  }

  function barRow(label, value, max, text, color, sub) {
    var li = el('li'), w = el('span', 'cv-w', label), tr = el('span', 'cv-track'), f = el('span', 'cv-fill');
    if (sub) w.appendChild(el('small', '', sub));
    f.style.width = Math.max(0, value / max * 100).toFixed(1) + '%';
    f.style.background = color;
    tr.appendChild(f); li.appendChild(w); li.appendChild(tr); li.appendChild(el('span', 'cv-v', text));
    li.title = label + ' : ' + text;
    return li;
  }

  function renderProbs(probs, k, truth) {
    var ul = $('i-probs'); ul.textContent = '';
    I.names.forEach(function (name, c) {
      var p = probs ? probs[c] * 100 : 0;
      ul.appendChild(barRow(name, p, 100, probs ? fr(p, 1) + ' %' : '—', c === k ? GOLD : GREY, c === truth ? 'vraie classe' : ''));
    });
  }

  // Lit les pixels d'une image, applique le prétraitement du projet, puis prédit.
  function analyse(img, truth) {
    var w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
    var scale = Math.min(1, 1024 / Math.max(w, h));
    w = Math.max(1, Math.round(w * scale)); h = Math.max(1, Math.round(h * scale));
    var c = document.createElement('canvas'); c.width = w; c.height = h;
    var g = c.getContext('2d', { willReadFrequently: true });
    g.fillStyle = '#000'; g.fillRect(0, 0, w, h);
    g.drawImage(img, 0, 0, w, h);
    var px64 = Core.imageTo64(g.getImageData(0, 0, w, h).data, w, h, I.m.size);
    var r = Core.predictImage(px64, I.m);

    // ce que le modèle reçoit
    var seen = $('i-seen').getContext('2d'), id = seen.createImageData(64, 64);
    for (var i = 0; i < px64.length; i++) { id.data[4 * i] = id.data[4 * i + 1] = id.data[4 * i + 2] = px64[i]; id.data[4 * i + 3] = 255; }
    seen.putImageData(id, 0, 0);

    renderProbs(r.probs, r.k, truth === undefined ? -1 : truth);
    var v = $('i-verdict'); v.textContent = 'Le modèle répond : ';
    v.appendChild(el('b', '', I.names[r.k]));
    v.appendChild(document.createTextNode(' (' + fr(r.probs[r.k] * 100) + ' %). '));
    var st = $('i-status'); st.textContent = '';
    if (truth === undefined) {
      v.appendChild(document.createTextNode("Image libre : je ne connais pas la bonne réponse, et le modèle n'a appris que sur des IRM de ce jeu."));
      st.textContent = 'Image libre : ' + I.names[r.k];
    } else if (r.k === truth) {
      v.appendChild(el('span', 'ok', '✓ Juste.'));
      st.textContent = '✓ Juste : ' + I.names[r.k];
    } else {
      v.appendChild(el('span', 'bad', '✗ Raté.'));
      v.appendChild(document.createTextNode(' La vraie classe : ' + I.names[truth] + '.'));
      st.textContent = '✗ Raté : la vraie classe est « ' + I.names[truth] + ' »';
    }
    return r;
  }

  function loadFile(file) {
    if (!/^image\//.test(file.type)) { $('i-status').textContent = "Ce fichier n'est pas une image."; return; }
    var url = URL.createObjectURL(file), img = new Image();
    img.onload = function () {
      Array.prototype.forEach.call($('i-thumbs').children, function (x) { x.classList.remove('is-on'); });
      analyse(img);
      URL.revokeObjectURL(url);
    };
    img.onerror = function () { $('i-status').textContent = "Je n'arrive pas à lire cette image."; URL.revokeObjectURL(url); };
    img.src = url;
  }

  /* ═════════════ chargement ═════════════ */

  function load(url, init, statusId) {
    fetch(url).then(function (r) {
      if (!r.ok) throw new Error(r.status);
      return r.json();
    }).then(init).catch(function (e) {
      $(statusId).textContent = 'Données introuvables (' + url + '). Ouvrez la page depuis le site, pas depuis un fichier.';
      if (window.console) console.error(e);
    });
  }
  load('textes.json', initText, 't-status');
  load('images.json', initImages, 'i-status');

  window.CvrieDemo = { text: function () { return T; }, images: function () { return I; } }; // pour les tests
})();
