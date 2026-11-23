/* Zappy — interface de la démo. Les règles et l'IA sont dans core.js.
   La simulation avance à pas fixe (un tick = une unité de temps du serveur),
   le dessin suit à son rythme. */
(function () {
'use strict';

var Z = window.ZAPPY;
var $ = function (id) { return document.getElementById(id); };
var canvas = $('zp-canvas'), ctx = canvas.getContext('2d');
var wrap = $('zp-view');

var TEAM_COLORS = ['#E9A855', '#6FB7C9', '#E08A9B', '#9BC46B'];
var RES_COLORS = ['#E6DCC3', '#9FB4C8', '#6FC3A0', '#D9705F', '#C9A0DC', '#E8C15A', '#8192F2'];
var RES_FR = ['nourriture', 'linemate', 'deraumere', 'sibur', 'mendiane', 'phiras', 'thystame'];
var DIR_FR = ['sur ma case', 'devant', 'devant à droite', 'à droite', 'derrière à droite', 'derrière', 'derrière à gauche', 'à gauche', 'devant à gauche'];

var small = (window.matchMedia && matchMedia('(pointer: coarse)').matches) || (navigator.hardwareConcurrency || 8) <= 4;
var reduced = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

var cfg = { size: 10, teams: 4, clients: 1, freq: 100 };
var game = null, seed = 1;
var running = true, turbo = false, onScreen = true, rafId = 0, lastT = 0, acc = 0;
var selected = null;                       // process IA choisi
var showLinks = true, showVision = true;
var vis = {};                              // positions affichées, par id de joueur
var waves = [], lastWave = {};             // ondes sonores en cours
var halos = [];                            // incantations en cours ou qui viennent de finir
var journal = [], journalDirty = true;
var mapDirty = true, lastMapDraw = 0, layer = document.createElement('canvas');
var dpr = 1, W = 0, H = 0, cell = 0, fancy = true, slowFrames = 0;
var uiT = 0, effF = 0, tickCount = 0, tickT = 0, wonShown = false;

/* ───────── partie ───────── */
function teamNames() { return ['team1', 'team2', 'team3', 'team4'].slice(0, cfg.teams); }
function colorOf(team) { return TEAM_COLORS[parseInt(team.slice(4), 10) - 1] || '#fff'; }

function newGame() {
  seed = (Date.now() % 100000) + 1;
  game = new Z.Game({ width: cfg.size, height: cfg.size, teams: teamNames(), clients: cfg.clients, freq: cfg.freq, seed: seed });
  game.onGui = onGui;
  selected = null; vis = {}; waves = []; lastWave = {}; halos = []; journal = []; journalDirty = true;
  mapDirty = true; acc = 0; wonShown = false;
  $('zp-rally-msg').textContent = '';
  note('Partie lancée : carte ' + cfg.size + '×' + cfg.size + ', ' + cfg.teams + ' équipe' + (cfg.teams > 1 ? 's' : '') + ', -c ' + cfg.clients + '. Une reine par équipe se connecte.');
  resize(); refreshUI(true); kick();
}

function note(text, id) {
  journal.push({ t: game ? game.tick : 0, s: text, id: id || 0 });
  if (journal.length > 40) journal.shift();
  journalDirty = true;
}

function procById(id) {
  for (var i = 0; i < game.procs.length; i++) if (game.procs[i].player && game.procs[i].player.id === id) return game.procs[i];
  return null;
}

/* la page lit le protocole graphique du serveur, comme le vrai client OpenGL */
function onGui(msg) {
  var a = msg.charCodeAt(0), b = msg.charCodeAt(1), p;
  if (a === 98) { mapDirty = true; return; }                       // bct
  if (a !== 112 && a !== 115 && a !== 101) return;
  if (b === 98 && a === 112) {                                     // pbc #id texte
    var id = parseInt(msg.slice(5), 10), now = performance.now();
    if (!lastWave[id] || now - lastWave[id] > 520) { lastWave[id] = now; waves.push({ id: id, t: now }); if (waves.length > 60) waves.shift(); }
    return;
  }
  var c3 = msg.charCodeAt(2);
  if (b === 112 || b === 103 || (b === 105 && c3 === 110) || (b === 100 && c3 === 114)) return;   // ppo, pgt, pin, pdr
  p = msg.slice(0, -1).split(' ');
  switch (p[0]) {
    case 'pic':
      halos.push({ x: +p[1], y: +p[2], level: +p[3], t: performance.now(), end: 0, ok: false });
      note('Incantation lancée en (' + p[1] + ', ' + p[2] + ') : niveau ' + p[3] + ' → ' + (+p[3] + 1) + ', drones ' + p.slice(4).join(' '), parseInt(p[4].slice(1), 10));
      break;
    case 'pie':
      for (var i = halos.length - 1; i >= 0; i--) if (!halos[i].end && halos[i].x === +p[1] && halos[i].y === +p[2]) { halos[i].end = performance.now(); halos[i].ok = p[3] === '1'; break; }
      note(p[3] === '1' ? 'Incantation réussie en (' + p[1] + ', ' + p[2] + ')' : 'Incantation ratée en (' + p[1] + ', ' + p[2] + ') : une condition n\'était plus remplie');
      break;
    case 'pfk': note('La reine #' + p[1].slice(1) + ' pond un œuf (Fork)', +p[1].slice(1)); break;
    case 'pnw': note('#' + p[1].slice(1) + ' rejoint ' + p[6], +p[1].slice(1)); break;
    case 'pdi':
      var pr = procById(+p[1].slice(1));
      note('#' + p[1].slice(1) + (pr && pr.player.isDead ? ' meurt de faim' : ' quitte la partie : ses réponses se sont décalées'));
      break;
    case 'seg':
      if (!wonShown) {
        wonShown = true; note('Victoire : ' + p[1] + ' a 6 drones au niveau 8 (seg ' + p[1] + ')');
        setRunning(false);
      }
      break;
  }
}

/* ───────── boucle ───────── */
function kick() { if (!rafId && onScreen && !document.hidden) { lastT = 0; rafId = requestAnimationFrame(frame); } }
function animating() { return running || waves.length || halos.length; }

function frame(t) {
  rafId = 0;
  var dt = lastT ? Math.min(100, t - lastT) : 16;
  lastT = t;
  if (running) {
    var want, t0 = performance.now(), done = 0, budget = turbo ? 9 : 7;
    if (turbo) want = 100000; else { acc += dt * cfg.freq / 1000; want = Math.floor(acc); acc -= want; }
    while (done < want) {
      game.step(); done++;
      if ((done & 7) === 0 && performance.now() - t0 > budget) { if (!turbo) acc = 0; break; }   // en retard : on lâche le reste
    }
    tickCount += done;
    if (t - tickT > 1000) { effF = Math.round(tickCount * 1000 / (t - tickT)); tickCount = 0; tickT = t; }
  }
  var d0 = performance.now();
  draw(t, dt);
  var cost = performance.now() - d0;
  if (cost > 12) { if (++slowFrames > 20 && (fancy || dpr > 1)) { fancy = false; dpr = 1; resize(); slowFrames = 0; } } else if (slowFrames > 0) slowFrames--;
  if (t - uiT > 160) { uiT = t; refreshUI(false); }
  if (animating() && onScreen && !document.hidden) rafId = requestAnimationFrame(frame);
}

function setRunning(v) {
  running = v;
  $('zp-play').textContent = v ? 'Pause' : 'Lecture';
  $('zp-play').setAttribute('aria-pressed', v ? 'false' : 'true');
  if (v) kick(); else refreshUI(true);
}

/* ───────── dessin ───────── */
function resize() {
  var cw = Math.min(wrap.clientWidth, 640);
  if (cw < 50) return;
  if (!slowFrames && fancy) dpr = Math.min(window.devicePixelRatio || 1, small ? 1.5 : 2);
  W = cw; H = cw;
  canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
  canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
  layer.width = canvas.width; layer.height = canvas.height;
  cell = W / cfg.size;
  mapDirty = true; lastMapDraw = 0;
  if (!rafId && game) draw(performance.now(), 16);
}

function drawMap() {
  var c = layer.getContext('2d'), w = game.world, n = cfg.size, x, y, r;
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  c.fillStyle = '#0F0D0A'; c.fillRect(0, 0, W, H);
  for (y = 0; y < n; y++) for (x = 0; x < n; x++) {
    c.fillStyle = (x + y) & 1 ? '#1B1712' : '#1F1A14';
    c.fillRect(x * cell + .5, y * cell + .5, cell - 1, cell - 1);
  }
  var rad = Math.max(1.1, Math.min(3.2, cell * 0.075));
  for (y = 0; y < n; y++) for (x = 0; x < n; x++) {
    var base = (y * n + x) * 7;
    for (r = 0; r < 7; r++) {
      var q = w.tiles[base + r];
      if (!q) continue;
      /* 7 emplacements fixes dans la case : la nourriture au centre, les pierres autour */
      var px = r === 0 ? 0.5 : 0.5 + 0.33 * Math.cos((r - 1) * Math.PI / 3 + 0.5);
      var py = r === 0 ? 0.5 : 0.5 + 0.33 * Math.sin((r - 1) * Math.PI / 3 + 0.5);
      c.globalAlpha = r === 0 ? 0.55 : 0.95;
      c.fillStyle = RES_COLORS[r];
      c.beginPath(); c.arc((x + px) * cell, (y + py) * cell, rad * (q > 1 ? 1.35 : 1), 0, 6.283); c.fill();
    }
  }
  c.globalAlpha = 1;
}

function tri(x, y, r, o) {
  var a = (o - 1) * Math.PI / 2 - Math.PI / 2;           // 1 = nord (haut de l'écran)
  ctx.beginPath();
  ctx.moveTo(x + Math.cos(a) * r * 1.15, y + Math.sin(a) * r * 1.15);
  ctx.lineTo(x + Math.cos(a + 2.45) * r, y + Math.sin(a + 2.45) * r);
  ctx.lineTo(x + Math.cos(a - 2.45) * r, y + Math.sin(a - 2.45) * r);
  ctx.closePath();
}

function draw(t, dt) {
  if (!game || !W) return;
  if (mapDirty && t - lastMapDraw > 110) { drawMap(); mapDirty = false; lastMapDraw = t; }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.drawImage(layer, 0, 0);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  var world = game.world, players = world.players, n = cfg.size, i, p, v, k;
  var ease = reduced ? 1 : 1 - Math.exp(-dt / 70);

  /* champ de vision du drone choisi */
  if (selected && selected.player && selected.alive && showVision) {
    var sp = selected.player, cells = Z.visionTiles(sp.x, sp.y, sp.orientation, sp.level, n, n);
    ctx.fillStyle = 'rgba(240,234,223,.075)';
    for (i = 0; i < cells.length; i++) ctx.fillRect(cells[i][0] * cell, cells[i][1] * cell, cell, cell);
  }

  /* œufs */
  for (i = 0; i < world.eggs.length; i++) {
    var e = world.eggs[i];
    ctx.strokeStyle = colorOf(e.team); ctx.lineWidth = 1.4; ctx.fillStyle = 'rgba(15,13,10,.8)';
    ctx.beginPath(); ctx.ellipse((e.x + .78) * cell, (e.y + .78) * cell, cell * .1 + 1.5, cell * .13 + 2, 0, 0, 6.283); ctx.fill(); ctx.stroke();
  }

  /* halos d'incantation : anneau à profil doux, dans l'esprit du shader incant.frag du projet */
  for (i = halos.length - 1; i >= 0; i--) {
    var h = halos[i], hx = (h.x + .5) * cell, hy = (h.y + .5) * cell, age = (t - h.t) / 1000;
    if (h.end) {
      var f = (t - h.end) / 900;
      if (f >= 1) { halos.splice(i, 1); continue; }
      ctx.strokeStyle = h.ok ? 'rgba(233,168,85,' + (1 - f) + ')' : 'rgba(224,119,95,' + (1 - f) + ')';
      ctx.lineWidth = 2.5 * (1 - f) + .5;
      ctx.beginPath(); ctx.arc(hx, hy, cell * (0.6 + (h.ok ? 2.2 : 0.5) * (reduced ? 1 : f)), 0, 6.283); ctx.stroke();
      continue;
    }
    if (t - h.t > 120000) { halos.splice(i, 1); continue; }
    var pulse = reduced ? 0.5 : 0.5 + 0.5 * Math.sin(age * 4);
    var R = cell * (0.85 + 0.12 * pulse);
    if (fancy) {
      var g = ctx.createRadialGradient(hx, hy, R * 0.35, hx, hy, R * 1.25);
      g.addColorStop(0, 'rgba(233,168,85,0)'); g.addColorStop(0.55, 'rgba(255,214,150,' + (0.34 + 0.2 * pulse) + ')'); g.addColorStop(1, 'rgba(233,168,85,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(hx, hy, R * 1.25, 0, 6.283); ctx.fill();
    }
    ctx.strokeStyle = 'rgba(255,224,170,.9)'; ctx.lineWidth = 1.3;
    ctx.setLineDash([cell * .22, cell * .16]); ctx.lineDashOffset = reduced ? 0 : -age * cell * .6;
    ctx.beginPath(); ctx.arc(hx, hy, R * 0.8, 0, 6.283); ctx.stroke();
    ctx.setLineDash([]);
  }

  /* positions affichées : glissent vers la case réelle */
  var occ = {}, alive = [];
  for (i = 0; i < players.length; i++) {
    p = players[i];
    if (p.isDead) continue;
    k = p.y * n + p.x; (occ[k] = occ[k] || []).push(p); alive.push(p);
  }
  var seen = {};
  for (k in occ) {
    var list = occ[k], m = list.length;
    for (i = 0; i < m; i++) {
      p = list[i];
      var off = m > 1 ? cell * (m > 4 ? 0.3 : 0.24) : 0, ang = i * 6.283 / m + 0.6;
      var tx = (p.x + .5) * cell + Math.cos(ang) * off, ty = (p.y + .5) * cell + Math.sin(ang) * off;
      v = vis[p.id];
      if (!v || Math.abs(tx - v.x) > W / 2 || Math.abs(ty - v.y) > H / 2) v = vis[p.id] = { x: tx, y: ty };
      else { v.x += (tx - v.x) * ease; v.y += (ty - v.y) * ease; }
      v.m = m; seen[p.id] = 1;
    }
  }
  for (k in vis) if (!seen[k]) delete vis[k];

  /* liens de ralliement : du suiveur vers le drone dont il a retenu le poids */
  var byWeight = {}, live = game.live, pr;
  for (i = 0; i < live.length; i++) if (live[i].player) byWeight[live[i].brain.player.rally_weight] = live[i];
  if (showLinks) {
    ctx.lineWidth = 1; ctx.setLineDash([3, 4]);
    for (i = 0; i < live.length; i++) {
      pr = live[i];
      if (!pr.player || !pr.view.moving) continue;
      var target = byWeight[pr.view.heardWeight];
      if (!target || !vis[pr.player.id] || !vis[target.player.id]) continue;
      var a = vis[pr.player.id], b2 = vis[target.player.id], dx = b2.x - a.x, dy = b2.y - a.y;
      if (dx > W / 2) dx -= W; if (dx < -W / 2) dx += W;
      if (dy > H / 2) dy -= H; if (dy < -H / 2) dy += H;
      ctx.strokeStyle = selected === pr || selected === target ? 'rgba(255,236,200,.95)' : 'rgba(240,234,223,.34)';
      for (var ox = -1; ox <= 1; ox++) for (var oy = -1; oy <= 1; oy++) {
        var x1 = a.x + ox * W, y1 = a.y + oy * H, x2 = x1 + dx, y2 = y1 + dy;
        if (Math.max(x1, x2) < 0 || Math.min(x1, x2) > W || Math.max(y1, y2) < 0 || Math.min(y1, y2) > H) continue;
        ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
      }
    }
    ctx.setLineDash([]);
  }

  /* ondes sonores des Broadcast */
  for (i = waves.length - 1; i >= 0; i--) {
    var wv = waves[i], f2 = (t - wv.t) / 620;
    v = vis[wv.id];
    if (f2 >= 1 || !v) { waves.splice(i, 1); continue; }
    pr = procById(wv.id);
    ctx.strokeStyle = pr ? colorOf(pr.team) : '#fff';
    ctx.globalAlpha = (1 - f2) * 0.55; ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.arc(v.x, v.y, reduced ? cell * 0.7 : cell * (0.35 + 2.4 * f2), 0, 6.283); ctx.stroke();
  }
  ctx.globalAlpha = 1;

  /* drones */
  for (i = 0; i < alive.length; i++) {
    p = alive[i]; v = vis[p.id]; pr = game.byFd[p.fd];
    var r = Math.max(4.6, cell * (v.m > 4 ? 0.15 : v.m > 1 ? 0.19 : 0.27));
    var col = colorOf(p.team);
    if (pr && !pr.isRecruiter && pr.brain.player.is_anchor && p.level > 1 && p.level < 8 && pr.view.ready) {
      var pl = reduced ? 0.6 : 0.5 + 0.5 * Math.sin(t / 260);       // l'ancre : le point de rendez-vous
      if (fancy) {
        var gg = ctx.createRadialGradient(v.x, v.y, 0, v.x, v.y, r * 3);
        gg.addColorStop(0, 'rgba(233,168,85,' + (0.3 + 0.2 * pl) + ')'); gg.addColorStop(1, 'rgba(233,168,85,0)');
        ctx.fillStyle = gg; ctx.beginPath(); ctx.arc(v.x, v.y, r * 3, 0, 6.283); ctx.fill();
      }
      ctx.strokeStyle = '#FFD696'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(v.x, v.y, r * (1.7 + 0.25 * pl), 0, 6.283); ctx.stroke();
    }
    tri(v.x, v.y, r, p.orientation);
    ctx.fillStyle = col; ctx.fill();
    ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(15,13,10,.85)'; ctx.stroke();
    if (pr && pr.isRecruiter) {                                      // la reine : un losange
      ctx.strokeStyle = col; ctx.lineWidth = 1.3;
      ctx.beginPath(); ctx.moveTo(v.x, v.y - r * 1.9); ctx.lineTo(v.x + r * 1.9, v.y); ctx.lineTo(v.x, v.y + r * 1.9); ctx.lineTo(v.x - r * 1.9, v.y); ctx.closePath(); ctx.stroke();
    }
    if (cell >= 30 && v.m <= 4) {
      ctx.font = '600 ' + Math.round(Math.max(9, r * 0.95)) + 'px "Instrument Sans",system-ui,sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = '#17130E'; ctx.fillText(p.level, v.x, v.y + 0.5);
    }
    if (selected && selected.player === p) {
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.arc(v.x, v.y, r * 2.3 + 2, 0, 6.283); ctx.stroke();
    }
  }
}

/* ───────── clic sur un drone ───────── */
var lastPick = 0;
canvas.addEventListener('click', function (ev) {
  var rect = canvas.getBoundingClientRect(), x = ev.clientX - rect.left, y = ev.clientY - rect.top;
  var hits = [], lim = Math.max(cell * 0.55, 16), i, p, v;
  for (i = 0; i < game.world.players.length; i++) {
    p = game.world.players[i]; v = vis[p.id];
    if (!v || p.isDead) continue;
    var d = Math.hypot(v.x - x, v.y - y);
    if (d < lim) hits.push({ d: d, p: p });
  }
  if (!hits.length) { selected = null; refreshUI(true); return; }
  hits.sort(function (a, b) { return a.d - b.d || a.p.id - b.p.id; });
  var idx = 0;
  for (i = 0; i < hits.length; i++) if (selected && selected.player === hits[i].p) idx = (i + 1) % hits.length;   // même case : on passe au suivant
  if (hits.length > 1 && hits[0].d < 6 && !(selected && hits.some(function (h) { return h.p === selected.player; }))) idx = 0;
  selected = game.byFd[hits[idx].p.fd] || null; lastPick = Date.now();
  refreshUI(true);
});

/* ───────── panneaux ───────── */
var cache = {};
function setHTML(id, html) { if (cache[id] !== html) { cache[id] = html; $(id).innerHTML = html; } }
function setText(id, s) { if (cache[id] !== s) { cache[id] = s; $(id).textContent = s; } }
function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function num(n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' '); }

function refreshRanking() {
  var rk = game.ranking(), html = '';
  rk.sort(function (a, b) {
    if (b.max !== a.max) return b.max - a.max;
    return (b.levels[b.max] || 0) - (a.levels[a.max] || 0) || (a.team < b.team ? -1 : 1);
  });
  for (var i = 0; i < rk.length; i++) {
    var r = rk[i], pips = '';
    for (var l = 1; l <= 8; l++) pips += '<i class="' + (r.levels[l] ? 'on' : '') + '" title="niveau ' + l + '">' + (r.levels[l] || '') + '</i>';
    html += '<div class="zp-team' + (game.winner === r.team ? ' is-win' : '') + '" style="--tc:' + colorOf(r.team) + '">' +
      '<b><span class="zp-dot"></span>' + r.team + '</b>' +
      '<span class="zp-lvl">niv. ' + (r.max || '–') + '</span>' +
      '<span class="zp-pips" aria-label="drones par niveau, de 1 à 8">' + pips + '</span>' +
      '<span class="zp-count">' + r.alive + ' drone' + (r.alive > 1 ? 's' : '') + (r.eggs ? ' · ' + r.eggs + ' œuf' + (r.eggs > 1 ? 's' : '') : '') + '</span></div>';
  }
  setHTML('zp-rank', html);
}

function compass(k) {
  /* 8 directions autour du drone, 1 = devant, puis vers la droite */
  var s = '<svg class="zp-compass" viewBox="0 0 60 60" aria-hidden="true"><path d="M30 21l6 15H24z" fill="currentColor" opacity=".8"/>';
  for (var i = 1; i <= 8; i++) {
    var a = (i - 1) * Math.PI / 4 - Math.PI / 2, x = 30 + Math.cos(a) * 23, y = 30 + Math.sin(a) * 23;
    s += '<circle cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" r="' + (i === k ? 6 : 3) + '" class="' + (i === k ? 'on' : '') + '"/>';
    if (i === k) s += '<text x="' + x.toFixed(1) + '" y="' + (y + 3).toFixed(1) + '">' + i + '</text>';
  }
  if (k === 0) s += '<circle cx="30" cy="30" r="11" class="ring"/>';
  return s + '</svg>';
}

function stateText(pr) {
  var P = pr.brain.player, p = pr.player, v = pr.view, s = '', req = Z.ELEVATION_REQ[P.level];
  if (!pr.alive) return '<b>Arrêté.</b> ' + (p && p.isDead ? 'Mort de faim : le serveur a envoyé <span class="mono">dead</span>.' : 'Le process a quitté la partie.');
  if (!p) return '<b>Connexion…</b>';
  if (p.isIncanting) return '<b>Incantation en cours.</b> Figé par le serveur pendant 300 unités de temps.';
  if (v.state === 'reine') return '<b>Reine.</b> Elle ne monte pas de niveau. Elle garde l\'équipe à 9 : une place libre ou un œuf (<span class="mono">Fork</span>) pour chaque nouveau drone. Elle mange sous 30 de nourriture.';
  if (v.state === 'niveau 8') return '<b>Niveau 8.</b> Reste connecté pour compter dans la victoire, et mange.';
  if (v.state === 'survivre') s = '<b>Survivre.</b> Va vers la nourriture la plus proche en vue.';
  else if (v.state === 'collecter') {
    var miss = P.missing_for_elevation(), parts = [];
    for (var k in miss) parts.push(miss[k] + ' ' + k);
    s = '<b>Collecter.</b> Il lui manque : ' + (parts.join(', ') || 'rien') + '.';
  } else if (v.state === 'incanter') {
    if (req && req.players === 1) s = '<b>Incanter.</b> Niveau 1 : il incante seul.';
    else if (P.locked && P.is_anchor) s = '<b>Ancre.</b> Personne n\'a un poids plus grand : il ne bouge plus et attend ' + req.players + ' drones de niveau ' + P.level + ' (' + P.here_count + ' sur la case).';
    else if (P.locked) s = '<b>Verrouillé au rendez-vous.</b> Il entend l\'ancre sur sa case et attend le quorum (' + P.here_count + ' / ' + req.players + ').';
    else if (P.is_anchor) s = '<b>Ancre.</b> Il se fige comme point de rendez-vous.';
    else s = '<b>Incanter.</b> Pierres réunies, il rejoint le groupe.';
  } else s = '<b>' + esc(v.state) + '</b>';
  if (v.moving) s += ' <span class="zp-follow">Suit un appel venu de la direction ' + v.heardDir + ' (' + DIR_FR[v.heardDir] + ').</span>';
  else if (v.heardDir !== null && !pr.isRecruiter && req && req.players > 1 && !P.locked)
    s += ' Il entend un poids plus grand (direction ' + v.heardDir + ') mais n\'est pas prêt : ' + (P.need_fuel ? 'il doit d\'abord manger.' : 'il lui manque des pierres.');
  return s;
}

function refreshInspector() {
  var pr = selected;
  if (!pr) {
    setHTML('zp-insp', '<p class="zp-empty">Cliquez sur un drone de la carte. Vous verrez son état, son inventaire, ses commandes en attente et ses échanges avec le serveur.</p>');
    return;
  }
  var p = pr.player, P = pr.brain.player, html = '', i;
  html += '<div class="zp-head" style="--tc:' + colorOf(pr.team) + '"><span class="zp-dot"></span><b>#' + (p ? p.id : '?') + '</b> ' + pr.team +
    ' · niveau ' + (p ? p.level : 1) + (pr.isRecruiter ? ' · reine' : '') + '</div>';
  html += '<div class="zp-state">' + (pr.alive && p && !pr.isRecruiter && pr.view.heardDir !== null && p.level > 1 && p.level < 8 ? compass(pr.view.heardDir) : '') + '<p>' + stateText(pr) + '</p></div>';
  if (p) {
    html += '<div class="zp-inv">';
    for (i = 0; i < 7; i++) html += '<span title="' + RES_FR[i] + '"><i style="background:' + RES_COLORS[i] + '"></i>' + Z.RESOURCE_NAMES[i] + ' <b>' + p.inventory[i] + '</b></span>';
    html += '</div>';
    if (!pr.isRecruiter && p.level > 1 && p.level < 8) html += '<p class="zp-small">Son poids de ralliement : <span class="mono">' + P.rally_weight + '</span></p>';
    html += '<span class="zp-sub">File de commandes sur le serveur (10 au plus)</span><div class="zp-queue">';
    if (!p.actionQueue.length) html += '<em>vide</em>';
    for (i = 0; i < p.actionQueue.length; i++) {
      var a = p.actionQueue[i], cost = Z.getCommandCost(a.name);
      html += '<span' + (i === 0 ? ' class="on"' : '') + '>' + esc(a.name) + (i === 0 ? ' <small>' + (cost - a.remainingTicks) + '/' + cost + '</small>' : '') + '</span>';
    }
    html += '</div>';
  }
  html += '<span class="zp-sub">Derniers messages du protocole (texte réel)</span><div class="term zp-log">';
  var log = game.logOf(pr, 14);
  for (i = 0; i < log.length; i++) {
    var l = log[i], txt = l.s.length > 96 ? l.s.slice(0, 96) + '…' : l.s;
    html += '<span class="t-dim">' + l.t + '</span> ' + (l.d === '>' ? '<span class="t-in">&gt;&gt; ' + esc(txt) + '</span>' : '&lt;&lt; ' + esc(txt)) + '\n';
  }
  html += '</div>';
  setHTML('zp-insp', html);
}

function refreshUI(force) {
  if (!game) return;
  var s = game.stats;
  setText('zp-status', 't = ' + num(game.tick) + ' · ' + (game.time < 60 ? game.time.toFixed(1).replace('.', ',') + ' s de jeu' : Math.floor(game.time / 60) + ' min ' + Math.floor(game.time % 60) + ' s de jeu') +
    (running ? ' · ' + num(effF) + ' ticks/s' : ' · en pause'));
  refreshRanking();
  refreshInspector();
  setText('zp-s-bc', num(s.broadcasts)); setText('zp-s-ok', s.incantOk + ' / ' + s.incantStart);
  setText('zp-s-fk', String(s.forks)); setText('zp-s-pop', String(game.live.length));
  if (journalDirty || force) {
    journalDirty = false;
    var html = '', from = Math.max(0, journal.length - 7);
    for (var i = journal.length - 1; i >= from; i--) html += '<span class="t-dim">' + journal[i].t + '</span> ' + esc(journal[i].s) + '\n';
    setHTML('zp-journal', html);
  }
  if (force && !rafId) draw(performance.now(), 1000);
}

/* ───────── réglages ───────── */
function chips(id, values, labels, get, set) {
  var box = $(id);
  values.forEach(function (v, i) {
    var b = document.createElement('button');
    b.type = 'button'; b.className = 'chip'; b.textContent = labels[i];
    b.setAttribute('aria-pressed', get() === v ? 'true' : 'false');
    b.addEventListener('click', function () {
      set(v);
      Array.prototype.forEach.call(box.children, function (c, k) { c.setAttribute('aria-pressed', values[k] === get() ? 'true' : 'false'); });
    });
    box.appendChild(b);
  });
}
chips('zp-size', [10, 15, 20, 30], ['10 × 10', '15 × 15', '20 × 20', '30 × 30'], function () { return cfg.size; }, function (v) { cfg.size = v; newGame(); });
chips('zp-teams', [1, 2, 3, 4], ['1', '2', '3', '4'], function () { return cfg.teams; }, function (v) { cfg.teams = v; newGame(); });
chips('zp-c', [1, 3, 9], ['1 (tout par Fork)', '3', '9 (aucun Fork au départ)'], function () { return cfg.clients; }, function (v) { cfg.clients = v; newGame(); });

var fInput = $('zp-f');
function setFreq(v) {
  cfg.freq = v; if (game) game.setFreq(v);
  $('zp-f-val').textContent = v;
}
fInput.addEventListener('input', function () { setFreq(Math.round(Math.pow(500, fInput.value / 100))); });   // curseur logarithmique : 1 à 500
$('zp-turbo').addEventListener('click', function () {
  turbo = !turbo; this.setAttribute('aria-pressed', turbo ? 'true' : 'false'); acc = 0;
});
$('zp-play').addEventListener('click', function () { setRunning(!running); });
function stepN(n) { setRunning(false); for (var i = 0; i < n; i++) game.step(); refreshUI(true); kick(); }
$('zp-step').addEventListener('click', function () { stepN(1); });
$('zp-step7').addEventListener('click', function () { stepN(7); });
$('zp-new').addEventListener('click', function () { newGame(); setRunning(true); });
$('zp-links').addEventListener('change', function () { showLinks = this.checked; refreshUI(true); });
$('zp-vision').addEventListener('change', function () { showVision = this.checked; refreshUI(true); });

/* choisit le rendez-vous le plus suivi du moment */
$('zp-rally').addEventListener('click', function () {
  var live = game.live, byWeight = {}, countBy = {}, best = null, bestN = 0, i, pr;
  for (i = 0; i < live.length; i++) if (live[i].player) byWeight[live[i].brain.player.rally_weight] = live[i];
  for (i = 0; i < live.length; i++) {
    pr = live[i];
    if (!pr.player || pr.isRecruiter) continue;
    var w = pr.view.moving ? pr.view.heardWeight : (pr.brain.player.locked ? (pr.view.heardWeight || pr.brain.player.rally_weight) : 0);
    if (!w || !byWeight[w]) continue;
    countBy[w] = (countBy[w] || 0) + 1;
    if (countBy[w] > bestN) { bestN = countBy[w]; best = byWeight[w]; }
  }
  if (best) { selected = best; $('zp-rally-msg').textContent = 'Ancre #' + best.player.id + ' choisie : ' + bestN + ' drone' + (bestN > 1 ? 's' : '') + ' au rendez-vous ou en route.'; }
  else $('zp-rally-msg').textContent = 'Aucun appel suivi pour l\'instant. Les premiers arrivent quand deux drones passent au niveau 2 (vers t = 1 000).';
  refreshUI(true);
});

/* ───────── cycle de vie ───────── */
if (window.ResizeObserver) new ResizeObserver(function () { var cw = Math.min(wrap.clientWidth, 640); if (Math.abs(cw - W) > 1) resize(); }).observe(wrap);
else window.addEventListener('resize', resize);
if (window.IntersectionObserver) new IntersectionObserver(function (es) { onScreen = es[0].isIntersecting; if (onScreen) kick(); }, { threshold: 0.02 }).observe(document.querySelector('.stage.zp'));
document.addEventListener('visibilitychange', function () { if (!document.hidden) kick(); });

/* légende des ressources */
(function () {
  var html = '';
  for (var i = 0; i < 7; i++) html += '<span><i style="background:' + RES_COLORS[i] + '"></i>' + Z.RESOURCE_NAMES[i] + '</span>';
  $('zp-legend').innerHTML = html;
})();

setFreq(100);
newGame();
window.__zappy = { game: function () { return game; }, select: function (pr) { selected = pr; refreshUI(true); }, vis: vis, state: function () { return { running: running, turbo: turbo, fancy: fancy, dpr: dpr, cell: cell }; }, visOf: function (id) { return vis[id]; } };
})();
