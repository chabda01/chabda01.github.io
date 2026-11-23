/* Raytracer — interface de la démo.
   Le calcul est dans core.js (fonctions pures) et tourne dans worker.js. */
(function () {
'use strict';

var RT = window.RT, SCENES = window.RT_SCENES;
var $ = function (id) { return document.getElementById(id); };
var canvas = $('rt-canvas'), ctx = canvas.getContext('2d');
var editor = $('rt-src'), statusEl = $('rt-status'), msgEl = $('rt-msg'), bar = $('rt-bar');
var resSel = $('rt-res'), fileEl = $('rt-file');
var stTime = $('rt-time'), stRays = $('rt-rays'), stSize = $('rt-size'), stObjs = $('rt-objs');

var current = SCENES[0];
var jobId = 0, worker = null, fallbackTimer = null, hasImage = false;

/* ───────── affichage ───────── */
function fmt(n) { return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' '); }
function fmtTime(ms) { return ms < 1000 ? Math.round(ms) + ' ms' : (ms / 1000).toFixed(ms < 10000 ? 2 : 1).replace('.', ',') + ' s'; }

function showMessages(error, warnings) {
  msgEl.textContent = '';
  var lines = [];
  if (error) lines.push({ cls: 't-err', text: (error.line ? 'Ligne ' + error.line + ' : ' : 'Erreur : ') + error.message });
  (warnings || []).forEach(function (w) { lines.push({ cls: 't-dim', text: 'Ligne ' + w.line + ' : ' + w.message }); });
  lines.forEach(function (l, i) {
    var s = document.createElement('span');
    s.className = l.cls;
    s.textContent = l.text + (i < lines.length - 1 ? '\n' : '');
    msgEl.appendChild(s);
  });
  msgEl.hidden = lines.length === 0;
}

/* met la ligne fautive en évidence dans l'éditeur */
function selectLine(line, focus) {
  if (!line) return;
  var text = editor.value, start = 0;
  for (var i = 1; i < line; i++) {
    var nl = text.indexOf('\n', start);
    if (nl < 0) break;
    start = nl + 1;
  }
  var end = text.indexOf('\n', start);
  if (end < 0) end = text.length;
  var lh = parseFloat(getComputedStyle(editor).lineHeight) || 19;
  if (focus) { editor.focus({ preventScroll: true }); editor.setSelectionRange(start, end); }
  editor.scrollTop = Math.max(0, (line - 4) * lh);
  editor.scrollLeft = 0;
}

/* ───────── cache des images calculées ─────────
   Une image finie est gardée en PNG (binaire, sans perte) : en mémoire pour la visite
   en cours, et dans IndexedDB pour les visites suivantes. La clé est le texte exact
   de la scène + la taille : la même scène ne se recalcule jamais deux fois. */
var CACHE_VERSION = 'v1', CACHE_MAX = 40;
var memCache = {}, db = null, dbTried = false, dbWaiters = [];
var currentKey = '', shownKey = '';

function hashText(str) {                       // FNV-1a, deux moitiés de 32 bits
  var h1 = 0x811c9dc5, h2 = 0x01000193;
  for (var i = 0; i < str.length; i++) {
    var c = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 16777619);
    h2 = Math.imul(h2 ^ (c + i), 2246822519);
  }
  return (h1 >>> 0).toString(16) + (h2 >>> 0).toString(16);
}
function cacheKey(src, size) { return CACHE_VERSION + ':' + size.width + 'x' + size.height + ':' + src.length + ':' + hashText(src); }

