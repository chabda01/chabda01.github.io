/* Raytracer — Web Worker : calcule l'image sans bloquer la page.
   Reçoit  { id, src, width, height }
   Envoie  { id, data, pixels, total, rays, ms, done }  plusieurs fois par rendu.
   Aperçu en direct (caméra à la souris) :
   reçoit  { prepare: src }  une fois, puis  { preview, position, rotation, width, height }  à chaque image ;
   envoie  { preview, data, width, height, ms }. */
'use strict';
importScripts('core.js');

var job = null;

function tick(mine) {
  if (job !== mine) return;               // un rendu plus récent a pris la place
  var done = mine.renderer.step(50);
  var copy = new Uint8ClampedArray(mine.renderer.data);
  self.postMessage({
    id: mine.id, data: copy, width: mine.renderer.width, height: mine.renderer.height,
    pixels: mine.renderer.pixels, total: mine.renderer.total, rays: mine.renderer.rays,
    ms: Date.now() - mine.start, done: done
  }, [copy.buffer]);
  if (!done) setTimeout(function () { tick(mine); }, 0);   // laisse passer les nouveaux messages
}

var previewScene = null;

self.onmessage = function (e) {
  var m = e.data;
  if (m.prepare !== undefined) {
    job = null;                               // on arrête le rendu complet en cours
    try { previewScene = self.RT.parseScene(m.prepare); } catch (err) { previewScene = null; }
    return;
  }
  if (m.preview) {
    if (!previewScene) return;
    var t0 = performance.now();
    previewScene.camera.position = m.position;
    previewScene.camera.rotation = m.rotation;
    var r = self.RT.createRenderer(previewScene, m.width, m.height, null, { fast: true }).renderAll();
    self.postMessage({ preview: m.preview, data: r.data, width: r.width, height: r.height, ms: performance.now() - t0 }, [r.data.buffer]);
    return;
  }
  try {
    var scene = self.RT.parseScene(m.src);
    job = { id: m.id, start: Date.now(), renderer: self.RT.createRenderer(scene, m.width, m.height) };
    tick(job);
  } catch (err) {
    job = null;
    self.postMessage({ id: m.id, error: String(err.message || err), line: err.line || 0 });
  }
};
