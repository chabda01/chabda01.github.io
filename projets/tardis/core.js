/* Tardis — cœur du calcul (fonctions pures, sans DOM).
   Reconstitution pédagogique : le code original de ce projet n'a pas été
   retrouvé. Ce fichier est écrit pour cette page, sur un jeu de données
   fictif, pour illustrer la méthode décrite dans le portfolio (nettoyage
   de données ferroviaires, visualisation, modèle de prédiction de retard).
   Chargé par la page et par node (tests). */
(function (root) {
'use strict';

/* ───────── 1. nombres aléatoires reproductibles ───────── */
/* mulberry32 : PRNG minuscule, déterministe à partir d'une graine entière. */
function mulberry32(seed) {
  var s = seed >>> 0;
  return function () {
    s = (s + 0x6D2B79F5) | 0;
    var t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* bruit gaussien (Box-Muller), à partir d'un rand() uniforme [0,1) */
function gaussian(rand) {
  var u1 = Math.max(rand(), 1e-9), u2 = rand();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

/* ───────── 2. jeu de données fictif « SNCF-like » ───────── */
var LINES = [
  { id: 'L1', nom: 'Paris – Lyon', base: 3.0 },
  { id: 'L2', nom: 'Paris – Lille', base: 1.5 },
  { id: 'L3', nom: 'Paris – Nantes', base: 5.0 },
  { id: 'L4', nom: 'Paris – Strasbourg', base: 2.0 },
  { id: 'L5', nom: 'Paris – Marseille', base: 7.0 }
];
var DAY_MS = 86400000;
var BASE_DATE = Date.UTC(2025, 2, 1); /* 1er mars 2025 — arbitraire, fictif */

function pad2(n) { return n < 10 ? '0' + n : String(n); }
function isoDate(t) {
  var d = new Date(t);
  return d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate());
}
function isWeekdayDate(t) {
  var dow = new Date(t).getUTCDay();
  return dow >= 1 && dow <= 5;
}
var DOW_FR = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
function dayNameFR(t) { return DOW_FR[new Date(t).getUTCDay()]; }

/* bosse de retard aux heures de pointe (8h et 18h), en minutes */
function rushBump(hour) {
  return 6 * Math.exp(-Math.pow(hour - 8, 2) / 8) + 7 * Math.exp(-Math.pow(hour - 18, 2) / 8);
}

function lineById(id) {
  for (var i = 0; i < LINES.length; i++) if (LINES[i].id === id) return LINES[i];
  return null;
}

/* Génère un jeu de données BRUT (donc sale) : n trajets « propres » au
   départ, puis on abîme une partie des lignes pour simuler les défauts
   réels d'un export de données — doublons, champs manquants, valeurs
   aberrantes — que la fonction cleanDataset() devra ensuite traiter. */
function generateDataset(seed, n) {
  n = n || 1500;
  var rand = mulberry32(seed);
  var rows = [], id = 1, i, r, t, hour, isWd, retard, line;

  for (i = 0; i < n; i++) {
    line = LINES[Math.floor(rand() * LINES.length)];
    t = BASE_DATE + Math.floor(rand() * 60) * DAY_MS;
    hour = 5 + Math.floor(rand() * 19); /* premiers départs 5h, derniers 23h */
    isWd = isWeekdayDate(t);
    var base = line.base + rushBump(hour) + (isWd ? 1.5 : -1);
    retard = Math.round(base + gaussian(rand) * 6);
    rows.push({ id: id++, ligne: line.id, date: isoDate(t), heure: hour, retard: retard });
  }

  /* --- on abîme le jeu de données, règle par règle --- */
  var nMissing = Math.round(n * 0.03);
  for (i = 0; i < nMissing; i++) rows[Math.floor(rand() * n)].retard = null;

  var nOutliers = Math.round(n * 0.015);
  for (i = 0; i < nOutliers; i++) {
    r = rows[Math.floor(rand() * n)];
    if (r.retard === null) continue;
    r.retard = rand() < 0.5 ? -40 - Math.floor(rand() * 40) : 220 + Math.floor(rand() * 300);
  }

  var nDup = Math.round(n * 0.02);
  for (i = 0; i < nDup; i++) rows.push(Object.assign({}, rows[Math.floor(rand() * rows.length)]));

  var nInvalid = Math.max(3, Math.round(n * 0.006));
  for (i = 0; i < nInvalid; i++) {
    t = BASE_DATE + Math.floor(rand() * 60) * DAY_MS;
    rows.push({ id: id++, ligne: null, date: isoDate(t), heure: 5 + Math.floor(rand() * 19), retard: Math.round(gaussian(rand) * 6) });
  }

  return rows;
}

/* ───────── 3. nettoyage, règle par règle ───────── */
function median(values) {
  if (!values.length) return null;
  var s = values.slice().sort(function (a, b) { return a - b; });
  var mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

var OUTLIER_MIN = -15, OUTLIER_MAX = 180;

function cleanDataset(raw) {
  var i, r;

  /* règle 1 — lignes dont un champ essentiel manque (ligne, date ou heure) */
  var invalid = [], step1 = [];
  for (i = 0; i < raw.length; i++) {
    r = raw[i];
    if (r.ligne == null || r.date == null || r.heure == null) invalid.push(r);
    else step1.push(r);
  }

  /* règle 2 — doublons exacts (même ligne, même date, même heure) */
  var seen = Object.create(null), step2 = [], dupRows = [];
  for (i = 0; i < step1.length; i++) {
    r = step1[i];
    var key = r.ligne + '|' + r.date + '|' + r.heure;
    if (seen[key]) { dupRows.push(r); continue; }
    seen[key] = true;
    step2.push(r);
  }

  /* règle 3 — valeurs aberrantes (retard connu mais hors des bornes réalistes) */
  var outliers = [], step3 = [];
  for (i = 0; i < step2.length; i++) {
    r = step2[i];
    if (r.retard != null && (r.retard < OUTLIER_MIN || r.retard > OUTLIER_MAX)) outliers.push(r);
    else step3.push(r);
  }

  /* règle 4 — valeurs manquantes : on complète par la médiane de la même ligne
     (calculée sur les trajets déjà propres), pas par une moyenne globale. */
  var byLine = Object.create(null);
  for (i = 0; i < step3.length; i++) {
    r = step3[i];
    if (r.retard == null) continue;
    (byLine[r.ligne] || (byLine[r.ligne] = [])).push(r.retard);
  }
  var globalMedian = median(step3.filter(function (x) { return x.retard != null; }).map(function (x) { return x.retard; }));
  var imputedCount = 0;
  var clean = step3.map(function (x) {
    if (x.retard != null) return Object.assign({}, x, { impute: false });
    imputedCount++;
    var pool = byLine[x.ligne];
    var val = pool && pool.length ? median(pool) : globalMedian;
    return Object.assign({}, x, { retard: val, impute: true });
  });

  return {
    clean: clean,
    excluded: { invalid: invalid, duplicates: dupRows, outliers: outliers },
    report: {
      totalRaw: raw.length,
      invalid: invalid.length,
      duplicates: dupRows.length,
      outliers: outliers.length,
      imputed: imputedCount,
      totalClean: clean.length
    }
  };
}

/* ───────── 4. statistiques et visualisations ───────── */
function mean(values) {
  if (!values.length) return null;
  var s = 0; for (var i = 0; i < values.length; i++) s += values[i];
  return s / values.length;
}

function histogram(values, min, max, step) {
  var nBins = Math.ceil((max - min) / step);
  var bins = [];
  for (var b = 0; b < nBins; b++) bins.push({ from: min + b * step, to: min + (b + 1) * step, count: 0 });
  var over = 0, under = 0;
  for (var i = 0; i < values.length; i++) {
    var v = values[i];
    if (v < min) { under++; continue; }
    if (v >= max) { over++; continue; }
    bins[Math.floor((v - min) / step)].count++;
  }
  return { bins: bins, under: under, over: over };
}

/* moyenne groupée (par ligne, par heure…) ; keyFn(row) -> clé */
function groupAverage(rows, keyFn) {
  var groups = Object.create(null), order = [];
  for (var i = 0; i < rows.length; i++) {
    var k = keyFn(rows[i]);
    if (!groups[k]) { groups[k] = []; order.push(k); }
    groups[k].push(rows[i].retard);
  }
  return order.map(function (k) {
    return { key: k, avg: mean(groups[k]), n: groups[k].length };
  });
}

/* ───────── 5. régression linéaire, entraînée en direct ───────── */
/* une feature par ligne sauf la première (ligne de référence) + heure
   standardisée + son carré (pour la bosse de pointe) + jour ouvré. */
function fitScaler(values) {
  var m = mean(values);
  var variance = mean(values.map(function (v) { return (v - m) * (v - m); }));
  var sd = Math.sqrt(variance) || 1;
  return { mean: m, sd: sd, z: function (v) { return (v - m) / sd; } };
}

/* indicatrices « proche de l'heure de pointe » (matin 8h, soir 18h) :
   une parabole unique ne peut pas représenter deux pics, donc on ajoute
   ces deux colonnes plutôt qu'un simple carré de l'heure. */
function bumpFeature(hour, center) { return Math.exp(-Math.pow(hour - center, 2) / 8); }

function featureNames() {
  var names = ['biais', 'heure_std', 'pointe_matin', 'pointe_soir', 'jour_ouvré'];
  for (var i = 1; i < LINES.length; i++) names.push('ligne=' + LINES[i].id);
  return names;
}

function buildRow(r, scaler) {
  var hz = scaler.z(r.heure);
  var row = [1, hz, bumpFeature(r.heure, 8), bumpFeature(r.heure, 18), isWeekdayDate(Date.parse(r.date)) ? 1 : 0];
  for (var i = 1; i < LINES.length; i++) row.push(r.ligne === LINES[i].id ? 1 : 0);
  return row;
}

function buildDesignMatrix(rows, scaler) {
  return { X: rows.map(function (r) { return buildRow(r, scaler); }), y: rows.map(function (r) { return r.retard; }) };
}

function dot(a, b) { var s = 0; for (var i = 0; i < a.length; i++) s += a[i] * b[i]; return s; }

/* descente de gradient, batch complet, MSE. renvoie les poids et la courbe de perte. */
function trainLinearRegression(X, y, opts) {
  opts = opts || {};
  var epochs = opts.epochs || 300, lr = opts.lr || 0.15;
  var n = X.length, d = X[0].length;
  var w = new Array(d).fill(0);
  var lossHistory = [];
  for (var e = 0; e < epochs; e++) {
    var grad = new Array(d).fill(0), sqErr = 0;
    for (var i = 0; i < n; i++) {
      var pred = dot(X[i], w);
      var err = pred - y[i];
      sqErr += err * err;
      for (var j = 0; j < d; j++) grad[j] += err * X[i][j];
    }
    for (var j2 = 0; j2 < d; j2++) w[j2] -= (lr * 2 / n) * grad[j2];
    lossHistory.push(sqErr / n);
  }
  return { weights: w, lossHistory: lossHistory };
}

function predictRow(weights, featureRow) { return dot(weights, featureRow); }

function mae(yTrue, yPred) {
  var s = 0; for (var i = 0; i < yTrue.length; i++) s += Math.abs(yTrue[i] - yPred[i]);
  return s / yTrue.length;
}
function rmse(yTrue, yPred) {
  var s = 0; for (var i = 0; i < yTrue.length; i++) s += (yTrue[i] - yPred[i]) * (yTrue[i] - yPred[i]);
  return Math.sqrt(s / yTrue.length);
}
function r2(yTrue, yPred) {
  var m = mean(yTrue), ssRes = 0, ssTot = 0;
  for (var i = 0; i < yTrue.length; i++) {
    ssRes += (yTrue[i] - yPred[i]) * (yTrue[i] - yPred[i]);
    ssTot += (yTrue[i] - m) * (yTrue[i] - m);
  }
  return ssTot === 0 ? 0 : 1 - ssRes / ssTot;
}

/* séparation train/test, mélange déterministe (Fisher-Yates) avec un rand() donné */
function splitTrainTest(rows, ratio, rand) {
  var a = rows.slice();
  for (var i = a.length - 1; i > 0; i--) {
    var j = Math.floor(rand() * (i + 1));
    var tmp = a[i]; a[i] = a[j]; a[j] = tmp;
  }
  var cut = Math.round(a.length * ratio);
  return { train: a.slice(0, cut), test: a.slice(cut) };
}

/* pipeline complet : split → standardisation (apprise sur le train) →
   entraînement → métriques mesurées sur le test. */
function fitModel(cleanRows, opts) {
  opts = opts || {};
  var rand = mulberry32((opts.seed || 1) + 97);
  var split = splitTrainTest(cleanRows, opts.trainRatio || 0.8, rand);
  var scaler = fitScaler(split.train.map(function (r) { return r.heure; }));
  var trainMat = buildDesignMatrix(split.train, scaler);
  var testMat = buildDesignMatrix(split.test, scaler);
  var fit = trainLinearRegression(trainMat.X, trainMat.y, { epochs: opts.epochs || 300, lr: opts.lr || 0.15 });
  var predTest = testMat.X.map(function (row) { return predictRow(fit.weights, row); });
  return {
    weights: fit.weights,
    lossHistory: fit.lossHistory,
    scaler: scaler,
    trainSize: split.train.length,
    testSize: split.test.length,
    metrics: { mae: mae(testMat.y, predTest), rmse: rmse(testMat.y, predTest), r2: r2(testMat.y, predTest) },
    featureNames: featureNames()
  };
}

function predictFor(model, ligne, heure, estWeekday) {
  var hz = model.scaler.z(heure);
  var row = [1, hz, bumpFeature(heure, 8), bumpFeature(heure, 18), estWeekday ? 1 : 0];
  for (var i = 1; i < LINES.length; i++) row.push(ligne === LINES[i].id ? 1 : 0);
  return predictRow(model.weights, row);
}

/* ───────── export ───────── */
var api = {
  LINES: LINES, lineById: lineById, isWeekdayDate: isWeekdayDate, dayNameFR: dayNameFR, isoDate: isoDate,
  mulberry32: mulberry32, gaussian: gaussian,
  generateDataset: generateDataset,
  cleanDataset: cleanDataset, OUTLIER_MIN: OUTLIER_MIN, OUTLIER_MAX: OUTLIER_MAX, median: median,
  mean: mean, histogram: histogram, groupAverage: groupAverage,
  fitScaler: fitScaler, buildRow: buildRow, buildDesignMatrix: buildDesignMatrix,
  trainLinearRegression: trainLinearRegression, predictRow: predictRow,
  mae: mae, rmse: rmse, r2: r2, splitTrainTest: splitTrainTest,
  fitModel: fitModel, predictFor: predictFor, featureNames: featureNames
};
if (typeof module !== 'undefined' && module.exports) module.exports = api;
else root.TARDIS = api;
})(typeof self !== 'undefined' ? self : this);