function openDb(cb) {
  if (dbTried) { if (dbWaiters) dbWaiters.push(cb); else cb(db); return; }
  dbTried = true; dbWaiters.push(cb);
  function ready(d) { db = d; var w = dbWaiters; dbWaiters = null; w.forEach(function (f) { f(db); }); }
  try {
    var req = indexedDB.open('raytracer-cache', 1);
    req.onupgradeneeded = function () { req.result.createObjectStore('images', { keyPath: 'key' }).createIndex('t', 't'); };
    req.onsuccess = function () { ready(req.result); };
    req.onerror = req.onblocked = function () { ready(null); };
  } catch (err) { ready(null); }
}
function cacheGet(key, cb) {
  if (memCache[key]) { cb(memCache[key]); return; }
  openDb(function (d) {
    if (!d) { cb(null); return; }
    try {
      var req = d.transaction('images').objectStore('images').get(key);
      req.onsuccess = function () { if (req.result) memCache[key] = req.result; cb(req.result || null); };
      req.onerror = function () { cb(null); };
    } catch (err) { cb(null); }
  });
}
function cachePut(entry) {
  memCache[entry.key] = entry;
  openDb(function (d) {
    if (!d) return;
    try {
      var store = d.transaction('images', 'readwrite').objectStore('images');
      store.put(entry);
      var count = store.count();
      count.onsuccess = function () {            // on ne garde que les plus récentes
        var extra = count.result - CACHE_MAX;
        if (extra <= 0) return;
        store.index('t').openCursor().onsuccess = function (e) {
          var cur = e.target.result;
          if (cur && extra-- > 0) { cur.delete(); cur.continue(); }
        };
      };
    } catch (err) { /* stockage refusé : le cache en mémoire suffit */ }
  });
}
function paintCached(entry, id) {
  createImageBitmap(entry.blob).then(function (img) {
    if (id !== jobId) return;
    if (canvas.width !== entry.width || canvas.height !== entry.height) { canvas.width = entry.width; canvas.height = entry.height; }
    ctx.drawImage(img, 0, 0);
    hasImage = true; shownKey = entry.key;
    bar.style.transform = 'scaleX(1)';
    bar.parentNode.classList.add('is-done');
    stTime.textContent = fmtTime(entry.ms);
    stRays.textContent = fmt(entry.rays);
    statusEl.textContent = 'Image reprise du cache — « Rendre » la recalcule';
    $('rt-png').disabled = false;
  }, function () { if (id === jobId) startJob(id); });
}

function paint(m) {
  if (canvas.width !== m.width || canvas.height !== m.height) { canvas.width = m.width; canvas.height = m.height; }
  ctx.putImageData(new ImageData(m.data, m.width, m.height), 0, 0);
  hasImage = true;
  var pct = Math.floor(m.pixels * 100 / m.total);
  bar.style.transform = 'scaleX(' + (m.pixels / m.total) + ')';
  bar.parentNode.classList.toggle('is-done', m.done);
  stTime.textContent = fmtTime(m.ms);
  stRays.textContent = fmt(m.rays);
  statusEl.textContent = m.done ? 'Image terminée' : 'Calcul en cours… ' + pct + ' %';
  $('rt-png').disabled = false;
  if (m.done && currentKey) {                  // image finie : on la range dans le cache
    var entry = { key: currentKey, width: m.width, height: m.height, rays: m.rays, ms: m.ms, t: Date.now() };
    shownKey = currentKey;
    canvas.toBlob(function (blob) { if (blob) { entry.blob = blob; cachePut(entry); } }, 'image/png');
  }
}

/* ───────── lancer un rendu ───────── */
function onWorkerMessage(e) {
  var m = e.data;
  if (m.preview) { onPreviewMessage(m); return; }
  if (m.id !== jobId) return;
  if (m.error) { showMessages({ message: m.error, line: m.line }); statusEl.textContent = 'Scène invalide'; return; }
  paint(m);
}

function getWorker() {
  if (worker || worker === false) return worker;
  try {
    worker = new Worker('worker.js');
    worker.onmessage = onWorkerMessage;
    worker.onerror = function () {          // worker refusé (page ouverte en file://) : on calcule dans la page
      worker = false;
      startJob(jobId);
    };
  } catch (err) { worker = false; }
  return worker;
}

/* secours sans Web Worker : même calcul, par petites tranches */
function renderInPage(id, scene, size) {
  var r = RT.createRenderer(scene, size.width, size.height), start = Date.now();
  (function slice() {
    if (id !== jobId) return;
    var done = r.step(30);
    paint({ data: new Uint8ClampedArray(r.data), width: r.width, height: r.height, pixels: r.pixels, total: r.total, rays: r.rays, ms: Date.now() - start, done: done });
    if (!done) fallbackTimer = setTimeout(slice, 0);
  })();
}

