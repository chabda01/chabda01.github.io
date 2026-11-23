/* Arcade — version web du projet C++ (G-OOP-400).
   Ce fichier reprend, fonction par fonction, le code du dépôt :
     include/IDisplay.hpp, include/IGame.hpp      -> Key, Color, formes des objets
     src/games/snake.cpp, nibbler.cpp, minesweeper.cpp, extra/breakout.cpp -> les 4 jeux
     src/core.cpp                                  -> Core (menu, scores, nom, chargement)
   Aucun accès au DOM ici : tout est testable avec node (voir tests.js).
   Les calculs en `float` du C++ sont refaits avec Math.fround pour tomber sur les mêmes valeurs. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.ArcadeCore = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var f = Math.fround;

  // enum class Key (IDisplay.hpp)
  var Key = {};
  ["UP", "DOWN", "LEFT", "RIGHT", "NEXT_LIB", "NEXT_GAME", "RESTART", "MENU", "EXIT",
    "SPACE", "ENTER", "ONE", "TWO", "THREE", "N", "UNKNOWN"].forEach(function (k) { Key[k] = k; });

  // enum class Color (IDisplay.hpp)
  var Color = {};
  ["BLACK", "RED", "GREEN", "YELLOW", "BLUE", "MAGENTA", "CYAN", "WHITE"].forEach(function (c) { Color[c] = c; });

  function cell(symbol, fg, bg) { return { symbol: symbol, fg: fg, bg: bg }; }

  // std::rand() par défaut : un entier entre 0 et RAND_MAX
  function defaultRand() { return Math.floor(Math.random() * 2147483648); }

  /* ───────────────────────── Snake (src/games/snake.cpp) ───────────────────────── */

  var SNAKE_MAP = (function () {
    var m = ["##############################"];
    for (var i = 0; i < 23; i++) m.push("#                            #");
    m.push("##############################");
    return m;
  })();

  function Snake(opts) {
    this._rand = (opts && opts.rand) || defaultRand;
    this._width = 0; this._height = 0; this._score = 0;
    this._over = false; this._won = false;
    this._timer = 0; this._speed = f(0.2); this._baseSpeed = f(0.2);
    this._foodTimer = 0; this._boosted = false;
    this._dir = "RIGHT"; this._nextDir = "RIGHT";
    this._body = []; this._food = [0, 0]; this._map = [];
  }
  Snake.prototype.isOnBody = function (x, y) {
    for (var i = 0; i < this._body.length; i++)
      if (this._body[i][0] === x && this._body[i][1] === y) return true;
    return false;
  };
  Snake.prototype.isWall = function (x, y) {
    if (x < 0 || x >= this._width || y < 0 || y >= this._height) return true;
    return this._map[y][x] === "#";
  };
  Snake.prototype.init = function () {
    this._map = SNAKE_MAP.slice();
    this._height = this._map.length;
    this._width = this._map[0].length;
    this._score = 0; this._over = false; this._won = false;
    this._timer = 0; this._speed = f(0.2); this._baseSpeed = f(0.2);
    this._foodTimer = 0; this._boosted = false;
    this._dir = "RIGHT"; this._nextDir = "RIGHT";
    var cx = Math.floor(this._width / 2), cy = Math.floor(this._height / 2);
    this._body = [[cx, cy], [cx - 1, cy], [cx - 2, cy], [cx - 3, cy]];
    this.spawnFood();
  };
  Snake.prototype.close = function () { this._body = []; this._map = []; };
  Snake.prototype.handleInput = function (key) {
    if (key === Key.UP && this._dir !== "DOWN") this._nextDir = "UP";
    if (key === Key.DOWN && this._dir !== "UP") this._nextDir = "DOWN";
    if (key === Key.LEFT && this._dir !== "RIGHT") this._nextDir = "LEFT";
    if (key === Key.RIGHT && this._dir !== "LEFT") this._nextDir = "RIGHT";
    if (key === Key.SPACE) {
      this._boosted = !this._boosted;
      this._speed = this._boosted ? f(this._baseSpeed * f(0.4)) : this._baseSpeed;
    }
  };
  Snake.prototype.update = function (dt) {
    dt = f(dt);
    if (this._over || this._won) return;

    // la nourriture change de place toutes les 7 secondes
    this._foodTimer = f(this._foodTimer + dt);
    if (this._foodTimer >= 7) { this._foodTimer = 0; this.spawnFood(); }

    this._timer = f(this._timer + dt);
    if (this._timer < this._speed) return;
    this._timer = 0;

    this._dir = this._nextDir;
    var hx = this._body[0][0], hy = this._body[0][1];
    if (this._dir === "UP") hy -= 1;
    else if (this._dir === "DOWN") hy += 1;
    else if (this._dir === "LEFT") hx -= 1;
    else if (this._dir === "RIGHT") hx += 1;

    if (hx < 0 || hx >= this._width || hy < 0 || hy >= this._height || this._map[hy][hx] === "#") {
      this._over = true; return;
    }
    if (this.isOnBody(hx, hy)) { this._over = true; return; }

    this._body.unshift([hx, hy]);
    if (hx === this._food[0] && hy === this._food[1]) {
      this._score += 10;
      if (this._baseSpeed > f(0.05)) this._baseSpeed = f(this._baseSpeed - f(0.01));
      this._speed = this._boosted ? f(this._baseSpeed * f(0.4)) : this._baseSpeed;
      this._foodTimer = 0;
      if (!this.spawnFood()) this._won = true;
    } else {
      this._body.pop();
    }
  };
  Snake.prototype.render = function (display) {
    display.clear();
    for (var y = 0; y < this._height; y++)
      for (var x = 0; x < this._width; x++)
        if (this._map[y][x] === "#") display.drawCell(x, y, cell("#", Color.YELLOW, Color.YELLOW));
    display.drawCell(this._food[0], this._food[1], cell("*", Color.RED, Color.BLACK));
    for (var i = 0; i < this._body.length; i++)
      display.drawCell(this._body[i][0], this._body[i][1],
        i === 0 ? cell("@", Color.GREEN, Color.BLACK) : cell("o", Color.CYAN, Color.BLACK));
    display.drawText(0, this._height, "Score: " + this._score, Color.WHITE);
    var mx = Math.floor(this._width / 2) - 4, my = Math.floor(this._height / 2);
    if (this._over) display.drawText(mx, my, "GAME OVER", Color.WHITE);
    if (this._won) display.drawText(mx, my, "YOU WIN !", Color.WHITE);
    display.render();
  };
  Snake.prototype.spawnFood = function () {
    // on vérifie d'abord qu'il reste une case libre, puis on tire au hasard
    for (var y = 0; y < this._height; y++)
      for (var x = 0; x < this._width; x++)
        if (!this.isWall(x, y) && !this.isOnBody(x, y)) {
          var fx = this._rand() % this._width;
          var fy = this._rand() % this._height;
          while (this.isWall(fx, fy) || this.isOnBody(fx, fy)) {
            fx = this._rand() % this._width;
            fy = this._rand() % this._height;
          }
          this._food = [fx, fy];
          return true;
        }
    return false;
  };
  Snake.prototype.isOver = function () { return this._over || this._won; };
  Snake.prototype.getScore = function () { return this._score; };
  Snake.prototype.getName = function () { return "Snake"; };

  /* ───────────────────────── Nibbler (src/games/nibbler.cpp) ───────────────────────── */

  var NIBBLER_BASE_MAP = [
    "##############################",
    "#                            #",
    "#  ########    ##########    #",
    "#  ########    ##########    #",
    "#  ########    ##########    #",
    "#  ########    ##########    #",
    "#                            #",
    "#    ##########    ########  #",
    "#    ##########    ########  #",
    "#    ##########    ########  #",
    "#    ##########    ########  #",
    "#                            #",
    "#  ########    ##########    #",
    "#  ########    ##########    #",
    "#  ########    ##########    #",
    "#  ########    ##########    #",
    "#                            #",
    "#    ######  ########  ###   #",
    "#    ######  ########  ###   #",
    "#    ######  ########  ###   #",
    "#    ######  ########  ###   #",
    "#                            #",
    "#                            #",
    "#                            #",
    "##############################"
  ];
  var FOOD_START = 6, FOOD_PER_LEVEL = 3;
  var OFFSET = { UP: [0, -1], DOWN: [0, 1], LEFT: [-1, 0], RIGHT: [1, 0] };
  var OPPOSITE = { UP: "DOWN", DOWN: "UP", LEFT: "RIGHT", RIGHT: "LEFT" };

  // opts.levels : les 32 cartes de resources/mapnibbler (levels.js). Sans elles : BASE_MAP, comme en C++.
  function Nibbler(opts) {
    this._rand = (opts && opts.rand) || defaultRand;
    this._levels = (opts && opts.levels) || [];
    this._width = 0; this._height = 0; this._score = 0;
    this._over = false; this._won = false; this._level = 1; this._foodLeft = 0;
    this._dir = "RIGHT"; this._nextDir = "RIGHT";
    this._timer = 0; this._speed = f(0.2); this._baseSpeed = f(0.2);
    this._foodTimer = 0; this._boosted = false; this._waiting = false; this._waitTimer = 0;
    this._body = []; this._food = []; this._map = [];
  }
  Nibbler.prototype.isOnBody = Snake.prototype.isOnBody;
  Nibbler.prototype.isWall = Snake.prototype.isWall;
  Nibbler.prototype.loadLevel = function () {
    var file = this._levels[this._level - 1];
    this._map = file ? file.slice() : NIBBLER_BASE_MAP.slice();
    this._height = this._map.length;
    this._width = this._map[0].length;
    var cx = Math.floor(this._width / 2), cy = this._height - 2;
    this._body = [[cx, cy], [cx - 1, cy], [cx - 2, cy], [cx - 3, cy]];
    this._dir = "RIGHT"; this._nextDir = "RIGHT";
    this._timer = 0; this._foodTimer = 0; this._waiting = false; this._waitTimer = 0;
  };
  Nibbler.prototype.init = function () {
    this._score = 0; this._over = false; this._won = false; this._level = 1;
    this._baseSpeed = f(0.2); this._speed = f(0.2); this._boosted = false;
    this._waiting = false; this._waitTimer = 0;
    this.loadLevel();
    this._foodLeft = FOOD_START;
    this.spawnFood();
  };
  Nibbler.prototype.close = function () { this._body = []; this._food = []; this._map = []; };
  Nibbler.prototype.handleInput = function (key) {
    if (key === Key.UP && this._dir === "DOWN") return;
    if (key === Key.DOWN && this._dir === "UP") return;
    if (key === Key.LEFT && this._dir === "RIGHT") return;
    if (key === Key.RIGHT && this._dir === "LEFT") return;
    if (key === Key.UP) this._nextDir = "UP";
    if (key === Key.DOWN) this._nextDir = "DOWN";
    if (key === Key.LEFT) this._nextDir = "LEFT";
    if (key === Key.RIGHT) this._nextDir = "RIGHT";
    if (key === Key.SPACE) {
      this._boosted = !this._boosted;
      this._speed = this._boosted ? f(this._baseSpeed * f(0.4)) : this._baseSpeed;
    }
  };
  Nibbler.prototype.moveSnake = function () {
    this._dir = this._nextDir;
    var hx = this._body[0][0], hy = this._body[0][1];
    var nx = hx + OFFSET[this._dir][0], ny = hy + OFFSET[this._dir][1];

    if (this.isOnBody(nx, ny)) { this._over = true; return; }

    if (this.isWall(nx, ny)) {
      // face à un mur : on regarde à gauche et à droite du serpent
      var candidates = ["UP", "DOWN", "LEFT", "RIGHT"];
      var opposite = OPPOSITE[this._dir];
      var freeCount = 0, freeDir = this._dir, freeNx = nx, freeNy = ny;
      for (var i = 0; i < 4; i++) {
        var d = candidates[i];
        if (d === this._dir || d === opposite) continue;
        var cx = hx + OFFSET[d][0], cy = hy + OFFSET[d][1];
        if (!this.isWall(cx, cy) && !this.isOnBody(cx, cy)) {
          freeCount++; freeDir = d; freeNx = cx; freeNy = cy;
        }
      }
      if (freeCount === 0) { this._over = true; return; }          // cul-de-sac
      if (freeCount >= 2) { this._waiting = true; this._waitTimer = 0; return; } // carrefour en T : on attend le joueur
      this._dir = freeDir; this._nextDir = freeDir; nx = freeNx; ny = freeNy;   // un seul côté libre : virage automatique
    }
    this._body.unshift([nx, ny]);

    var ate = false;
    for (var k = 0; k < this._food.length; k++) {
      if (this._food[k][0] === nx && this._food[k][1] === ny) {
        this._score += 10 * this._level;
        this._food.splice(k, 1);
        this._foodLeft--;
        ate = true;
        break;
      }
    }
    if (ate) {
      if (this._baseSpeed > f(0.05)) this._baseSpeed = f(this._baseSpeed - f(0.01));
      this._speed = this._boosted ? f(this._baseSpeed * f(0.4)) : this._baseSpeed;
      this._foodTimer = 0;
    }
    if (ate && this._foodLeft === 0) {
      if (this._level >= 32) { this._won = true; return; }
      this._level++;
      if (this._baseSpeed > f(0.05)) this._baseSpeed = f(this._baseSpeed - f(0.01));
      this._speed = this._boosted ? f(this._baseSpeed * f(0.4)) : this._baseSpeed;
      this.loadLevel();
      this._foodLeft = FOOD_START + (this._level - 1) * FOOD_PER_LEVEL;
      this.spawnFood();
    } else if (!ate) {
      this._body.pop();
    }
  };
  Nibbler.prototype.update = function (dt) {
    dt = f(dt);
    if (this._over || this._won) return;

    if (this._waiting) {
      // carrefour en T : 3 secondes pour choisir un côté, sinon perdu
      this._waitTimer = f(this._waitTimer + dt);
      if (this._waitTimer >= 3) { this._over = true; return; }
      var nx = this._body[0][0] + OFFSET[this._nextDir][0];
      var ny = this._body[0][1] + OFFSET[this._nextDir][1];
      if (this._nextDir !== this._dir && !this.isWall(nx, ny) && !this.isOnBody(nx, ny)) {
        this._waiting = false; this._waitTimer = 0; this._timer = this._speed;
      }
      return;
    }

    this._foodTimer = f(this._foodTimer + dt);
    if (this._foodTimer >= 12) { this._foodTimer = 0; this.spawnFood(); }

    this._timer = f(this._timer + dt);
    if (this._timer < this._speed) return;
    this._timer = 0;
    this.moveSnake();
  };
  Nibbler.prototype.render = function (display) {
    display.clear();
    for (var y = 0; y < this._height; y++)
      for (var x = 0; x < this._width; x++)
        if (this._map[y][x] === "#") display.drawCell(x, y, cell("#", Color.YELLOW, Color.YELLOW));
    for (var k = 0; k < this._food.length; k++)
      display.drawCell(this._food[k][0], this._food[k][1], cell("*", Color.RED, Color.BLACK));
    for (var i = 0; i < this._body.length; i++)
      display.drawCell(this._body[i][0], this._body[i][1],
        i === 0 ? cell("@", Color.GREEN, Color.BLACK) : cell("o", Color.CYAN, Color.BLACK));
    display.drawText(0, this._height,
      "Score: " + this._score + "  Level: " + this._level + "  Food left: " + this._foodLeft, Color.WHITE);
    var mx = Math.floor(this._width / 2) - 4, my = Math.floor(this._height / 2);
    if (this._over) display.drawText(mx, my, "GAME OVER", Color.WHITE);
    if (this._won) display.drawText(mx, my, "YOU WIN !", Color.WHITE);
    display.render();
  };
  Nibbler.prototype.spawnFood = function () {
    this._food = [];
    var placed = 0;
    while (placed < this._foodLeft) {
      var x = this._rand() % this._width;
      var y = this._rand() % this._height;
      var blocked = this.isWall(x, y) || this.isOnBody(x, y);
      if (!blocked)
        for (var k = 0; k < this._food.length; k++)
          if (this._food[k][0] === x && this._food[k][1] === y) { blocked = true; break; }
      if (!blocked) { this._food.push([x, y]); placed++; }
    }
  };
  Nibbler.prototype.isOver = Snake.prototype.isOver;
  Nibbler.prototype.getScore = Snake.prototype.getScore;
  Nibbler.prototype.getName = function () { return "Nibbler"; };

  /* ───────────────────────── Minesweeper (src/games/minesweeper.cpp) ───────────────────────── */

  var BOARD_W = 26, BOARD_H = 18, BOARD_X = 2, BOARD_Y = 2, MINE_COUNT = 70;
  var NUM_COLORS = [Color.WHITE, Color.CYAN, Color.GREEN, Color.YELLOW, Color.MAGENTA,
    Color.RED, Color.RED, Color.RED, Color.RED];

  function Minesweeper(opts) {
    this._rand = (opts && opts.rand) || defaultRand;
    this._curX = BOARD_W >> 1; this._curY = BOARD_H >> 1;
    this._score = 0; this._over = false; this._won = false; this._firstMove = true;
    this._grid = [];
  }
  Minesweeper.BOARD_W = BOARD_W; Minesweeper.BOARD_H = BOARD_H; Minesweeper.MINE_COUNT = MINE_COUNT;
  Minesweeper.prototype.init = function () {
    this._curX = BOARD_W >> 1; this._curY = BOARD_H >> 1;
    this._score = 0; this._over = false; this._won = false; this._firstMove = true;
    this._grid = [];
    for (var y = 0; y < BOARD_H; y++) {
      var row = [];
      for (var x = 0; x < BOARD_W; x++) row.push({ mine: false, revealed: false, flagged: false, adjacent: 0 });
      this._grid.push(row);
    }
  };
  Minesweeper.prototype.close = function () { this._grid = []; };
  Minesweeper.prototype.placeMines = function (safeX, safeY) {
    // les mines sont posées après le premier clic, jamais sur lui ni autour
    var placed = 0;
    while (placed < MINE_COUNT) {
      var x = this._rand() % BOARD_W;
      var y = this._rand() % BOARD_H;
      if (this._grid[y][x].mine) continue;
      if (Math.abs(x - safeX) <= 1 && Math.abs(y - safeY) <= 1) continue;
      this._grid[y][x].mine = true;
      ++placed;
    }
  };
  Minesweeper.prototype.computeAdjacent = function () {
    for (var y = 0; y < BOARD_H; y++)
      for (var x = 0; x < BOARD_W; x++) {
        if (this._grid[y][x].mine) continue;
        var count = 0;
        for (var dy = -1; dy <= 1; dy++)
          for (var dx = -1; dx <= 1; dx++) {
            var nx = x + dx, ny = y + dy;
            if (nx >= 0 && nx < BOARD_W && ny >= 0 && ny < BOARD_H && this._grid[ny][nx].mine) ++count;
          }
        this._grid[y][x].adjacent = count;
      }
  };
  Minesweeper.prototype.floodReveal = function (x, y) {
    if (x < 0 || x >= BOARD_W || y < 0 || y >= BOARD_H) return;
    var c = this._grid[y][x];
    if (c.revealed || c.flagged || c.mine) return;
    c.revealed = true;
    this._score += 10;
    if (c.adjacent === 0)
      for (var dy = -1; dy <= 1; dy++)
        for (var dx = -1; dx <= 1; dx++)
          if (dx !== 0 || dy !== 0) this.floodReveal(x + dx, y + dy);
  };
  Minesweeper.prototype.checkWin = function () {
    for (var y = 0; y < BOARD_H; y++)
      for (var x = 0; x < BOARD_W; x++)
        if (!this._grid[y][x].mine && !this._grid[y][x].revealed) return false;
    return true;
  };
  Minesweeper.prototype.handleInput = function (key) {
    if (this._over || this._won) return;
    if (key === Key.UP && this._curY > 0) --this._curY;
    if (key === Key.DOWN && this._curY < BOARD_H - 1) ++this._curY;
    if (key === Key.LEFT && this._curX > 0) --this._curX;
    if (key === Key.RIGHT && this._curX < BOARD_W - 1) ++this._curX;

    var c;
    if (key === Key.SPACE) {
      c = this._grid[this._curY][this._curX];
      if (c.revealed || c.flagged) return;
      if (this._firstMove) {
        this._firstMove = false;
        this.placeMines(this._curX, this._curY);
        this.computeAdjacent();
      }
      if (c.mine) { c.revealed = true; this._over = true; return; }
      this.floodReveal(this._curX, this._curY);
      if (this.checkWin()) this._won = true;
    }
    if (key === Key.ENTER) {
      c = this._grid[this._curY][this._curX];
      if (!c.revealed) c.flagged = !c.flagged;
    }
  };
  Minesweeper.prototype.update = function () {};
  Minesweeper.prototype.render = function (display) {
    display.clear();
    for (var y = 0; y < BOARD_H; y++)
      for (var x = 0; x < BOARD_W; x++) {
        var c = this._grid[y][x], px = BOARD_X + x, py = BOARD_Y + y;
        var cursor = (x === this._curX && y === this._curY);
        if (!c.revealed) {
          if (c.flagged) display.drawCell(px, py, cell("F", Color.YELLOW, Color.BLUE));
          else if (cursor) display.drawCell(px, py, cell("#", Color.WHITE, Color.BLUE));
          else display.drawCell(px, py, cell("#", Color.BLUE, Color.BLUE));
        } else if (c.mine) {
          display.drawCell(px, py, cell("o", Color.RED, Color.BLACK));
        } else if (c.adjacent === 0) {
          display.drawCell(px, py, cell(" ", Color.BLACK, Color.BLACK));
        } else {
          display.drawCell(px, py, cell(String(c.adjacent), NUM_COLORS[c.adjacent], Color.BLACK));
        }
      }
    display.drawText(0, 0, "Minesweeper   [SPACE] reveal   [ENTER] flag", Color.WHITE);
    display.drawText(0, BOARD_Y + BOARD_H + 1, "Score: " + this._score + "   Mines: " + MINE_COUNT, Color.WHITE);
    if (this._over) display.drawText(BOARD_X, BOARD_Y + BOARD_H + 2, "GAME OVER", Color.WHITE);
    if (this._won) display.drawText(BOARD_X, BOARD_Y + BOARD_H + 2, "YOU WIN !", Color.WHITE);
    display.render();
  };
  Minesweeper.prototype.isOver = Snake.prototype.isOver;
  Minesweeper.prototype.getScore = Snake.prototype.getScore;
  Minesweeper.prototype.getName = function () { return "Minesweeper"; };

  /* ───────────────────────── Breakout (extra/breakout.cpp, cible « make bonus ») ───────────────────────── */

  var PADDLE_Y = 22, PADDLE_W = 5, BRICK_ROWS = 5;
  var BRICK_COLORS = [Color.RED, Color.MAGENTA, Color.YELLOW, Color.GREEN, Color.CYAN];

  function Breakout(opts) {
    this._rand = (opts && opts.rand) || defaultRand;
    this._width = 0; this._height = 0; this._score = 0; this._lives = 3;
    this._over = false; this._won = false;
    this._ballX = 0; this._ballY = 0; this._dirX = 1; this._dirY = -1;
    this._stepTime = f(0.06); this._stepTimer = 0;
    this._paddleX = 0; this._paddleSpeed = 16;
    this._leftHeld = false; this._rightHeld = false; this._launched = false;
    this._bricks = [];
  }
  Breakout.prototype.init = function () {
    this._width = 30; this._height = 25;
    this._score = 0; this._lives = 3; this._over = false; this._won = false;
    this._bricks = [];
    for (var r = 0; r < BRICK_ROWS; r++) {
      var row = [];
      for (var c = 0; c < this._width - 2; c++) row.push(this._rand() % BRICK_ROWS + 1);
      this._bricks.push(row);
    }
    this._paddleX = f((this._width - PADDLE_W) / 2);
    this._launched = false;
    this.resetBall();
  };
  Breakout.prototype.close = function () { this._bricks = []; };
  Breakout.prototype.resetBall = function () {
    this._ballX = Math.trunc(this._paddleX) + (PADDLE_W >> 1);
    this._ballY = PADDLE_Y - 1;
    this._dirX = (this._rand() % 2) ? 1 : -1;
    this._dirY = -1;
    this._stepTimer = 0;
  };
  Breakout.prototype.checkBrickAt = function (x, y) {
    var gx = x - 1, gy = y - 2;
    if (gy < 0 || gy >= BRICK_ROWS) return false;
    if (gx < 0 || gx >= this._width - 2) return false;
    if (this._bricks[gy][gx] === 0) return false;
    this._score += 10 * (BRICK_ROWS - gy);   // les rangées du haut rapportent plus
    this._bricks[gy][gx] = 0;
    return true;
  };
  Breakout.prototype.handleInput = function (key) {
    // une flèche lance la raquette, toute autre touche l'arrête
    if (key === Key.LEFT) { this._leftHeld = true; this._rightHeld = false; return; }
    if (key === Key.RIGHT) { this._rightHeld = true; this._leftHeld = false; return; }
    if (key === Key.UNKNOWN) return;
    this._leftHeld = this._rightHeld = false;
    if (!this._launched && key === Key.SPACE) this._launched = true;
  };
  Breakout.prototype.update = function (dt) {
    if (this._over || this._won) return;
    dt = f(Math.min(f(dt), f(0.05)));

    if (this._leftHeld) this._paddleX = f(this._paddleX - f(this._paddleSpeed * dt));
    if (this._rightHeld) this._paddleX = f(this._paddleX + f(this._paddleSpeed * dt));
    this._paddleX = Math.max(1, Math.min(this._width - 1 - PADDLE_W, this._paddleX));

    if (!this._launched) {
      this._ballX = Math.trunc(this._paddleX) + (PADDLE_W >> 1);
      this._ballY = PADDLE_Y - 1;
      return;
    }

    this._stepTimer = f(this._stepTimer + dt);
    if (this._stepTimer < this._stepTime) return;
    this._stepTimer = f(this._stepTimer - this._stepTime);

    var nx = this._ballX + this._dirX, ny = this._ballY + this._dirY;
    if (nx <= 0 || nx >= this._width - 1) { this._dirX = -this._dirX; nx = this._ballX + this._dirX; }
    if (ny <= 0) { this._dirY = -this._dirY; ny = this._ballY + this._dirY; }

    var px = Math.trunc(this._paddleX);
    if (this._dirY > 0 && ny === PADDLE_Y && nx >= px && nx < px + PADDLE_W) {
      this._dirY = -1;
      this._dirX = (nx < px + (PADDLE_W >> 1)) ? -1 : 1;
      ny = this._ballY + this._dirY;
    }

    if (ny >= this._height - 1) {
      if (--this._lives <= 0) { this._over = true; return; }
      this._launched = false;
      this.resetBall();
      return;
    }

    var hitX = this.checkBrickAt(nx, this._ballY);
    var hitY = this.checkBrickAt(this._ballX, ny);
    if (!hitX && !hitY) {
      if (this.checkBrickAt(nx, ny)) { this._dirX = -this._dirX; this._dirY = -this._dirY; }
    } else {
      if (hitX) { this._dirX = -this._dirX; nx = this._ballX + this._dirX; }
      if (hitY) { this._dirY = -this._dirY; ny = this._ballY + this._dirY; }
    }
    this._ballX = nx; this._ballY = ny;

    for (var r = 0; r < this._bricks.length; r++)
      for (var c = 0; c < this._bricks[r].length; c++)
        if (this._bricks[r][c]) return;
    this._won = true;
  };
  Breakout.prototype.render = function (display) {
    display.clear();
    var x, y;
    for (x = 0; x < this._width; x++) display.drawCell(x, 0, cell("#", Color.YELLOW, Color.YELLOW));
    for (y = 1; y < this._height; y++) {
      display.drawCell(0, y, cell("#", Color.YELLOW, Color.YELLOW));
      display.drawCell(this._width - 1, y, cell("#", Color.YELLOW, Color.YELLOW));
    }
    for (var r = 0; r < BRICK_ROWS; r++)
      for (var col = 0; col < this._bricks[r].length; col++) {
        if (this._bricks[r][col] === 0) continue;
        var c = BRICK_COLORS[this._bricks[r][col] - 1];
        display.drawCell(col + 1, r + 2, cell("#", c, c));
      }
    var px = Math.trunc(this._paddleX);
    for (var i = 0; i < PADDLE_W; i++) display.drawCell(px + i, PADDLE_Y, cell("=", Color.CYAN, Color.CYAN));
    display.drawCell(this._ballX, this._ballY, cell("o", Color.WHITE, Color.BLACK));

    var hud = "Score: " + this._score + "   Lives: " + this._lives;
    if (!this._launched) hud += "   [SPACE] launch";
    display.drawText(0, this._height, hud, Color.WHITE);
    var mx = Math.floor(this._width / 2) - 4, my = Math.floor(this._height / 2);
    if (this._over) display.drawText(mx, my, "GAME OVER", Color.WHITE);
    if (this._won) display.drawText(mx, my, "YOU WIN !", Color.WHITE);
    display.render();
  };
  Breakout.prototype.isOver = Snake.prototype.isOver;
  Breakout.prototype.getScore = Snake.prototype.getScore;
  Breakout.prototype.getName = function () { return "Breakout"; };

  /* ───────────────────────── scores.txt (Core::loadScores / saveScores) ───────────────────────── */

  // Même lecture que `while (f >> gameName >> playerName >> score)` : trois mots séparés par des blancs.
  // La lecture s'arrête au premier score qui n'est pas un entier.
  function parseScores(text) {
    var tok = String(text || "").split(/\s+/).filter(function (t) { return t.length; });
    var out = [];
    for (var i = 0; i + 2 < tok.length; i += 3) {
      var m = /^[+-]?\d+/.exec(tok[i + 2]);
      if (!m) break;
      out.push([tok[i], tok[i + 1], parseInt(m[0], 10)]);
      if (m[0].length !== tok[i + 2].length) break; // « 12abc » : le flux reste bloqué sur « abc »
    }
    return out;
  }
  function formatScores(scores) {
    return scores.map(function (s) { return s[0] + " " + s[1] + " " + s[2] + "\n"; }).join("");
  }
  // Core::showBestScores : le meilleur score de chaque jeu, jeux triés par nom (std::map).
  function bestScores(scores) {
    var best = {};
    scores.forEach(function (s) {
      if (!(s[0] in best) || s[2] > best[s[0]][1]) best[s[0]] = [s[1], s[2]];
    });
    return Object.keys(best).sort(function (a, b) { return a < b ? -1 : a > b ? 1 : 0; })
      .map(function (g) { return [g, best[g][0], best[g][1]]; });
  }

  /* ───────────────────────── Core (src/core.cpp) ─────────────────────────
     env remplace ce que le C++ demande au système :
       env.dl   : { list() -> chemins de ./lib, dlopen(path) -> handle|null, dlsym(handle, nom) -> fonction|null, dlclose(handle) }
       env.readFile(nom) -> texte|null, env.writeFile(nom, texte)
       env.now() -> secondes (std::chrono::steady_clock), env.exit(code)
     Core::run() est une boucle infinie en C++. Ici, step() fait UN tour de cette boucle ;
     c'est la page qui l'appelle à chaque image. step() renvoie false quand le programme se termine. */

  function Core(initialLib, env) {
    this.env = env;
    this._inMenu = true; this._enteringName = false; this._playerName = "";
    this._displayPath = initialLib; this._gamePath = "";
    this._displayIdx = 0; this._gameIdx = 0;
    this._availableDisplays = []; this._availableGames = [];
    this._displayHandle = null; this._gameHandle = null;
    this._display = null; this._game = null;
    this._scores = [];
    this._prev = null;
    this.ended = false;

    this.scanLibs();
    this.loadScores();
    for (var i = 0; i < this._availableDisplays.length; i++)
      if (this._availableDisplays[i] === initialLib) { this._displayIdx = i; break; }
    this.loadDisplay(this._displayPath);
  }
  Core.prototype.scanLibs = function () {
    var dl = this.env.dl, self = this;
    this._availableDisplays = []; this._availableGames = [];
    dl.list().forEach(function (path) {
      if (!/\.so$/.test(path)) return;
      var handle = dl.dlopen(path);
      if (!handle) return;
      if (dl.dlsym(handle, "createDisplay")) self._availableDisplays.push(path);
      else if (dl.dlsym(handle, "createGame")) self._availableGames.push(path);
      dl.dlclose(handle);
    });
  };
  Core.prototype.loadDisplay = function (path) {
    this.unloadDisplay();
    this._displayHandle = this.env.dl.dlopen(path);
    if (!this._displayHandle) throw new Error("Failed to load display library: " + path);
    var createFunc = this.env.dl.dlsym(this._displayHandle, "createDisplay");
    if (!createFunc) throw new Error("Failed to find createDisplay in: " + path);
    this._display = createFunc();
    if (!this._display) throw new Error("createDisplay returned null for: " + path);
    this._display.init();
  };
  Core.prototype.loadGame = function (path) {
    this.unloadGame();
    this._gameHandle = this.env.dl.dlopen(path);
    if (!this._gameHandle) throw new Error("Failed to load game library: " + path);
    var createFunc = this.env.dl.dlsym(this._gameHandle, "createGame");
    if (!createFunc) throw new Error("Failed to find createGame in: " + path);
    this._game = createFunc();
    if (!this._game) throw new Error("createGame returned null for: " + path);
    this._game.init(this._display.getWidth(), this._display.getHeight());
  };
  Core.prototype.unloadDisplay = function () {
    if (this._display) { this._display.close(); this._display = null; }
    if (this._displayHandle) { this.env.dl.dlclose(this._displayHandle); this._displayHandle = null; }
  };
  Core.prototype.unloadGame = function () {
    if (this._game) { this._game.close(); this._game = null; }
    if (this._gameHandle) { this.env.dl.dlclose(this._gameHandle); this._gameHandle = null; }
  };
  // ~Core()
  Core.prototype.destroy = function () { this.unloadDisplay(); this.unloadGame(); };

  // Un tour de la boucle `while (true)` de Core::run().
  Core.prototype.step = function () {
    if (this.ended) return false;
    if (this._prev === null) this._prev = this.env.now();
    if (this._inMenu) return this.showMenu();

    var now = this.env.now();
    var dt = f(now - this._prev);
    this._prev = now;

    var key = this._display.getInput();
    if (key === Key.EXIT) { this.ended = true; this.destroy(); this.env.exit(0); return false; }
    if (key === Key.MENU) { this._inMenu = true; return true; }
    if (key === Key.NEXT_LIB) { this.nextDisplay(); return true; }
    if (key === Key.NEXT_GAME) { this.nextGame(); return true; }
    if (key === Key.RESTART) { this.loadGame(this._availableGames[this._gameIdx]); return true; }
    this._game.handleInput(key);
    this._game.update(dt);

    if (this._game.isOver()) {
      this._scores.push([this._game.getName(), this._playerName === "" ? "Unknown" : this._playerName, this._game.getScore()]);
      this.saveScores();
      this._inMenu = true;
      if (this.env.onGameOver) this.env.onGameOver(this._scores[this._scores.length - 1]); // ajout web : prévenir la page
      return true;
    }

    this._display.clear();
    this._game.render(this._display);
    this._display.render();
    return true;
  };

  Core.prototype.showMenu = function () {
    var d = this._display;
    d.clear();
    d.drawText(2, 1, "=== ARCADE ===", Color.WHITE);
    d.drawText(2, 3, "Game    : " + this._availableGames[this._gameIdx], Color.WHITE);
    d.drawText(2, 4, "Display : " + this._availableDisplays[this._displayIdx], Color.WHITE);

    // Core::NameEntering()
    if (this._enteringName) {
      d.drawText(2, 5, "Player Name: " + this._playerName + "_", Color.WHITE);
      d.drawText(2, 6, "[ENTREE] enable  [ESC] disable  [BACKSPACE] delete", Color.WHITE);
      d.render();
      // En C++, getChar() bloque jusqu'à la prochaine touche. Ici il renvoie null tant qu'il n'y a rien :
      // on rend la main au navigateur et on reviendra au prochain tour.
      var c = d.getChar();
      if (c === null) return true;
      if (c === 10 || c === 13) this._enteringName = false;
      else if (c === 27) this._enteringName = false;
      else if ((c === 127 || c === 8) && this._playerName !== "") this._playerName = this._playerName.slice(0, -1);
      else if (c >= 32 && c < 127 && this._playerName.length < 20) this._playerName += String.fromCharCode(c);
      if (this._enteringName) return true; // ajout web : on évite l'image où les deux écrans se superposent
      d.clear();
      d.drawText(2, 1, "=== ARCADE ===", Color.WHITE);
      d.drawText(2, 3, "Game    : " + this._availableGames[this._gameIdx], Color.WHITE);
      d.drawText(2, 4, "Display : " + this._availableDisplays[this._displayIdx], Color.WHITE);
    }
    d.drawText(2, 5, "Player Name: " + (this._playerName === "" ? "---" : this._playerName), Color.WHITE);
    d.drawText(2, 6, "INPUT: start  F2: game  TAB: next display  N: enter name / edit name  Q: exit", Color.WHITE);
    this.showBestScores();
    d.render();

    var key = d.getInput();
    if (key === Key.ENTER) {
      this.loadGame(this._availableGames[this._gameIdx]);
      this._display.showGameIntro(this._game.getName());
      this._inMenu = false;
    } else if (key === Key.NEXT_LIB) {
      this.nextDisplay();
    } else if (key === Key.NEXT_GAME) {
      this.nextGame();
    } else if (key === Key.EXIT) {
      this.ended = true;
      this.env.exit(0); // exit(0) direct : le C++ ne décharge rien ici
      return false;
    } else if (key === Key.N) {
      this._enteringName = true;
      this._playerName = "";
    }
    return true;
  };
  Core.prototype.nextDisplay = function () {
    this._displayIdx = (this._displayIdx + 1) % this._availableDisplays.length;
    this.loadDisplay(this._availableDisplays[this._displayIdx]);
  };
  Core.prototype.nextGame = function () {
    // seul l'index change : le jeu est chargé plus tard, par ENTREE (menu) ou R (en partie)
    this._gameIdx = (this._gameIdx + 1) % this._availableGames.length;
  };
  Core.prototype.showBestScores = function () {
    var d = this._display;
    d.drawText(2, 8, "--- Best Scores ---", Color.WHITE);
    var best = bestScores(this._scores);
    if (!best.length) { d.drawText(2, 9, "Aucun score enregistre", Color.WHITE); return; }
    var row = 9;
    best.forEach(function (b) { d.drawText(2, row++, b[0] + "  ->  " + b[1] + "  " + b[2], Color.WHITE); });
  };
  Core.prototype.loadScores = function () {
    this._scores = this._scores.concat(parseScores(this.env.readFile("scores.txt")));
  };
  Core.prototype.saveScores = function () {
    this.env.writeFile("scores.txt", formatScores(this._scores));
  };

  return {
    Key: Key, Color: Color,
    Snake: Snake, Nibbler: Nibbler, Minesweeper: Minesweeper, Breakout: Breakout,
    Core: Core,
    parseScores: parseScores, formatScores: formatScores, bestScores: bestScores,
    NIBBLER_BASE_MAP: NIBBLER_BASE_MAP, SNAKE_MAP: SNAKE_MAP
  };
});
