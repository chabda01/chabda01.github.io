/* R-Type — cœur du jeu, sans affichage.
   Portage en JavaScript de la logique de jeu du projet d'origine (C++20) :
   engine/ecs (SparseArray, Registry), engine/core/EventBus, et tout game/
   (composants, EntityFactory, 14 systèmes, trajectoires, armes, règles, niveaux).
   Mêmes noms, même ordre, mêmes valeurs que GameConfig.hpp.
   Aucun accès au DOM : ce fichier tourne aussi sous node (voir les tests). */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.RTypeCore = api;
})(typeof self !== 'undefined' ? self : this, function () {
'use strict';

/* ───────────────────────── GameConfig.hpp ───────────────────────── */
var config = {
  SCREEN_WIDTH: 1280, SCREEN_HEIGHT: 720,
  PLAYER_SPEED: 300, PLAYER_WIDTH: 66, PLAYER_HEIGHT: 34, PLAYER_START_X: 100,
  PLAYER_HEALTH: 1, PLAYER_LIVES: 3, PLAYER_FIRE_COOLDOWN: 0.25, PLAYER_MISSILE_SPEED: 800,
  BYDOS_SPEED: 150, BYDOS_WIDTH: 64, BYDOS_HEIGHT: 64, BYDOS_HEALTH: 1, BYDOS_SCORE: 100,
  BYDOS_FIRE_COOLDOWN: 2.0, ENEMY_MISSILE_SPEED: 350, SINE_AMPLITUDE: 60, SINE_FREQUENCY: 0.5,
  MISSILE_WIDTH: 32, MISSILE_HEIGHT: 8, MISSILE_DAMAGE: 1,
  BOSS_WIDTH: 180, BOSS_HEIGHT: 220, BOSS_HEALTH: 20, BOSS_SCORE: 1000, BOSS_FIRE_COOLDOWN: 1.0,
  BOSS_ENTER_SPEED: 120, BOSS_HOVER_MARGIN: 260,
  BOSS_CORE_WIDTH: 70, BOSS_CORE_HEIGHT: 70,
  BOSS_PHASE2_FRACTION: 0.66, BOSS_PHASE3_FRACTION: 0.33,
  BOSS_SUMMON_INTERVAL: 5.0, BOSS_SUMMON_COUNT: 2,
  KAMIKAZE_SPEED: 240, KAMIKAZE_TURN_RATE: 2.5, KAMIKAZE_WIDTH: 48, KAMIKAZE_HEIGHT: 48,
  KAMIKAZE_HEALTH: 1, KAMIKAZE_SCORE: 150,
  TURRET_WIDTH: 56, TURRET_HEIGHT: 56, TURRET_HEALTH: 3, TURRET_SCORE: 200,
  TURRET_FIRE_COOLDOWN: 1.6, TURRET_MISSILE_SPEED: 300, TURRET_DRIFT_SPEED: 60,
  SNAKE_WIDTH: 40, SNAKE_HEIGHT: 40, SNAKE_HEALTH: 2, SNAKE_SCORE: 120,
  SNAKE_SPEED: 170, SNAKE_AMPLITUDE: 140, SNAKE_FREQUENCY: 0.45,
  POWERUP_WIDTH: 32, POWERUP_HEIGHT: 32, POWERUP_SPEED: 90,
  SPEED_BONUS_STEP: 0.2, SPEED_BONUS_MAX_LEVEL: 3,
  RAPID_FIRE_DURATION: 10.0, RAPID_FIRE_COOLDOWN_SCALE: 0.5,
  MAX_LIVES: 9, POWERUP_MAXED_SCORE: 500,
  CHARGE_MIN_TIME: 0.5, CHARGE_FULL_TIME: 1.5, CHARGED_MISSILE_SPEED: 900,
  CHARGED_MISSILE_WIDTH: 64, CHARGED_MISSILE_HEIGHT: 64, CHARGED_DAMAGE_MIN: 3, CHARGED_DAMAGE_MAX: 8,
  FORCE_WIDTH: 40, FORCE_HEIGHT: 40, FORCE_ATTACH_GAP: 4, FORCE_LAUNCH_SPEED: 700,
  FORCE_LAUNCH_RANGE: 420, FORCE_RETURN_SPEED: 900, FORCE_CONTACT_DAMAGE_DELAY: 0.25, FORCE_CONTACT_DAMAGE: 1,
  WAVE_SPACING: 90,
  CAMPAIGN_PATH: 'assets/levels/campaign.json',
  SLOW_MODE_TIME_SCALE: 0.7, VERSUS_KILL_SCORE: 500,
  OFFSCREEN_MARGIN: 200
};
/* Le C++ calcule en `float` (simple précision). Pour tirer et faire apparaître les vagues au même
   tick que lui, les réglages, les minuteries et les positions sont arrondis de la même façon. */
var f = Math.fround;
Object.keys(config).forEach(function (key) { if (typeof config[key] === 'number') config[key] = f(config[key]); });
config.BOSS_HOVER_X = config.SCREEN_WIDTH - config.BOSS_WIDTH - config.BOSS_HOVER_MARGIN;
function playerStartY(playerId) {
  return config.SCREEN_HEIGHT * playerId / 5 - config.PLAYER_HEIGHT / 2;
}

/* Les touches tenues tiennent dans un octet, un bit par action (engine/input/Action.hpp). */
var Action = { Up: 1, Down: 2, Left: 4, Right: 8, Shoot: 16, Charge: 32, Force: 64 };

var EntityType = {
  Player: 0, Bydos: 1, PlayerMissile: 2, EnemyMissile: 3, PowerUp: 4, Boss: 5, Kamikaze: 6,
  Turret: 7, Snake: 8, ChargedMissile: 9, Force: 10, BossCore: 11
};
var PowerUpKind = { None: 0, Speed: 1, Force: 2, Life: 3, RapidFire: 4 };
var BossPhase = { Entering: 0, Phase1: 1, Phase2: 2, Phase3: 3, Dying: 4 };
var ForceMode = { AttachedFront: 0, AttachedBack: 1, Launched: 2, Detached: 3, Returning: 4 };
var Side = { Players: 0, Enemies: 1, Solo1: 2, Solo2: 3, Solo3: 4, Solo4: 5 };
function soloSide(playerId) { return Side.Solo1 + (playerId - 1); }

function ResourceError(message) {
  this.name = 'ResourceError';
  this.message = message;
  this.stack = (new Error(message)).stack;
}
ResourceError.prototype = Object.create(Error.prototype);

function clamp(value, low, high) { return value < low ? low : (value > high ? high : value); }

/* Petit générateur pseudo-aléatoire avec graine (le C++ utilise std::mt19937).
   Il ne sert qu'aux bonus lâchés « au hasard » et à game.random() des scripts. */
function makeRandom(seed) {
  var state = (seed >>> 0) || 1;
  return function () {
    state = (state + 0x6D2B79F5) >>> 0;
    var t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ───────────────────────── engine/ecs/SparseArray ─────────────────────────
   Une colonne du tableau : une case par entité, vide ou pleine. */
function SparseArray() {
  this._data = [];
  this.live = 0;            // cases pleines (pour le panneau « sous le capot »)
}
SparseArray.prototype.insertAt = function (entity, component) {
  while (this._data.length <= entity) this._data.push(undefined);
  if (this._data[entity] === undefined) this.live++;
  this._data[entity] = component;
  return component;
};
SparseArray.prototype.erase = function (entity) {
  if (entity >= this._data.length) return;
  if (this._data[entity] !== undefined) this.live--;
  this._data[entity] = undefined;
};
SparseArray.prototype.get = function (entity) { return this._data[entity]; };
SparseArray.prototype.has = function (entity) {
  return entity < this._data.length && this._data[entity] !== undefined;
};
SparseArray.prototype.size = function () { return this._data.length; };

/* ───────────────────────── engine/ecs/Registry ─────────────────────────
   Le tableau : donne les numéros d'entités, possède les colonnes et les systèmes. */
function Registry() {
  this._nextEntity = 0;
  this._freeEntities = [];
  this._isFree = [];
  this._components = {};
  this._componentNames = [];
  this._systems = [];
  this.profiler = null;     // { now, time[], runs[] } : rempli par la démo, nul sinon
}
Registry.prototype.spawnEntity = function () {
  // Un numéro libéré est réutilisé en priorité : les colonnes ne grandissent pas pour rien.
  if (this._freeEntities.length > 0) {
    var entity = this._freeEntities.pop();
    this._isFree[entity] = false;
    return entity;
  }
  return this._nextEntity++;
};
Registry.prototype.killEntity = function (entity) {
  // Numéro jamais donné, ou entité déjà supprimée : rien à faire.
  if (entity >= this._nextEntity || this._isFree[entity]) return;
  for (var i = 0; i < this._componentNames.length; i++) {
    this._components[this._componentNames[i]].erase(entity);
  }
  this._freeEntities.push(entity);
  this._isFree[entity] = true;
};
Registry.prototype.registerComponent = function (name) {
  var column = this._components[name];
  if (!column) {
    column = this._components[name] = new SparseArray();
    this._componentNames.push(name);
  }
  return column;
};
Registry.prototype.addComponent = function (entity, name, component) {
  return this.registerComponent(name).insertAt(entity, component);
};
Registry.prototype.removeComponent = function (entity, name) {
  if (this._components[name]) this._components[name].erase(entity);
};
Registry.prototype.getComponents = function (name) { return this.registerComponent(name); };
Registry.prototype.addSystem = function (system) {
  if (system.enabled === undefined) system.enabled = true;
  this._systems.push(system);
};
Registry.prototype.runSystems = function (deltaTime) {
  var systems = this._systems, profiler = this.profiler;
  for (var i = 0; i < systems.length; i++) {
    if (!systems[i].enabled) continue;       // une règle éteinte est sautée
    if (profiler) {
      var start = profiler.now();
      systems[i].update(this, deltaTime);
      profiler.time[i] += profiler.now() - start;
      profiler.runs[i]++;
    } else {
      systems[i].update(this, deltaTime);
    }
  }
};
/* Lectures pour l'affichage et les tests (absentes du C++, qui lit les colonnes directement). */
Registry.prototype.entityCount = function () { return this._nextEntity - this._freeEntities.length; };
Registry.prototype.entityCapacity = function () { return this._nextEntity; };
Registry.prototype.isAlive = function (entity) { return entity < this._nextEntity && !this._isFree[entity]; };
Registry.prototype.componentNames = function () { return this._componentNames.slice(); };
Registry.prototype.systems = function () { return this._systems; };

/* ───────────────────────── engine/core/EventBus ─────────────────────────
   Médiateur : le jeu annonce, les autres parties (affichage, réseau) s'abonnent. */
function EventBus() {
  this._handlers = {};
  this._nextId = 1;
}
EventBus.prototype.subscribe = function (type, callback) {
  var id = this._nextId++;
  (this._handlers[type] = this._handlers[type] || []).push({ id: id, callback: callback });
  return id;
};
EventBus.prototype.unsubscribe = function (id) {
  for (var type in this._handlers) {
    this._handlers[type] = this._handlers[type].filter(function (handler) { return handler.id !== id; });
  }
};
EventBus.prototype.publish = function (type, event) {
  var handlers = this._handlers[type];
  if (!handlers) return;
  // Boucle par numéro : un abonné peut s'abonner pendant l'annonce sans casser la boucle.
  for (var index = 0; index < handlers.length; index++) handlers[index].callback(event);
};

/* ───────────────────────── game/GameRules ───────────────────────── */
function defaultRules() {
  return { difficulty: 'normal', mode: 'coop', lives: 0, friendlyFire: false, slowMode: false, autoFire: false };
}
function profileOf(difficulty) {
  if (difficulty === 'easy') {
    return { enemySpeed: f(0.85), enemyFireCooldown: 1.5, enemyMissileSpeed: f(0.8), enemyHealth: 1.0, playerLives: 5 };
  }
  if (difficulty === 'hard') {
    return { enemySpeed: f(1.2), enemyFireCooldown: f(0.6), enemyMissileSpeed: 1.25, enemyHealth: 2.0, playerLives: 2 };
  }
  return { enemySpeed: 1.0, enemyFireCooldown: 1.0, enemyMissileSpeed: 1.0, enemyHealth: 1.0, playerLives: config.PLAYER_LIVES };
}
function livesOf(rules) { return rules.lives > 0 ? rules.lives : profileOf(rules.difficulty).playerLives; }
function timeScaleOf(rules) { return rules.slowMode ? Math.fround(0.7) : 1.0; }
function scaledEnemyHealth(rules, baseHealth) {
  return Math.max(1, Math.ceil(baseHealth * profileOf(rules.difficulty).enemyHealth));
}
function parseDifficulty(text) { return text === 'easy' || text === 'normal' || text === 'hard' ? text : null; }
function parseMode(text) { return text === 'coop' || text === 'versus' ? text : null; }

function parseJson(text, who, path) {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new ResourceError(who + ': ' + path + ' is not valid JSON: ' + error.message);
  }
}
/* Lit le fichier de règles. Une règle absente garde sa valeur par défaut ;
   une valeur invalide lance une erreur claire. */
function loadRules(text, path) {
  path = path || 'rules.json';
  if (typeof text !== 'string') throw new ResourceError('loadRules: cannot open ' + path);
  var json = parseJson(text, 'loadRules', path);
  var rules = defaultRules();
  function wrongType(key) {
    return new ResourceError('loadRules: ' + path + ' has a value of the wrong type: ' + key);
  }
  if ('difficulty' in json) {
    if (typeof json.difficulty !== 'string') throw wrongType('difficulty');
    if (!parseDifficulty(json.difficulty)) {
      throw new ResourceError('loadRules: ' + path + ': difficulty must be easy, normal or hard');
    }
    rules.difficulty = json.difficulty;
  }
  if ('mode' in json) {
    if (typeof json.mode !== 'string') throw wrongType('mode');
    if (!parseMode(json.mode)) throw new ResourceError('loadRules: ' + path + ': mode must be coop or versus');
    rules.mode = json.mode;
  }
  if ('lives' in json) {
    if (typeof json.lives !== 'number') throw wrongType('lives');
    rules.lives = Math.trunc(json.lives);
    if (rules.lives < 1 || rules.lives > 9) {
      throw new ResourceError('loadRules: ' + path + ': lives must be between 1 and 9');
    }
  }
  ['friendlyFire', 'slowMode', 'autoFire'].forEach(function (key) {
    if (key in json) {
      if (typeof json[key] !== 'boolean') throw wrongType(key);
      rules[key] = json[key];
    }
  });
  return rules;
}

/* ───────────────────────── game/Targeting, game/Overlap ───────────────────────── */
function nearestPlayerCenter(registry, from) {
  var players = registry.getComponents('Player');
  var positions = registry.getComponents('Position');
  var hitboxes = registry.getComponents('Hitbox');
  var best = null, bestDistance = 0;
  for (var entity = 0; entity < players.size(); ++entity) {
    if (!players.has(entity) || !positions.has(entity)) continue;
    var cx = positions.get(entity).x, cy = positions.get(entity).y;
    if (hitboxes.has(entity)) {
      cx += hitboxes.get(entity).offsetX + hitboxes.get(entity).width / 2;
      cy += hitboxes.get(entity).offsetY + hitboxes.get(entity).height / 2;
    }
    var dx = cx - from.x, dy = cy - from.y;
    var distance = dx * dx + dy * dy;
    if (!best || distance < bestDistance) {
      best = { x: cx, y: cy };
      bestDistance = distance;
    }
  }
  return best;
}
/* Vecteur de longueur 1 de `from` vers `to`. Deux points confondus : vers la gauche. */
function directionTo(from, to) {
  var dx = to.x - from.x, dy = to.y - from.y;
  var length = Math.sqrt(dx * dx + dy * dy);
  if (length < 0.0001) return { x: -1, y: 0 };
  return { x: dx / length, y: dy / length };
}
function overlaps(aPos, aBox, bPos, bBox) {
  var aLeft = aPos.x + aBox.offsetX, aTop = aPos.y + aBox.offsetY;
  var bLeft = bPos.x + bBox.offsetX, bTop = bPos.y + bBox.offsetY;
  return aLeft < bLeft + bBox.width && bLeft < aLeft + aBox.width
    && aTop < bTop + bBox.height && bTop < aTop + aBox.height;
}
function centerOf(positions, hitboxes, entity) {
  var center = { x: positions.get(entity).x, y: positions.get(entity).y };
  if (hitboxes.has(entity)) {
    center.x += hitboxes.get(entity).offsetX + hitboxes.get(entity).width / 2;
    center.y += hitboxes.get(entity).offsetY + hitboxes.get(entity).height / 2;
  }
  return center;
}

/* ───────────────────────── game/patterns ─────────────────────────
   Une trajectoire calcule la position à partir du point d'apparition et du temps écoulé. */
function LinearPattern(vx, vy) { this.vx = vx; this.vy = vy; }
LinearPattern.prototype.computePosition = function (origin, elapsed) {
  return { x: origin.x + this.vx * elapsed, y: origin.y + this.vy * elapsed };
};
function SinePattern(speed, amplitude, frequency) {
  this.speed = speed; this.amplitude = amplitude; this.frequency = frequency;
}
SinePattern.prototype.computePosition = function (origin, elapsed) {
  var angle = 2 * Math.PI * this.frequency * elapsed;
  return { x: origin.x - this.speed * elapsed, y: origin.y + this.amplitude * Math.sin(angle) };
};
/* Entre par la droite, s'arrête à stopX, puis oscille sur place. */
function HoverPattern(enterSpeed, stopX, amplitude, frequency) {
  this.enterSpeed = enterSpeed; this.stopX = stopX; this.amplitude = amplitude; this.frequency = frequency;
}
HoverPattern.prototype.computePosition = function (origin, elapsed) {
  var travelDistance = Math.max(0, origin.x - this.stopX);
  var travelTime = this.enterSpeed > 0 ? travelDistance / this.enterSpeed : 0;
  if (elapsed < travelTime) return { x: origin.x - this.enterSpeed * elapsed, y: origin.y };
  var angle = 2 * Math.PI * this.frequency * (elapsed - travelTime);
  return { x: this.stopX, y: origin.y + this.amplitude * Math.sin(angle) };
};

/* ───────────────────────── game/weapons ─────────────────────────
   Une arme garde son temps entre deux tirs et crée les missiles d'un tir avec l'usine. */
function missileStart(position) {
  return { x: position.x - config.MISSILE_WIDTH / 2, y: position.y - config.MISSILE_HEIGHT / 2 };
}
function BasicWeapon(cooldown, vx, vy) { this.cooldown = cooldown; this.vx = vx; this.vy = vy; }
BasicWeapon.prototype.getCooldown = function () { return this.cooldown; };
BasicWeapon.prototype.fire = function (factory, shooter, position) {
  factory.createMissile(shooter, missileStart(position), { x: this.vx, y: this.vy });
};
function AimedWeapon(cooldown, missileSpeed) { this.cooldown = cooldown; this.missileSpeed = missileSpeed; }
AimedWeapon.prototype.getCooldown = function () { return this.cooldown; };
AimedWeapon.prototype.fire = function (factory, shooter, position) {
  var target = factory.nearestPlayerCenter(position);
  var direction = target ? directionTo(position, target) : { x: -1, y: 0 };
  factory.createMissile(shooter, missileStart(position),
    { x: direction.x * this.missileSpeed, y: direction.y * this.missileSpeed });
};
/* Un éventail de `count` missiles, vers la gauche ou visé sur le joueur le plus proche. */
function SpreadWeapon(cooldown, missileSpeed, count, spread, aimed) {
  this.cooldown = cooldown; this.missileSpeed = missileSpeed; this.count = Math.max(1, count);
  this.spread = spread; this.aimed = aimed;
}
SpreadWeapon.prototype.getCooldown = function () { return this.cooldown; };
SpreadWeapon.prototype.fire = function (factory, shooter, position) {
  var center = { x: -1, y: 0 };
  if (this.aimed) {
    var target = factory.nearestPlayerCenter(position);
    if (target) center = directionTo(position, target);
  }
  var baseAngle = Math.atan2(center.y, center.x);
  var start = missileStart(position);
  for (var i = 0; i < this.count; ++i) {
    var place = this.count === 1 ? 0.5 : i / (this.count - 1);
    var angle = baseAngle - this.spread / 2 + this.spread * place;
    factory.createMissile(shooter, { x: start.x, y: start.y },
      { x: Math.cos(angle) * this.missileSpeed, y: Math.sin(angle) * this.missileSpeed });
  }
};
/* Un anneau de `count` missiles. L'anneau suivant est décalé d'un demi-pas. */
function RadialWeapon(cooldown, missileSpeed, count) {
  this.cooldown = cooldown; this.missileSpeed = missileSpeed; this.count = Math.max(1, count); this.rotation = 0;
}
RadialWeapon.prototype.getCooldown = function () { return this.cooldown; };
RadialWeapon.prototype.fire = function (factory, shooter, position) {
  var step = 2 * Math.PI / this.count;
  var start = missileStart(position);
  for (var i = 0; i < this.count; ++i) {
    var angle = this.rotation + step * i;
    factory.createMissile(shooter, { x: start.x, y: start.y },
      { x: Math.cos(angle) * this.missileSpeed, y: Math.sin(angle) * this.missileSpeed });
  }
  this.rotation += step / 2;
};

/* ───────────────────────── game/EntityFactory ─────────────────────────
   Les recettes : quels composants reçoivent un vaisseau, un ennemi, un boss, un missile, un bonus. */
function EntityFactory(registry, eventBus, rules) {
  this._registry = registry;
  this._eventBus = eventBus;
  this._rules = rules || defaultRules();
}
EntityFactory.prototype.rules = function () { return this._rules; };
EntityFactory.prototype._publishSpawn = function (entity, type, playerId, position) {
  this._eventBus.publish('EntitySpawned',
    { entity: entity, type: type, playerId: playerId, x: position.x, y: position.y });
};
EntityFactory.prototype._enemyWeapon = function (baseCooldown) {
  var profile = profileOf(this._rules.difficulty);
  var cooldown = f(baseCooldown * profile.enemyFireCooldown);
  // L'ennemi attend un cooldown complet avant son premier tir.
  return { weapon: new BasicWeapon(cooldown, -config.ENEMY_MISSILE_SPEED * profile.enemyMissileSpeed, 0), cooldownLeft: cooldown };
};
EntityFactory.prototype._addEnemyBody = function (entity, position, width, height, health, score) {
  var registry = this._registry;
  registry.addComponent(entity, 'Position', { x: position.x, y: position.y });
  registry.addComponent(entity, 'Hitbox', { offsetX: 0, offsetY: 0, width: width, height: height });
  registry.addComponent(entity, 'Health', { current: health, max: health });
  registry.addComponent(entity, 'Team', { side: Side.Enemies });
  registry.addComponent(entity, 'Enemy', { scoreValue: score });
};
EntityFactory.prototype.createPlayer = function (playerId, position) {
  var registry = this._registry;
  var entity = registry.spawnEntity();
  registry.addComponent(entity, 'Position', { x: position.x, y: position.y });
  registry.addComponent(entity, 'Velocity', { x: 0, y: 0 });
  registry.addComponent(entity, 'Hitbox', { offsetX: 0, offsetY: 0, width: config.PLAYER_WIDTH, height: config.PLAYER_HEIGHT });
  registry.addComponent(entity, 'Health', { current: config.PLAYER_HEALTH, max: config.PLAYER_HEALTH });
  // En coop tous les joueurs sont dans le même camp ; en versus, chacun a le sien.
  registry.addComponent(entity, 'Team', { side: this._rules.mode === 'versus' ? soloSide(playerId) : Side.Players });
  registry.addComponent(entity, 'Player', { id: playerId, lives: livesOf(this._rules) });
  registry.addComponent(entity, 'PlayerInput', { mask: 0 });
  registry.addComponent(entity, 'PlayerBonuses', { speedLevel: 0, rapidFireLeft: 0 });
  registry.addComponent(entity, 'ChargeShot', { charge: 0 });
  registry.addComponent(entity, 'Score', { points: 0 });
  registry.addComponent(entity, 'Weapon',
    { weapon: new BasicWeapon(config.PLAYER_FIRE_COOLDOWN, config.PLAYER_MISSILE_SPEED, 0), cooldownLeft: 0 });
  this._publishSpawn(entity, EntityType.Player, playerId, position);
  return entity;
};
/* Le Bydos n'a pas de vitesse : c'est sa trajectoire (pattern) qui le déplace. */
EntityFactory.prototype.createBydos = function (position, pattern) {
  var registry = this._registry;
  var entity = registry.spawnEntity();
  registry.addComponent(entity, 'Position', { x: position.x, y: position.y });
  registry.addComponent(entity, 'Hitbox', { offsetX: 0, offsetY: 0, width: config.BYDOS_WIDTH, height: config.BYDOS_HEIGHT });
  var health = scaledEnemyHealth(this._rules, config.BYDOS_HEALTH);
  registry.addComponent(entity, 'Health', { current: health, max: health });
  registry.addComponent(entity, 'Team', { side: Side.Enemies });
  registry.addComponent(entity, 'Enemy', { scoreValue: config.BYDOS_SCORE });
  registry.addComponent(entity, 'MovementPattern', { pattern: pattern, origin: { x: position.x, y: position.y }, elapsed: 0 });
  registry.addComponent(entity, 'Weapon', this._enemyWeapon(config.BYDOS_FIRE_COOLDOWN));
  this._publishSpawn(entity, EntityType.Bydos, 0, position);
  return entity;
};
/* Le boss : deux entités. Le corps est blindé (Invulnerable), le noyau à l'avant porte la vie. */
EntityFactory.prototype.createBoss = function (position, pattern) {
  var registry = this._registry;
  var health = scaledEnemyHealth(this._rules, config.BOSS_HEALTH);
  var coreOffsetY = (config.BOSS_HEIGHT - config.BOSS_CORE_HEIGHT) / 2;
  var body = registry.spawnEntity();
  var core = registry.spawnEntity();
  // La Hitbox du corps commence derrière le noyau : un missile venu de la gauche touche d'abord le noyau.
  registry.addComponent(body, 'Position', { x: position.x, y: position.y });
  registry.addComponent(body, 'Hitbox', { offsetX: config.BOSS_CORE_WIDTH, offsetY: 0,
    width: config.BOSS_WIDTH - config.BOSS_CORE_WIDTH, height: config.BOSS_HEIGHT });
  registry.addComponent(body, 'Health', { current: health, max: health });
  registry.addComponent(body, 'Team', { side: Side.Enemies });
  registry.addComponent(body, 'Enemy', { scoreValue: config.BOSS_SCORE });
  registry.addComponent(body, 'Invulnerable', {});
  registry.addComponent(body, 'MovementPattern', { pattern: pattern, origin: { x: position.x, y: position.y }, elapsed: 0 });
  // Pas d'arme tant qu'il entre : BossSystem lui en donne une en passant en phase 1.
  registry.addComponent(body, 'BossBrain',
    { phase: BossPhase.Entering, core: core, phaseTime: 0, summonTimer: config.BOSS_SUMMON_INTERVAL });
  registry.addComponent(core, 'Position', { x: position.x, y: position.y + coreOffsetY });
  registry.addComponent(core, 'Hitbox', { offsetX: 0, offsetY: 0, width: config.BOSS_CORE_WIDTH, height: config.BOSS_CORE_HEIGHT });
  registry.addComponent(core, 'Health', { current: health, max: health });
  registry.addComponent(core, 'Team', { side: Side.Enemies });
  registry.addComponent(core, 'Enemy', { scoreValue: config.BOSS_SCORE });
  registry.addComponent(core, 'BossCore', { boss: body, offsetX: 0, offsetY: coreOffsetY });
  this._publishSpawn(body, EntityType.Boss, 0, position);
  this._publishSpawn(core, EntityType.BossCore, 0, { x: position.x, y: position.y + coreOffsetY });
  return body;
};
/* Le kamikaze : pas de trajectoire ni d'arme, HomingSystem tourne sa vitesse vers le joueur. */
EntityFactory.prototype.createKamikaze = function (position) {
  var speed = config.KAMIKAZE_SPEED * profileOf(this._rules.difficulty).enemySpeed;
  var entity = this._registry.spawnEntity();
  this._addEnemyBody(entity, position, config.KAMIKAZE_WIDTH, config.KAMIKAZE_HEIGHT,
    scaledEnemyHealth(this._rules, config.KAMIKAZE_HEALTH), config.KAMIKAZE_SCORE);
  this._registry.addComponent(entity, 'Velocity', { x: -speed, y: 0 });
  this._registry.addComponent(entity, 'Homing', { speed: speed, turnRate: config.KAMIKAZE_TURN_RATE });
  this._publishSpawn(entity, EntityType.Kamikaze, 0, position);
  return entity;
};
EntityFactory.prototype.createTurret = function (position, pattern) {
  var profile = profileOf(this._rules.difficulty);
  var cooldown = f(config.TURRET_FIRE_COOLDOWN * profile.enemyFireCooldown);
  var entity = this._registry.spawnEntity();
  this._addEnemyBody(entity, position, config.TURRET_WIDTH, config.TURRET_HEIGHT,
    scaledEnemyHealth(this._rules, config.TURRET_HEALTH), config.TURRET_SCORE);
  this._registry.addComponent(entity, 'MovementPattern', { pattern: pattern, origin: { x: position.x, y: position.y }, elapsed: 0 });
  this._registry.addComponent(entity, 'Weapon',
    { weapon: new AimedWeapon(cooldown, config.TURRET_MISSILE_SPEED * profile.enemyMissileSpeed), cooldownLeft: cooldown });
  this._publishSpawn(entity, EntityType.Turret, 0, position);
  return entity;
};
EntityFactory.prototype.createSnakeSegment = function (position, pattern) {
  var entity = this._registry.spawnEntity();
  this._addEnemyBody(entity, position, config.SNAKE_WIDTH, config.SNAKE_HEIGHT,
    scaledEnemyHealth(this._rules, config.SNAKE_HEALTH), config.SNAKE_SCORE);
  this._registry.addComponent(entity, 'MovementPattern', { pattern: pattern, origin: { x: position.x, y: position.y }, elapsed: 0 });
  this._publishSpawn(entity, EntityType.Snake, 0, position);
  return entity;
};
/* Le tir chargé : plus gros, plus rapide, et `piercing` (il traverse les cibles). */
EntityFactory.prototype.createChargedMissile = function (shooter, position, velocity, damage) {
  var registry = this._registry;
  var teams = registry.getComponents('Team');
  var side = teams.has(shooter) ? teams.get(shooter).side : Side.Players;
  var entity = registry.spawnEntity();
  registry.addComponent(entity, 'Position', { x: position.x, y: position.y });
  registry.addComponent(entity, 'Velocity', { x: velocity.x, y: velocity.y });
  registry.addComponent(entity, 'Hitbox', { offsetX: 0, offsetY: 0, width: config.CHARGED_MISSILE_WIDTH, height: config.CHARGED_MISSILE_HEIGHT });
  registry.addComponent(entity, 'Health', { current: 1, max: 1 });
  registry.addComponent(entity, 'Team', { side: side });
  registry.addComponent(entity, 'Projectile', { shooter: shooter, damage: damage, piercing: true, alreadyHit: [] });
  this._publishSpawn(entity, EntityType.ChargedMissile, 0, position);
  this._eventBus.publish('ShotFired', { shooter: shooter });
  return entity;
};
/* La Force naît collée devant le vaisseau. Invulnerable : elle arrête les missiles ennemis. */
EntityFactory.prototype.giveForce = function (ship) {
  var registry = this._registry;
  var players = registry.getComponents('Player'), positions = registry.getComponents('Position');
  var hitboxes = registry.getComponents('Hitbox'), teams = registry.getComponents('Team');
  if (!players.has(ship) || !positions.has(ship) || !hitboxes.has(ship) || !teams.has(ship)) return false;
  // Une seule Force par vaisseau.
  var forces = registry.getComponents('Force');
  for (var other = 0; other < forces.size(); ++other) {
    if (forces.has(other) && forces.get(other).owner === ship) return false;
  }
  var playerId = players.get(ship).id;
  var shipBox = hitboxes.get(ship);
  var position = {
    x: positions.get(ship).x + shipBox.offsetX + shipBox.width + config.FORCE_ATTACH_GAP,
    y: positions.get(ship).y + shipBox.offsetY + shipBox.height / 2 - config.FORCE_HEIGHT / 2
  };
  var side = teams.get(ship).side;
  var entity = registry.spawnEntity();
  registry.addComponent(entity, 'Position', { x: position.x, y: position.y });
  registry.addComponent(entity, 'Hitbox', { offsetX: 0, offsetY: 0, width: config.FORCE_WIDTH, height: config.FORCE_HEIGHT });
  registry.addComponent(entity, 'Health', { current: 1, max: 1 });
  registry.addComponent(entity, 'Team', { side: side });
  registry.addComponent(entity, 'Force', { owner: ship, playerId: playerId, mode: ForceMode.AttachedFront,
    direction: 1, travelled: 0, keyWasHeld: false, contactCooldown: 0 });
  registry.addComponent(entity, 'Invulnerable', {});
  this._publishSpawn(entity, EntityType.Force, playerId, position);
  return true;
};
/* Le corps d'un ennemi quelconque. Appelé par ScriptEngine, qui ajoute ensuite Scripted. */
EntityFactory.prototype.createCustomEnemy = function (type, health, score, width, height, position) {
  var entity = this._registry.spawnEntity();
  this._addEnemyBody(entity, position, width, height, scaledEnemyHealth(this._rules, health), score);
  this._publishSpawn(entity, type, 0, position);
  return entity;
};
/* Le bonus n'a ni camp ni vie : les collisions l'ignorent, seul PowerUpSystem le ramasse. */
EntityFactory.prototype.createPowerUp = function (position, kind) {
  var registry = this._registry;
  var entity = registry.spawnEntity();
  registry.addComponent(entity, 'Position', { x: position.x, y: position.y });
  registry.addComponent(entity, 'Velocity', { x: -config.POWERUP_SPEED, y: 0 });
  registry.addComponent(entity, 'Hitbox', { offsetX: 0, offsetY: 0, width: config.POWERUP_WIDTH, height: config.POWERUP_HEIGHT });
  registry.addComponent(entity, 'PowerUp', { kind: kind });
  this._publishSpawn(entity, EntityType.PowerUp, kind, position);
  return entity;
};
EntityFactory.prototype.giveDrop = function (enemy, kind, chance) {
  if (!this._registry.getComponents('Position').has(enemy)) return;
  this._registry.addComponent(enemy, 'Drop', { kind: kind, chance: chance });
};
/* Le missile prend le camp du tireur. Il a 1 point de vie : il le perd en touchant. */
EntityFactory.prototype.createMissile = function (shooter, position, velocity) {
  var registry = this._registry;
  var teams = registry.getComponents('Team');
  var side = teams.has(shooter) ? teams.get(shooter).side : Side.Enemies;
  var entity = registry.spawnEntity();
  registry.addComponent(entity, 'Position', { x: position.x, y: position.y });
  registry.addComponent(entity, 'Velocity', { x: velocity.x, y: velocity.y });
  registry.addComponent(entity, 'Hitbox', { offsetX: 0, offsetY: 0, width: config.MISSILE_WIDTH, height: config.MISSILE_HEIGHT });
  registry.addComponent(entity, 'Health', { current: 1, max: 1 });
  registry.addComponent(entity, 'Team', { side: side });
  registry.addComponent(entity, 'Projectile', { shooter: shooter, damage: config.MISSILE_DAMAGE, piercing: false, alreadyHit: [] });
  this._publishSpawn(entity, side === Side.Enemies ? EntityType.EnemyMissile : EntityType.PlayerMissile, 0, position);
  this._eventBus.publish('ShotFired', { shooter: shooter });
  return entity;
};
EntityFactory.prototype.nearestPlayerCenter = function (from) { return nearestPlayerCenter(this._registry, from); };

/* ───────────────────────── game/systems : les 14 règles ─────────────────────────
   Chaque système est une règle appliquée à chaque ligne qui a les colonnes dont il a besoin. */

/* 1. Touches du joueur -> vitesse. Deux flèches opposées s'annulent. */
function PlayerControlSystem() { this.name = 'PlayerControlSystem'; }
PlayerControlSystem.prototype.update = function (registry) {
  var inputs = registry.getComponents('PlayerInput');
  var velocities = registry.getComponents('Velocity');
  var bonuses = registry.getComponents('PlayerBonuses');
  for (var entity = 0; entity < inputs.size(); ++entity) {
    if (!inputs.has(entity) || !velocities.has(entity)) continue;
    var mask = inputs.get(entity).mask;
    var velocity = velocities.get(entity);
    velocity.x = 0;
    velocity.y = 0;
    // Chaque niveau de bonus de vitesse ajoute 20 % à PLAYER_SPEED.
    var speed = config.PLAYER_SPEED
      * (1 + (bonuses.has(entity) ? config.SPEED_BONUS_STEP * bonuses.get(entity).speedLevel : 0));
    if (mask & Action.Left) velocity.x -= speed;
    if (mask & Action.Right) velocity.x += speed;
    if (mask & Action.Up) velocity.y -= speed;
    if (mask & Action.Down) velocity.y += speed;
  }
};

/* 2. Trajectoires des ennemis -> positions. */
function PatternSystem() { this.name = 'PatternSystem'; }
PatternSystem.prototype.update = function (registry, deltaTime) {
  var patterns = registry.getComponents('MovementPattern');
  var positions = registry.getComponents('Position');
  for (var entity = 0; entity < patterns.size(); ++entity) {
    if (!patterns.has(entity) || !positions.has(entity) || !patterns.get(entity).pattern) continue;
    var movement = patterns.get(entity);
    movement.elapsed = f(movement.elapsed + deltaTime);
    var next = movement.pattern.computePosition(movement.origin, movement.elapsed);
    positions.get(entity).x = f(next.x);
    positions.get(entity).y = f(next.y);
  }
};

/* 3. Kamikazes : la vitesse tourne petit à petit vers le joueur le plus proche. */
function HomingSystem() { this.name = 'HomingSystem'; }
HomingSystem.prototype.update = function (registry, deltaTime) {
  var homings = registry.getComponents('Homing');
  var positions = registry.getComponents('Position');
  var velocities = registry.getComponents('Velocity');
  var hitboxes = registry.getComponents('Hitbox');
  for (var entity = 0; entity < homings.size(); ++entity) {
    if (!homings.has(entity) || !positions.has(entity) || !velocities.has(entity)) continue;
    var homing = homings.get(entity);
    var center = centerOf(positions, hitboxes, entity);
    var target = nearestPlayerCenter(registry, center);
    var direction = target ? directionTo(center, target) : { x: -1, y: 0 };
    var blend = Math.min(1, f(homing.turnRate * deltaTime));
    var velocity = velocities.get(entity);
    velocity.x = f(velocity.x + f(f(f(direction.x * homing.speed) - velocity.x) * blend));
    velocity.y = f(velocity.y + f(f(f(direction.y * homing.speed) - velocity.y) * blend));
  }
};

/* 4. Monstres scriptés : leur fonction update les déplace et les fait tirer. */
function ScriptSystem(engine) { this.name = 'ScriptSystem'; this._engine = engine; }
ScriptSystem.prototype.update = function (registry, deltaTime) { this._engine.update(deltaTime); };

/* 5. Position += vitesse x temps écoulé. */
function MovementSystem() { this.name = 'MovementSystem'; }
MovementSystem.prototype.update = function (registry, deltaTime) {
  var positions = registry.getComponents('Position');
  var velocities = registry.getComponents('Velocity');
  for (var entity = 0; entity < positions.size(); ++entity) {
    if (!positions.has(entity) || !velocities.has(entity)) continue;
    positions.get(entity).x = f(positions.get(entity).x + f(velocities.get(entity).x * deltaTime));
    positions.get(entity).y = f(positions.get(entity).y + f(velocities.get(entity).y * deltaTime));
  }
};

/* 6. La Force : collée à son vaisseau, lancée, arrêtée ou qui revient. */
var ARRIVAL_DISTANCE = 24;
function attachedPosition(shipTopLeft, ship, side) {
  var shipCenterY = shipTopLeft.y + ship.offsetY + ship.height / 2;
  var x = side > 0
    ? shipTopLeft.x + ship.offsetX + ship.width + config.FORCE_ATTACH_GAP
    : shipTopLeft.x + ship.offsetX - config.FORCE_WIDTH - config.FORCE_ATTACH_GAP;
  return { x: x, y: shipCenterY - config.FORCE_HEIGHT / 2 };
}
function ForceSystem(eventBus) { this.name = 'ForceSystem'; this._eventBus = eventBus; }
ForceSystem.prototype.update = function (registry, deltaTime) {
  var forces = registry.getComponents('Force');
  var positions = registry.getComponents('Position');
  var hitboxes = registry.getComponents('Hitbox');
  var players = registry.getComponents('Player');
  var inputs = registry.getComponents('PlayerInput');
  for (var entity = 0; entity < forces.size(); ++entity) {
    if (!forces.has(entity) || !positions.has(entity)) continue;
    var pod = forces.get(entity);
    // Le vaisseau est mort pour de bon (ou son numéro est repris) : la Force disparaît.
    var ownerHere = players.has(pod.owner) && players.get(pod.owner).id === pod.playerId
      && positions.has(pod.owner) && hitboxes.has(pod.owner);
    if (!ownerHere) {
      registry.killEntity(entity);
      this._eventBus.publish('EntityDestroyed', { entity: entity });
      continue;
    }
    pod.contactCooldown = Math.max(0, f(pod.contactCooldown - deltaTime));
    var shipBox = hitboxes.get(pod.owner);
    var shipTopLeft = { x: positions.get(pod.owner).x, y: positions.get(pod.owner).y };
    var position = positions.get(entity);
    // La touche Force n'agit qu'à l'appui, pas tant qu'on la tient.
    var keyHeld = inputs.has(pod.owner) && (inputs.get(pod.owner).mask & Action.Force) !== 0;
    var pressed = keyHeld && !pod.keyWasHeld;
    pod.keyWasHeld = keyHeld;
    var side, where, step;
    switch (pod.mode) {
      case ForceMode.AttachedFront:
      case ForceMode.AttachedBack:
        side = pod.mode === ForceMode.AttachedFront ? 1 : -1;
        where = attachedPosition(shipTopLeft, shipBox, side);
        position.x = where.x;
        position.y = where.y;
        if (pressed) {
          pod.mode = ForceMode.Launched;
          pod.direction = side;
          pod.travelled = 0;
        }
        break;
      case ForceMode.Launched:
        step = f(config.FORCE_LAUNCH_SPEED * deltaTime);
        position.x = clamp(f(position.x + pod.direction * step), 0, config.SCREEN_WIDTH - config.FORCE_WIDTH);
        pod.travelled = f(pod.travelled + step);
        var atEdge = position.x <= 0 || position.x >= config.SCREEN_WIDTH - config.FORCE_WIDTH;
        if (pressed) pod.mode = ForceMode.Returning;
        else if (pod.travelled >= config.FORCE_LAUNCH_RANGE || atEdge) pod.mode = ForceMode.Detached;
        break;
      case ForceMode.Detached:
        if (pressed) pod.mode = ForceMode.Returning;
        break;
      case ForceMode.Returning:
        // Elle revient vers le côté du vaisseau où elle se trouve.
        var shipCenterX = shipTopLeft.x + shipBox.offsetX + shipBox.width / 2;
        side = position.x + config.FORCE_WIDTH / 2 >= shipCenterX ? 1 : -1;
        var target = attachedPosition(shipTopLeft, shipBox, side);
        var direction = directionTo(position, target);
        var distance = Math.hypot(target.x - position.x, target.y - position.y);
        step = f(config.FORCE_RETURN_SPEED * deltaTime);
        if (distance <= Math.max(step, ARRIVAL_DISTANCE)) {
          position.x = target.x;
          position.y = target.y;
          pod.mode = side > 0 ? ForceMode.AttachedFront : ForceMode.AttachedBack;
        } else {
          position.x = f(position.x + f(direction.x * step));
          position.y = f(position.y + f(direction.y * step));
        }
        break;
    }
  }
};

/* 7. Armes prêtes -> nouveaux missiles. Joueur : touche de tir (ou tir automatique). Ennemi : toujours. */
function ShootingSystem(factory) { this.name = 'ShootingSystem'; this._factory = factory; }
ShootingSystem.prototype.update = function (registry, deltaTime) {
  var weapons = registry.getComponents('Weapon');
  var positions = registry.getComponents('Position');
  var hitboxes = registry.getComponents('Hitbox');
  var inputs = registry.getComponents('PlayerInput');
  var enemies = registry.getComponents('Enemy');
  var bonuses = registry.getComponents('PlayerBonuses');
  for (var entity = 0; entity < weapons.size(); ++entity) {
    if (!weapons.has(entity) || !positions.has(entity) || !weapons.get(entity).weapon) continue;
    var weapon = weapons.get(entity);
    weapon.cooldownLeft = Math.max(0, f(weapon.cooldownLeft - deltaTime));
    var wantsToFire = inputs.has(entity)
      ? ((inputs.get(entity).mask & Action.Shoot) !== 0 || this._factory.rules().autoFire)
      : enemies.has(entity);
    if (!wantsToFire || weapon.cooldownLeft > 0) continue;
    var center = centerOf(positions, hitboxes, entity);
    var current = weapon.weapon;
    // Avec le bonus de tir rapide, le temps entre deux tirs est divisé par deux.
    var rapid = bonuses.has(entity) && bonuses.get(entity).rapidFireLeft > 0;
    weapon.cooldownLeft = f(current.getCooldown() * (rapid ? config.RAPID_FIRE_COOLDOWN_SCALE : 1));
    current.fire(this._factory, entity, center);
  }
};

/* 8. Tir chargé : la charge monte tant que la touche est tenue ; relâchée, le tir part. */
function ChargeSystem(factory) { this.name = 'ChargeSystem'; this._factory = factory; }
ChargeSystem.prototype.update = function (registry, deltaTime) {
  var charges = registry.getComponents('ChargeShot');
  var inputs = registry.getComponents('PlayerInput');
  var positions = registry.getComponents('Position');
  var hitboxes = registry.getComponents('Hitbox');
  var healths = registry.getComponents('Health');
  for (var entity = 0; entity < charges.size(); ++entity) {
    if (!charges.has(entity) || !inputs.has(entity) || !positions.has(entity)) continue;
    var shot = charges.get(entity);
    var held = (inputs.get(entity).mask & Action.Charge) !== 0;
    var alive = !healths.has(entity) || healths.get(entity).current > 0;
    if (held && alive) {
      shot.charge = Math.min(config.CHARGE_FULL_TIME, f(shot.charge + deltaTime));
      continue;
    }
    if (shot.charge >= config.CHARGE_MIN_TIME && alive) {
      // De 0 (charge minimale) à 1 (charge complète) : donne les dégâts entre MIN et MAX.
      var level = clamp(f(f(shot.charge - config.CHARGE_MIN_TIME) / f(config.CHARGE_FULL_TIME - config.CHARGE_MIN_TIME)), 0, 1);
      var damage = config.CHARGED_DAMAGE_MIN + Math.round(f(level * (config.CHARGED_DAMAGE_MAX - config.CHARGED_DAMAGE_MIN)));
      var nose = { x: positions.get(entity).x, y: positions.get(entity).y };
      if (hitboxes.has(entity)) {
        nose.x += hitboxes.get(entity).offsetX + hitboxes.get(entity).width;
        nose.y += hitboxes.get(entity).offsetY + hitboxes.get(entity).height / 2;
      }
      this._factory.createChargedMissile(entity, { x: nose.x, y: nose.y - config.CHARGED_MISSILE_HEIGHT / 2 },
        { x: config.CHARGED_MISSILE_SPEED, y: 0 }, damage);
    }
    shot.charge = 0;
  }
};

/* 9. Collisions : chevauchement de rectangles (AABB) entre camps opposés. Toutes les paires : O(n²). */
function CollisionSystem(eventBus, rules) {
  this.name = 'CollisionSystem';
  this._eventBus = eventBus;
  this._rules = rules || null;
  this.lastCandidates = 0;   // mesures pour le panneau (absentes du C++)
  this.lastPairs = 0;
}
CollisionSystem.prototype.update = function (registry) {
  var positions = registry.getComponents('Position'), hitboxes = registry.getComponents('Hitbox');
  var teams = registry.getComponents('Team'), healths = registry.getComponents('Health');
  var projectiles = registry.getComponents('Projectile'), enemies = registry.getComponents('Enemy');
  var scores = registry.getComponents('Score'), forces = registry.getComponents('Force');
  var ships = registry.getComponents('Player'), invulnerables = registry.getComponents('Invulnerable');
  var friendlyFire = !!this._rules && this._rules.friendlyFire;
  var versus = !!this._rules && this._rules.mode === 'versus';
  var eventBus = this._eventBus;

  // Points du tireur quand sa cible meurt.
  function awardKill(shooter, target) {
    if (healths.get(target).current > 0 || !scores.has(shooter)) return;
    if (enemies.has(target)) scores.get(shooter).points += enemies.get(target).scoreValue;
    else if (versus && ships.has(target) && target !== shooter) scores.get(shooter).points += config.VERSUS_KILL_SCORE;
  }
  function missileHits(missile, target) {
    var shot = projectiles.get(missile);
    // Une cible invulnérable arrête le missile, sans prendre de dégâts.
    if (invulnerables.has(target)) {
      healths.get(missile).current = 0;
      return;
    }
    if (shot.piercing) {
      // Un missile qui traverse blesse chaque cible une seule fois, puis continue.
      if (shot.alreadyHit.indexOf(target) !== -1) return;
      shot.alreadyHit.push(target);
    } else {
      healths.get(missile).current = 0;
    }
    healths.get(target).current -= shot.damage;
    awardKill(shot.shooter, target);
  }
  function forceTouches(force, other) {
    var pod = forces.get(force);
    if (pod.contactCooldown > 0 || invulnerables.has(other)) return;
    pod.contactCooldown = config.FORCE_CONTACT_DAMAGE_DELAY;
    healths.get(other).current -= config.FORCE_CONTACT_DAMAGE;
    awardKill(pod.owner, other);
  }

  var candidates = [];
  for (var entity = 0; entity < hitboxes.size(); ++entity) {
    if (positions.has(entity) && hitboxes.has(entity) && teams.has(entity) && healths.has(entity)
      && healths.get(entity).current > 0) candidates.push(entity);
  }
  var pairs = 0;
  for (var first = 0; first < candidates.length; ++first) {
    var a = candidates[first];
    for (var second = first + 1; second < candidates.length; ++second) {
      var b = candidates[second];
      if (healths.get(a).current <= 0) break;      // a vient de mourir
      if (healths.get(b).current <= 0) continue;   // b est mort
      pairs++;
      var aIsMissile = projectiles.has(a), bIsMissile = projectiles.has(b);
      // Même camp : jamais de choc entre alliés, sauf le tir allié (option de la coop).
      if (teams.get(a).side === teams.get(b).side) {
        var missile = aIsMissile ? a : b;
        var target = aIsMissile ? b : a;
        if (!friendlyFire || aIsMissile === bIsMissile || !ships.has(target)
          || projectiles.get(missile).shooter === target) continue;
      }
      if (!overlaps(positions.get(a), hitboxes.get(a), positions.get(b), hitboxes.get(b))) continue;
      // Deux missiles adverses s'annulent. Seul un missile qui traverse survit.
      if (aIsMissile && bIsMissile) {
        var aPierces = projectiles.get(a).piercing, bPierces = projectiles.get(b).piercing;
        var centerA = centerOf(positions, hitboxes, a), centerB = centerOf(positions, hitboxes, b);
        if (!aPierces || bPierces) healths.get(a).current = 0;
        if (!bPierces || aPierces) healths.get(b).current = 0;
        eventBus.publish('ProjectilesCollided', { x: (centerA.x + centerB.x) / 2, y: (centerA.y + centerB.y) / 2 });
        continue;
      }
      if (aIsMissile) missileHits(a, b);
      else if (bIsMissile) missileHits(b, a);
      else if (forces.has(a)) forceTouches(a, b);
      else if (forces.has(b)) forceTouches(b, a);
      else {
        // Deux vaisseaux en contact perdent 1 PV chacun, sauf une cible invulnérable.
        if (!invulnerables.has(a)) healths.get(a).current -= 1;
        if (!invulnerables.has(b)) healths.get(b).current -= 1;
      }
    }
  }
  this.lastCandidates = candidates.length;
  this.lastPairs = pairs;
};

/* 10. Bonus touchés par un joueur -> effet appliqué, bonus supprimé. */
function PowerUpSystem(factory, eventBus) { this.name = 'PowerUpSystem'; this._factory = factory; this._eventBus = eventBus; }
PowerUpSystem.prototype.update = function (registry, deltaTime) {
  var powerUps = registry.getComponents('PowerUp'), players = registry.getComponents('Player');
  var bonuses = registry.getComponents('PlayerBonuses'), scores = registry.getComponents('Score');
  var positions = registry.getComponents('Position'), hitboxes = registry.getComponents('Hitbox');
  var healths = registry.getComponents('Health');
  var entity;
  // Le tir rapide de chaque joueur s'écoule.
  for (entity = 0; entity < bonuses.size(); ++entity) {
    if (bonuses.has(entity)) bonuses.get(entity).rapidFireLeft = Math.max(0, f(bonuses.get(entity).rapidFireLeft - deltaTime));
  }
  for (var item = 0; item < powerUps.size(); ++item) {
    if (!powerUps.has(item) || !positions.has(item) || !hitboxes.has(item)) continue;
    // Le premier vaisseau vivant qui touche le bonus le ramasse.
    for (var ship = 0; ship < players.size(); ++ship) {
      var alive = players.has(ship) && positions.has(ship) && hitboxes.has(ship)
        && healths.has(ship) && healths.get(ship).current > 0;
      if (!alive || !overlaps(positions.get(item), hitboxes.get(item), positions.get(ship), hitboxes.get(ship))) continue;
      var kind = powerUps.get(item).kind;
      var where = { x: positions.get(item).x, y: positions.get(item).y };
      var player = players.get(ship);
      var mine = bonuses.get(ship);
      switch (kind) {
        case PowerUpKind.Speed:
          if (mine.speedLevel < config.SPEED_BONUS_MAX_LEVEL) ++mine.speedLevel;
          else if (scores.has(ship)) scores.get(ship).points += config.POWERUP_MAXED_SCORE;
          break;
        case PowerUpKind.Life:
          player.lives = Math.min(player.lives + 1, config.MAX_LIVES);
          break;
        case PowerUpKind.RapidFire:
          mine.rapidFireLeft = config.RAPID_FIRE_DURATION;
          break;
        case PowerUpKind.Force:
          // Une seule Force par vaisseau : déjà équipé, le bonus rapporte des points.
          if (!this._factory.giveForce(ship) && scores.has(ship)) scores.get(ship).points += config.POWERUP_MAXED_SCORE;
          break;
      }
      this._eventBus.publish('PowerUpCollected', { playerId: player.id, kind: kind, x: where.x, y: where.y });
      registry.killEntity(item);
      this._eventBus.publish('EntityDestroyed', { entity: item });
      break;
    }
  }
};

/* 11. Le boss : une machine à états. La phase suit la vie du noyau et ne recule jamais. */
function bossConfigOf(phase) {
  switch (phase) {
    case BossPhase.Phase2: return { amplitude: 120, frequency: 0.40, cooldown: 0.9, missileSpeed: 350 };
    case BossPhase.Phase3: return { amplitude: 150, frequency: 0.55, cooldown: 1.4, missileSpeed: 280 };
    default: return { amplitude: 90, frequency: 0.30, cooldown: 1.2, missileSpeed: 320 };
  }
}
function bossWeaponOf(phase, cooldown, missileSpeed) {
  switch (phase) {
    case BossPhase.Phase2: return new SpreadWeapon(cooldown, missileSpeed, 5, 0.9, true);
    case BossPhase.Phase3: return new RadialWeapon(cooldown, missileSpeed, 10);
    default: return new SpreadWeapon(cooldown, missileSpeed, 3, 0.5, false);
  }
}
function phaseForHealth(fraction) {
  if (fraction > config.BOSS_PHASE2_FRACTION) return BossPhase.Phase1;
  if (fraction > config.BOSS_PHASE3_FRACTION) return BossPhase.Phase2;
  return BossPhase.Phase3;
}
function BossSystem(factory, eventBus) { this.name = 'BossSystem'; this._factory = factory; this._eventBus = eventBus; }
/* Nouvelle phase : nouvelle trajectoire et nouvelle arme (le patron « stratégie »). */
BossSystem.prototype.enterPhase = function (registry, boss, brain, phase) {
  brain.phase = phase;
  brain.phaseTime = 0;
  brain.summonTimer = config.BOSS_SUMMON_INTERVAL;
  var phaseConfig = bossConfigOf(phase);
  var profile = profileOf(this._factory.rules().difficulty);
  var here = registry.getComponents('Position').get(boss);
  // std::clamp(v, lo, hi) : même ordre de comparaison que le C++.
  var y = clamp(here.y, phaseConfig.amplitude, config.SCREEN_HEIGHT - config.BOSS_HEIGHT - phaseConfig.amplitude);
  registry.addComponent(boss, 'MovementPattern', {
    pattern: new HoverPattern(0, here.x, phaseConfig.amplitude, phaseConfig.frequency),
    origin: { x: here.x, y: y }, elapsed: 0
  });
  var cooldown = f(f(phaseConfig.cooldown) * profile.enemyFireCooldown);
  registry.addComponent(boss, 'Weapon',
    { weapon: bossWeaponOf(phase, cooldown, f(phaseConfig.missileSpeed * profile.enemyMissileSpeed)), cooldownLeft: cooldown });
  this._eventBus.publish('BossPhaseChanged', { boss: boss, phase: phase });
};
BossSystem.prototype.update = function (registry, deltaTime) {
  var brains = registry.getComponents('BossBrain'), cores = registry.getComponents('BossCore');
  var healths = registry.getComponents('Health'), positions = registry.getComponents('Position');
  var entity;
  // Un noyau dont le corps a disparu disparaît aussi.
  for (entity = 0; entity < cores.size(); ++entity) {
    if (!cores.has(entity)) continue;
    var body = cores.get(entity).boss;
    if (brains.has(body) && brains.get(body).core === entity) continue;
    registry.killEntity(entity);
    this._eventBus.publish('EntityDestroyed', { entity: entity });
  }
  for (var boss = 0; boss < brains.size(); ++boss) {
    if (!brains.has(boss) || !positions.has(boss) || !healths.has(boss)) continue;
    var brain = brains.get(boss);
    var core = brain.core;
    var coreAlive = cores.has(core) && cores.get(core).boss === boss && positions.has(core)
      && healths.has(core) && healths.get(core).current > 0;
    // Le noyau est détruit : le boss meurt avec lui (HealthSystem le supprime juste après).
    if (!coreAlive) {
      healths.get(boss).current = 0;
      brain.phase = BossPhase.Dying;
      continue;
    }
    // Le noyau reste à sa place sur le corps, et le corps montre la vie du noyau.
    positions.get(core).x = positions.get(boss).x + cores.get(core).offsetX;
    positions.get(core).y = positions.get(boss).y + cores.get(core).offsetY;
    healths.get(boss).current = healths.get(core).current;
    healths.get(boss).max = healths.get(core).max;
    brain.phaseTime = f(brain.phaseTime + deltaTime);
    // Il entre sans tirer, puis passe en phase 1 une fois arrivé.
    if (brain.phase === BossPhase.Entering) {
      if (positions.get(boss).x <= config.BOSS_HOVER_X + 1) this.enterPhase(registry, boss, brain, BossPhase.Phase1);
      continue;
    }
    var fraction = f(healths.get(core).current / Math.max(1, healths.get(core).max));
    var wanted = phaseForHealth(fraction);
    if (wanted > brain.phase) this.enterPhase(registry, boss, brain, wanted);
    // Phase 3 : il envoie des kamikazes à intervalles réguliers, depuis le milieu de son corps.
    if (brain.phase === BossPhase.Phase3) {
      brain.summonTimer = f(brain.summonTimer - deltaTime);
      if (brain.summonTimer <= 0) {
        brain.summonTimer = f(brain.summonTimer + config.BOSS_SUMMON_INTERVAL);
        var x = positions.get(boss).x;
        var middleY = positions.get(boss).y + config.BOSS_HEIGHT / 2 - config.KAMIKAZE_HEIGHT / 2;
        for (var i = 0; i < config.BOSS_SUMMON_COUNT; ++i) {
          var spread = (i - (config.BOSS_SUMMON_COUNT - 1) / 2) * 80;
          this._factory.createKamikaze({ x: x, y: middleY + spread });
        }
      }
    }
  }
};

/* 12. Vies à zéro : un joueur perd une vie et réapparaît, le reste est supprimé (et peut lâcher un bonus). */
function HealthSystem(eventBus, rules, factory, random) {
  this.name = 'HealthSystem';
  this._eventBus = eventBus;
  this._rules = rules || null;
  this._factory = factory || null;
  this._random = random || makeRandom(1);
  this._mostPlayers = 0;
  this._gameOverSent = false;
}
HealthSystem.prototype.rollDrop = function (drop) {
  if (drop.kind === PowerUpKind.None || drop.chance <= 0) return false;
  if (drop.chance >= 1) return true;
  return this._random() < drop.chance;
};
HealthSystem.prototype.update = function (registry) {
  var healths = registry.getComponents('Health'), players = registry.getComponents('Player');
  var positions = registry.getComponents('Position'), hitboxes = registry.getComponents('Hitbox');
  var drops = registry.getComponents('Drop');
  var playersAlive = 0;
  for (var entity = 0; entity < healths.size(); ++entity) {
    if (!healths.has(entity)) continue;
    var health = healths.get(entity);
    if (health.current > 0) {
      playersAlive += players.has(entity) ? 1 : 0;
      continue;
    }
    // Un joueur à zéro perd une vie. Il ne disparaît pas tout de suite.
    if (players.has(entity)) {
      var player = players.get(entity);
      player.lives -= 1;
      this._eventBus.publish('PlayerDied', { playerId: player.id });
      if (player.lives > 0) {
        health.current = health.max;
        if (positions.has(entity)) {
          positions.get(entity).x = config.PLAYER_START_X;
          positions.get(entity).y = playerStartY(player.id);
        }
        ++playersAlive;
        continue;
      }
    }
    // Un ennemi qui lâche un bonus : on note où il meurt (son centre) avant de le supprimer.
    var drop = null, dropAt = { x: 0, y: 0 };
    if (drops.has(entity) && positions.has(entity)) {
      drop = { kind: drops.get(entity).kind, chance: drops.get(entity).chance };
      dropAt = { x: positions.get(entity).x, y: positions.get(entity).y };
      if (hitboxes.has(entity)) {
        dropAt.x += hitboxes.get(entity).offsetX + hitboxes.get(entity).width / 2 - config.POWERUP_WIDTH / 2;
        dropAt.y += hitboxes.get(entity).offsetY + hitboxes.get(entity).height / 2 - config.POWERUP_HEIGHT / 2;
      }
    }
    registry.killEntity(entity);
    this._eventBus.publish('EntityDestroyed', { entity: entity });
    if (drop && this._factory && this.rollDrop(drop)) this._factory.createPowerUp(dropAt, drop.kind);
  }
  // Fin de partie, annoncée une seule fois.
  this._mostPlayers = Math.max(this._mostPlayers, playersAlive);
  if (this._gameOverSent) return;
  var versus = !!this._rules && this._rules.mode === 'versus';
  if (versus && this._mostPlayers >= 2 && playersAlive <= 1) {
    this._gameOverSent = true;
    this._eventBus.publish('GameOver', { victory: playersAlive === 1 });
  } else if (!versus && this._mostPlayers > 0 && playersAlive === 0) {
    this._gameOverSent = true;
    this._eventBus.publish('GameOver', { victory: false });
  }
};

/* ───────────────────────── game/levels : LevelLoader, CampaignLoader ─────────────────────────
   `files` remplace le disque : un objet { chemin: texte du fichier }. */
function openFile(files, path, who) {
  if (!files || typeof files[path] !== 'string') throw new ResourceError(who + ': cannot open ' + path);
  return files[path];
}
function parseWaveType(text) {
  if (text === 'boss') return EntityType.Boss;
  if (text === 'kamikaze') return EntityType.Kamikaze;
  if (text === 'turret') return EntityType.Turret;
  if (text === 'snake') return EntityType.Snake;
  return EntityType.Bydos;       // "bydos" ou un nom inconnu : une faute de frappe ne fait pas planter
}
function parseDrop(text) {
  if (text === 'speed') return PowerUpKind.Speed;
  if (text === 'force') return PowerUpKind.Force;
  if (text === 'life') return PowerUpKind.Life;
  if (text === 'rapidfire') return PowerUpKind.RapidFire;
  return PowerUpKind.None;
}
function loadCampaign(files, path) {
  var json = parseJson(openFile(files, path, 'CampaignLoader'), 'CampaignLoader', path);
  if (!json || !Array.isArray(json.levels) || json.levels.some(function (level) { return typeof level !== 'string'; })) {
    throw new ResourceError('CampaignLoader: ' + path + ' needs a "levels" list of file paths');
  }
  if (json.levels.length === 0) throw new ResourceError('CampaignLoader: ' + path + ': the "levels" list is empty');
  return json.levels.slice();
}
function loadLevel(files, path) {
  var json = parseJson(openFile(files, path, 'LevelLoader'), 'LevelLoader', path);
  function missing(what) { return new ResourceError('LevelLoader: ' + path + ' is missing a required field: ' + what); }
  function need(object, key, type) {
    if (!object || typeof object[key] !== type) throw missing(key);
    return object[key];
  }
  function optional(object, key, type, fallback) {
    if (!(key in object)) return fallback;
    if (typeof object[key] !== type) throw missing(key);
    return object[key];
  }
  var level = { name: need(json, 'name', 'string'), waves: [] };
  if (!Array.isArray(json.waves)) throw missing('waves');
  json.waves.forEach(function (waveJson) {
    var wave = { time: f(need(waveJson, 'time', 'number')), script: '' };
    var typeName = need(waveJson, 'type', 'string');
    wave.type = parseWaveType(typeName);
    // "script:zigzag" : des monstres écrits en Lua (assets/scripts/zigzag.lua).
    if (typeName.indexOf('script:') === 0) {
      wave.script = typeName.slice('script:'.length);
      if (wave.script === '') throw new ResourceError('LevelLoader: ' + path + ': script wave without a script name');
    }
    wave.count = need(waveJson, 'count', 'number') >>> 0;
    wave.y = need(waveJson, 'y', 'number');
    wave.pattern = need(waveJson, 'pattern', 'string');
    wave.interval = f(optional(waveJson, 'interval', 'number', 0));
    wave.spacing = f(optional(waveJson, 'spacing', 'number', config.WAVE_SPACING));
    if (wave.interval < 0 || wave.spacing < 0) {
      throw new ResourceError('LevelLoader: ' + path + ': interval and spacing must not be negative');
    }
    wave.drop = parseDrop(optional(waveJson, 'drop', 'string', ''));
    wave.dropChance = f(optional(waveJson, 'dropChance', 'number', 1));
    if (wave.dropChance < 0 || wave.dropChance > 1) {
      throw new ResourceError('LevelLoader: ' + path + ': dropChance must be between 0 and 1');
    }
    level.waves.push(wave);
  });
  // LevelSystem lit les vagues dans l'ordre du temps. Le tri est stable.
  level.waves.sort(function (a, b) { return a.time - b.time; });
  return level;
}

/* ───────────────────────── game/scripting/ScriptEngine ─────────────────────────
   Dans le projet, ce moteur exécute de vrais fichiers Lua (Lua 5.4 embarqué).
   Un navigateur n'a pas de Lua : ici, chaque script est une traduction en JavaScript
   de son fichier .lua (voir `scripts` plus bas), avec la même table et les mêmes fonctions
   `update(self, dt, game)` et `fire(self, game)`, et le même objet `game`. */
var SPRITE_NAMES = { bydos: EntityType.Bydos, kamikaze: EntityType.Kamikaze, turret: EntityType.Turret, snake: EntityType.Snake };
function usable(value) { return typeof value === 'number' && isFinite(value); }
function ScriptEngine(registry, factory, eventBus, sources, random) {
  var engine = this;
  this._registry = registry;
  this._factory = factory;
  this._eventBus = eventBus;
  this._sources = sources || {};
  this._random = random || makeRandom(2);
  this._scripts = {};
  this._instances = {};
  this._nextSerial = 1;
  this._current = 0;
  this.errors = [];
  // L'objet `game` donné aux scripts.
  this._game = {
    screen_width: config.SCREEN_WIDTH,
    screen_height: config.SCREEN_HEIGHT,
    nearest_player: function () { return nearestPlayerCenter(registry, engine.currentCenter()); },
    shoot: function (vx, vy) { if (usable(vx) && usable(vy)) engine.shootFromCurrent(vx, vy); },
    shoot_at: function (x, y) {
      if (!usable(x) || !usable(y)) return;
      var speed = config.ENEMY_MISSILE_SPEED;
      var scripted = registry.getComponents('Scripted');
      if (scripted.has(engine._current)) {
        var script = engine._scripts[scripted.get(engine._current).script];
        if (script) speed = script.definition.missileSpeed * profileOf(factory.rules().difficulty).enemyMissileSpeed;
      }
      var direction = directionTo(engine.currentCenter(), { x: x, y: y });
      engine.shootFromCurrent(direction.x * speed, direction.y * speed);
    },
    random: function (a, b) {
      if (!usable(a) || !usable(b)) throw new Error('game.random: bounds must be finite numbers');
      var low = Math.min(a, b), high = Math.max(a, b);
      return low + (high - low) * engine._random();
    },
    spawn: function (name, x, y) {
      if (!usable(x) || !usable(y)) throw new ResourceError('game.spawn: position must be finite numbers');
      engine.spawn(name, { x: x, y: y });
    }
  };
}
/* Vérifie la table du script (comme au chargement du .lua) et lit sa description. */
ScriptEngine.prototype.load = function (name) {
  if (this._scripts[name]) return this._scripts[name].definition;
  if (!/^[A-Za-z0-9_-]+$/.test(name)) throw new ResourceError("ScriptEngine: invalid script name '" + name + "'");
  var table = this._sources[name];
  if (table === undefined) throw new ResourceError('ScriptEngine: cannot load assets/scripts/' + name + '.lua');
  if (table === null || typeof table !== 'object') throw new ResourceError("script '" + name + "' must return a table");
  if (typeof table.update !== 'function') throw new ResourceError("script '" + name + "' must have an `update` function");
  function numberField(key, fallback) {
    if (table[key] === undefined) return fallback;
    if (typeof table[key] !== 'number') throw new ResourceError("script '" + name + "': field '" + key + "' must be a number");
    return table[key];
  }
  var definition = {
    health: Math.trunc(numberField('health', 1)),
    score: Math.trunc(numberField('score', 100)),
    width: numberField('width', 48),
    height: numberField('height', 48),
    fireCooldown: f(numberField('fire_cooldown', 0)),
    missileSpeed: f(numberField('missile_speed', 350)),
    sprite: EntityType.Bydos
  };
  if (typeof table.sprite === 'string') {
    if (!(table.sprite in SPRITE_NAMES)) throw new ResourceError("script '" + name + "': unknown sprite '" + table.sprite + "'");
    definition.sprite = SPRITE_NAMES[table.sprite];
  } else if (table.sprite !== undefined) {
    throw new ResourceError("script '" + name + "': field 'sprite' must be a string");
  }
  if (definition.health < 1 || definition.width <= 0 || definition.height <= 0
    || definition.fireCooldown < 0 || definition.missileSpeed <= 0) {
    throw new ResourceError("script '" + name + "': health, width, height and missile_speed must be positive");
  }
  this._scripts[name] = { definition: definition, table: table, hasFire: typeof table.fire === 'function' };
  return definition;
};
/* Crée le corps du monstre, puis son état : la table `self` du script. */
ScriptEngine.prototype.spawn = function (name, position) {
  var definition = this.load(name);
  var entity = this._factory.createCustomEnemy(definition.sprite, definition.health, definition.score,
    definition.width, definition.height, position);
  if (!this._registry.getComponents('Position').has(entity)) return entity;
  var serial = this._nextSerial++;
  this._instances[serial] = { origin_x: position.x, origin_y: position.y, width: definition.width, height: definition.height };
  var profile = profileOf(this._factory.rules().difficulty);
  this._registry.addComponent(entity, 'Scripted', { script: name, serial: serial, time: 0,
    origin: { x: position.x, y: position.y }, fireLeft: f(definition.fireCooldown * profile.enemyFireCooldown) });
  return entity;
};
ScriptEngine.prototype.currentCenter = function () {
  var positions = this._registry.getComponents('Position');
  if (!positions.has(this._current)) return { x: 0, y: 0 };
  return centerOf(positions, this._registry.getComponents('Hitbox'), this._current);
};
ScriptEngine.prototype.shootFromCurrent = function (velocityX, velocityY) {
  var center = this.currentCenter();
  this._factory.createMissile(this._current,
    { x: center.x - config.MISSILE_WIDTH / 2, y: center.y - config.MISSILE_HEIGHT / 2 }, { x: velocityX, y: velocityY });
};
ScriptEngine.prototype.removeMonster = function (entity) {
  this._registry.killEntity(entity);
  this._eventBus.publish('EntityDestroyed', { entity: entity });
};
/* Un tick d'un monstre : on remplit `self`, on appelle update, on relit x et y, puis on tire si l'arme est prête. */
ScriptEngine.prototype.updateMonster = function (entity, deltaTime) {
  var registry = this._registry;
  var scripted = registry.getComponents('Scripted'), positions = registry.getComponents('Position');
  var healths = registry.getComponents('Health');
  if (!scripted.has(entity) || !positions.has(entity)) return;
  var state = scripted.get(entity);
  state.time = f(state.time + deltaTime);
  var name = state.script;
  var self = this._instances[state.serial];
  var script = this._scripts[name];
  if (!self || !script) return;
  var x = positions.get(entity).x, y = positions.get(entity).y;
  var ok = true, dead = false, error = '';
  this._current = entity;
  self.x = x;
  self.y = y;
  self.time = state.time;
  self.health = healths.has(entity) ? healths.get(entity).current : 0;
  try {
    script.table.update(self, deltaTime, this._game);
  } catch (caught) {
    ok = false;
    error = String(caught && caught.message || caught);
  }
  if (ok) {
    var newX = typeof self.x === 'number' ? self.x : x;
    var newY = typeof self.y === 'number' ? self.y : y;
    dead = !!self.dead;
    if (positions.has(entity) && usable(newX) && usable(newY)) {
      positions.get(entity).x = f(newX);
      positions.get(entity).y = f(newY);
    }
  }
  var fireCooldown = script.definition.fireCooldown;
  if (ok && !dead && fireCooldown > 0) {
    var fireLeft = 0;
    if (scripted.has(entity)) {
      scripted.get(entity).fireLeft = f(scripted.get(entity).fireLeft - deltaTime);
      fireLeft = scripted.get(entity).fireLeft;
    }
    if (fireLeft <= 0) {
      var profile = profileOf(this._factory.rules().difficulty);
      if (scripted.has(entity)) scripted.get(entity).fireLeft = f(scripted.get(entity).fireLeft + f(fireCooldown * profile.enemyFireCooldown));
      if (script.hasFire) {
        try {
          script.table.fire(self, this._game);
        } catch (caught2) {
          ok = false;
          error = String(caught2 && caught2.message || caught2);
        }
      } else {
        // Sans fonction fire : un tir visé sur le joueur le plus proche.
        var target = nearestPlayerCenter(registry, this.currentCenter());
        if (target) {
          var speed = script.definition.missileSpeed * profile.enemyMissileSpeed;
          var direction = directionTo(this.currentCenter(), target);
          this.shootFromCurrent(direction.x * speed, direction.y * speed);
        }
      }
    }
  }
  this._current = 0;
  // Un script cassé ne casse pas le jeu : son monstre est retiré.
  if (!ok) this.errors.push('[script] ' + name + ': ' + error);
  if (!ok || dead) this.removeMonster(entity);
};
ScriptEngine.prototype.update = function (deltaTime) {
  var scripted = this._registry.getComponents('Scripted');
  var monsters = [], alive = {}, entity;
  for (entity = 0; entity < scripted.size(); ++entity) {
    if (scripted.has(entity)) {
      monsters.push(entity);
      alive[scripted.get(entity).serial] = true;
    }
  }
  // On libère l'état des monstres qui n'existent plus.
  for (var serial in this._instances) {
    if (!alive[serial]) delete this._instances[serial];
  }
  for (var i = 0; i < monsters.length; i++) this.updateMonster(monsters[i], deltaTime);
};
ScriptEngine.prototype.instanceCount = function () { return Object.keys(this._instances).length; };

/* Traduction en JavaScript des deux scripts Lua du dépôt (assets/scripts/*.lua).
   Chaque ligne suit le fichier d'origine ; seul le langage change. */
var scripts = {
  /* zigzag.lua : zigzague de haut en bas en avançant, et tire vers le joueur. */
  zigzag: {
    health: 2, score: 150, width: 48, height: 48, sprite: 'bydos', fire_cooldown: 1.8, missile_speed: 300,
    update: function (self, dt, game) {
      self.x = self.x - 140 * dt;
      self.y = self.origin_y + 110 * Math.sin(self.time * 3.5);
    },
    fire: function (self, game) {
      var player = game.nearest_player();
      if (player) game.shoot_at(player.x, player.y);
    }
  },
  /* orbiter.lua : entre par la droite, puis tourne en cercle en tirant trois missiles à la fois. */
  orbiter: (function () {
    var CENTER_X = 900, RADIUS = 120;
    return {
      health: 4, score: 250, width: 56, height: 56, sprite: 'turret', fire_cooldown: 1.2, missile_speed: 260,
      update: function (self, dt, game) {
        if (self.x > CENTER_X + RADIUS) {
          self.x = self.x - 160 * dt;
        } else {
          self.angle = (self.angle || 0) + 1.6 * dt;
          self.x = CENTER_X + RADIUS * Math.cos(self.angle);
          self.y = self.origin_y + RADIUS * Math.sin(self.angle);
        }
      },
      fire: function (self, game) {
        for (var slope = -1; slope <= 1; slope++) game.shoot(-260, slope * 90);
      }
    };
  })()
};

/* 13. Les vagues des niveaux -> nouveaux ennemis, passage au niveau suivant, victoire. */
function entityHeightOf(type) {
  switch (type) {
    case EntityType.Boss: return config.BOSS_HEIGHT;
    case EntityType.Kamikaze: return config.KAMIKAZE_HEIGHT;
    case EntityType.Turret: return config.TURRET_HEIGHT;
    case EntityType.Snake: return config.SNAKE_HEIGHT;
    default: return config.BYDOS_HEIGHT;
  }
}
function makeWavePattern(wave, screenWidth, rules) {
  // La difficulté change la vitesse de déplacement des ennemis (le boss garde la sienne).
  var speedScale = profileOf(rules.difficulty).enemySpeed;
  var enemySpeed = config.BYDOS_SPEED * speedScale;
  switch (wave.type) {
    case EntityType.Boss:
      return new HoverPattern(config.BOSS_ENTER_SPEED, screenWidth - config.BOSS_WIDTH - config.BOSS_HOVER_MARGIN,
        config.SINE_AMPLITUDE, config.SINE_FREQUENCY);
    case EntityType.Turret:
      return new LinearPattern(-config.TURRET_DRIFT_SPEED * speedScale, 0);
    case EntityType.Snake:
      return new SinePattern(config.SNAKE_SPEED * speedScale, config.SNAKE_AMPLITUDE, config.SNAKE_FREQUENCY);
  }
  if (wave.pattern === 'sine') return new SinePattern(enemySpeed, config.SINE_AMPLITUDE, config.SINE_FREQUENCY);
  return new LinearPattern(-enemySpeed, 0);
}
/* `firstLevel` (0 par défaut) est un ajout de la démo : commencer la campagne à un autre niveau. */
function LevelSystem(factory, eventBus, levelPaths, screenWidth, screenHeight, scriptEngine, files, firstLevel) {
  this.name = 'LevelSystem';
  this._factory = factory;
  this._eventBus = eventBus;
  this._levelPaths = levelPaths;
  this._screenWidth = screenWidth;
  this._screenHeight = screenHeight;
  this._scripts = scriptEngine || null;
  this._files = files;
  this._levelIndex = 0;
  this._currentLevel = { name: '', waves: [] };
  this._nextWaveIndex = 0;
  this._pending = [];
  this._timer = 0;
  this._victoryPublished = false;
  if (levelPaths.length === 0) {
    this._victoryPublished = true;
    return;
  }
  // Tous les niveaux sont lus dès maintenant, scripts compris :
  // une faute dans le niveau 3 est signalée avant la première vague du niveau 1.
  for (var i = 0; i < levelPaths.length; i++) this.preloadScripts(loadLevel(files, levelPaths[i]));
  this._levelIndex = clamp(firstLevel | 0, 0, levelPaths.length - 1);
  this._currentLevel = loadLevel(files, levelPaths[this._levelIndex]);
}
LevelSystem.prototype.preloadScripts = function (level) {
  for (var i = 0; i < level.waves.length; i++) {
    var wave = level.waves[i];
    if (wave.script === '') continue;
    if (!this._scripts) {
      throw new ResourceError("LevelSystem: level '" + level.name + "' uses scripts, but this game has no ScriptEngine");
    }
    this._scripts.load(wave.script);
  }
};
LevelSystem.prototype.update = function (registry, deltaTime) {
  if (this._victoryPublished) return;
  this._timer = f(this._timer + deltaTime);
  var waves = this._currentLevel.waves;
  while (this._nextWaveIndex < waves.length && waves[this._nextWaveIndex].time <= this._timer) {
    this.startWave(waves[this._nextWaveIndex]);
    ++this._nextWaveIndex;
  }
  this.spawnPending(deltaTime);
  if (this.currentLevelCleared(registry)) this.advanceLevel();
};
/* Sans `interval` : tous les ennemis d'un coup, l'un sous l'autre. Avec : un par un, en file. */
LevelSystem.prototype.startWave = function (wave) {
  if (wave.interval > 0) {
    this._pending.push({ wave: wave, remaining: wave.count, timeLeft: 0 });
    return;
  }
  for (var i = 0; i < wave.count; ++i) this.spawnOne(wave, f(wave.y + f(i * wave.spacing)));
};
LevelSystem.prototype.spawnPending = function (deltaTime) {
  for (var i = 0; i < this._pending.length; i++) {
    var pending = this._pending[i];
    pending.timeLeft = f(pending.timeLeft - deltaTime);
    while (pending.remaining > 0 && pending.timeLeft <= 0) {
      this.spawnOne(pending.wave, pending.wave.y);
      --pending.remaining;
      pending.timeLeft = f(pending.timeLeft + pending.wave.interval);
    }
  }
  this._pending = this._pending.filter(function (pending) { return pending.remaining !== 0; });
};
/* Un ennemi de la vague, au bord droit. La hauteur est ramenée dans l'écran. */
LevelSystem.prototype.spawnOne = function (wave, y) {
  var height = wave.script === '' ? entityHeightOf(wave.type) : this._scripts.load(wave.script).height;
  var maxY = Math.max(0, this._screenHeight - height);
  var position = { x: this._screenWidth, y: clamp(y, 0, maxY) };
  var enemy, rules = this._factory.rules();
  if (wave.script !== '') {
    enemy = this._scripts.spawn(wave.script, position);
    if (wave.drop !== PowerUpKind.None) this._factory.giveDrop(enemy, wave.drop, wave.dropChance);
    return;
  }
  switch (wave.type) {
    case EntityType.Boss: enemy = this._factory.createBoss(position, makeWavePattern(wave, this._screenWidth, rules)); break;
    case EntityType.Kamikaze: enemy = this._factory.createKamikaze(position); break;
    case EntityType.Turret: enemy = this._factory.createTurret(position, makeWavePattern(wave, this._screenWidth, rules)); break;
    case EntityType.Snake: enemy = this._factory.createSnakeSegment(position, makeWavePattern(wave, this._screenWidth, rules)); break;
    default: enemy = this._factory.createBydos(position, makeWavePattern(wave, this._screenWidth, rules)); break;
  }
  if (wave.drop !== PowerUpKind.None) this._factory.giveDrop(enemy, wave.drop, wave.dropChance);
};
/* Niveau vide : toutes les vagues sont lancées et plus aucune entité n'a le composant Enemy. */
LevelSystem.prototype.currentLevelCleared = function (registry) {
  if (this._nextWaveIndex < this._currentLevel.waves.length || this._pending.length > 0) return false;
  return registry.getComponents('Enemy').live === 0;
};
LevelSystem.prototype.advanceLevel = function () {
  ++this._levelIndex;
  if (this._levelIndex >= this._levelPaths.length) {
    if (!this._victoryPublished) {
      this._victoryPublished = true;
      this._eventBus.publish('GameOver', { victory: true });
    }
    return;
  }
  this._currentLevel = loadLevel(this._files, this._levelPaths[this._levelIndex]);
  this._nextWaveIndex = 0;
  this._timer = 0;
  this._pending = [];
};
/* Lecture pour l'affichage (ajout de la démo). */
LevelSystem.prototype.info = function () {
  return {
    index: Math.min(this._levelIndex, this._levelPaths.length - 1), count: this._levelPaths.length,
    name: this._currentLevel.name, time: this._timer,
    wavesDone: this._nextWaveIndex, waves: this._currentLevel.waves.length, finished: this._victoryPublished
  };
};

/* 14. Joueurs gardés dans l'écran, le reste supprimé une fois bien sorti. */
function BoundarySystem(eventBus, area) { this.name = 'BoundarySystem'; this._eventBus = eventBus; this._area = area; }
BoundarySystem.prototype.update = function (registry) {
  var positions = registry.getComponents('Position'), hitboxes = registry.getComponents('Hitbox');
  var players = registry.getComponents('Player');
  var area = this._area, margin = config.OFFSCREEN_MARGIN;
  for (var entity = 0; entity < positions.size(); ++entity) {
    if (!positions.has(entity)) continue;
    var position = positions.get(entity);
    var width = hitboxes.has(entity) ? hitboxes.get(entity).width : 0;
    var height = hitboxes.has(entity) ? hitboxes.get(entity).height : 0;
    if (players.has(entity)) {
      position.x = clamp(position.x, area.left, area.left + area.width - width);
      position.y = clamp(position.y, area.top, area.top + area.height - height);
      continue;
    }
    var outside = position.x + width < area.left - margin || position.x > area.left + area.width + margin
      || position.y + height < area.top - margin || position.y > area.top + area.height + margin;
    if (outside) {
      registry.killEntity(entity);
      this._eventBus.publish('EntityDestroyed', { entity: entity });
    }
  }
};

/* ───────────────────────── game/BossInfo ───────────────────────── */
function findBoss(registry) {
  var brains = registry.getComponents('BossBrain'), healths = registry.getComponents('Health');
  for (var entity = 0; entity < brains.size(); ++entity) {
    if (brains.has(entity) && healths.has(entity)) {
      return { entity: entity, health: healths.get(entity).current, maxHealth: healths.get(entity).max, phase: brains.get(entity).phase };
    }
  }
  return null;
}

/* ───────────────────────── game/RTypeGame ─────────────────────────
   Tout rassemblé : l'objet que le serveur (ou le mode local) possède et met à jour.
   options : { files, scripts, seed, firstLevel }. */
var COMPONENTS = ['Position', 'Velocity', 'Hitbox', 'Health', 'Player', 'PlayerInput', 'Team', 'Enemy', 'Projectile',
  'Weapon', 'MovementPattern', 'Score', 'Homing', 'PowerUp', 'Drop', 'PlayerBonuses', 'ChargeShot', 'Force',
  'Invulnerable', 'BossBrain', 'BossCore', 'Scripted'];

function RTypeGame(rules, options) {
  options = options || {};
  this._rules = rules || defaultRules();
  this._files = options.files || {};
  this._scriptSources = options.scripts || scripts;
  this._seed = options.seed === undefined ? 1 : options.seed;
  this._firstLevel = options.firstLevel || 0;
  this._registry = new Registry();
  this._eventBus = new EventBus();
  this._factory = new EntityFactory(this._registry, this._eventBus, this._rules);
  this._players = {};
  this._scripts = null;
  this._levels = null;
  this._collisions = null;
}
RTypeGame.prototype.getRules = function () { return this._rules; };
/* Crée les colonnes, puis ajoute les règles dans l'ordre où elles tournent. */
RTypeGame.prototype.init = function () {
  var registry = this._registry, random = makeRandom(this._seed);
  for (var i = 0; i < COMPONENTS.length; i++) registry.registerComponent(COMPONENTS[i]);
  // L'ordre compte : chaque règle lit ce que la précédente vient d'écrire.
  registry.addSystem(new PlayerControlSystem());
  registry.addSystem(new PatternSystem());
  registry.addSystem(new HomingSystem());
  this._scripts = new ScriptEngine(registry, this._factory, this._eventBus, this._scriptSources, random);
  registry.addSystem(new ScriptSystem(this._scripts));
  registry.addSystem(new MovementSystem());
  registry.addSystem(new ForceSystem(this._eventBus));
  registry.addSystem(new ShootingSystem(this._factory));
  registry.addSystem(new ChargeSystem(this._factory));
  this._collisions = new CollisionSystem(this._eventBus, this._rules);
  registry.addSystem(this._collisions);
  registry.addSystem(new PowerUpSystem(this._factory, this._eventBus));
  registry.addSystem(new BossSystem(this._factory, this._eventBus));
  registry.addSystem(new HealthSystem(this._eventBus, this._rules, this._factory, random));
  // Pas de vagues en versus : les joueurs s'affrontent seuls.
  if (this._rules.mode === 'coop') {
    this._levels = new LevelSystem(this._factory, this._eventBus, loadCampaign(this._files, config.CAMPAIGN_PATH),
      config.SCREEN_WIDTH, config.SCREEN_HEIGHT, this._scripts, this._files, this._firstLevel);
    registry.addSystem(this._levels);
  }
  registry.addSystem(new BoundarySystem(this._eventBus,
    { left: 0, top: 0, width: config.SCREEN_WIDTH, height: config.SCREEN_HEIGHT }));
};
/* Un tick de jeu : toutes les règles tournent une fois. */
RTypeGame.prototype.update = function (deltaTime) {
  // Mode « jeu plus lent » (accessibilité) : le temps du jeu s'écoule plus doucement.
  this._registry.runSystems(f(deltaTime * timeScaleOf(this._rules)));
};
RTypeGame.prototype._aliveShip = function (playerId) {
  if (!(playerId in this._players)) return null;
  var ship = this._players[playerId];
  var ships = this._registry.getComponents('Player');
  // Le numéro d'entité a pu être réutilisé : on vérifie que c'est encore le vaisseau de CE joueur.
  if (!ships.has(ship) || ships.get(ship).id !== playerId) return null;
  return ship;
};
RTypeGame.prototype.addPlayer = function (playerId) {
  var existing = this._aliveShip(playerId);
  if (existing !== null) return existing;
  var ship = this._factory.createPlayer(playerId, { x: config.PLAYER_START_X, y: playerStartY(playerId) });
  this._players[playerId] = ship;
  return ship;
};
RTypeGame.prototype.findPlayerShip = function (playerId) { return this._aliveShip(playerId); };
RTypeGame.prototype.removePlayer = function (playerId) {
  var ship = this._aliveShip(playerId);
  if (ship !== null) {
    this._registry.killEntity(ship);
    this._eventBus.publish('EntityDestroyed', { entity: ship });
  }
  delete this._players[playerId];
};
RTypeGame.prototype.setPlayerInput = function (playerId, mask) {
  var ship = this._aliveShip(playerId);
  if (ship === null) return;
  var inputs = this._registry.getComponents('PlayerInput');
  if (inputs.has(ship)) inputs.get(ship).mask = mask & 0xFF;
};
RTypeGame.prototype.isOver = function () {
  var ids = Object.keys(this._players);
  if (ids.length === 0) return false;
  var alive = 0;
  for (var i = 0; i < ids.length; i++) if (this._aliveShip(+ids[i]) !== null) ++alive;
  if (this._rules.mode === 'versus' && ids.length >= 2) return alive <= 1;
  return alive === 0;
};
RTypeGame.prototype.getRegistry = function () { return this._registry; };
RTypeGame.prototype.getEventBus = function () { return this._eventBus; };
RTypeGame.prototype.getFactory = function () { return this._factory; };
RTypeGame.prototype.getScriptEngine = function () { return this._scripts; };
RTypeGame.prototype.levelInfo = function () { return this._levels ? this._levels.info() : null; };
RTypeGame.prototype.collisionStats = function () {
  return { candidates: this._collisions.lastCandidates, pairs: this._collisions.lastPairs };
};

return {
  config: config, playerStartY: playerStartY, Action: Action, EntityType: EntityType, PowerUpKind: PowerUpKind,
  BossPhase: BossPhase, ForceMode: ForceMode, Side: Side, ResourceError: ResourceError, COMPONENTS: COMPONENTS,
  SparseArray: SparseArray, Registry: Registry, EventBus: EventBus,
  defaultRules: defaultRules, profileOf: profileOf, livesOf: livesOf, timeScaleOf: timeScaleOf,
  scaledEnemyHealth: scaledEnemyHealth, parseDifficulty: parseDifficulty, parseMode: parseMode, loadRules: loadRules,
  nearestPlayerCenter: nearestPlayerCenter, directionTo: directionTo, overlaps: overlaps, makeRandom: makeRandom,
  LinearPattern: LinearPattern, SinePattern: SinePattern, HoverPattern: HoverPattern,
  BasicWeapon: BasicWeapon, AimedWeapon: AimedWeapon, SpreadWeapon: SpreadWeapon, RadialWeapon: RadialWeapon,
  EntityFactory: EntityFactory, ScriptEngine: ScriptEngine, scripts: scripts,
  loadCampaign: loadCampaign, loadLevel: loadLevel, findBoss: findBoss,
  PlayerControlSystem: PlayerControlSystem, PatternSystem: PatternSystem, HomingSystem: HomingSystem,
  ScriptSystem: ScriptSystem, MovementSystem: MovementSystem, ForceSystem: ForceSystem, ShootingSystem: ShootingSystem,
  ChargeSystem: ChargeSystem, CollisionSystem: CollisionSystem, PowerUpSystem: PowerUpSystem, BossSystem: BossSystem,
  HealthSystem: HealthSystem, LevelSystem: LevelSystem, BoundarySystem: BoundarySystem,
  RTypeGame: RTypeGame
};
});