/* opts.width : largeur forcée (aperçu pendant le glisser) ; opts.focus : montrer la ligne en erreur */
function render(opts) {
  opts = opts || {};
  var scene, size;
  jobId++;
  clearTimeout(fallbackTimer);
  try {
    scene = RT.parseScene(editor.value);
    var wanted = opts.width || (resSel.value === 'file' ? 0 : parseInt(resSel.value, 10));
    size = RT.renderSize(scene.camera, wanted);
  } catch (err) {
    if (!(err instanceof RT.SceneError)) throw err;
    showMessages(err);
    selectLine(err.line, opts.focus);
    statusEl.textContent = 'Scène invalide' + (hasImage ? ' — l\'image affichée est la précédente' : '');
    return false;
  }
  showMessages(null, scene.warnings);
  stSize.textContent = size.width + ' × ' + size.height;
  stObjs.textContent = scene.primitives.length + ' / ' + (scene.ambient.length + scene.directional.length + scene.point.length);
  statusEl.textContent = 'Calcul en cours…';
  bar.style.transform = 'scaleX(0)';
  var id = jobId, src = editor.value;
  pending = { scene: scene, size: size, src: src };
  if (opts.width) { currentKey = ''; startJob(id); return true; }     // aperçu pendant le glisser : pas de cache
  var key = cacheKey(src, size);
  currentKey = key;
  if (opts.force && shownKey === key) { startJob(id); return true; }  // « Rendre » sur l'image déjà affichée : on recalcule
  cacheGet(key, function (hit) {
    if (id !== jobId) return;
    if (hit) paintCached(hit, id); else startJob(id);
  });
  return true;
}

var pending = null;
function startJob(id) {
  if (id !== jobId || !pending) return;
  var w = getWorker();
  if (w) w.postMessage({ id: id, src: pending.src, width: pending.size.width, height: pending.size.height });
  else renderInPage(id, pending.scene, pending.size);
}

/* ───────── scènes prêtes ───────── */
function loadScene(s) {
  current = s;
  editor.value = s.src;
  editor.scrollTop = 0;
  fileEl.textContent = 'scenes/' + s.file;
  Array.prototype.forEach.call(document.querySelectorAll('.chip[data-scene]'), function (c) {
    c.setAttribute('aria-pressed', c.getAttribute('data-scene') === s.id ? 'true' : 'false');
  });
  render();
}

SCENES.forEach(function (s) {
  var b = document.createElement('button');
  b.type = 'button';
  b.className = 'chip';
  b.textContent = s.label;
  b.setAttribute('data-scene', s.id);
  b.setAttribute('aria-pressed', 'false');
  b.addEventListener('click', function () {
    loadScene(s);
    canvas.scrollIntoView({ behavior: 'smooth', block: 'nearest' });   // sur téléphone, l'image est au-dessus
  });
  $(s.group === 'repo' ? 'rt-chips-repo' : 'rt-chips-metier').appendChild(b);
});

/* ───────── boutons ───────── */
$('rt-render').addEventListener('click', function () { render({ focus: true, force: true }); });
$('rt-render2').addEventListener('click', function () {
  if (render({ focus: true, force: true })) canvas.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
});
$('rt-reset').addEventListener('click', function () { loadScene(current); });
resSel.addEventListener('change', function () { render(); });
editor.addEventListener('keydown', function (e) {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); render({ focus: true, force: true }); }
});
$('rt-png').addEventListener('click', function () {
  canvas.toBlob(function (blob) {
    if (!blob) return;
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = current.file.replace(/\.cfg$/, '') + '.png';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }, 'image/png');
});

/* ───────── glisser sur l'image : la caméra tourne autour de la scène ─────────
   On réécrit position et rotation dans le fichier : l'éditeur reste la seule source. */
