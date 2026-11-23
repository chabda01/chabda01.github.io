/* DR CVRIE — cœur du calcul, sans interface.
   Fonctions pures : elles marchent dans le navigateur (window.CvrieCore) et dans node (require). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CvrieCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ───── outils ───── */

  // base64 → octets
  function b64ToBytes(b64) {
    if (typeof atob === 'function') {
      var bin = atob(b64), out = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
      return out;
    }
    return new Uint8Array(Buffer.from(b64, 'base64'));
  }
  // base64 → entiers 16 bits (petit-boutiste)
  function b64ToU16(b64) {
    var b = b64ToBytes(b64), out = new Uint16Array(b.length >> 1);
    for (var i = 0; i < out.length; i++) out[i] = b[2 * i] | (b[2 * i + 1] << 8);
    return out;
  }
  // base64 → entiers 8 bits signés
  function b64ToI8(b64) {
    var b = b64ToBytes(b64);
    return new Int8Array(b.buffer, b.byteOffset, b.length);
  }
  // hasard reproductible
  function rng(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* ───── volet textes ───── */

  // Prépare le modèle exporté par Python (vocabulaire, idf, matrice H, centres).
  function loadTextModel(d) {
    var m = {
      n: d.n, nFeat: d.nFeat, nComp: d.nComp, k: d.k,
      vocab: d.vocab, idf: d.idf, index: new Map(),
      stopGeneric: new Set(d.stopGeneric), stopEnglish: new Set(d.stopEnglish),
      centroids: d.centroids.map(function (c) { return Float64Array.from(c); })
    };
    for (var i = 0; i < d.vocab.length; i++) m.index.set(d.vocab[i], i);
    // H : 40 lignes × nFeat colonnes, rangée par colonne pour lire vite un mot
    var q = b64ToU16(d.H);
    m.H = new Float32Array(d.nComp * d.nFeat);
    for (var j = 0; j < d.nComp; j++) {
      var s = d.hScale[j] / 65535;
      for (var t = 0; t < d.nFeat; t++) m.H[t * d.nComp + j] = q[j * d.nFeat + t] * s;
    }
    return m;
  }

  // Même nettoyage que clean_text() du projet : minuscules, lettres seules,
  // mots de 3 lettres ou plus, sans les mots trop généraux.
  function cleanText(text, m) {
    var w = String(text).toLowerCase().replace(/[^a-z]+/g, ' ').split(' '), out = [];
    for (var i = 0; i < w.length; i++) {
      if (w[i].length > 2 && !m.stopGeneric.has(w[i])) out.push(w[i]);
    }
    return out;
  }

  // TF-IDF comme TfidfVectorizer(sublinear_tf, ngram 1-2, stop_words='english', norme L2).
  // Renvoie un vecteur creux : idx (colonnes), val (poids), terms (mots).
  function tfidf(text, m) {
    var toks = cleanText(text, m).filter(function (w) { return !m.stopEnglish.has(w); });
    var counts = new Map(), i, id;
    for (i = 0; i < toks.length; i++) {
      id = m.index.get(toks[i]);
      if (id !== undefined) counts.set(id, (counts.get(id) || 0) + 1);
      if (i + 1 < toks.length) {
        id = m.index.get(toks[i] + ' ' + toks[i + 1]);
        if (id !== undefined) counts.set(id, (counts.get(id) || 0) + 1);
      }
    }
    var idx = Array.from(counts.keys()).sort(function (a, b) { return a - b; });
    var val = new Float64Array(idx.length), norm = 0;
    for (i = 0; i < idx.length; i++) {
      val[i] = (1 + Math.log(counts.get(idx[i]))) * m.idf[idx[i]];
      norm += val[i] * val[i];
    }
    norm = Math.sqrt(norm) || 1;
    for (i = 0; i < idx.length; i++) val[i] /= norm;
    return { idx: idx, val: val, terms: idx.map(function (t) { return m.vocab[t]; }), nTokens: toks.length };
  }

  // Passage en 40 thèmes : w = H·x puis norme L2.
  // (Mesuré : c'est exactement ce que rend nmf.transform() + normalize() du projet.)
  function project(sp, m) {
    var w = new Float64Array(m.nComp), i, j, norm = 0;
    for (i = 0; i < sp.idx.length; i++) {
      var o = sp.idx[i] * m.nComp, v = sp.val[i];
      for (j = 0; j < m.nComp; j++) w[j] += v * m.H[o + j];
    }
    for (j = 0; j < m.nComp; j++) norm += w[j] * w[j];
    norm = Math.sqrt(norm);
    if (norm > 0) for (j = 0; j < m.nComp; j++) w[j] /= norm;
    return w;
  }

  function dist2(a, b, ao, bo, n) {
    var s = 0;
    for (var j = 0; j < n; j++) { var d = a[ao + j] - b[bo + j]; s += d * d; }
    return s;
  }

  // Centre le plus proche (distance euclidienne, comme KMeans.predict).
  function nearestCentroid(vec, centroids) {
    var best = 0, bd = Infinity, d = [];
    for (var c = 0; c < centroids.length; c++) {
      var x = dist2(vec, centroids[c], 0, 0, vec.length);
      d.push(Math.sqrt(x));
      if (x < bd) { bd = x; best = c; }
    }
    return { k: best, dists: d };
  }

  // Chaîne complète pour un texte : nettoyage → TF-IDF → 40 thèmes → groupe.
  function assign(text, m) {
    var sp = tfidf(text, m);
    if (!sp.idx.length) return { known: false, sp: sp };
    var vec = project(sp, m), r = nearestCentroid(vec, m.centroids);
    return { known: true, sp: sp, vec: vec, k: r.k, dists: r.dists };
  }

  // Les n lignes de `mat` (lignes × dim, vecteurs de norme 1) les plus proches de vec.
  function neighbours(vec, mat, dim, n) {
    var rows = mat.length / dim, sims = new Float64Array(rows), order = [];
    for (var r = 0; r < rows; r++) {
      var s = 0, o = r * dim;
      for (var j = 0; j < dim; j++) s += vec[j] * mat[o + j];
      sims[r] = s; order.push(r);
    }
    order.sort(function (a, b) { return sims[b] - sims[a]; });
    return order.slice(0, n).map(function (r) { return { i: r, sim: sims[r] }; });
  }

  // Poids de chaque mot du texte vers le groupe k, comparé à la moyenne des groupes.
  // Positif : le mot tire vers ce groupe. Négatif : il tire ailleurs.
  function contributions(sp, m, k) {
    var out = [];
    for (var i = 0; i < sp.idx.length; i++) {
      var o = sp.idx[i] * m.nComp, mean = 0, own = 0;
      for (var c = 0; c < m.centroids.length; c++) {
        var s = 0;
        for (var j = 0; j < m.nComp; j++) s += m.H[o + j] * m.centroids[c][j];
        mean += s / m.centroids.length;
        if (c === k) own = s;
      }
      out.push({ term: sp.terms[i], weight: sp.val[i] * (own - mean) });
    }
    out.sort(function (a, b) { return b.weight - a.weight; });
    return out;
  }

  /* ───── k-means (algorithme de Lloyd, départ k-means++) ───── */

  function kmeansInit(X, dim, k, seed) {
    var n = X.length / dim, rand = rng(seed), C = new Float64Array(k * dim);
    var d = new Float64Array(n).fill(Infinity), c, i, j;
    var first = Math.floor(rand() * n);
    for (j = 0; j < dim; j++) C[j] = X[first * dim + j];
    for (c = 1; c < k; c++) {
      var total = 0;
      for (i = 0; i < n; i++) {
        var x = dist2(X, C, i * dim, (c - 1) * dim, dim);
        if (x < d[i]) d[i] = x;
        total += d[i];
      }
      var r = rand() * total, pick = n - 1;
      for (i = 0; i < n; i++) { r -= d[i]; if (r <= 0) { pick = i; break; } }
      for (j = 0; j < dim; j++) C[c * dim + j] = X[pick * dim + j];
    }
    return { X: X, dim: dim, k: k, n: n, C: C, labels: new Int32Array(n).fill(-1), iter: 0, moved: n, inertia: NaN, done: false };
  }

  // Un tour : chaque point rejoint le centre le plus proche, puis chaque centre se recentre.
  function kmeansStep(st) {
    var X = st.X, dim = st.dim, k = st.k, n = st.n, i, c, j;
    var moved = 0, inertia = 0, sums = new Float64Array(k * dim), counts = new Int32Array(k);
    for (i = 0; i < n; i++) {
      var best = 0, bd = Infinity;
      for (c = 0; c < k; c++) {
        var x = dist2(X, st.C, i * dim, c * dim, dim);
        if (x < bd) { bd = x; best = c; }
      }
      if (st.labels[i] !== best) { moved++; st.labels[i] = best; }
      inertia += bd; counts[best]++;
      for (j = 0; j < dim; j++) sums[best * dim + j] += X[i * dim + j];
    }
    for (c = 0; c < k; c++) {
      if (!counts[c]) continue; // groupe vide : le centre reste en place
      for (j = 0; j < dim; j++) st.C[c * dim + j] = sums[c * dim + j] / counts[c];
    }
    st.iter++; st.moved = moved; st.inertia = inertia; st.counts = counts;
    st.done = moved === 0;
    return st;
  }

  function kmeansRun(X, dim, k, seed, maxIter) {
    var st = kmeansInit(X, dim, k, seed);
    for (var it = 0; it < (maxIter || 300) && !st.done; it++) kmeansStep(st);
    return st;
  }

  // Mots qui distinguent chaque groupe : poids moyen dans le groupe moins poids moyen général.
  function topTerms(docs, labels, k, m, nTop) {
    var sums = [], all = new Float64Array(m.nFeat), counts = new Int32Array(k), c, i, t;
    for (c = 0; c < k; c++) sums.push(new Float64Array(m.nFeat));
    for (i = 0; i < docs.length; i++) {
      var sp = docs[i], g = labels[i];
      counts[g]++;
      for (t = 0; t < sp.idx.length; t++) { sums[g][sp.idx[t]] += sp.val[t]; all[sp.idx[t]] += sp.val[t]; }
    }
    return sums.map(function (s, g) {
      var sc = [];
      for (t = 0; t < m.nFeat; t++) {
        if (m.vocab[t].indexOf(' ') >= 0) continue; // mots seuls, plus lisibles
        sc.push([t, (counts[g] ? s[t] / counts[g] : 0) - all[t] / docs.length]);
      }
      sc.sort(function (a, b) { return b[1] - a[1]; });
      return sc.slice(0, nTop).map(function (p) { return m.vocab[p[0]]; });
    });
  }

  /* ───── volet images ───── */

  // Même prétraitement que charger_images() : gris = moyenne R,V,B (0..255),
  // puis 64×64 en prenant un pixel sur N (plus proche voisin).
  function imageTo64(rgba, w, h, size) {
    size = size || 64;
    var out = new Float32Array(size * size);
    for (var r = 0; r < size; r++) {
      var y = Math.floor(r * h / size);
      for (var c = 0; c < size; c++) {
        var x = Math.floor(c * w / size), o = (y * w + x) * 4;
        out[r * size + c] = (rgba[o] + rgba[o + 1] + rgba[o + 2]) / 3;
      }
    }
    return out;
  }

  // Prépare le modèle image exporté par Python.
  function loadImageModel(d) {
    var m = { classes: d.classes, size: d.size, layers: [] };
    var mu = b64ToU16(d.mean), sd = b64ToU16(d.std), n = d.size * d.size, i;
    m.mean = new Float32Array(n); m.std = new Float32Array(n);
    for (i = 0; i < n; i++) { m.mean[i] = mu[i] * d.meanScale; m.std[i] = sd[i] * d.stdScale; }
    d.layers.forEach(function (L) {
      var q = b64ToI8(L.W), W = new Float32Array(q.length);
      for (i = 0; i < q.length; i++) W[i] = q[i] * L.scale;
      m.layers.push({ nIn: L.nIn, nOut: L.nOut, W: W, b: Float32Array.from(L.b) });
    });
    return m;
  }

  // Pixels 64×64 (0..255) → probabilité par classe.
  // StandardScaler, puis couches : sortie = W·x + b, ReLU entre les couches, softmax à la fin.
  function predictImage(px, m) {
    var x = new Float32Array(px.length), i, j;
    for (i = 0; i < px.length; i++) x[i] = (px[i] - m.mean[i]) / m.std[i];
    for (var l = 0; l < m.layers.length; l++) {
      var L = m.layers[l], y = new Float32Array(L.nOut);
      for (j = 0; j < L.nOut; j++) {
        var s = L.b[j], o = j * L.nIn;
        for (i = 0; i < L.nIn; i++) s += L.W[o + i] * x[i];
        y[j] = (l < m.layers.length - 1 && s < 0) ? 0 : s;
      }
      x = y;
    }
    var max = -Infinity, sum = 0, p = [];
    for (j = 0; j < x.length; j++) if (x[j] > max) max = x[j];
    for (j = 0; j < x.length; j++) { p.push(Math.exp(x[j] - max)); sum += p[j]; }
    var best = 0;
    for (j = 0; j < p.length; j++) { p[j] /= sum; if (p[j] > p[best]) best = j; }
    return { k: best, probs: p };
  }

  return {
    b64ToBytes: b64ToBytes, b64ToU16: b64ToU16, rng: rng,
    loadTextModel: loadTextModel, cleanText: cleanText, tfidf: tfidf, project: project,
    nearestCentroid: nearestCentroid, assign: assign, neighbours: neighbours, contributions: contributions,
    kmeansInit: kmeansInit, kmeansStep: kmeansStep, kmeansRun: kmeansRun, topTerms: topTerms,
    imageTo64: imageTo64, loadImageModel: loadImageModel, predictImage: predictImage
  };
});
