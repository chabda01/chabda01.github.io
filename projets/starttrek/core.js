/* Start Trek — cœur du calcul (physique du module lunaire + politiques).
   Réécriture en JavaScript des constantes et formules RÉELLES de l'environnement
   Gymnasium LunarLander-v3 (projet Farama Foundation, licence MIT) : gravité,
   impulsions des moteurs, formule de récompense, normalisation de l'observation,
   génération du terrain. Sources exactes citées à côté de chaque bloc — lues le
   12/11/2026 dans gymnasium/envs/box2d/lunar_lander.py sur GitHub.

   Ce que je n'ai PAS réimplémenté à l'identique (simplifications assumées) :
   - Box2D résout les contacts et les joints avec un solveur physique complet
     (articulations, friction, "sommeil" des corps). Je n'ai pas ce solveur :
     le contact avec le sol et les jambes sont des points fixes attachés à la
     coque, pas des corps articulés indépendants.
   - L'assoupissement ("awake=False", qui déclenche la réussite) est approché
     par un minuteur de vitesse quasi nulle, avec les seuils par défaut de
     Box2D (0,5 s, 0,01 m/s, ~2°/s) plutôt que le vrai critère interne du moteur.
   - Le vent (enable_wind) est désactivé, comme dans config.yaml du dépôt.
   Tout le reste (gravité, poussée, bruit des moteurs, récompense, observation,
   terrain, raison de fin d'épisode) suit les formules réelles ligne à ligne.

   Fonctions pures : aucune ne touche au DOM. Marche sous node (require) et
   dans le navigateur (window.STCore). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.STCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ───────────────────── constantes réelles (lunar_lander.py) ─────────────────────
  var FPS = 50;
  var DT = 1 / FPS;
  var SCALE = 30.0;                       // pixels par mètre (sert pour les formules d'origine)
  var GRAVITY = -10.0;                    // config par défaut de LunarLander-v3
  var MAIN_ENGINE_POWER = 13.0;
  var SIDE_ENGINE_POWER = 0.6;
  var INITIAL_RANDOM = 1000.0;
  var VIEWPORT_W = 600, VIEWPORT_H = 400;
  var W = VIEWPORT_W / SCALE, H = VIEWPORT_H / SCALE;   // 20 m × 13,33 m
  var LANDER_POLY = [[-14, 17], [-17, 0], [-17, -10], [17, -10], [17, 0], [14, 17]]
    .map(function (p) { return [p[0] / SCALE, p[1] / SCALE]; });
  var LEG_AWAY = 20 / SCALE, LEG_DOWN = 18 / SCALE;
  var MAIN_ENGINE_Y_LOCATION = 4 / SCALE;
  var SIDE_ENGINE_HEIGHT = 14 / SCALE, SIDE_ENGINE_AWAY = 12 / SCALE;
  var HULL_DENSITY = 5.0;
  var CHUNKS = 11;
  var INITIAL_X = VIEWPORT_W / SCALE / 2;   // 10 m
  var INITIAL_Y = VIEWPORT_H / SCALE;       // 13,33 m

  // Seuils de "sommeil" Box2D par défaut (b2_linearSleepTolerance, b2_angularSleepTolerance,
  // b2_timeToSleep) : c'est ce qui déclenche "not self.lander.awake" → atterrissage réussi.
  var SLEEP_LINEAR_TOL = 0.01;     // m/s
  var SLEEP_ANGULAR_TOL = 2 * Math.PI / 180; // rad/s (~2°/s)
  var SLEEP_TIME = 0.5;            // s
  var SLEEP_STEPS = Math.round(SLEEP_TIME * FPS);

  // Jambes simplifiées : points fixes par rapport à la coque (voir note en tête de fichier).
  var LEG_FOOT_LOCAL = [[-0.95, -0.78], [0.95, -0.78]];

  // ───────────────────── propriétés de masse du polygone (comme b2PolygonShape) ─────────────────────
  function polygonMass(poly, density) {
    var area = 0, cx = 0, cy = 0, I = 0, n = poly.length;
    for (var i = 0; i < n; i++) {
      var x1 = poly[i][0], y1 = poly[i][1];
      var x2 = poly[(i + 1) % n][0], y2 = poly[(i + 1) % n][1];
      var cross = x1 * y2 - x2 * y1;
      var triArea = 0.5 * cross;
      area += triArea;
      cx += triArea * (x1 + x2) / 3;
      cy += triArea * (y1 + y2) / 3;
      var intx2 = x1 * x1 + x1 * x2 + x2 * x2;
      var inty2 = y1 * y1 + y1 * y2 + y2 * y2;
      I += (cross / 12) * (intx2 + inty2);
    }
    cx /= area; cy /= area;
    var mass = density * Math.abs(area);
    var Iorigin = density * Math.abs(I);
    var Icentroid = Iorigin - mass * (cx * cx + cy * cy);   // théorème de Huygens (axes parallèles)
    return { mass: mass, cx: cx, cy: cy, I: Icentroid };
  }
  var HULL = polygonMass(LANDER_POLY, HULL_DENSITY);

  // ───────────────────── générateur pseudo-aléatoire (déterministe, pas celui de Python) ─────────────────────
  // mulberry32 — reproductible à partir d'un seed entier. Les parties ne sont pas identiques
  // au rejeu Python original (algorithme de hasard différent), mais une même seed JS redonne
  // toujours la même partie ici.
  function makeRng(seed) {
    var a = (seed >>> 0) || 1;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function uniform(rng, lo, hi) { return lo + (hi - lo) * rng(); }
  function hashSeed(seed, salt) { return ((seed >>> 0) * 2654435761 + salt) >>> 0; }

  // ───────────────────── terrain (reset(), lunar_lander.py) ─────────────────────
  function makeTerrain(seed) {
    var rng = makeRng(hashSeed(seed, 0x9E3779B1));
    var height = [], i;
    for (i = 0; i < CHUNKS + 1; i++) height.push(uniform(rng, 0, H / 2));
    var helipadY = H / 4;
    height[Math.floor(CHUNKS / 2) - 2] = helipadY;
    height[Math.floor(CHUNKS / 2) - 1] = helipadY;
    height[Math.floor(CHUNKS / 2) + 0] = helipadY;
    height[Math.floor(CHUNKS / 2) + 1] = helipadY;
    height[Math.floor(CHUNKS / 2) + 2] = helipadY;
    var chunkX = [];
    for (i = 0; i < CHUNKS; i++) chunkX.push(W / (CHUNKS - 1) * i);
    var smoothY = [];
    for (i = 0; i < CHUNKS; i++) {
      var hPrev = height[(i - 1 + height.length) % height.length];
      smoothY.push(0.33 * (hPrev + height[i] + height[i + 1]));
    }
    return {
      chunkX: chunkX, smoothY: smoothY,
      helipadX1: chunkX[Math.floor(CHUNKS / 2) - 1],
      helipadX2: chunkX[Math.floor(CHUNKS / 2) + 1],
      helipadY: helipadY
    };
  }
  function groundHeightAt(terrain, x) {
    var cx = terrain.chunkX, cy = terrain.smoothY, n = cx.length;
    if (x <= cx[0]) return cy[0] + (cy[1] - cy[0]) * (x - cx[0]) / (cx[1] - cx[0]);
    if (x >= cx[n - 1]) return cy[n - 1] + (cy[n - 1] - cy[n - 2]) * (x - cx[n - 1]) / (cx[n - 1] - cx[n - 2]);
    for (var i = 0; i < n - 1; i++) {
      if (x >= cx[i] && x <= cx[i + 1]) {
        var t = (x - cx[i]) / (cx[i + 1] - cx[i]);
        return cy[i] + (cy[i + 1] - cy[i]) * t;
      }
    }
    return cy[n - 1];
  }

  // ───────────────────── rotation / points du monde ─────────────────────
  function rot(px, py, angle) {
    var s = Math.sin(angle), c = Math.cos(angle);
    return [px * c - py * s, px * s + py * c];
  }
  function worldCM(state) {
    var r = rot(HULL.cx, HULL.cy, state.angle);
    return [state.x + r[0], state.y + r[1]];
  }
  function hullWorldVertices(state) {
    return LANDER_POLY.map(function (p) {
      var r = rot(p[0], p[1], state.angle);
      return [state.x + r[0], state.y + r[1]];
    });
  }
  function footWorld(state, i) {
    var p = LEG_FOOT_LOCAL[i];
    var r = rot(p[0], p[1], state.angle);
    return [state.x + r[0], state.y + r[1]];
  }

  // ───────────────────── état initial (reset()) ─────────────────────
  function reset(seed) {
    var terrain = makeTerrain(seed);
    var rng = makeRng(hashSeed(seed, 0x2545F491));
    return {
      rngSeed: seed, rngCalls: 0,
      terrain: terrain,
      x: INITIAL_X, y: INITIAL_Y, angle: 0,
      vx: 0, vy: 0, omega: 0,
      initialForce: [uniform(rng, -INITIAL_RANDOM, INITIAL_RANDOM), uniform(rng, -INITIAL_RANDOM, INITIAL_RANDOM)],
      leg0: false, leg1: false,
      prevShaping: null,
      restTimer: 0,
      stepCount: 0,
      done: false, truncated: false, reason: null,
      mainFlame: false, leftFlame: false, rightFlame: false,
      _rng: rng
    };
  }

  function computeObs(s) {
    return [
      (s.x - INITIAL_X) / (W / 2),
      (s.y - (s.terrain.helipadY + LEG_DOWN)) / (H / 2),
      s.vx * (W / 2) / FPS,
      s.vy * (H / 2) / FPS,
      s.angle,
      20.0 * s.omega / FPS,
      s.leg0 ? 1.0 : 0.0,
      s.leg1 ? 1.0 : 0.0
    ];
  }

  // ───────────────────── un pas de simulation (step(), lunar_lander.py) ─────────────────────
  function step(state, action, maxSteps) {
    var s = {
      rngSeed: state.rngSeed, rngCalls: state.rngCalls, terrain: state.terrain,
      x: state.x, y: state.y, angle: state.angle, vx: state.vx, vy: state.vy, omega: state.omega,
      initialForce: state.initialForce, leg0: state.leg0, leg1: state.leg1,
      prevShaping: state.prevShaping, restTimer: state.restTimer, stepCount: state.stepCount,
      done: false, truncated: false, reason: null,
      mainFlame: false, leftFlame: false, rightFlame: false,
      _rng: state._rng
    };

    var mPower = 0, sPower = 0, direction = 0;
    if (action === 2) { mPower = 1.0; s.mainFlame = true; }
    else if (action === 1 || action === 3) { sPower = 1.0; direction = action - 2; s.leftFlame = action === 1; s.rightFlame = action === 3; }

    // gravité
    var dvx = 0, dvy = GRAVITY * DT, dom = 0;

    // force initiale aléatoire : Box2D l'applique une seule fois, au tout premier pas
    if (s.stepCount === 0) {
      dvx += s.initialForce[0] / HULL.mass * DT;
      dvy += s.initialForce[1] / HULL.mass * DT;
    }

    var tip = [Math.sin(s.angle), Math.cos(s.angle)];
    var side = [-tip[1], tip[0]];
    var cm = worldCM(s);

    if (mPower > 0) {
      var d0 = uniform(s._rng, -1, 1) / SCALE, d1 = uniform(s._rng, -1, 1) / SCALE;
      var ox = tip[0] * (MAIN_ENGINE_Y_LOCATION + 2 * d0) + side[0] * d1;
      var oy = -tip[1] * (MAIN_ENGINE_Y_LOCATION + 2 * d0) - side[1] * d1;
      var px = s.x + ox, py = s.y + oy;
      var fx = -ox * MAIN_ENGINE_POWER * mPower, fy = -oy * MAIN_ENGINE_POWER * mPower;
      dvx += fx / HULL.mass; dvy += fy / HULL.mass;
      var rx = px - cm[0], ry = py - cm[1];
      dom += (rx * fy - ry * fx) / HULL.I;
    } else if (sPower > 0) {
      var e0 = uniform(s._rng, -1, 1) / SCALE, e1 = uniform(s._rng, -1, 1) / SCALE;
      var ox2 = tip[0] * e0 + side[0] * (3 * e1 + direction * SIDE_ENGINE_AWAY);
      var oy2 = -tip[1] * e0 - side[1] * (3 * e1 + direction * SIDE_ENGINE_AWAY);
      // le 17 (au lieu de SIDE_ENGINE_HEIGHT=14) est le "bug" connu du code d'origine — reproduit tel quel.
      var px2 = s.x + ox2 - tip[0] * (17 / SCALE), py2 = s.y + oy2 + tip[1] * SIDE_ENGINE_HEIGHT;
      var fx2 = -ox2 * SIDE_ENGINE_POWER * sPower, fy2 = -oy2 * SIDE_ENGINE_POWER * sPower;
      dvx += fx2 / HULL.mass; dvy += fy2 / HULL.mass;
      var rx2 = px2 - cm[0], ry2 = py2 - cm[1];
      dom += (rx2 * fy2 - ry2 * fx2) / HULL.I;
    }

    s.vx += dvx; s.vy += dvy; s.omega += dom;
    s.x += s.vx * DT; s.y += s.vy * DT; s.angle += s.omega * DT;

    // contact sol : jambes (points fixes, correction souple) + coque (crash immédiat)
    var hullHit = false;
    var verts = hullWorldVertices(s);
    for (var i = 0; i < verts.length; i++) {
      if (verts[i][1] <= groundHeightAt(s.terrain, verts[i][0])) { hullHit = true; break; }
    }
    s.leg0 = false; s.leg1 = false;
    for (var k = 0; k < 2; k++) {
      var foot = footWorld(s, k);
      var gy = groundHeightAt(s.terrain, foot[0]);
      if (foot[1] <= gy) {
        if (k === 0) s.leg0 = true; else s.leg1 = true;
        if (!hullHit) {
          s.y += (gy - foot[1]);                 // ne pas s'enfoncer
          if (s.vy < 0) s.vy = 0;                 // restitution 0 : pas de rebond
          s.vx *= 0.9; s.omega *= 0.8;            // friction approchée
        }
      }
    }

    var obs = computeObs(s);
    var shaping = -100 * Math.sqrt(obs[0] * obs[0] + obs[1] * obs[1])
      - 100 * Math.sqrt(obs[2] * obs[2] + obs[3] * obs[3])
      - 100 * Math.abs(obs[4]) + 10 * obs[6] + 10 * obs[7];
    var reward = s.prevShaping === null ? 0 : shaping - s.prevShaping;
    s.prevShaping = shaping;
    reward -= mPower * 0.30;
    reward -= sPower * 0.03;

    var outOfBounds = Math.abs(obs[0]) >= 1.0;
    var terminated = false;
    if (hullHit || outOfBounds) { reward = -100; terminated = true; }

    if (!terminated) {
      var slow = Math.abs(s.vx) < SLEEP_LINEAR_TOL && Math.abs(s.vy) < SLEEP_LINEAR_TOL && Math.abs(s.omega) < SLEEP_ANGULAR_TOL;
      if (s.leg0 && s.leg1 && slow) s.restTimer++; else s.restTimer = 0;
      if (s.restTimer >= SLEEP_STEPS) { reward = 100; terminated = true; }
    }

    s.stepCount++;
    var truncated = !terminated && maxSteps && s.stepCount >= maxSteps;
    s.done = terminated || truncated;
    s.truncated = truncated;
    if (s.done) s.reason = getTerminationReason(terminated, truncated, obs);

    return { state: s, obs: obs, reward: reward, terminated: terminated, truncated: truncated, reason: s.reason };
  }

  // ───────────────────── politiques du dépôt (train.py — exactes) ─────────────────────
  function randomPolicy(rng) { return Math.floor(rng() * 4); }

  function heuristicPolicy(obs) {
    var vY = obs[3], theta = obs[4];
    if (vY < -0.2) return 2;
    else if (theta > 0.1) return 1;
    else if (theta < -0.1) return 3;
    else return 0;
  }

  // Raison de fin — port exact de get_termination_reason() (train.py).
  function getTerminationReason(terminated, truncated, obs) {
    if (truncated) return 'out-of-view';
    if (terminated) {
      var left = obs[6], right = obs[7];
      return (left && right) ? 'sleep' : 'crash';
    }
    return 'unknown';
  }

  // ───────────────────── politiques "équivalentes" (PAS les réseaux entraînés) ─────────────────────
  // Le pilote de référence vient de Gymnasium lui-même (fonction heuristic(), lunar_lander.py,
  // Farama Foundation, licence MIT) : un contrôleur proportionnel publié par le projet, pas écrit
  // par moi et pas lié au DQN. Les vrais poids DQN/table Q du dépôt ne sont pas sauvegardés
  // (fichiers générés, gitignorés) — voir la page pour l'explication complète.
  function autopilotAction(obs) {
    var x = obs[0], y = obs[1], vx = obs[2], vy = obs[3], theta = obs[4], omega = obs[5], leg0 = obs[6], leg1 = obs[7];
    var angleTarg = x * 0.5 + vx * 1.0;
    if (angleTarg > 0.4) angleTarg = 0.4;
    if (angleTarg < -0.4) angleTarg = -0.4;
    var hoverTarg = 0.55 * Math.abs(x);
    var angleTodo = (angleTarg - theta) * 0.5 - omega * 1.0;
    var hoverTodo = (hoverTarg - y) * 0.5 - vy * 0.5;
    if (leg0 || leg1) { angleTodo = 0; hoverTodo = -vy * 0.5; }
    if (hoverTodo > Math.abs(angleTodo) && hoverTodo > 0.05) return 2;
    else if (angleTodo < -0.05) return 3;
    else if (angleTodo > 0.05) return 1;
    return 0;
  }

  // Bornes du discrétiseur réel du projet (q_learning_agent/discretizer.py, n_bins=8).
  var Q_OBS_LOW = [-1.5, -0.5, -5.0, -5.0, -3.14, -5.0, 0.0, 0.0];
  var Q_OBS_HIGH = [1.5, 1.5, 5.0, 5.0, 3.14, 5.0, 1.0, 1.0];
  var Q_N_BINS = 8;
  function discretizeObs(obs) {
    var out = obs.slice();
    for (var i = 0; i < 6; i++) {
      var lo = Q_OBS_LOW[i], hi = Q_OBS_HIGH[i];
      var bin = Math.min(Q_N_BINS - 1, Math.max(0, Math.floor((obs[i] - lo) / (hi - lo) * Q_N_BINS)));
      out[i] = lo + (bin + 0.5) * (hi - lo) / Q_N_BINS;   // centre de la case : perte d'information simulée
    }
    return out;
  }

  // "Équivalent DQN" : le pilote complet, avec un peu d'imperfection résiduelle (le vrai DQN
  // du rapport n'atteint pas encore le seuil "résolu" à 300 épisodes sur aucune des 5 graines).
  function approxPolicyDqn(obs, rng) {
    if (rng() < 0.07) return Math.floor(rng() * 4);
    return autopilotAction(obs);
  }

  // "Équivalent Q-learning" : même logique, appliquée à un état grossièrement discrétisé
  // (8 cases/dimension, comme discretizer.py) avec une forte part de hasard — pour illustrer
  // la perte d'information et la sparsité décrites dans le README, pas une vraie table Q.
  function approxPolicyQLearning(obs, rng) {
    if (rng() < 0.4) return Math.floor(rng() * 4);
    return autopilotAction(discretizeObs(obs));
  }

  // ───────────────────── simulation d'un épisode complet (pour les statistiques) ─────────────────────
  function runEpisode(seed, policyKind, maxSteps) {
    var s = reset(seed);
    var policyRng = makeRng(hashSeed(seed, 0x165667B1));
    var total = 0, r;
    while (!s.done) {
      var obs = computeObs(s);
      var action;
      if (policyKind === 'random') action = randomPolicy(policyRng);
      else if (policyKind === 'heuristic') action = heuristicPolicy(obs);
      else if (policyKind === 'dqn') action = approxPolicyDqn(obs, policyRng);
      else if (policyKind === 'qlearning') action = approxPolicyQLearning(obs, policyRng);
      else action = 0;
      r = step(s, action, maxSteps);
      s = r.state;
      total += r.reward;
    }
    return { return: total, length: s.stepCount, reason: s.reason };
  }

  return {
    FPS: FPS, DT: DT, SCALE: SCALE, W: W, H: H, GRAVITY: GRAVITY,
    LANDER_POLY: LANDER_POLY, LEG_FOOT_LOCAL: LEG_FOOT_LOCAL, HULL: HULL,
    makeRng: makeRng, uniform: uniform,
    makeTerrain: makeTerrain, groundHeightAt: groundHeightAt,
    hullWorldVertices: hullWorldVertices, footWorld: footWorld,
    reset: reset, step: step, computeObs: computeObs,
    randomPolicy: randomPolicy, heuristicPolicy: heuristicPolicy, getTerminationReason: getTerminationReason,
    autopilotAction: autopilotAction, discretizeObs: discretizeObs,
    approxPolicyDqn: approxPolicyDqn, approxPolicyQLearning: approxPolicyQLearning,
    runEpisode: runEpisode
  };
});