var RE_CAM = /camera\s*[:=]\s*\{/;
function vecRegex(name) { return new RegExp('(' + name + '\\s*[:=]\\s*)\\{[^{}]*\\}'); }
function round1(v) { var r = Math.round(v * 10) / 10; return r === 0 ? 0 : r; }

function writeCamera(pos, rot) {
  var text = editor.value, m = RE_CAM.exec(text);
  if (!m) return false;
  var head = text.slice(0, m.index), tail = text.slice(m.index);
  var rp = vecRegex('position'), rr = vecRegex('rotation');
  if (!rp.test(tail) || !rr.test(tail)) return false;
  tail = tail.replace(rp, '$1{ x = ' + round1(pos[0]) + '; y = ' + round1(pos[1]) + '; z = ' + round1(pos[2]) + '; }');
  tail = tail.replace(rr, '$1{ x = ' + round1(rot[0]) + '; y = ' + round1(rot[1]) + '; z = ' + round1(rot[2]) + '; }');
  var top = editor.scrollTop;
  editor.value = head + tail;
  editor.scrollTop = top;
  return true;
}

/* Aperçu en direct pendant le glisser.
   - Une seule image en calcul à la fois : dès qu'elle revient, on envoie la position
     de caméra la plus récente. Aucune file d'attente, donc aucun retard qui s'accumule.
   - La taille de l'aperçu s'ajuste à la machine : on vise une image calculée en ~12 ms.
   - L'aperçu saute l'occlusion ambiante ; l'image complète est recalculée au relâchement.
   - Le texte de la scène n'est réécrit que de temps en temps, pas à chaque mouvement. */
var drag = null, pvBusy = false, pvNext = null, pvSeq = 0, pvWidth = 200, pvScene = null, lastWrite = 0;
var pvCanvas = document.createElement('canvas'), pvCtx = pvCanvas.getContext('2d');

function showPreview(m) {
  if (pvCanvas.width !== m.width || pvCanvas.height !== m.height) { pvCanvas.width = m.width; pvCanvas.height = m.height; }
  pvCtx.putImageData(new ImageData(m.data, m.width, m.height), 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(pvCanvas, 0, 0, canvas.width, canvas.height);   // la toile garde sa taille : pas de saut de mise en page
  // on vise ~12 ms par image : plus la machine est rapide, plus l'aperçu est fin
  var k = Math.sqrt(12 / Math.max(m.ms, 0.5));
  pvWidth = Math.round(Math.max(96, Math.min(canvas.width, 480, pvWidth * Math.max(0.6, Math.min(1.5, k)))));
  shownKey = '';
  statusEl.textContent = 'Aperçu en direct';
}
function sendPreview() {
  if (pvBusy || !pvNext || !drag) return;
  var cam = pvNext; pvNext = null;
  var w = pvWidth, h = Math.max(1, Math.round(w * canvas.height / canvas.width));
  if (worker) {
    pvBusy = true;
    worker.postMessage({ preview: ++pvSeq, position: cam.pos, rotation: cam.rot, width: w, height: h });
  } else if (pvScene) {                                          // sans worker : même calcul dans la page
    var t0 = performance.now();
    pvScene.camera.position = cam.pos; pvScene.camera.rotation = cam.rot;
    var r = RT.createRenderer(pvScene, w, h, null, { fast: true }).renderAll();
    showPreview({ data: r.data, width: w, height: h, ms: performance.now() - t0 });
  }
}
function onPreviewMessage(m) {
  pvBusy = false;
  if (drag && m.preview === pvSeq) showPreview(m);
  sendPreview();
}

canvas.addEventListener('pointerdown', function (e) {
  if (e.button) return;
  var scene;
  try { scene = RT.parseScene(editor.value); } catch (err) { return; }
  var cam = scene.camera, f = RT.cameraBasis(cam).forward;
  var dist = RT.createRenderer(scene, 16, 9).centerDistance();
  if (!dist || dist > 2000) dist = 150;
  drag = {
    id: e.pointerId, x: e.clientX, y: e.clientY, rot: cam.rotation.slice(), dist: dist, moved: false, pos: null, cur: null,
    pivot: [cam.position[0] + f[0] * dist, cam.position[1] + f[1] * dist, cam.position[2] + f[2] * dist]
  };
  pvScene = scene;
  try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* rien */ }
  canvas.classList.add('is-drag');
});
canvas.addEventListener('pointermove', function (e) {
  if (!drag || e.pointerId !== drag.id) return;
  var dx = e.clientX - drag.x, dy = e.clientY - drag.y;
  if (!drag.moved) {
    if (Math.abs(dx) + Math.abs(dy) < 4) return;
    drag.moved = true;
    jobId++; clearTimeout(fallbackTimer);                        // le rendu complet en cours ne sert plus
    var w = getWorker();
    if (w) w.postMessage({ prepare: editor.value });
    pvBusy = false;
  }
  var rot = [Math.max(-85, Math.min(85, drag.rot[0] - dy * 0.3)), drag.rot[1] + dx * 0.3, drag.rot[2]];
  var f = RT.cameraBasis({ rotation: rot }).forward;
  var pos = [drag.pivot[0] - f[0] * drag.dist, drag.pivot[1] - f[1] * drag.dist, drag.pivot[2] - f[2] * drag.dist];
  drag.cur = { pos: pos, rot: rot };
  pvNext = drag.cur;
  sendPreview();
  var now = Date.now();
  if (now - lastWrite > 200) { lastWrite = now; writeCamera(pos, rot); }
});
function endDrag(e) {
  if (!drag || e.pointerId !== drag.id) return;
  var d = drag;
  drag = null; pvNext = null;
  canvas.classList.remove('is-drag');
  if (d.moved && d.cur) { writeCamera(d.cur.pos, d.cur.rot); render(); }
}
canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);

/* petit appareil (téléphone, peu de cœurs ou de mémoire) : on part sur l'image la plus légère */
if ((navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 4) ||
    (navigator.deviceMemory && navigator.deviceMemory <= 4) ||
    window.matchMedia('(pointer: coarse)').matches) resSel.value = '480';

loadScene(current);
})();
