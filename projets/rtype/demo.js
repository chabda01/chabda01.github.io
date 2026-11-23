/* R-Type — interface de la démo.
   Les règles du jeu sont dans core.js (sans affichage). Ici : la boucle à pas fixe,
   le clavier et le tactile, le dessin en canvas et le panneau « sous le capot ».
   Comme le client du projet, l'affichage écoute EntitySpawned / EntityDestroyed
   pour savoir quoi dessiner. */
(function () {
'use strict';

var C = window.RTypeCore, FILES = window.RTYPE_FILES;
var cfg = C.config, T = C.EntityType, A = C.Action;
var $ = function (id) { return document.getElementById(id); };
var stage = $('rty-stage'), view = $('rty-view'), canvas = $('rty-canvas'), ctx = canvas.getContext('2d');
var over = $('rty-over'), overTitle = $('rty-over-title'), overText = $('rty-over-text'), overBtn = $('rty-over-btn');
var playBtn = $('rty-play'), statusEl = $('rty-status');
var W = cfg.SCREEN_WIDTH, H = cfg.SCREEN_HEIGHT;
var STEP = Math.fround(1 / 60), STEP_MS = 1000 / 60, MAX_STEPS = 5;

var reduced = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
var coarse = window.matchMedia && matchMedia('(pointer: coarse)').matches;
var small = coarse || (navigator.hardwareConcurrency || 8) <= 4;

/* ───────── réglages ───────── */
var settings = { difficulty: 'normal', slow: false, auto: coarse, firstLevel: 0, speed: 1, shield: false, boxes: false };
var overrides = {};                 // fichiers de niveau modifiés par le visiteur
var game = null, rules = null, ship = null;
var state = 'idle';                 // idle | running | paused | over
var sprites = {}, effects = [], flash = 0, lastResult = null;
var keys = 0, touchMask = 0, steer = null;
var quality = small ? 1 : 2, visible = true;

/* ───────── nouvelle partie ───────── */
function currentFiles() {
  var files = {};
  Object.keys(FILES).forEach(function (path) { files[path] = FILES[path]; });
  Object.keys(overrides).forEach(function (path) { files[path] = overrides[path]; });
  return files;
}
function levelPath(index) { return 'assets/levels/level' + (index + 1) + '.json'; }

function newGame() {
  var files = currentFiles();
  var nextRules = C.loadRules(files['assets/rules.json'], 'assets/rules.json');   // le vrai rules.json
  nextRules.difficulty = settings.difficulty;
  nextRules.slowMode = settings.slow;
  nextRules.autoFire = settings.auto;
  var next = new C.RTypeGame(nextRules, { files: files, firstLevel: settings.firstLevel, seed: Date.now() & 0xffffff });
  var nextSprites = {};
  var bus = next.getEventBus();
  bus.subscribe('EntitySpawned', function (event) {
    nextSprites[event.entity] = { type: event.type, variant: event.playerId, x: event.x, y: event.y, w: 0, h: 0, born: 0 };
  });
  bus.subscribe('EntityDestroyed', function (event) {
    var sprite = nextSprites[event.entity];
    if (sprite && sprites === nextSprites) boom(sprite);
    delete nextSprites[event.entity];
  });
  bus.subscribe('ProjectilesCollided', function (event) { effects.push({ x: event.x, y: event.y, r: 14, t: 0, life: 0.18, color: '#FFE9B0' }); });
  bus.subscribe('PlayerDied', function () { flash = 1; });
  bus.subscribe('PowerUpCollected', function (event) { effects.push({ x: event.x + 16, y: event.y + 16, r: 46, t: 0, life: 0.35, color: '#E9A855', ring: true }); });
  bus.subscribe('GameOver', function (event) { lastResult = event.victory; });
  next.init();                      // lit la campagne, les niveaux et les scripts : peut lancer ResourceError
  game = next; rules = nextRules; sprites = nextSprites; effects = []; flash = 0; lastResult = null;
  ship = game.addPlayer(1);
  applyShield();
  game.getRegistry().profiler = profiler;
  resetProfiler();
  acc = 0;
  return true;
}
function applyShield() {
  if (!game) return;
  var registry = game.getRegistry(), mine = game.findPlayerShip(1);
  if (mine === null) return;
  // Le bouclier du mode test est le vrai composant Invulnerable du moteur, posé sur le vaisseau.
  if (settings.shield) registry.addComponent(mine, 'Invulnerable', {});
  else registry.removeComponent(mine, 'Invulnerable');
}
function boom(sprite) {
  if (sprite.x < -80 || sprite.x > W + 20 || sprite.y < -80 || sprite.y > H + 20) return;   // sorti de l'écran : pas d'explosion
  var missile = sprite.type === T.PlayerMissile || sprite.type === T.EnemyMissile;
  if (sprite.type === T.PowerUp || sprite.type === T.Force || sprite.type === T.ChargedMissile) return;
  var size = Math.max(sprite.w, sprite.h) || 30;
  if (missile) { if (sprite.x > W - 4 || sprite.x < 4) return; size = 14; }
  effects.push({ x: sprite.x + sprite.w / 2, y: sprite.y + sprite.h / 2, r: size * (missile ? 1 : 0.9), t: 0,
    life: missile ? 0.14 : (sprite.type === T.Boss ? 0.9 : 0.4), color: missile ? '#FFD9A0' : '#FF8A4C' });
  if (effects.length > 60) effects.splice(0, effects.length - 60);
}

/* ───────── boucle à pas fixe ─────────
   La simulation avance par pas de 1/60 s, quel que soit le rythme de l'écran.
   L'affichage dessine le dernier état connu. */
var raf = 0, lastTs = 0, acc = 0, starShift = 0;
var profiler = { now: function () { return performance.now(); }, time: new Float64Array(16), runs: new Float64Array(16) };
var win = { frames: 0, steps: 0, simMs: 0, drawMs: 0, frameMs: 0, slowFrames: 0 };
function resetProfiler() { profiler.time.fill(0); profiler.runs.fill(0); }

function inputMask() {
  var mask = keys | touchMask;
  if (steer && ship !== null) {
    var positions = game.getRegistry().getComponents('Position');
    var mine = game.findPlayerShip(1);
    if (mine !== null && positions.has(mine)) {
      var dx = steer.tx - positions.get(mine).x, dy = steer.ty - positions.get(mine).y;
      if (dx > 8) mask |= A.Right; else if (dx < -8) mask |= A.Left;
      if (dy > 8) mask |= A.Down; else if (dy < -8) mask |= A.Up;
    }
  }
  return mask;
}

function frame(ts) {
  raf = 0;
  if (state !== 'running') return;
  var elapsed = Math.min(100, ts - (lastTs || ts));
  lastTs = ts;
  acc += elapsed * settings.speed;
  var steps = 0, maxSteps = MAX_STEPS * settings.speed, t0 = performance.now();
  while (acc >= STEP_MS && steps < maxSteps) {
    game.setPlayerInput(1, inputMask());
    game.update(STEP);
    acc -= STEP_MS;
    steps++;
    if (lastResult !== null) break;
  }
  if (steps === maxSteps) acc = 0;              // machine trop lente : on ne rattrape pas le retard
  var t1 = performance.now();
  var seconds = elapsed / 1000;
  if (!reduced) starShift += seconds * 60 * (settings.slow ? 0.7 : 1) * settings.speed;
  for (var i = effects.length - 1; i >= 0; i--) { effects[i].t += seconds * settings.speed; if (effects[i].t >= effects[i].life) effects.splice(i, 1); }
  flash = Math.max(0, flash - seconds * 3);
  render();
  var t2 = performance.now();
  win.frames++; win.steps += steps; win.simMs += t1 - t0; win.drawMs += t2 - t1; win.frameMs += elapsed;
  adapt(elapsed);
  if (lastResult !== null) { finish(); return; }
  raf = requestAnimationFrame(frame);
}
/* Si l'écran ne suit pas, on allège le dessin (moins de pixels, moins d'étoiles, pas de halos). */
function adapt(elapsed) {
  if (elapsed > 24) win.slowFrames++;
  if (win.frames >= 90) {
    if (win.slowFrames > 45 && quality > 0) { quality--; resize(); }
    win.slowFrames = 0;
  }
}
function start() {
  if (!game || state === 'over') { try { newGame(); } catch (error) { showError(error); return; } }
  state = 'running';
  over.hidden = true;
  view.classList.add('is-live');
  playBtn.textContent = 'Pause';
  lastTs = 0;
  try { view.focus({ preventScroll: true }); } catch (e) { /* ancien navigateur */ }
  if (!raf) raf = requestAnimationFrame(frame);
}
function pause(auto) {
  if (state !== 'running') return;
  state = 'paused';
  keys = 0; touchMask = 0; steer = null;
  if (raf) { cancelAnimationFrame(raf); raf = 0; }
  view.classList.remove('is-live');
  playBtn.textContent = 'Reprendre';
  showOverlay('En pause', auto ? 'Le jeu s\'arrête quand il sort de l\'écran.' : 'P ou le bouton pour reprendre.', 'Reprendre');
  updatePanel(true);
}
function finish() {
  state = 'over';
  keys = 0; touchMask = 0; steer = null;
  view.classList.remove('is-live');
  playBtn.textContent = 'Rejouer';
  var score = hudValues().score;
  showOverlay(lastResult ? 'Victoire' : 'Partie perdue',
    (lastResult ? 'Le boss est détruit, la campagne est finie. ' : 'Plus de vies. ') + 'Score : ' + score + '.', 'Rejouer');
  updatePanel(true);
}
function restart() {
  if (raf) { cancelAnimationFrame(raf); raf = 0; }
  try { newGame(); } catch (error) {
    showError(error);
    if (state === 'running') raf = requestAnimationFrame(frame);   // fichier refusé : la partie en cours continue
    return false;
  }
  state = 'idle';
  start();
  return true;
}
function showOverlay(title, text, button) {
  overTitle.textContent = title; overText.textContent = text; overBtn.textContent = button;
  over.hidden = false;
}
function toggle() { if (state === 'running') pause(false); else start(); }

/* ───────── dessin ───────── */
var scale = 1, stars = [];
function makeStars() {
  var random = C.makeRandom(7), count = quality === 2 ? 110 : (quality === 1 ? 60 : 30);
  stars = [];
  for (var i = 0; i < count; i++) {
    var depth = 1 + Math.floor(random() * 3);
    stars.push({ x: random() * W, y: random() * H, d: depth, s: depth === 3 ? 3 : 2 });
  }
}
function resize() {
  var rect = view.getBoundingClientRect();
  var dpr = Math.min(window.devicePixelRatio || 1, quality === 2 ? 2 : (quality === 1 ? 1.25 : 1));
  var width = Math.max(240, Math.round(rect.width * dpr));
  canvas.width = width;
  canvas.height = Math.round(width * 9 / 16);
  scale = width / W;
  makeStars();
  render();
}
function poly(points) {
  ctx.beginPath();
  ctx.moveTo(points[0], points[1]);
  for (var i = 2; i < points.length; i += 2) ctx.lineTo(points[i], points[i + 1]);
  ctx.closePath();
}
function glow(x, y, radius, color, alpha) {
  if (quality < 2) return;
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  ctx.beginPath(); ctx.arc(x, y, radius, 0, 6.2832); ctx.fill();
  ctx.globalAlpha = 1;
}
var BONUS = { 1: ['S', '#6FD3FF'], 2: ['F', '#FF9B3D'], 3: ['+', '#FF6B81'], 4: ['R', '#F6D860'] };
var PHASE_COLOR = ['#8D8477', '#7FB77E', '#E9A855', '#E0775F', '#E0775F'];

function drawEntity(entity, sprite, registry, time) {
  var x = sprite.x, y = sprite.y, w = sprite.w, h = sprite.h, cx = x + w / 2, cy = y + h / 2, angle;
  switch (sprite.type) {
    case T.Player:
      if (registry.getComponents('Invulnerable').has(entity)) {
        ctx.strokeStyle = 'rgba(111,211,255,.7)'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.ellipse(cx, cy, w * 0.72, h * 0.95, 0, 0, 6.2832); ctx.stroke();
      }
      ctx.fillStyle = '#FF9B3D'; poly([x - 2, cy - 5, x - 12 - (time * 40 % 8), cy, x - 2, cy + 5]); ctx.fill();
      ctx.fillStyle = '#DCE6F2'; poly([x, y + 4, x + w * 0.55, y + 6, x + w, cy, x + w * 0.55, y + h - 6, x, y + h - 4, x + 10, cy]); ctx.fill();
      ctx.fillStyle = '#3FA7F0'; poly([x + w * 0.42, y + 9, x + w * 0.72, cy, x + w * 0.42, y + h - 9]); ctx.fill();
      ctx.fillStyle = '#8FA3BA'; ctx.fillRect(x + 6, y, w * 0.38, 5); ctx.fillRect(x + 6, y + h - 5, w * 0.38, 5);
      break;
    case T.Bydos:
      var scripted = registry.getComponents('Scripted').has(entity);
      glow(cx, cy, w * 0.7, scripted ? '#B07CFF' : '#FF5A4C', 0.12);
      ctx.fillStyle = scripted ? '#8E5BE8' : '#D8483C';
      ctx.beginPath(); ctx.arc(cx, cy, w * 0.44, 0, 6.2832); ctx.fill();
      ctx.fillStyle = scripted ? '#5B35A8' : '#8E2A26';
      poly([x, cy, x + w * 0.3, y + 4, x + w * 0.2, cy, x + w * 0.3, y + h - 4]); ctx.fill();
      ctx.fillStyle = '#FFF3D6'; ctx.beginPath(); ctx.arc(cx - w * 0.12, cy, w * 0.16, 0, 6.2832); ctx.fill();
      ctx.fillStyle = '#1A1611'; ctx.beginPath(); ctx.arc(cx - w * 0.17, cy, w * 0.07, 0, 6.2832); ctx.fill();
      break;
    case T.Kamikaze:
      var velocity = registry.getComponents('Velocity').get(entity);
      angle = velocity ? Math.atan2(velocity.y, velocity.x) : Math.PI;
      ctx.save(); ctx.translate(cx, cy); ctx.rotate(angle);
      ctx.fillStyle = '#FF4FA3'; poly([w * 0.5, 0, -w * 0.4, -h * 0.42, -w * 0.18, 0, -w * 0.4, h * 0.42]); ctx.fill();
      ctx.fillStyle = '#FFD1E6'; poly([w * 0.5, 0, 0, -h * 0.12, 0, h * 0.12]); ctx.fill();
      ctx.restore();
      break;
    case T.Turret:
      var orbiter = registry.getComponents('Scripted').has(entity);
      var target = C.nearestPlayerCenter(registry, { x: cx, y: cy });
      angle = target && !orbiter ? Math.atan2(target.y - cy, target.x - cx) : Math.PI;
      ctx.fillStyle = orbiter ? '#2FA39B' : '#6E8B5A';
      poly([x + w * 0.3, y, x + w * 0.7, y, x + w, y + h * 0.3, x + w, y + h * 0.7, x + w * 0.7, y + h, x + w * 0.3, y + h, x, y + h * 0.7, x, y + h * 0.3]); ctx.fill();
      ctx.fillStyle = orbiter ? '#17605B' : '#3F5433'; ctx.beginPath(); ctx.arc(cx, cy, w * 0.26, 0, 6.2832); ctx.fill();
      ctx.save(); ctx.translate(cx, cy); ctx.rotate(angle); ctx.fillStyle = '#D9D1C3'; ctx.fillRect(0, -4, w * 0.6, 8); ctx.restore();
      break;
    case T.Snake:
      ctx.fillStyle = '#4FBF6B'; ctx.beginPath(); ctx.arc(cx, cy, w * 0.5, 0, 6.2832); ctx.fill();
      ctx.fillStyle = '#1F7A3A'; ctx.beginPath(); ctx.arc(cx, cy, w * 0.26, 0, 6.2832); ctx.fill();
      break;
    case T.Boss:
      // Le corps blindé : sa hitbox commence derrière le noyau (70 px plus à droite).
      var bx = x - cfg.BOSS_CORE_WIDTH;
      ctx.fillStyle = '#4A2230';
      poly([bx + 50, y + 30, bx + 110, y, bx + 180, y + 20, bx + 180, y + h - 20, bx + 110, y + h, bx + 50, y + h - 30, bx + 78, cy]); ctx.fill();
      ctx.fillStyle = '#7A3348';
      poly([bx + 96, y + 26, bx + 168, y + 36, bx + 168, y + h - 36, bx + 96, y + h - 26, bx + 112, cy]); ctx.fill();
      ctx.strokeStyle = '#B8566F'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(bx + 112, y + 60); ctx.lineTo(bx + 166, y + 66); ctx.moveTo(bx + 112, y + h - 60); ctx.lineTo(bx + 166, y + h - 66); ctx.stroke();
      break;
    case T.BossCore:
      var pulse = 0.5 + 0.5 * Math.sin(time * 6);
      glow(cx, cy, w * 0.8, '#FFB04C', 0.14 + 0.1 * pulse);
      ctx.fillStyle = '#FF9B3D'; ctx.beginPath(); ctx.arc(cx, cy, w * 0.48, 0, 6.2832); ctx.fill();
      ctx.fillStyle = '#FFE9B0'; ctx.beginPath(); ctx.arc(cx, cy, w * (0.2 + 0.06 * pulse), 0, 6.2832); ctx.fill();
      break;
    case T.PlayerMissile:
      ctx.fillStyle = '#7FE3FF'; ctx.fillRect(x, y, w, h);
      ctx.fillStyle = '#FFFFFF'; ctx.fillRect(x + w * 0.55, y + 2, w * 0.45, h - 4);
      break;
    case T.EnemyMissile:
      var v = registry.getComponents('Velocity').get(entity);
      ctx.save(); ctx.translate(cx, cy); ctx.rotate(v ? Math.atan2(v.y, v.x) : Math.PI);
      ctx.fillStyle = '#FF7A45'; ctx.fillRect(-w / 2, -h / 2, w, h);
      ctx.fillStyle = '#FFE0A8'; ctx.fillRect(w * 0.1, -h / 2 + 2, w * 0.4, h - 4);
      ctx.restore();
      break;
    case T.ChargedMissile:
      glow(cx, cy, w * 0.75, '#7FE3FF', 0.18);
      ctx.fillStyle = '#7FE3FF'; ctx.beginPath(); ctx.arc(cx, cy, w * 0.42, 0, 6.2832); ctx.fill();
      ctx.fillStyle = '#FFFFFF'; ctx.beginPath(); ctx.arc(cx + 6, cy, w * 0.22, 0, 6.2832); ctx.fill();
      break;
    case T.Force:
      glow(cx, cy, w * 0.9, '#FF9B3D', 0.16);
      ctx.fillStyle = '#FF9B3D'; ctx.beginPath(); ctx.arc(cx, cy, w * 0.5, 0, 6.2832); ctx.fill();
      ctx.strokeStyle = '#FFE9B0'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(cx, cy, w * 0.3, time * 4, time * 4 + 4.4); ctx.stroke();
      break;
    case T.PowerUp:
      var bonus = BONUS[sprite.variant] || ['?', '#FFFFFF'];
      ctx.fillStyle = '#1A1611'; ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = bonus[1]; ctx.lineWidth = 3; ctx.strokeRect(x + 1.5, y + 1.5, w - 3, h - 3);
      ctx.fillStyle = bonus[1]; ctx.font = 'bold 22px "JetBrains Mono",monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(bonus[0], cx, cy + 1);
      break;
  }
}

function render() {
  if (!game) return;
  var registry = game.getRegistry();
  var positions = registry.getComponents('Position'), hitboxes = registry.getComponents('Hitbox');
  var time = performance.now() / 1000;
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.fillStyle = '#05070D';
  ctx.fillRect(0, 0, W, H);
  // Fond étoilé (dessiné pour cette page ; dans le projet, il est fait par le client graphique).
  for (var s = 0; s < stars.length; s++) {
    var star = stars[s];
    var sx = ((star.x - starShift * star.d * 0.6) % W + W) % W;
    ctx.fillStyle = star.d === 3 ? '#C9D6EA' : (star.d === 2 ? '#7C8BA3' : '#465166');
    ctx.fillRect(sx, star.y, star.s, star.s);
  }
  var order = [T.Boss, T.BossCore, T.Snake, T.Turret, T.Bydos, T.Kamikaze, T.PowerUp, T.EnemyMissile, T.PlayerMissile, T.ChargedMissile, T.Force, T.Player];
  var ids = Object.keys(sprites), entity, sprite, box;
  for (var i = 0; i < ids.length; i++) {
    entity = +ids[i]; sprite = sprites[entity];
    if (!positions.has(entity)) continue;
    box = hitboxes.get(entity);
    sprite.x = positions.get(entity).x + (box ? box.offsetX : 0);
    sprite.y = positions.get(entity).y + (box ? box.offsetY : 0);
    sprite.w = box ? box.width : 0; sprite.h = box ? box.height : 0;
  }
  for (var o = 0; o < order.length; o++) {
    for (i = 0; i < ids.length; i++) {
      entity = +ids[i]; sprite = sprites[entity];
      if (sprite.type === order[o] && positions.has(entity)) drawEntity(entity, sprite, registry, time);
    }
  }
  if (settings.boxes) {
    ctx.lineWidth = 1.5 / Math.min(1, scale);
    for (i = 0; i < ids.length; i++) {
      entity = +ids[i]; sprite = sprites[entity];
      if (!positions.has(entity)) continue;
      ctx.strokeStyle = registry.getComponents('Invulnerable').has(entity) ? '#6FD3FF' : (registry.getComponents('Enemy').has(entity) ? '#FF6B6B' : '#7FB77E');
      ctx.strokeRect(sprite.x, sprite.y, sprite.w, sprite.h);
    }
  }
  for (i = 0; i < effects.length; i++) {
    var effect = effects[i], k = effect.t / effect.life;
    ctx.globalAlpha = 1 - k;
    if (effect.ring) { ctx.strokeStyle = effect.color; ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(effect.x, effect.y, effect.r * k, 0, 6.2832); ctx.stroke(); }
    else {
      ctx.fillStyle = effect.color; ctx.beginPath(); ctx.arc(effect.x, effect.y, effect.r * (0.4 + 0.8 * k), 0, 6.2832); ctx.fill();
      ctx.fillStyle = '#FFF3D6'; ctx.beginPath(); ctx.arc(effect.x, effect.y, effect.r * 0.45 * (1 - k), 0, 6.2832); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
  // Jauge du tir chargé, sous le vaisseau.
  var mine = game.findPlayerShip(1);
  if (mine !== null && positions.has(mine)) {
    var charge = registry.getComponents('ChargeShot').get(mine).charge;
    if (charge > 0) {
      var px = positions.get(mine).x, py = positions.get(mine).y + cfg.PLAYER_HEIGHT + 10, ready = charge >= cfg.CHARGE_MIN_TIME;
      ctx.fillStyle = 'rgba(255,255,255,.18)'; ctx.fillRect(px, py, cfg.PLAYER_WIDTH, 7);
      ctx.fillStyle = ready ? '#7FE3FF' : '#8D8477'; ctx.fillRect(px, py, cfg.PLAYER_WIDTH * charge / cfg.CHARGE_FULL_TIME, 7);
      ctx.fillStyle = '#FFFFFF'; ctx.fillRect(px + cfg.PLAYER_WIDTH * cfg.CHARGE_MIN_TIME / cfg.CHARGE_FULL_TIME, py - 2, 2, 11);
    }
  }
  // Barre de vie du boss : lue avec findBoss(), comme le mode local du projet.
  var boss = C.findBoss(registry);
  if (boss) {
    var bw = 560, bxx = (W - bw) / 2;
    ctx.fillStyle = 'rgba(0,0,0,.55)'; ctx.fillRect(bxx - 4, 14, bw + 8, 30);
    ctx.fillStyle = 'rgba(255,255,255,.14)'; ctx.fillRect(bxx, 18, bw, 22);
    ctx.fillStyle = PHASE_COLOR[boss.phase]; ctx.fillRect(bxx, 18, bw * Math.max(0, boss.health) / boss.maxHealth, 22);
    ctx.fillStyle = '#05070D'; ctx.fillRect(bxx + bw * 0.66, 18, 3, 22); ctx.fillRect(bxx + bw * 0.33, 18, 3, 22);
    ctx.fillStyle = '#F0EADF'; ctx.font = '26px "JetBrains Mono",monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    ctx.fillText(boss.phase === 0 ? 'BOSS · il entre' : 'BOSS · phase ' + Math.min(3, boss.phase) + ' · ' + Math.max(0, boss.health) + '/' + boss.maxHealth, W / 2, 52);
  }
  if (flash > 0 && !reduced) { ctx.fillStyle = 'rgba(224,119,95,' + (0.35 * flash).toFixed(3) + ')'; ctx.fillRect(0, 0, W, H); }
  updateHud();
}

/* ───────── bandeau : score, vies, bonus, niveau ───────── */
var hudCache = {};
function setText(id, text) { if (hudCache[id] !== text) { hudCache[id] = text; $(id).textContent = text; } }
function hudValues() {
  var registry = game.getRegistry(), mine = game.findPlayerShip(1);
  if (mine === null) return { score: hudCache._score || 0, lives: 0, bonus: '' };
  var bonuses = registry.getComponents('PlayerBonuses').get(mine), parts = [];
  if (bonuses.speedLevel > 0) parts.push('vitesse +' + bonuses.speedLevel * 20 + ' %');
  if (bonuses.rapidFireLeft > 0) parts.push('tir rapide ' + Math.ceil(bonuses.rapidFireLeft) + ' s');
  var forces = registry.getComponents('Force');
  if (forces.live > 0) parts.push('Force');
  if (settings.shield) parts.push('bouclier');
  hudCache._score = registry.getComponents('Score').get(mine).points;
  return { score: hudCache._score, lives: registry.getComponents('Player').get(mine).lives, bonus: parts.filter(Boolean).join(' · ') };
}
function updateHud() {
  var values = hudValues(), info = game.levelInfo();
  setText('rty-score', String(values.score));
  setText('rty-lives', values.lives > 0 ? new Array(values.lives + 1).join('♥') : '–');
  setText('rty-bonus', values.bonus);
  if (info) setText('rty-status', 'Niveau ' + (info.index + 1) + '/' + info.count + ' · ' + info.name.replace(/^Level \d+ - /, '') + ' · vague ' + info.wavesDone + '/' + info.waves);
}

/* ───────── panneau « sous le capot » ───────── */
var table = $('rty-table'), tctx = table.getContext('2d'), sysRows = [], lastPanel = 0;
function buildSystems() {
  var box = $('rty-sys');
  box.textContent = '';
  sysRows = game.getRegistry().systems().map(function (system, index) {
    var row = document.createElement('div'), num = document.createElement('i'), name = document.createElement('span'),
      value = document.createElement('b'), bar = document.createElement('u');
    num.textContent = String(index + 1); name.textContent = system.name; value.textContent = '–';
    row.appendChild(num); row.appendChild(name); row.appendChild(value); row.appendChild(bar);
    box.appendChild(row);
    return { value: value, bar: bar };
  });
}
function fmtMs(ms) { return ms.toFixed(ms < 1 ? 2 : 1).replace('.', ',') + ' ms'; }
function updatePanel(force) {
  var now = performance.now();
  if (!force && now - lastPanel < 250) return;
  lastPanel = now;
  var registry = game.getRegistry(), names = C.COMPONENTS, total = 0, i;
  for (i = 0; i < names.length; i++) total += registry.getComponents(names[i]).live;
  setText('rty-s-ent', String(registry.entityCount()));
  setText('rty-s-comp', String(total));
  setText('rty-s-pairs', String(game.collisionStats().pairs));
  if (win.frames > 0) {
    var systems = registry.systems().length;
    setText('rty-s-sys', String(Math.round(win.steps / win.frames * systems)));
    setText('rty-s-sim', fmtMs(win.simMs / win.frames));
    setText('rty-s-draw', fmtMs(win.drawMs / win.frames));
    setText('rty-s-tick', 'Pas fixe de 1/60 s : ' + Math.round(win.steps * 1000 / win.frameMs) + ' ticks par seconde pour '
      + Math.round(win.frames * 1000 / win.frameMs) + ' images par seconde à l\'écran'
      + (settings.speed > 1 ? ' (vitesse ×' + settings.speed + ')' : '') + (quality < 2 ? '. Dessin allégé.' : '.'));
    var max = 0, means = [];
    for (i = 0; i < sysRows.length; i++) { means[i] = profiler.runs[i] ? profiler.time[i] * 1000 / profiler.runs[i] : 0; if (means[i] > max) max = means[i]; }
    for (i = 0; i < sysRows.length; i++) {
      sysRows[i].value.textContent = profiler.runs[i] ? (means[i] < 10 ? means[i].toFixed(1).replace('.', ',') : Math.round(means[i])) + ' µs' : '–';
      sysRows[i].bar.style.transform = 'scaleX(' + (max > 0 ? (means[i] / max).toFixed(3) : 0) + ')';
    }
    win.frames = 0; win.steps = 0; win.simMs = 0; win.drawMs = 0; win.frameMs = 0;
    resetProfiler();
  }
  drawTable(registry);
}
/* Le tableau ECS : une ligne par numéro d'entité, une colonne par type de composant. */
var SHORT = { MovementPattern: 'MovePattern', PlayerBonuses: 'PlayerBonus' };
function drawTable(registry) {
  var names = C.COMPONENTS, cssW = table.clientWidth || 332, dpr = Math.min(window.devicePixelRatio || 1, 2);
  var head = 82, rowH = 6, maxRows = 40, foot = 18, gutter = 22;
  var cssH = head + maxRows * rowH + foot;
  if (table.width !== Math.round(cssW * dpr) || table.height !== Math.round(cssH * dpr)) {
    table.width = Math.round(cssW * dpr); table.height = Math.round(cssH * dpr);
    table.style.aspectRatio = cssW + ' / ' + cssH;
  }
  var colW = (cssW - gutter) / names.length, c, e;
  tctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  tctx.clearRect(0, 0, cssW, cssH);
  tctx.font = '9.5px "JetBrains Mono",monospace'; tctx.textBaseline = 'middle';
  for (c = 0; c < names.length; c++) {
    var column = registry.getComponents(names[c]), x = gutter + c * colW;
    tctx.save(); tctx.translate(x + colW / 2, head - 6); tctx.rotate(-Math.PI / 2);
    tctx.fillStyle = column.live ? '#F0EADF' : '#8D8477'; tctx.textAlign = 'left';
    tctx.fillText(SHORT[names[c]] || names[c], 0, 0); tctx.restore();
    for (e = 0; e < maxRows; e++) {
      tctx.fillStyle = column.has(e) ? '#E9A855' : 'rgba(240,234,224,.07)';
      tctx.fillRect(x + 1, head + e * rowH + 1, colW - 2, rowH - 2);
    }
    tctx.fillStyle = column.live ? '#F0EADF' : '#8D8477'; tctx.textAlign = 'center';
    tctx.fillText(String(column.live), x + colW / 2, head + maxRows * rowH + 10);
  }
  tctx.textAlign = 'right'; tctx.fillStyle = '#8D8477';
  for (e = 0; e < maxRows; e += 5) tctx.fillText(String(e), gutter - 5, head + e * rowH + rowH / 2);
  var mine = game.findPlayerShip(1);
  if (mine !== null && mine < maxRows) { tctx.fillStyle = '#7FE3FF'; tctx.fillRect(gutter - 3, head + mine * rowH + 1, 2, rowH - 2); }
  var capacity = registry.entityCapacity();
  setText('rty-s-more', 'Numéros 0 à ' + (maxRows - 1) + ' affichés sur ' + capacity + ' déjà donnés. Le trait bleu est votre vaisseau. Un numéro libéré est réutilisé : le tableau ne grandit pas pour rien.');
}
setInterval(function () { if (state === 'running' && visible) updatePanel(false); }, 250);

/* ───────── clavier ───────── */
var KEYMAP = { ArrowUp: A.Up, ArrowDown: A.Down, ArrowLeft: A.Left, ArrowRight: A.Right, ' ': A.Shoot, Spacebar: A.Shoot, Enter: A.Shoot, c: A.Charge, C: A.Charge, x: A.Force, X: A.Force };
function typing(target) { return target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName); }
window.addEventListener('keydown', function (event) {
  if (event.ctrlKey || event.metaKey || event.altKey || typing(event.target) || !visible) return;
  if ((event.key === 'p' || event.key === 'P') && (state === 'running' || state === 'paused')) { if (!event.repeat) toggle(); event.preventDefault(); return; }
  if (state !== 'running') return;
  var bit = KEYMAP[event.key];
  if (!bit) return;
  if (bit === A.Shoot && event.target && event.target.tagName === 'BUTTON') return;   // Espace sur un bouton : on laisse le bouton agir
  keys |= bit;
  event.preventDefault();
});
window.addEventListener('keyup', function (event) {
  var bit = KEYMAP[event.key];
  if (bit) keys &= ~bit;
});
window.addEventListener('blur', function () { keys = 0; });

/* ───────── tactile : glisser sur le jeu déplace le vaisseau ───────── */
function markTouch() { stage.classList.add('is-touch'); }
if (coarse) markTouch();
canvas.addEventListener('pointerdown', function (event) {
  if (event.pointerType === 'mouse') { if (state === 'running') { try { view.focus({ preventScroll: true }); } catch (e) { /* rien */ } } return; }
  markTouch();
  if (state !== 'running') return;
  var mine = game.findPlayerShip(1), positions = game.getRegistry().getComponents('Position');
  if (mine === null) return;
  steer = { id: event.pointerId, sx: event.clientX, sy: event.clientY, ox: positions.get(mine).x, oy: positions.get(mine).y, tx: positions.get(mine).x, ty: positions.get(mine).y };
  try { canvas.setPointerCapture(event.pointerId); } catch (e) { /* rien */ }
  event.preventDefault();
});
canvas.addEventListener('pointermove', function (event) {
  if (!steer || event.pointerId !== steer.id) return;
  var ratio = W / canvas.getBoundingClientRect().width;
  steer.tx = steer.ox + (event.clientX - steer.sx) * ratio * 1.25;
  steer.ty = steer.oy + (event.clientY - steer.sy) * ratio * 1.25;
});
function endSteer(event) { if (steer && event.pointerId === steer.id) steer = null; }
canvas.addEventListener('pointerup', endSteer);
canvas.addEventListener('pointercancel', endSteer);
Array.prototype.forEach.call($('rty-pad').querySelectorAll('button'), function (button) {
  var action = button.getAttribute('data-action');
  if (action === 'pause') { button.addEventListener('click', toggle); return; }
  var bit = +action;
  function down(event) { touchMask |= bit; button.classList.add('is-down'); try { button.setPointerCapture(event.pointerId); } catch (e) { /* rien */ } event.preventDefault(); }
  function up() { touchMask &= ~bit; button.classList.remove('is-down'); }
  button.addEventListener('pointerdown', down);
  button.addEventListener('pointerup', up);
  button.addEventListener('pointercancel', up);
  button.addEventListener('contextmenu', function (event) { event.preventDefault(); });
});

/* ───────── boutons et réglages ───────── */
function refocus() { if (state === 'running') { try { view.focus({ preventScroll: true }); } catch (e) { /* rien */ } } }
function press(button, on) { button.setAttribute('aria-pressed', on ? 'true' : 'false'); }
function group(id, apply) {
  var box = $(id);
  box.addEventListener('click', function (event) {
    var chip = event.target.closest('.chip[data-v]');
    if (!chip || !box.contains(chip)) return;
    Array.prototype.forEach.call(box.querySelectorAll('.chip[data-v]'), function (other) { press(other, other === chip); });
    apply(chip.getAttribute('data-v'));
    refocus();
  });
}
function switchChip(id, key, apply) {
  var chip = $(id);
  press(chip, settings[key]);
  chip.addEventListener('click', function () {
    settings[key] = !settings[key];
    press(chip, settings[key]);
    if (apply) apply();
    if (state !== 'running') render();
    refocus();
  });
}
playBtn.addEventListener('click', toggle);
overBtn.addEventListener('click', start);
$('rty-restart').addEventListener('click', restart);
group('rty-diff', function (value) { settings.difficulty = value; restart(); });
group('rty-level', function (value) { settings.firstLevel = +value; loadEditor(); restart(); });
group('rty-speed', function (value) { settings.speed = +value; });
switchChip('rty-slow', 'slow', function () { if (rules) rules.slowMode = settings.slow; });
switchChip('rty-auto', 'auto', function () { if (rules) rules.autoFire = settings.auto; });
switchChip('rty-shield', 'shield', applyShield);
switchChip('rty-boxes', 'boxes');

/* ───────── fichiers : niveau modifiable, script Lua ───────── */
var editor = $('rty-src'), msg = $('rty-msg');
function loadEditor() {
  var path = levelPath(settings.firstLevel);
  $('rty-level-file').textContent = path;
  editor.value = overrides[path] || FILES[path];
  msg.hidden = true;
}
function showError(error) {
  msg.textContent = '';
  var line = document.createElement('span');
  line.className = 't-err';
  line.textContent = error && error.name === 'ResourceError' ? error.message : 'Erreur : ' + (error && error.message || error);
  msg.appendChild(line);
  msg.hidden = false;
  $('rty-level-box').open = true;
}
$('rty-apply').addEventListener('click', function () {
  var path = levelPath(settings.firstLevel), previous = overrides[path];
  overrides[path] = editor.value;
  msg.hidden = true;
  if (!restart()) {                 // fichier refusé : on garde la partie d'avant
    if (previous === undefined) delete overrides[path]; else overrides[path] = previous;
    return;
  }
  view.scrollIntoView({ block: 'center', behavior: reduced ? 'auto' : 'smooth' });
});
$('rty-reset').addEventListener('click', function () {
  delete overrides[levelPath(settings.firstLevel)];
  loadEditor();
});
$('rty-lua').textContent = FILES['assets/scripts/zigzag.lua'];
$('rty-luajs').textContent = 'zigzag: {\n  health: 2, score: 150, width: 48, height: 48,\n  sprite: \'bydos\', fire_cooldown: 1.8, missile_speed: 300,\n  update: '
  + String(C.scripts.zigzag.update).replace(/\n {4}/g, '\n  ') + ',\n  fire: ' + String(C.scripts.zigzag.fire).replace(/\n {4}/g, '\n  ') + '\n}';

/* ───────── arrêt hors écran, onglet caché, taille ───────── */
if ('IntersectionObserver' in window) {
  new IntersectionObserver(function (entries) {
    visible = entries[0].isIntersecting;
    if (!visible) pause(true);
  }, { threshold: 0.15 }).observe(view);
}
document.addEventListener('visibilitychange', function () { if (document.hidden) pause(true); });
var resizeTimer = 0;
window.addEventListener('resize', function () { clearTimeout(resizeTimer); resizeTimer = setTimeout(function () { resize(); if (game) updatePanel(true); }, 120); });

/* ───────── départ : une image fixe, rien ne tourne avant « Jouer » ───────── */
if (coarse) $('rty-hint').textContent = 'Glissez sur le jeu pour déplacer le vaisseau. Le tir automatique est activé sur écran tactile. Tenez « Charge » puis relâchez pour le tir chargé. Tournez le téléphone pour un jeu plus grand.';
loadEditor();
newGame();
buildSystems();
resize();
updatePanel(true);

/* Poignée pour les tests automatiques de la page. */
window.__rtype = { game: function () { return game; }, state: function () { return state; }, settings: settings };
})();
