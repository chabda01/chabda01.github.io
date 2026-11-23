/* Zappy — cœur de la démo, sans DOM.
   Trois parties, chacune reprise d'un fichier du projet d'origine :
   1. World   : les règles du jeu          (server/src/World.cpp, Map.cpp, Player.cpp — C++)
   2. IA      : la boucle de décision      (ai/logic/*.py, ai/network/*.py — Python)
   3. Game    : la boucle du serveur       (server/src/Server.cpp : places, connexion, envoi des lignes)
   Le code Python est bloquant (il attend chaque réponse). Ici chaque drone est une
   coroutine (function*) : « yield » = « j'attends une ligne du serveur ». */
(function (root) {
'use strict';

/* ═════════════ 1. LE MONDE (World.cpp) ═════════════ */

var RESOURCE_NAMES = ['food', 'linemate', 'deraumere', 'sibur', 'mendiane', 'phiras', 'thystame'];
var RESOURCE_COUNT = 7;
var NORTH = 1, EAST = 2, SOUTH = 3, WEST = 4;

/* joueurs requis puis linemate, deraumere, sibur, mendiane, phiras, thystame */
var ELEVATION = [
  [1, 1, 0, 0, 0, 0, 0], // 1->2
  [2, 1, 1, 1, 0, 0, 0], // 2->3
  [2, 2, 0, 1, 0, 2, 0], // 3->4
  [4, 1, 1, 2, 0, 1, 0], // 4->5
  [4, 1, 2, 1, 3, 0, 0], // 5->6
  [6, 1, 2, 3, 0, 1, 0], // 6->7
  [6, 2, 2, 2, 2, 2, 1]  // 7->8
];

var DENSITIES = [0.5, 0.3, 0.15, 0.1, 0.1, 0.08, 0.05];

function resourceFromName(name) { return RESOURCE_NAMES.indexOf(name); }

function getCommandCost(name) {
  if (name === 'Forward' || name === 'Right' || name === 'Left' || name === 'Look' ||
      name === 'Broadcast' || name === 'Eject' || name === 'Take' || name === 'Set') return 7;
  if (name === 'Inventory') return 1;
  if (name === 'Fork') return 42;
  if (name === 'Incantation') return 300;
  return 0; // Connect_nbr
}

function cRound(v) { return v < 0 ? -Math.floor(-v + 0.5) : Math.floor(v + 0.5); }  // std::round

/* Direction d'où vient un son, vue par celui qui l'entend. 0 = même case, 1 = devant,
   puis on tourne vers la droite : 3 = à droite, 5 = derrière, 7 = à gauche. */
function broadcastDirection(sx, sy, rx, ry, width, height, receiverOrientation) {
  var dx = sx - rx, dy = sy - ry;
  var hw = Math.trunc(width / 2), hh = Math.trunc(height / 2);
  if (dx > hw) dx -= width;
  if (dx < -hw) dx += width;
  if (dy > hh) dy -= height;
  if (dy < -hh) dy += height;
  if (dx === 0 && dy === 0) return 0;

  var angle = Math.atan2(dy, dx), orientAngle = 0;
  switch (receiverOrientation) {
    case NORTH: orientAngle = -Math.PI / 2; break;
    case EAST: orientAngle = 0; break;
    case SOUTH: orientAngle = Math.PI / 2; break;
    case WEST: orientAngle = Math.PI; break;
  }
  var rel = angle - orientAngle;
  while (rel > Math.PI) rel -= 2 * Math.PI;
  while (rel < -Math.PI) rel += 2 * Math.PI;
  var sector = cRound(rel / (Math.PI / 4));
  if (sector < 0) sector += 8;
  sector = sector % 8;
  return sector + 1;
}

/* Les cases vues par Look, dans l'ordre de la réponse (même parcours que _cmdLook). */
function visionTiles(x, y, orientation, level, width, height) {
  var fx = 0, fy = 0, rx = 0, ry = 0, out = [];
  switch (orientation) {
    case NORTH: fy = -1; rx = 1; break;
    case SOUTH: fy = 1; rx = -1; break;
    case EAST: fx = 1; ry = 1; break;
    case WEST: fx = -1; ry = -1; break;
  }
  for (var dist = 0; dist <= level; dist++) {
    var cx = x + fx * dist, cy = y + fy * dist;
    for (var side = -dist; side <= dist; side++) {
      out.push([(((cx + rx * side) % width) + width) % width, (((cy + ry * side) % height) + height) % height]);
    }
  }
  return out;
}

function World(config, rand) {
  this.config = config;
  this.width = config.width; this.height = config.height;
  this.rand = rand;                       // équivalent de std::rand()
  this.tiles = new Int32Array(this.width * this.height * RESOURCE_COUNT);
  this.players = [];
  this.eggs = [];
  this.spawnTimer = 0;
  this.nextEggId = 0;
  this.nextId = 1;
  this.onGuiEvent = null;
  this.onPlayerEvent = null;
  this.spawnResources();
}
var W = World.prototype;

W.wrapX = function (x) { return ((x % this.width) + this.width) % this.width; };
W.wrapY = function (y) { return ((y % this.height) + this.height) % this.height; };
W.tileIndex = function (x, y) { return (this.wrapY(y) * this.width + this.wrapX(x)) * RESOURCE_COUNT; };
W.tileGet = function (x, y, r) { return this.tiles[this.tileIndex(x, y) + r]; };

W._spawnResource = function (r, density) {
  var total = Math.trunc((this.width * this.height) * density), current = 0, i;
  for (i = r; i < this.tiles.length; i += RESOURCE_COUNT) current += this.tiles[i];
  var toSpawn = total - current;
  for (i = 0; i < toSpawn; i++) {
    var rx = this.rand() % this.width;
    var ry = this.rand() % this.height;
    this.tiles[(ry * this.width + rx) * RESOURCE_COUNT + r]++;
  }
};
W.spawnResources = function () {
  for (var r = 0; r < RESOURCE_COUNT; r++) this._spawnResource(r, DENSITIES[r]);
};

W.bctMsg = function (x, y) {
  var s = 'bct ' + x + ' ' + y, i = this.tileIndex(x, y);
  for (var r = 0; r < RESOURCE_COUNT; r++) s += ' ' + this.tiles[i + r];
  return s + '\n';
};

W.addPlayer = function (fd, team) {
  var x = this.rand() % this.width;
  var y = this.rand() % this.height;
  var p = {
    id: this.nextId++, fd: fd, x: x, y: y, orientation: NORTH, level: 1,
    isDead: false, isIncanting: false, inventory: [10, 0, 0, 0, 0, 0, 0], team: team,
    actionQueue: [], foodTimer: 126
  };
  this.players.push(p);
  if (this.onGuiEvent)
    this.onGuiEvent('pnw #' + p.id + ' ' + p.x + ' ' + p.y + ' ' + p.orientation + ' ' + p.level + ' ' + p.team + '\n');
  return p;
};

W.hatchEgg = function (team) {
  for (var i = 0; i < this.eggs.length; i++) {
    if (this.eggs[i].team === team) {
      if (this.onGuiEvent) this.onGuiEvent('edi #' + this.eggs[i].id + '\n');
      this.eggs.splice(i, 1);
      return true;
    }
  }
  return false;
};

W.removePlayer = function (fd) {
  var p = this.getPlayer(fd);
  if (p && this.onGuiEvent && !p.isDead) this.onGuiEvent('pdi #' + p.id + '\n');
  this.players = this.players.filter(function (q) { return q.fd !== fd; });
};

W.getPlayer = function (fd) {
  for (var i = 0; i < this.players.length; i++) if (this.players[i].fd === fd) return this.players[i];
  return null;
};

W.update = function (ticks) {
  for (var t = 0; t < ticks; t++) {
    this.spawnTimer++;
    if (this.spawnTimer >= 20) { this.spawnResources(); this.spawnTimer = 0; }

    var players = this.players;           // la liste ne change pas pendant un tick
    for (var i = 0; i < players.length; i++) {
      var p = players[i];
      if (p.isDead) continue;

      p.foodTimer--;
      if (p.foodTimer <= 0 && !p.isIncanting) {
        if (p.inventory[0] > 0) {
          p.inventory[0]--;
          p.foodTimer = 126;
          if (this.onGuiEvent) this.onGuiEvent(this.guiPlayerInventory(p.id));
        } else {
          p.isDead = true;
          if (this.onPlayerEvent) this.onPlayerEvent(p.fd, 'dead\n');
          if (this.onGuiEvent) this.onGuiEvent('pdi #' + p.id + '\n');
          continue;
        }
      }

      if (p.isIncanting) {
        if (!(p.actionQueue.length && p.actionQueue[0].name === 'Incantation')) continue;
      }

      if (p.actionQueue.length) {
        var action = p.actionQueue[0];
        if (!action.isStarted) {
          action.isStarted = true;
          if (action.name === 'Incantation') {
            if (!this._checkIncantationStart(p)) {
              if (this.onPlayerEvent) this.onPlayerEvent(p.fd, 'ko\n');
              p.actionQueue.shift();
              continue;
            }
          }
        }
        if (action.remainingTicks > 0) action.remainingTicks--;
        if (action.remainingTicks <= 0) {
          var resp = '';
          if (action.name === 'Incantation') resp = this._cmdIncantationEnd(p);
          else resp = this._run(p, action.name, action.arg);
          if (resp !== '' && this.onPlayerEvent) this.onPlayerEvent(p.fd, resp + '\n');
          p.actionQueue.shift();
        }
      }
    }
  }
};

var HANDLERS = {
  Forward: 1, Right: 1, Left: 1, Look: 1, Inventory: 1, Take: 1, Set: 1, Broadcast: 1,
  Fork: 1, Eject: 1, Incantation: 1, Connect_nbr: 1
};

W._run = function (p, name, arg) {
  switch (name) {
    case 'Forward': return this._cmdForward(p);
    case 'Right': return this._cmdRight(p);
    case 'Left': return this._cmdLeft(p);
    case 'Look': return this._cmdLook(p);
    case 'Inventory': return this._cmdInventory(p);
    case 'Take': return this._cmdTake(p, arg);
    case 'Set': return this._cmdSet(p, arg);
    case 'Broadcast': return this._cmdBroadcast(p, arg);
    case 'Fork': return this._cmdFork(p);
    case 'Eject': return this._cmdEject(p);
    case 'Incantation': return '';
    case 'Connect_nbr': return this._cmdConnectNbr(p);
  }
  return '';
};

/* Une commande reçue : au plus 10 en attente par joueur, sinon elle est ignorée. */
W.queueCommand = function (playerFd, cmd) {
  var p = this.getPlayer(playerFd);
  if (!p) return false;
  if (p.actionQueue.length >= 10) return false;

  var m = /^\s*(\S*)\s*([\s\S]*)$/.exec(cmd);
  var name = m[1], arg = m[2];
  if (!Object.prototype.hasOwnProperty.call(HANDLERS, name)) {
    if (this.onPlayerEvent) this.onPlayerEvent(playerFd, 'suc\n');
    return true;
  }
  p.actionQueue.push({ command: cmd, name: name, arg: arg, remainingTicks: getCommandCost(name), isStarted: false });
  return true;
};

W.guiPlayerInventory = function (id) {
  for (var i = 0; i < this.players.length; i++) {
    var p = this.players[i];
    if (p.id !== id) continue;
    var s = 'pin #' + p.id + ' ' + p.x + ' ' + p.y;
    for (var r = 0; r < RESOURCE_COUNT; r++) s += ' ' + p.inventory[r];
    return s + '\n';
  }
  return '';
};
W.guiMapContent = function () {
  var s = '';
  for (var y = 0; y < this.height; y++) for (var x = 0; x < this.width; x++) s += this.bctMsg(x, y);
  return s;
};

W._ppo = function (p) {
  if (this.onGuiEvent) this.onGuiEvent('ppo #' + p.id + ' ' + p.x + ' ' + p.y + ' ' + p.orientation + '\n');
};
W._cmdForward = function (p) {
  switch (p.orientation) {
    case NORTH: p.y = this.wrapY(p.y - 1); break;
    case SOUTH: p.y = this.wrapY(p.y + 1); break;
    case EAST: p.x = this.wrapX(p.x + 1); break;
    case WEST: p.x = this.wrapX(p.x - 1); break;
  }
  this._ppo(p);
  return 'ok';
};
W._cmdRight = function (p) { p.orientation = (p.orientation % 4) + 1; this._ppo(p); return 'ok'; };
W._cmdLeft = function (p) { p.orientation = ((p.orientation - 2 + 4) % 4) + 1; this._ppo(p); return 'ok'; };

W._cmdLook = function (p) {
  var cells = visionTiles(p.x, p.y, p.orientation, p.level, this.width, this.height);
  var out = '[', players = this.players;
  for (var c = 0; c < cells.length; c++) {
    if (c) out += ',';
    var tx = cells[c][0], ty = cells[c][1], first = true, k;
    for (k = 0; k < players.length; k++) {
      if (players[k].x === tx && players[k].y === ty) {
        if (!first) out += ' ';
        out += 'player'; first = false;
      }
    }
    var base = (ty * this.width + tx) * RESOURCE_COUNT;
    for (var r = 0; r < RESOURCE_COUNT; r++) {
      for (var q = this.tiles[base + r]; q > 0; q--) {
        if (!first) out += ' ';
        out += RESOURCE_NAMES[r]; first = false;
      }
    }
  }
  return out + ']';
};

W._cmdInventory = function (p) {
  var s = '[';
  for (var i = 0; i < RESOURCE_COUNT; i++) { if (i) s += ', '; s += RESOURCE_NAMES[i] + ' ' + p.inventory[i]; }
  return s + ']';
};

W._cmdTake = function (p, res) {
  var r = resourceFromName(res);
  if (r < 0) return 'ko';
  var i = this.tileIndex(p.x, p.y) + r;
  if (this.tiles[i] <= 0) return 'ko';
  this.tiles[i]--;
  p.inventory[r]++;
  if (this.onGuiEvent) {
    this.onGuiEvent('pgt #' + p.id + ' ' + r + '\n');
    this.onGuiEvent(this.bctMsg(p.x, p.y));
    this.onGuiEvent(this.guiPlayerInventory(p.id));
  }
  return 'ok';
};

W._cmdSet = function (p, res) {
  var r = resourceFromName(res);
  if (r < 0) return 'ko';
  if (p.inventory[r] <= 0) return 'ko';
  p.inventory[r]--;
  this.tiles[this.tileIndex(p.x, p.y) + r]++;
  if (this.onGuiEvent) {
    this.onGuiEvent('pdr #' + p.id + ' ' + r + '\n');
    this.onGuiEvent(this.bctMsg(p.x, p.y));
    this.onGuiEvent(this.guiPlayerInventory(p.id));
  }
  return 'ok';
};

/* Le son part vers TOUS les autres joueurs, avec pour chacun sa propre direction. */
W._cmdBroadcast = function (p, msg) {
  var players = this.players;
  for (var i = 0; i < players.length; i++) {
    var other = players[i];
    if (other.fd === p.fd) continue;
    var k = broadcastDirection(p.x, p.y, other.x, other.y, this.width, this.height, other.orientation);
    if (this.onPlayerEvent) this.onPlayerEvent(other.fd, 'message ' + k + ', ' + msg + '\n');
  }
  if (this.onGuiEvent) this.onGuiEvent('pbc #' + p.id + ' ' + msg + '\n');
  return 'ok';
};

W._cmdConnectNbr = function (p) {
  var slots = 0;
  for (var i = 0; i < this.eggs.length; i++) if (this.eggs[i].team === p.team) slots++;
  return String(slots);
};

W._cmdFork = function (p) {
  var egg = { id: this.nextEggId++, x: p.x, y: p.y, team: p.team };
  this.eggs.push(egg);
  if (this.onGuiEvent) {
    this.onGuiEvent('pfk #' + p.id + '\n');
    this.onGuiEvent('enw #' + egg.id + ' #' + p.id + ' ' + egg.x + ' ' + egg.y + '\n');
  }
  return 'ok';
};

W._cmdEject = function (p) {
  var ejected = false, players = this.players, self = this;
  for (var i = 0; i < players.length; i++) {
    var other = players[i];
    if (other.fd === p.fd) continue;
    if (other.x !== p.x || other.y !== p.y) continue;
    switch (p.orientation) {
      case NORTH: other.y = this.wrapY(other.y - 1); break;
      case SOUTH: other.y = this.wrapY(other.y + 1); break;
      case EAST: other.x = this.wrapX(other.x + 1); break;
      case WEST: other.x = this.wrapX(other.x - 1); break;
    }
    if (other.isIncanting) other.isIncanting = false;
    var k = broadcastDirection(p.x, p.y, other.x, other.y, this.width, this.height, other.orientation);
    if (this.onPlayerEvent) this.onPlayerEvent(other.fd, 'eject: ' + k + '\n');
    if (this.onGuiEvent) this.onGuiEvent('pex #' + other.id + '\n');
    ejected = true;
  }
  this.eggs = this.eggs.filter(function (e) {
    if (e.x === p.x && e.y === p.y) {
      if (self.onGuiEvent) self.onGuiEvent('edi #' + e.id + '\n');
      return false;
    }
    return true;
  });
  return ejected ? 'ok' : 'ko';
};

/* Conditions d'une incantation : assez de joueurs DU MÊME NIVEAU sur la case
   (quelle que soit leur équipe) et assez de chaque pierre posée au sol. */
W._incantationOk = function (p) {
  if (p.level < 1 || p.level > 7) return false;
  var req = ELEVATION[p.level - 1], n = 0, players = this.players;
  for (var i = 0; i < players.length; i++)
    if (players[i].x === p.x && players[i].y === p.y && players[i].level === p.level) n++;
  if (n < req[0]) return false;
  var base = this.tileIndex(p.x, p.y);
  for (var r = 0; r < RESOURCE_COUNT - 1; r++)
    if (this.tiles[base + r + 1] < req[r + 1]) return false;
  return true;
};

W._checkIncantationStart = function (p) {
  if (!this._incantationOk(p)) return false;
  var pic = 'pic ' + p.x + ' ' + p.y + ' ' + p.level, players = this.players;
  for (var i = 0; i < players.length; i++) {
    var other = players[i];
    if (other.x === p.x && other.y === p.y && other.level === p.level) {
      other.isIncanting = true;
      pic += ' #' + other.id;
      if (this.onPlayerEvent) this.onPlayerEvent(other.fd, 'Elevation underway\n');
    }
  }
  if (this.onGuiEvent) this.onGuiEvent(pic + '\n');
  return true;
};

W._cmdIncantationEnd = function (p) {
  var players = this.players, i;
  if (!this._incantationOk(p)) {          // les conditions sont revérifiées à la fin
    for (i = 0; i < players.length; i++)
      if (players[i].x === p.x && players[i].y === p.y && players[i].level === p.level)
        players[i].isIncanting = false;
    if (this.onGuiEvent) this.onGuiEvent('pie ' + p.x + ' ' + p.y + ' 0\n');
    return 'ko';
  }
  var req = ELEVATION[p.level - 1], base = this.tileIndex(p.x, p.y);
  for (var r = 0; r < RESOURCE_COUNT - 1; r++) this.tiles[base + r + 1] -= req[r + 1];

  var startLevel = p.level;
  for (i = 0; i < players.length; i++) {
    var other = players[i];
    if (other.x === p.x && other.y === p.y && other.level === startLevel) {
      other.level++;
      other.isIncanting = false;
      if (this.onGuiEvent) this.onGuiEvent('plv #' + other.id + ' ' + other.level + '\n');
      if (other.fd !== p.fd && this.onPlayerEvent)
        this.onPlayerEvent(other.fd, 'Current level: ' + other.level + '\n');
    }
  }
  if (this.onGuiEvent) {
    this.onGuiEvent('pie ' + p.x + ' ' + p.y + ' 1\n');
    this.onGuiEvent(this.bctMsg(p.x, p.y));
  }
  var teams = this.config.teams;
  for (var t = 0; t < teams.length; t++) {
    var count = 0;
    for (i = 0; i < players.length; i++)
      if (players[i].team === teams[t] && players[i].level === 8) count++;
    if (count >= 6 && this.onGuiEvent) this.onGuiEvent('seg ' + teams[t] + '\n');
  }
  return 'Current level: ' + p.level;
};

/* ═════════════ 2. L'IA (ai/ — Python) ═════════════ */

var RESOURCES = RESOURCE_NAMES;
var STONES = ['linemate', 'deraumere', 'sibur', 'mendiane', 'phiras', 'thystame'];
var ELEVATION_REQ = {};
ELEVATION.forEach(function (row, i) {
  var o = { players: row[0] };
  STONES.forEach(function (s, k) { o[s] = row[k + 1]; });
  ELEVATION_REQ[i + 1] = o;
});

/* direction du son -> déplacements pour s'en rapprocher (brain.py) */
var DIRECTION_MOVES = {
  0: [],
  1: ['Forward'],
  2: ['Right', 'Forward'],
  3: ['Right', 'Forward'],
  4: ['Right', 'Right', 'Forward'],
  5: ['Right', 'Right', 'Forward'],
  6: ['Left', 'Left', 'Forward'],
  7: ['Left', 'Forward'],
  8: ['Left', 'Forward']
};
var QUEEN_FOOD_MIN = 30;
var FOOD_THRESHOLD = 18, CRITICAL_FOOD = 12, FOOD_RALLY_TARGET = 25, LOCK_TIMEOUT = 60;
var TEAM_CAP = 9, REFORK_BELOW = 7, BUILD_FORK_COOLDOWN = 2.0;

/* petits équivalents de Python */
function pyStrip(s, chars) {
  var a = 0, b = s.length;
  if (chars === undefined) chars = ' \t\n\r\f\v';
  while (a < b && chars.indexOf(s[a]) >= 0) a++;
  while (b > a && chars.indexOf(s[b - 1]) >= 0) b--;
  return s.slice(a, b);
}
function pySplit(s) { var t = pyStrip(s); return t === '' ? [] : t.split(/\s+/); }
function ValueError(msg) { this.name = 'ValueError'; this.message = msg; }
function ConnectionError(msg) { this.name = 'ConnectionError'; this.message = msg; }
function pyInt(s) {
  if (!/^\s*[+-]?\d+\s*$/.test(s)) throw new ValueError("invalid literal for int(): '" + s + "'");
  return parseInt(s, 10);
}
function count(list, v) { var n = 0; for (var i = 0; i < list.length; i++) if (list[i] === v) n++; return n; }

/* network/broadcast.py — notre format de message : "TYPE:donnees" */
function encode(msgType, data) { return msgType + ':' + data; }
function decode(raw) {
  if (raw.indexOf('message ') !== 0) return null;
  try {
    var after = raw.slice(8), comma = after.indexOf(',');
    if (comma < 0) return null;
    var direction = pyInt(pyStrip(after.slice(0, comma)));
    var content = pyStrip(after.slice(comma + 1)), msgType, data, colon = content.indexOf(':');
    if (colon >= 0) { msgType = content.slice(0, colon); data = content.slice(colon + 1); }
    else { msgType = content; data = ''; }
    return [direction, pyStrip(msgType), pyStrip(data)];
  } catch (e) { return null; }
}

/* network/parser.py */
function parseLook(raw) {
  raw = pyStrip(raw, '[] \n');
  return raw.split(',').map(function (tile) { return pySplit(tile); });
}

/* trajet vers la case numéro `index` de la vision (survive.py, _go_to_tile) */
function pathToTile(index) {
  if (index === 0) return [];
  var r = Math.floor(Math.sqrt(index)), col = index - r * (r + 1), commands = [], i;
  for (i = 0; i < r; i++) commands.push('Forward');
  if (col < 0) { commands.push('Left'); for (i = 0; i < -col; i++) commands.push('Forward'); }
  else if (col > 0) { commands.push('Right'); for (i = 0; i < col; i++) commands.push('Forward'); }
  return commands;
}

/* logic/player.py — la mémoire d'un drone */
function PlayerState(rng) {
  this.level = 1;
  this.inventory = {};
  for (var i = 0; i < RESOURCES.length; i++) this.inventory[RESOURCES[i]] = 0;
  this.explore_steps = 0;
  this.need_fuel = true;
  this.is_anchor = false;
  this.locked = false;
  this.locked_ticks = 0;
  this.here_count = 0;
  this.rally_seen = 0;
  this.rally_weight = 1 + Math.floor(rng() * 1000000000);   // random.randint(1, 1_000_000_000)
}
PlayerState.prototype.update_inventory = function (raw) {
  var items = pyStrip(raw, '[] \n').split(',');
  for (var i = 0; i < items.length; i++) {
    var parts = pySplit(items[i]);
    if (parts.length === 2 && Object.prototype.hasOwnProperty.call(this.inventory, parts[0]))
      this.inventory[parts[0]] = pyInt(parts[1]);
  }
};
PlayerState.prototype.missing_for_elevation = function () {
  var out = {};
  if (this.level >= 8) return out;
  var req = ELEVATION_REQ[this.level];
  for (var i = 1; i < RESOURCES.length; i++) {
    var r = RESOURCES[i];
    if (this.inventory[r] < req[r]) out[r] = req[r] - this.inventory[r];
  }
  return out;
};
PlayerState.prototype.needs_food = function () { return this.inventory.food < FOOD_THRESHOLD; };
function isEmpty(o) { for (var k in o) return false; return true; }

/* network/client.py — un drone vu côté client. `io` est fourni par Game. */
function Client(io, team) {
  this.io = io;
  this.team = team;
  this.map_x = 0; this.map_y = 0;
  this.free_slots = 0;
  this._broadcasts = [];
  this._pending_level = null;
  this.inbox = [];
  this.closed = false;
}
var C = Client.prototype;
C._write = function (message) { this.io.write(message); };
C._read_line = function* () {
  while (!this.inbox.length) {
    if (this.closed) throw new ConnectionError('Connexion fermée par le serveur');
    yield;
  }
  var line = pyStrip(this.inbox.shift());
  this.io.logIn(line);
  return line;
};
C.connect = function* () {
  var welcome = yield* this._read_line();
  if (welcome.indexOf('WELCOME') !== 0) throw new ConnectionError('Handshake raté');
  this._write(this.team);
  try { this.free_slots = pyInt(yield* this._read_line()); }
  catch (e) { if (!(e instanceof ValueError)) throw e; this.free_slots = 0; }
  var dims = pySplit(yield* this._read_line());
  this.map_x = pyInt(dims[0]); this.map_y = pyInt(dims[1]);
};
C._read_response = function* (isIncantation) {
  for (;;) {
    var line = yield* this._read_line();
    if (line.indexOf('message ') === 0) this._broadcasts.push(line);
    else if (line.indexOf('Current level') === 0) {
      if (isIncantation) return line;
      try { this._pending_level = pyInt(pyStrip(line.split(':')[1])); } catch (e) { /* ignoré */ }
    } else if (line.indexOf('Elevation underway') === 0) {
      if (isIncantation) return line;
    } else if (line.indexOf('eject:') === 0) { /* ignoré */ }
    else if (line === 'dead') throw new ConnectionError('Mort de faim ou fin de partie');
    else return line;
  }
};
C.send = function* (command, isIncantation) {
  this._write(command);
  return yield* this._read_response(isIncantation);
};
C.receive = function* (isIncantation) { return yield* this._read_response(isIncantation); };
C.send_batch = function* (commands) {
  var results = [];
  for (var i = 0; i < commands.length; i += 10) {
    var chunk = commands.slice(i, i + 10), k;
    for (k = 0; k < chunk.length; k++) this._write(chunk[k]);
    for (k = 0; k < chunk.length; k++) results.push(yield* this._read_response());
  }
  return results;
};
C.get_broadcasts = function () { var p = this._broadcasts; this._broadcasts = []; return p; };
C.get_level_update = function () { var l = this._pending_level; this._pending_level = null; return l; };
C.connect_nbr = function* () {
  var raw = yield* this.send('Connect_nbr');
  try { return pyInt(raw); } catch (e) { return 0; }
};

/* logic/explore.py */
function* explore(client, player, rng) {
  player.explore_steps += 1;
  var commands = [];
  if (player.explore_steps % 3 === 0) commands.push(rng() < 0.5 ? 'Left' : 'Right');
  commands.push('Forward');
  yield* client.send_batch(commands);
}

/* logic/states/survive.py */
function* survive(client, player, rng) {
  var tiles = parseLook(yield* client.send('Look'));
  for (var index = 0; index < tiles.length; index++) {
    var n = count(tiles[index], 'food');
    if (n) {
      yield* client.send_batch(pathToTile(index));
      for (var i = 0; i < n; i++) yield* client.send('Take food');
      return;
    }
  }
  yield* explore(client, player, rng);
}

/* logic/states/collect.py */
function* collect(client, player, rng) {
  var missing = player.missing_for_elevation();
  var tiles = parseLook(yield* client.send('Look'));
  for (var index = 0; index < tiles.length; index++) {
    var tile = tiles[index], here = [], r, i;
    for (r in missing) if (tile.indexOf(r) >= 0) here.push(r);
    if (here.length) {
      yield* client.send_batch(pathToTile(index));
      for (i = 0; i < here.length; i++) yield* client.send('Take ' + here[i]);
      for (i = count(tile, 'food'); i > 0; i--) yield* client.send('Take food');
      return;
    }
  }
  yield* explore(client, player, rng);
}

/* logic/states/elevate.py */
function* topupStones(client, player, firstTile) {
  var req = ELEVATION_REQ[player.level] || {};
  for (var s = 0; s < STONES.length; s++) {
    var stone = STONES[s];
    var deficit = (req[stone] || 0) - count(firstTile, stone);
    var held = player.inventory[stone] || 0;
    for (var i = Math.min(deficit, held); i > 0; i--) {
      yield* client.send('Set ' + stone);
      player.inventory[stone] -= 1;
    }
  }
}
function* doIncantation(client, player) {
  var tiles = parseLook(yield* client.send('Look'));
  yield* topupStones(client, player, tiles.length ? tiles[0] : []);
  var startMsg = yield* client.send('Incantation', true);
  if (startMsg === 'ko') return;
  var endMsg = yield* client.receive(true);
  if (endMsg.indexOf('Current level') === 0) {
    try { player.level = pyInt(pyStrip(endMsg.split(':')[1])); } catch (e) { /* ignoré */ }
  }
}
function* elevate(client, player) {
  var req = ELEVATION_REQ[player.level] || {};
  var needed = req.players === undefined ? 1 : req.players;
  if (needed === 1) { yield* doIncantation(client, player); return; }

  var tiles = parseLook(yield* client.send('Look'));
  var playersHere = tiles.length ? Math.max(0, count(tiles[0], 'player') - 1) : 0;
  var here = playersHere + 1;
  player.here_count = here;
  if (tiles.length) for (var i = count(tiles[0], 'food'); i > 0; i--) yield* client.send('Take food');
  if (here >= needed) yield* doIncantation(client, player);
}

/* logic/fork.py — la reine construit l'équipe et remplace les morts */
function TeamManager(client, isRecruiter, host) {
  this.client = client;
  this.is_recruiter = isRecruiter;
  this.children = [];
  this.free_slots = isRecruiter ? client.free_slots : 0;
  this.slots_used = 0;
  this.next_build = 0.0;
  this.rebuilding = true;
  this.host = host;                        // host.now() = horloge en secondes, host.spawn() = lancer un process
}
TeamManager.prototype.tick = function* () {
  if (!this.is_recruiter) return;
  this.children = this.children.filter(function (c) { return c.alive; });
  var members = 1 + this.children.length;
  if (members < REFORK_BELOW) this.rebuilding = true;
  else if (members >= TEAM_CAP) this.rebuilding = false;
  if (!this.rebuilding || members >= TEAM_CAP) return;
  if (this.host.now() < this.next_build) return;

  if (this.slots_used < this.free_slots) {
    this.slots_used += 1;
    this.children.push(this.host.spawn());
  } else if ((yield* this.client.connect_nbr()) > 0) {
    this.children.push(this.host.spawn());
  } else {
    yield* this.client.send('Fork');
  }
  this.next_build = this.host.now() + BUILD_FORK_COOLDOWN;
};

/* logic/brain.py */
function Brain(client, rng, view) {
  this.client = client;
  this.player = new PlayerState(rng);
  this.rng = rng;
  this.view = view;                        // ce que la page affiche : état, direction entendue…
}
Brain.prototype._handle_broadcasts = function* () {
  var P = this.player, bestDir = null, bestWeight = P.rally_weight;
  var raws = this.client.get_broadcasts();
  for (var i = 0; i < raws.length; i++) {
    var parsed = decode(raws[i]);
    if (parsed === null) continue;
    if (parsed[1] !== 'NEED') continue;
    var parts = parsed[2].split(':'), senderLevel, senderWeight;
    try {
      if (parts.length < 3) continue;
      senderLevel = pyInt(parts[1]); senderWeight = pyInt(parts[2]);
    } catch (e) { continue; }
    if (senderLevel !== P.level) continue;
    if (senderWeight > bestWeight) { bestWeight = senderWeight; bestDir = parsed[0]; }
  }
  P.is_anchor = (bestDir === null);

  var req = ELEVATION_REQ[P.level];
  var ready = isEmpty(P.missing_for_elevation()) && !P.need_fuel && (req ? req.players : 1) > 1;

  if (ready && (P.is_anchor || bestDir === 0)) P.locked = true;
  else if (ready && bestDir) P.locked = false;

  this.view.heardDir = bestDir;
  this.view.heardWeight = bestDir === null ? 0 : bestWeight;
  this.view.ready = ready;
  this.view.moving = !!(bestDir && ready && !P.locked);

  if (bestDir && ready && !P.locked) {
    var moves = DIRECTION_MOVES[bestDir] || [];
    for (var m = 0; m < moves.length; m++) yield* this.client.send(moves[m]);
  }
};
Brain.prototype.run = function* (team) {
  var client = this.client, P = this.player, rng = this.rng, view = this.view;
  var prevLevel = P.level;

  for (;;) {
    yield* team.tick();

    if (team.is_recruiter) {
      view.state = 'reine';
      P.update_inventory(yield* client.send('Inventory'));
      if (P.inventory.food < QUEEN_FOOD_MIN) yield* survive(client, P, rng);
      continue;
    }

    yield* this._handle_broadcasts();

    var lvl = client.get_level_update();
    if (lvl !== null) P.level = lvl;

    P.update_inventory(yield* client.send('Inventory'));

    if (P.level !== prevLevel) {
      P.locked = false; P.locked_ticks = 0; P.rally_seen = 0;
      prevLevel = P.level;
    }

    if (P.level >= 8) {
      view.state = 'niveau 8';
      if (P.inventory.food < QUEEN_FOOD_MIN) yield* survive(client, P, rng);
      continue;
    }

    var missing = P.missing_for_elevation();
    var multi = ELEVATION_REQ[P.level].players > 1;
    var food = P.inventory.food;

    /* le cri : « je cherche des joueurs de mon niveau, voici mon poids » */
    if (multi) yield* client.send('Broadcast ' + encode('NEED', client.team + ':' + P.level + ':' + P.rally_weight));

    if (food < CRITICAL_FOOD) P.need_fuel = true;
    else if (food >= FOOD_RALLY_TARGET) P.need_fuel = false;

    if (P.locked) {
      if (P.here_count > P.rally_seen) { P.rally_seen = P.here_count; P.locked_ticks = 0; }
      else {
        P.locked_ticks += 1;
        if (P.locked_ticks >= LOCK_TIMEOUT) {
          P.locked = false; P.locked_ticks = 0; P.rally_seen = 0; P.need_fuel = true;
        }
      }
    } else { P.locked_ticks = 0; P.rally_seen = 0; }

    if (multi && P.locked) {
      view.state = 'incanter';
      yield* elevate(client, P);
    } else if (multi && P.is_anchor) {
      if (food < CRITICAL_FOOD) { view.state = 'survivre'; yield* survive(client, P, rng); }
      else { view.state = 'incanter'; yield* elevate(client, P); }
    } else {
      var mustEat = (isEmpty(missing) && multi) ? P.need_fuel : P.needs_food();
      if (mustEat) { view.state = 'survivre'; yield* survive(client, P, rng); }
      else if (!isEmpty(missing)) { view.state = 'collecter'; yield* collect(client, P, rng); }
      else { view.state = 'incanter'; yield* elevate(client, P); }
    }
  }
};

/* ═════════════ 3. LA BOUCLE DU SERVEUR (Server.cpp) + les process IA ═════════════ */

function mulberry32(seed) {
  var a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    var t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

var LOG_SIZE = 40;
var SPAWN_DELAY = 0.05;   // secondes : temps de lancement d'un process Python (hypothèse de la démo)

/* config : { width, height, teams:[noms], clients (-c), freq (-f), seed }
   opts   : { worldRand, record, keepDead } */
function Game(config, opts) {
  opts = opts || {};
  var self = this;
  this.config = { width: config.width, height: config.height, teams: config.teams.slice(), clients: config.clients, freq: config.freq };
  this.rng = mulberry32(config.seed === undefined ? 1 : config.seed);
  var rng = this.rng;
  this.world = new World(this.config, opts.worldRand || function () { return Math.floor(rng() * 2147483648); });
  this.keepDead = !!opts.keepDead;
  this.script = opts.record ? [] : null;   // entrées du monde, pour rejouer la partie dans le vrai code C++
  this.trace = opts.record ? [] : null;    // sorties du monde
  this.tick = 0;
  this.time = 0;                           // secondes de jeu écoulées
  this.slots = {};
  this.config.teams.forEach(function (t) { self.slots[t] = self.config.clients; });
  this.procs = [];                         // tous les process IA lancés, vivants ou non
  this.live = [];                          // ceux encore connectés, dans l'ordre de connexion
  this.byFd = {};
  this.pending = [];                       // process lancés, pas encore connectés
  this.nextFd = 4;
  this.onGui = null;                       // la page écoute le protocole graphique ici
  this.winner = null;
  this.stats = { broadcasts: 0, incantStart: 0, incantOk: 0, incantKo: 0, deaths: 0, forks: 0, crashes: 0 };

  this.world.onPlayerEvent = function (fd, msg) {
    if (self.trace) self.trace.push('P ' + fd + ' ' + msg);
    var pr = self.byFd[fd];
    if (!pr) return;
    pr.out.push(msg);
    if (msg === 'dead\n') pr.closing = true;
  };
  this.world.onGuiEvent = function (msg) {
    if (self.trace) self.trace.push('G ' + msg);
    var c = msg.charCodeAt(1);
    if (msg.charCodeAt(0) === 112) {                    // p..
      if (c === 98) self.stats.broadcasts++;            // pbc
      else if (c === 102) self.stats.forks++;           // pfk
      else if (msg.indexOf('pic ') === 0) self.stats.incantStart++;
      else if (msg.indexOf('pie ') === 0) { if (msg.charAt(msg.length - 2) === '1') self.stats.incantOk++; else self.stats.incantKo++; }
      else if (msg.indexOf('pdi ') === 0) self.stats.deaths++;
    } else if (msg.indexOf('seg ') === 0 && !self.winner) self.winner = msg.slice(4, -1);
    if (self.onGui) self.onGui(msg);
  };

  /* comme run_demo.sh : une seule IA lancée par équipe, la reine */
  this.config.teams.forEach(function (t) { self._launch(t, true); });
  this._pump();
}
var G = Game.prototype;

G._launch = function (team, isRecruiter) {
  var self = this;
  var pr = {
    fd: 0, team: team, isRecruiter: isRecruiter, alive: true, connected: false, closing: false,
    out: [], log: [], logN: 0, player: null, gen: null, exit: '',
    view: { state: 'connexion', heardDir: null, heardWeight: 0, ready: false, moving: false },
    client: null, brain: null, manager: null
  };
  function log(dir, text) {
    pr.log[pr.logN % LOG_SIZE] = { t: self.tick, d: dir, s: text };
    pr.logN++;
  }
  var io = {
    write: function (message) { log('>', message); self._fromClient(pr, message); },
    logIn: function (line) { log('<', line); }
  };
  pr.client = new Client(io, team);
  pr.brain = new Brain(pr.client, this.rng, pr.view);
  pr.gen = (function* () {
    yield* pr.client.connect();
    pr.manager = new TeamManager(pr.client, isRecruiter, {
      now: function () { return self.time; },
      spawn: function () {
        var child = self._launch(team, false);
        return child;
      }
    });
    yield* pr.brain.run(pr.manager);
  })();
  this.procs.push(pr);
  this.pending.push({ at: this.time + (isRecruiter ? 0 : SPAWN_DELAY), pr: pr });
  return pr;
};

/* accept() : le serveur envoie WELCOME */
G._accept = function (pr) {
  pr.fd = this.nextFd++;
  pr.connected = true;
  this.byFd[pr.fd] = pr;
  this.live.push(pr);
  pr.out.push('WELCOME\n');
};

/* une ligne reçue d'un client (Server::_handleClient) */
G._fromClient = function (pr, line) {
  if (pr.closing) return;
  if (!pr.player) { this._handshake(pr, line); return; }
  if (this.script) this.script.push('Q ' + pr.fd + ' ' + line);
  this.world.queueCommand(pr.fd, line);
};

G._handshake = function (pr, line) {
  var has = Object.prototype.hasOwnProperty.call(this.slots, line);
  if (has && this.slots[line] > 0) {
    this.slots[line]--;
    pr.out.push(this.slots[line] + '\n');
  } else if (has && (this.script && this.script.push('H ' + line), this.world.hatchEgg(line))) {
    pr.out.push('0\n');
  } else {
    pr.out.push('ko\n');
    pr.closing = true;
    return;
  }
  pr.out.push(this.config.width + ' ' + this.config.height + '\n');
  if (this.script) this.script.push('A ' + pr.fd + ' ' + line);
  pr.player = this.world.addPlayer(pr.fd, line);
};

/* fait tourner une IA jusqu'à ce qu'elle attende une ligne */
G._resume = function (pr) {
  if (!pr.alive) return;
  try {
    var r = pr.gen.next();
    if (r.done) this._exit(pr, 'fin');
  } catch (e) {
    if (e instanceof ConnectionError) this._exit(pr, e.message);
    else if (e instanceof ValueError) { this.stats.crashes++; this._exit(pr, 'ValueError : ' + e.message); }
    else throw e;
  }
};

/* le process IA s'arrête : le serveur voit la connexion se fermer */
G._exit = function (pr, why) {
  pr.alive = false;
  pr.exit = why;
  pr.view.state = 'arrêté';
  if (!pr.connected) return;
  var i = this.live.indexOf(pr);
  if (i >= 0) this.live.splice(i, 1);
  delete this.byFd[pr.fd];
  if (pr.player && (!pr.player.isDead || !this.keepDead)) {
    if (this.script) this.script.push('R ' + pr.fd);
    this.world.removePlayer(pr.fd);
  }
};

/* envoie les lignes en attente et laisse les IA répondre */
G._pump = function () {
  var i;
  for (i = 0; i < this.pending.length; ) {
    if (this.pending[i].at <= this.time + 1e-9) { this._accept(this.pending[i].pr); this.pending.splice(i, 1); }
    else i++;
  }
  for (var round = 0; round < 8; round++) {
    var any = false, list = this.live.slice();
    for (i = 0; i < list.length; i++) {
      var pr = list[i];
      if (!pr.out.length) continue;
      any = true;
      var inbox = pr.client.inbox;
      for (var k = 0; k < pr.out.length; k++) inbox.push(pr.out[k]);
      pr.out.length = 0;
      if (pr.closing) pr.client.closed = true;
      this._resume(pr);
    }
    if (!any) break;
  }
};

/* un tick : le monde avance d'une unité de temps, puis les lignes partent */
G.step = function () {
  this.tick++;
  this.time += 1 / this.config.freq;
  if (this.script) this.script.push('U 1');
  this.world.update(1);
  this._pump();
};

G.setFreq = function (f) { this.config.freq = Math.max(1, Math.min(500, Math.round(f))); };

G.logOf = function (pr, n) {
  var out = [], start = Math.max(0, pr.logN - Math.min(n, LOG_SIZE));
  for (var i = start; i < pr.logN; i++) out.push(pr.log[i % LOG_SIZE]);
  return out;
};

/* classement : par équipe, effectif vivant, niveau max, nombre par niveau, œufs */
G.ranking = function () {
  var self = this;
  return this.config.teams.map(function (t) {
    var levels = [0, 0, 0, 0, 0, 0, 0, 0, 0], alive = 0, max = 0, eggs = 0, i;
    for (i = 0; i < self.world.players.length; i++) {
      var p = self.world.players[i];
      if (p.team !== t || p.isDead) continue;
      alive++; levels[p.level]++;
      if (p.level > max) max = p.level;
    }
    for (i = 0; i < self.world.eggs.length; i++) if (self.world.eggs[i].team === t) eggs++;
    return { team: t, alive: alive, max: max, levels: levels, eggs: eggs };
  });
};

var api = {
  RESOURCE_NAMES: RESOURCE_NAMES, ELEVATION: ELEVATION, ELEVATION_REQ: ELEVATION_REQ, DENSITIES: DENSITIES,
  DIRECTION_MOVES: DIRECTION_MOVES, STONES: STONES,
  NORTH: NORTH, EAST: EAST, SOUTH: SOUTH, WEST: WEST,
  getCommandCost: getCommandCost, broadcastDirection: broadcastDirection, visionTiles: visionTiles,
  World: World, Game: Game, PlayerState: PlayerState, Client: Client, Brain: Brain, TeamManager: TeamManager,
  encode: encode, decode: decode, parseLook: parseLook, pathToTile: pathToTile, mulberry32: mulberry32,
  constants: {
    QUEEN_FOOD_MIN: QUEEN_FOOD_MIN, FOOD_THRESHOLD: FOOD_THRESHOLD, CRITICAL_FOOD: CRITICAL_FOOD,
    FOOD_RALLY_TARGET: FOOD_RALLY_TARGET, LOCK_TIMEOUT: LOCK_TIMEOUT, TEAM_CAP: TEAM_CAP,
    REFORK_BELOW: REFORK_BELOW, BUILD_FORK_COOLDOWN: BUILD_FORK_COOLDOWN
  }
};
if (typeof module !== 'undefined' && module.exports) module.exports = api;
else root.ZAPPY = api;
})(typeof self !== 'undefined' ? self : this);
