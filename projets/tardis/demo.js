/* Tardis — interface de la démo. Le calcul est dans core.js.
   Reconstitution pédagogique sur données fictives (voir bandeau en tête de page). */
(function () {
'use strict';

var T = window.TARDIS;
var $ = function (id) { return document.getElementById(id); };

var COL = { gold: '#E9A855', ink: '#F0EADF', ink2: '#B9AF9D', ink3: '#8D8477', ok: '#7FB77E', bad: '#E0775F', grid: 'rgba(240,234,224,.1)' };
var FONT = '11px "Instrument Sans",system-ui,sans-serif';
var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
var lite = (navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 4) || window.matchMedia('(pointer: coarse)').matches;

var st = { seed: 1, raw: [], cleanResult: null, model: null, chart: 'hist', jour: 'ouvre' };

/* ───────── petits outils ───────── */
function fr(x, d) { return x.toLocaleString('fr-FR', { minimumFractionDigits: d || 0, maximumFractionDigits: d || 0 }); }
function dateFR(iso) { var p = iso.split('-'); return p[2] + '/' + p[1] + '/' + p[0]; }
function heureFR(h) { return h + ' h'; }
function signed(x, d) { var s = fr(Math.abs(x), d); return (x >= 0 ? '+' : '–') + s; }

function fit(canvas) {
  var r = canvas.parentNode.getBoundingClientRect();
  var d = Math.min(window.devicePixelRatio || 1, 2);
  var w = Math.max(50, Math.round(r.width)), h = Math.max(50, Math.round(r.height));
  if (canvas.width !== w * d || canvas.height !== h * d) { canvas.width = w * d; canvas.height = h * d; }
  var ctx = canvas.getContext('2d');
  ctx.setTransform(d, 0, 0, d, 0, 0);
  ctx.clearRect(0, 0, w, h);
  ctx.font = FONT;
  return { ctx: ctx, w: w, h: h };
}

function el(tag, cls, text) {
  var e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

/* ───────── onglets (étapes) ───────── */
var panes = ['donnees', 'nettoyage', 'viz', 'modele'];
document.querySelectorAll('.tabs .chip').forEach(function (btn) {
  btn.addEventListener('click', function () {
    document.querySelectorAll('.tabs .chip').forEach(function (b) {
      b.classList.toggle('is-on', b === btn);
      b.setAttribute('aria-pressed', b === btn ? 'true' : 'false');
    });
    panes.forEach(function (p) { $('td-pane-' + p).hidden = (p !== btn.dataset.pane); });
    if (btn.dataset.pane === 'viz') requestAnimationFrame(drawChart);
    if (btn.dataset.pane === 'modele' && st.model) requestAnimationFrame(function () { drawLoss(st.model.lossHistory, 1); });
  });
});

/* ───────── onglet 1 : aperçu brut ───────── */
function renderSample() {
  var body = $('td-sample-body');
  body.textContent = '';
  st.raw.slice(0, 14).forEach(function (r) {
    var tr = el('tr');
    tr.appendChild(el('td', null, '#' + r.id));
    tr.appendChild(el('td', null, r.ligne || '—'));
    tr.appendChild(el('td', null, dateFR(r.date)));
    tr.appendChild(el('td', null, heureFR(r.heure)));
    var tdRetard = el('td', null, r.retard == null ? '—' : signed(r.retard, 0).replace('–', '-') + ' min');
    tr.appendChild(tdRetard);
    body.appendChild(tr);
  });
  $('td-sample-cap').textContent = 'Aperçu des 14 premiers trajets sur ' + fr(st.raw.length) + ' générés. « — » = valeur manquante dans le jeu brut.';
}

/* ───────── onglet 2 : nettoyage, règle par règle ───────── */
function exCode(r, extra) {
  return '#' + r.id + ' · ' + (r.ligne || '—') + ' · ' + dateFR(r.date) + ' · ' + heureFR(r.heure) + (extra ? ' · ' + extra : '');
}
function renderRules() {
  var rep = st.cleanResult.report, ex = st.cleanResult.excluded;
  var wrap = $('td-rules');
  wrap.textContent = '';

  function card(title, desc, count, examples) {
    var c = el('div', 'rule-card');
    var head = el('div', 'rule-card__head');
    head.appendChild(el('h3', null, title));
    head.appendChild(el('span', 'rule-count', fr(count)));
    c.appendChild(head);
    c.appendChild(el('p', null, desc));
    var exWrap = el('div', 'rule-ex');
    if (examples.length) examples.forEach(function (t) { exWrap.appendChild(el('code', null, t)); });
    else exWrap.appendChild(el('code', null, 'aucun cas dans ce jeu'));
    c.appendChild(exWrap);
    wrap.appendChild(c);
  }

  card('1 · Lignes invalides',
    'Un champ essentiel (ligne, date ou heure) manque → la ligne est supprimée.',
    rep.invalid,
    ex.invalid.slice(0, 3).map(function (r) { return exCode(r, 'champ manquant'); }));

  card('2 · Doublons',
    'Même ligne, même date, même heure vues plusieurs fois → on garde la première occurrence, les suivantes sont supprimées.',
    rep.duplicates,
    ex.duplicates.slice(0, 3).map(function (r) { return exCode(r, 'déjà vue'); }));

  card('3 · Valeurs aberrantes',
    'Retard inférieur à ' + T.OUTLIER_MIN + ' min ou supérieur à ' + T.OUTLIER_MAX + ' min (3 h) → la ligne est retirée.',
    rep.outliers,
    ex.outliers.slice(0, 3).map(function (r) { return exCode(r, 'retard = ' + r.retard + ' min'); }));

  var imputedRows = st.cleanResult.clean.filter(function (r) { return r.impute; });
  card('4 · Valeurs manquantes',
    'Retard absent → complété par la médiane des trajets propres de la même ligne.',
    rep.imputed,
    imputedRows.slice(0, 3).map(function (r) { return exCode(r, 'complété à ' + fr(r.retard) + ' min'); }));
}

/* ───────── réglages (panneau latéral) ───────── */
function renderStats() {
  var rep = st.cleanResult.report;
  $('td-s-raw').textContent = fr(rep.totalRaw);
  $('td-s-dup').textContent = fr(rep.duplicates);
  $('td-s-miss').textContent = fr(rep.imputed);
  $('td-s-out').textContent = fr(rep.outliers);
  $('td-s-clean').textContent = fr(rep.totalClean);
}

/* ───────── onglet 3 : visualisations ───────── */
function drawHistogram() {
  var g = fit($('td-chart')), ctx = g.ctx, w = g.w, h = g.h;
  var vals = st.cleanResult.clean.map(function (r) { return r.retard; });
  var h2 = T.histogram(vals, -15, 60, 5);
  var L = 32, R = 10, Tt = 10, B = 24, pw = w - L - R, ph = h - Tt - B;
  var bins = h2.bins.concat([{ from: 60, to: null, count: h2.over, overflow: true }]);
  var maxCount = Math.max(1, bins.reduce(function (m, b) { return Math.max(m, b.count); }, 0));
  var bw = pw / bins.length;

  ctx.strokeStyle = COL.grid; ctx.fillStyle = COL.ink3; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
  for (var gy = 0; gy <= 4; gy++) {
    var y = Tt + ph - (ph * gy / 4);
    ctx.beginPath(); ctx.moveTo(L, y); ctx.lineTo(L + pw, y); ctx.stroke();
    ctx.fillText(fr(Math.round(maxCount * gy / 4)), L - 6, y);
  }
  ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
  bins.forEach(function (b, i) {
    var x = L + i * bw, bh = (b.count / maxCount) * ph;
    ctx.fillStyle = b.overflow ? COL.bad : COL.gold;
    ctx.globalAlpha = .85;
    ctx.fillRect(x + 1, Tt + ph - bh, bw - 2, bh);
    ctx.globalAlpha = 1;
    if (i % 2 === 0 || bins.length <= 10) {
      ctx.fillStyle = COL.ink3;
      ctx.fillText(b.overflow ? '60+' : String(b.from), x + bw / 2, Tt + ph + 15);
    }
  });
}

function drawGroupBars(keyFn, labelFn, order) {
  var g = fit($('td-chart')), ctx = g.ctx, w = g.w, h = g.h;
  var groups = T.groupAverage(st.cleanResult.clean, keyFn);
  var byKey = {}; groups.forEach(function (gr) { byKey[gr.key] = gr; });
  var items = order.map(function (k) { return byKey[k] || { key: k, avg: 0, n: 0 }; });
  var L = 32, R = 10, Tt = 10, B = 24, pw = w - L - R, ph = h - Tt - B;
  var maxAvg = Math.max(1, items.reduce(function (m, b) { return Math.max(m, b.avg); }, 0)) * 1.15;
  var bw = pw / items.length;

  ctx.strokeStyle = COL.grid; ctx.fillStyle = COL.ink3; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
  for (var gy = 0; gy <= 4; gy++) {
    var y = Tt + ph - (ph * gy / 4);
    ctx.beginPath(); ctx.moveTo(L, y); ctx.lineTo(L + pw, y); ctx.stroke();
    ctx.fillText(fr(maxAvg * gy / 4, 0), L - 6, y);
  }
  ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
  items.forEach(function (b, i) {
    var x = L + i * bw, bh = (b.avg / maxAvg) * ph;
    ctx.fillStyle = COL.gold; ctx.globalAlpha = .85;
    ctx.fillRect(x + 2, Tt + ph - bh, bw - 4, bh);
    ctx.globalAlpha = 1;
    ctx.fillStyle = COL.ink3;
    ctx.fillText(labelFn(b.key), x + bw / 2, Tt + ph + 15);
  });
}

function drawChart() {
  if ($('td-pane-viz').hidden) return;
  if (st.chart === 'hist') {
    drawHistogram();
    $('td-chart-cap').textContent = 'Nombre de trajets par tranche de 5 minutes de retard, sur les ' + fr(st.cleanResult.report.totalClean) + ' trajets propres. La barre rouge regroupe les retards de 60 minutes ou plus.';
  } else if (st.chart === 'ligne') {
    drawGroupBars(function (r) { return r.ligne; }, function (k) { return k; }, T.LINES.map(function (l) { return l.id; }));
    $('td-chart-cap').textContent = 'Retard moyen par ligne fictive, mesuré sur le jeu propre.';
  } else {
    var hours = []; for (var hh = 5; hh <= 23; hh++) hours.push(hh);
    drawGroupBars(function (r) { return r.heure; }, function (k) { return k; }, hours);
    $('td-chart-cap').textContent = "Retard moyen par heure de départ (5 h à 23 h), mesuré sur le jeu propre. Les heures de pointe (8 h, 18 h) se voient à l'œil nu.";
  }
}
document.getElementById('td-viz-chips').addEventListener('click', function (e) {
  var btn = e.target.closest('.chip'); if (!btn) return;
  document.querySelectorAll('#td-viz-chips .chip').forEach(function (b) {
    b.classList.toggle('is-on', b === btn); b.setAttribute('aria-pressed', b === btn ? 'true' : 'false');
  });
  st.chart = btn.dataset.chart;
  drawChart();
});

/* ───────── onglet 4 : modèle ───────── */
function drawLoss(history, progress) {
  var g = fit($('td-loss')), ctx = g.ctx, w = g.w, h = g.h;
  if (!history || !history.length) return;
  var L = 4, R = 4, Tt = 8, B = 8, pw = w - L - R, ph = h - Tt - B;
  var n = Math.max(2, Math.round(history.length * progress));
  var slice = history.slice(0, n);
  var maxLoss = history[0] || 1, minLoss = Math.min.apply(null, history);
  ctx.strokeStyle = COL.gold; ctx.lineWidth = 1.6; ctx.beginPath();
  slice.forEach(function (v, i) {
    var x = L + (i / (history.length - 1)) * pw;
    var yy = Tt + ph - ((v - minLoss) / Math.max(1e-6, maxLoss - minLoss)) * ph;
    if (i === 0) ctx.moveTo(x, yy); else ctx.lineTo(x, yy);
  });
  ctx.stroke();
}

function animateLoss(history) {
  if (reduced) { drawLoss(history, 1); return; }
  var t0 = performance.now(), dur = 650;
  function step(now) {
    var p = Math.min(1, (now - t0) / dur);
    drawLoss(history, p);
    if (p < 1 && !$('td-pane-modele').hidden) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

function fillPredictControls() {
  var selL = $('td-pred-ligne'); selL.textContent = '';
  T.LINES.forEach(function (l) { var o = el('option', null, l.nom); o.value = l.id; selL.appendChild(o); });
  var selH = $('td-pred-heure'); selH.textContent = '';
  for (var h = 5; h <= 23; h++) { var o2 = el('option', null, heureFR(h)); o2.value = String(h); selH.appendChild(o2); }
  selH.value = '8';
}

function resetModelUI() {
  st.model = null;
  $('td-metrics').hidden = true;
  $('td-metrics-cap').textContent = '';
  $('td-train-status').textContent = 'Pas encore entraîné';
  $('td-train').disabled = false;
  $('td-pred-go').disabled = true;
  $('td-pred-result').textContent = '';
  var c = $('td-loss'); var g = fit(c); g.ctx.clearRect(0, 0, g.w, g.h);
}

$('td-train').addEventListener('click', function () {
  $('td-train').disabled = true;
  $('td-train-status').textContent = 'Entraînement en cours…';
  // le calcul est très rapide (jeu fictif, quelques milliers de lignes) ;
  // on le lance après un tick pour laisser le statut s'afficher.
  requestAnimationFrame(function () {
    var model = T.fitModel(st.cleanResult.clean, { seed: st.seed, epochs: 300, lr: 0.15 });
    st.model = model;
    $('td-train-status').textContent = 'Entraîné sur ' + fr(model.trainSize) + ' trajets · testé sur ' + fr(model.testSize);
    $('td-m-mae').textContent = fr(model.metrics.mae, 1);
    $('td-m-rmse').textContent = fr(model.metrics.rmse, 1);
    $('td-m-r2').textContent = fr(model.metrics.r2, 2);
    $('td-m-test').textContent = fr(model.testSize);
    $('td-metrics').hidden = false;
    $('td-metrics-cap').textContent = 'Mesuré sur les ' + fr(model.testSize) + ' trajets de test (jamais vus pendant l’entraînement), sur ce jeu de données fictif — pas un résultat du vrai projet.';
    $('td-train').disabled = false;
    $('td-pred-go').disabled = false;
    animateLoss(model.lossHistory);
  });
});

['td-pred-ouvre', 'td-pred-weekend'].forEach(function (id) {
  $(id).addEventListener('click', function () {
    st.jour = id === 'td-pred-ouvre' ? 'ouvre' : 'weekend';
    $('td-pred-ouvre').classList.toggle('is-on', st.jour === 'ouvre');
    $('td-pred-ouvre').setAttribute('aria-pressed', st.jour === 'ouvre' ? 'true' : 'false');
    $('td-pred-weekend').classList.toggle('is-on', st.jour === 'weekend');
    $('td-pred-weekend').setAttribute('aria-pressed', st.jour === 'weekend' ? 'true' : 'false');
  });
});

$('td-pred-go').addEventListener('click', function () {
  if (!st.model) return;
  var ligne = $('td-pred-ligne').value, heure = parseInt($('td-pred-heure').value, 10);
  var pred = T.predictFor(st.model, ligne, heure, st.jour === 'ouvre');
  var similar = st.cleanResult.clean.filter(function (r) { return r.ligne === ligne && r.heure === heure; });
  var avg = similar.length ? T.mean(similar.map(function (r) { return r.retard; })) : null;
  var html = '<b>' + signed(pred, 1) + ' min</b> de retard estimé pour cette ligne, à cette heure.';
  html += '<small>';
  if (avg != null) html += 'Pour comparaison : les ' + fr(similar.length) + ' trajets similaires du jeu nettoyé ont un retard moyen mesuré de ' + signed(avg, 1) + ' min.';
  else html += 'Aucun trajet comparable dans le jeu nettoyé actuel pour vérifier à l’œil.';
  html += '</small>';
  $('td-pred-result').innerHTML = html;
});

/* ───────── jeu de données : génération et nettoyage ───────── */
function doRegen() {
  var n = parseInt($('td-n').value, 10);
  st.raw = T.generateDataset(st.seed, n);
  st.cleanResult = T.cleanDataset(st.raw);
  renderSample(); renderRules(); renderStats(); resetModelUI();
  if (!$('td-pane-viz').hidden) drawChart();
}

var regenToken = 0;
function scheduleRegen() {
  var token = ++regenToken;
  requestAnimationFrame(function () { if (token === regenToken) doRegen(); });
}

$('td-n').addEventListener('input', function () {
  $('td-n-val').textContent = fr(parseInt($('td-n').value, 10));
  scheduleRegen();
});
$('td-reseed').addEventListener('click', function () {
  st.seed = Math.floor(Math.random() * 1e9);
  doRegen();
});

window.addEventListener('resize', function () {
  if (!$('td-pane-viz').hidden) drawChart();
  if (!$('td-pane-modele').hidden && st.model) drawLoss(st.model.lossHistory, 1);
});

/* ───────── démarrage ───────── */
(function init() {
  var n0 = lite ? 800 : 1500;
  $('td-n').value = String(n0);
  $('td-n-val').textContent = fr(n0);
  fillPredictControls();
  doRegen();
})();
})();
