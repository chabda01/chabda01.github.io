/* Arcade — la page. Trois « bibliothèques d'affichage » derrière la même interface (IDisplay),
   le faux chargeur de .so (dlopen / dlsym / dlclose), le journal des appels, le clavier et les boutons.
   Les règles des jeux et le cœur sont dans core.js. */
(function () {
  "use strict";

  var A = window.ArcadeCore, LEVELS = window.ArcadeLevels;
  if (!A) return;
  var Key = A.Key;
  var $ = function (id) { return document.getElementById(id); };

  var screenEl = $("ar-screen");
  var reduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var coarse = window.matchMedia && window.matchMedia("(pointer: coarse)").matches;
  var small = coarse || (navigator.hardwareConcurrency || 8) <= 4;
  var canvasScale = Math.min(window.devicePixelRatio || 1, small ? 1.5 : 2);

  var MONO = '"DejaVu Sans Mono","JetBrains Mono",ui-monospace,Menlo,Consolas,monospace';

  /* ───────────── touches : ce que chaque bibliothèque sait traduire (leurs getInput()) ───────────── */

  var COMMON_KEYS = { Up: Key.UP, Down: Key.DOWN, Left: Key.LEFT, Right: Key.RIGHT, Enter: Key.ENTER, Tab: Key.NEXT_LIB, F2: Key.NEXT_GAME };
  var CHAR_KEYS = { q: Key.EXIT, r: Key.RESTART, m: Key.MENU, n: Key.N, "1": Key.ONE, "2": Key.TWO, "3": Key.THREE };

  function mapKey(phys, withEscape) {
    if (phys.name === "Char") return CHAR_KEYS[phys.ch.toLowerCase()] || Key.UNKNOWN;
    if (phys.name === "Space") return Key.SPACE; // ncurses : ajout de cette page, voir « Ce qui change »
    if (phys.name === "Escape") return withEscape ? Key.EXIT : Key.UNKNOWN;
    return COMMON_KEYS[phys.name] || Key.UNKNOWN;
  }
  function toChar(phys, enterCode) {
    if (phys.name === "Enter") return enterCode;
    if (phys.name === "Backspace") return 127;
    if (phys.name === "Escape") return 27;
    if (phys.name === "Space") return 32;
    if (phys.name === "Char") { var c = phys.ch.charCodeAt(0); return c < 128 ? c : null; }
    return null;
  }

  /* ───────────── arcade_ncurses.so : une grille de caractères ───────────── */

  var TERM_W = 57, TERM_H = 27;   // taille du faux terminal
  var WIN_W = 30, WIN_H = 27;     // constantes de ncurses.cpp
  var ncursesIntroSeen = false;

  function NcursesDisplay() {
    this.libName = "ncurses";
    this.keys = []; this.chars = [];
    this._width = 0; this._height = 0; this._offsetX = 0; this._offsetY = 0;
    this._pendingKey = Key.UNKNOWN;
    this.blocking = false;
    this.el = null; this.rows = []; this.rowHtml = [];
    this.ch = []; this.at = [];
  }
  NcursesDisplay.prototype.init = function () {
    this.el = document.createElement("div");
    this.el.className = "ar-term";
    this.el.setAttribute("aria-hidden", "true");
    for (var y = 0; y < TERM_H; y++) {
      var row = document.createElement("div");
      this.el.appendChild(row); this.rows.push(row); this.rowHtml.push(null);
    }
    screenEl.appendChild(this.el);
    this._width = WIN_W; this._height = WIN_H - 2;
    this._offsetX = Math.max(0, Math.floor((TERM_W - WIN_W) / 2));
    this._offsetY = Math.max(0, Math.floor((TERM_H - WIN_H) / 2));
    this.clear();
    // showSplash(), showLoadingBar(), showStartMenu() : l'appel à init() ne rend pas la main avant la fin
    var replay = $("ar-intro") && $("ar-intro").checked;
    if (!ncursesIntroSeen || replay) {
      ncursesIntroSeen = true;
      this.blocking = true;
      this.phase = reduced ? "start" : "splash";
      this.t0 = null; this.lastStep = -1;
    } else {
      note("display", "…", "intro ncurses déjà jouée : passée (réglage de la page)");
    }
  };
  NcursesDisplay.prototype.close = function () {
    if (this.el && this.el.parentNode) this.el.parentNode.removeChild(this.el);
    this.el = null; this.blocking = false;
  };
  NcursesDisplay.prototype.clear = function () {
    this.ch = new Array(TERM_W * TERM_H).fill(" ");
    this.at = new Array(TERM_W * TERM_H).fill(7);
  };
  NcursesDisplay.prototype.put = function (row, col, c, attr) {
    if (row < 0 || row >= TERM_H || col < 0 || col >= TERM_W) return;
    this.ch[row * TERM_W + col] = c; this.at[row * TERM_W + col] = attr;
  };
  // mvprintw : écrit à partir de (row, col) ; arrivé au bord droit, le texte continue au début de la ligne suivante
  NcursesDisplay.prototype.mv = function (row, col, text, attr) {
    for (var i = 0; i < text.length; i++) {
      if (row >= TERM_H) return;
      this.put(row, col, text[i], attr);
      if (++col >= TERM_W) { col = 0; row++; }
    }
  };
  NcursesDisplay.prototype.render = function () {
    if (!this.el) return;
    for (var y = 0; y < TERM_H; y++) {
      var html = "", run = "", cur = -1;
      for (var x = 0; x < TERM_W; x++) {
        var a = this.at[y * TERM_W + x], c = this.ch[y * TERM_W + x];
        if (c === " ") a = cur === -1 ? 7 : cur;
        if (a !== cur) {
          if (run) html += '<span class="k' + cur + '">' + run + "</span>";
          run = ""; cur = a;
        }
        run += c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : c;
      }
      if (run) html += '<span class="k' + cur + '">' + run + "</span>";
      if (html !== this.rowHtml[y]) { this.rows[y].innerHTML = html; this.rowHtml[y] = html; }
    }
  };
  function colorPair(fg) {
    switch (fg) {
      case "RED": return 1; case "GREEN": return 2; case "YELLOW": return 3; case "BLUE": return 4;
      case "MAGENTA": return 5; case "CYAN": return 6; default: return 7; // WHITE et BLACK
    }
  }
  NcursesDisplay.prototype.drawCell = function (x, y, cell) {
    if (x < 0 || x >= this._width || y < 0 || y >= this._height) return;
    this.put(y + this._offsetY, x + this._offsetX, cell.symbol, colorPair(cell.fg));
  };
  NcursesDisplay.prototype.drawText = function (x, y, text, fg) {
    if (y < 0 || x < 0 || !text) return;
    this.mv(y + this._offsetY, x + this._offsetX, text, colorPair(fg || "WHITE"));
  };
  NcursesDisplay.prototype.getInput = function () {
    if (this._pendingKey !== Key.UNKNOWN) { var k = this._pendingKey; this._pendingKey = Key.UNKNOWN; return k; }
    return this.keys.length ? this.keys.shift() : Key.UNKNOWN; // getch() : une touche par tour
  };
  NcursesDisplay.prototype.getChar = function () { return this.chars.length ? this.chars.shift() : null; };
  NcursesDisplay.prototype.getWidth = function () { return this._width; };
  NcursesDisplay.prototype.getHeight = function () { return this._height; };
  NcursesDisplay.prototype.showGameIntro = function () {}; // non redéfinie dans ncurses.cpp : version vide de l'interface
  NcursesDisplay.prototype.mapKey = function (p) { return mapKey(p, false); };
  NcursesDisplay.prototype.toChar = function (p) { return toChar(p, 10); };

  var SPLASH = [
    "     _    ____   ____    _    ____  _____",
    "    / \\  |  _ \\ / ___|  / \\  |  _ \\| ____|",
    "   / _ \\ | |_) | |     / _ \\ | | | |  _|",
    "  / ___ \\|  _ <| |___ / ___ \\| |_| | |___",
    " /_/   \\_\\_| \\_\\\\____/_/   \\_\\____/|_____|"
  ];
  // Durées du vrai programme : 1,5 s de titre puis 10 x 0,6 s de barre. Ici : 0,7 s puis 10 x 0,07 s.
  var SPLASH_MS = 700, BAR_STEP_MS = 70;
  NcursesDisplay.prototype.tick = function (ts) {
    if (!this.blocking) return;
    if (this.t0 === null) this.t0 = ts;
    var cx = this._offsetX + (this._width >> 1), cy = this._offsetY + (this._height >> 1), i;
    if (this.phase === "splash") {
      this.clear();
      for (i = 0; i < 5; i++) this.mv(cy - 2 + i, cx - 14, SPLASH[i], 12);
      this.render();
      if (ts - this.t0 >= SPLASH_MS) { this.phase = "bar"; this.t0 = ts; }
    } else if (this.phase === "bar") {
      var step = Math.min(10, Math.floor((ts - this.t0) / BAR_STEP_MS) + 1);
      if (step !== this.lastStep) {
        this.lastStep = step;
        this.clear();
        this.mv(cy - 2, cx - 8, "Chargement...", 7);
        this.mv(cy, cx - 11, "[                    ]", 3);
        for (i = 0; i < step; i++) this.mv(cy, cx - 10 + i * 2, "==", 12);
        this.mv(cy + 2, cx - 2, (("  " + step * 10).slice(-3)) + "%", 6);
        this.render();
      }
      if (ts - this.t0 >= BAR_STEP_MS * 10) { this.phase = "start"; this.drawn = false; }
    } else if (!this.drawn) {
      this.drawn = true;
      this.clear();
      this.mv(cy, cx - 10, "ENTREE pour continuer  Q pour quitter", 7);
      this.render();
    }
  };
  NcursesDisplay.prototype.onBlockingKey = function (phys) {
    if (this.phase !== "start") return; // pendant le titre et la barre, le programme dort
    if (phys.name === "Enter") this.blocking = false;
    else if (phys.name === "Char" && phys.ch.toLowerCase() === "q") { this._pendingKey = Key.EXIT; this.blocking = false; }
  };
  NcursesDisplay.prototype.onPointer = function () { this.onBlockingKey({ name: "Enter" }); }; // confort web : toucher = ENTREE

  /* ───────────── arcade_sdl2.so et arcade_sfml.so : un canvas ───────────── */

  var CELL = 20, GRID_W = 30, GRID_H = 25, TEXT_H = 36;
  var RGB = { BLACK: "0,0,0", RED: "220,50,50", GREEN: "50,220,50", YELLOW: "220,220,50", BLUE: "50,50,220",
    MAGENTA: "220,50,220", CYAN: "50,220,220", WHITE: "255,255,255" };
  function rgb(c) { return "rgb(" + (RGB[c] || RGB.WHITE) + ")"; }

  function CanvasDisplay(kind) {
    this.libName = kind; this.kind = kind;
    this.keys = []; this.chars = [];
    this.blocking = false; this.canvas = null; this.ctx = null;
  }
  CanvasDisplay.prototype.init = function () {
    var c = document.createElement("canvas");
    c.className = "ar-canvas";
    c.setAttribute("aria-hidden", "true");
    this.canvas = c; this.ctx = c.getContext("2d");
    this.resize();
    screenEl.appendChild(c);
    this.clear();
  };
  CanvasDisplay.prototype.resize = function () {
    this.canvas.width = Math.round(GRID_W * CELL * canvasScale);
    this.canvas.height = Math.round((GRID_H * CELL + TEXT_H) * canvasScale);
    this.ctx.setTransform(canvasScale, 0, 0, canvasScale, 0, 0);
  };
  CanvasDisplay.prototype.close = function () {
    if (this.canvas && this.canvas.parentNode) this.canvas.parentNode.removeChild(this.canvas);
    this.canvas = null; this.ctx = null; this.blocking = false;
  };
  CanvasDisplay.prototype.clear = function () {
    if (!this.ctx) return;
    this.ctx.fillStyle = "#000";
    this.ctx.fillRect(0, 0, GRID_W * CELL, GRID_H * CELL + TEXT_H);
  };
  CanvasDisplay.prototype.render = function () {}; // window.display() / SDL_RenderPresent : le canvas est déjà à l'écran
  CanvasDisplay.prototype.drawCell = function (x, y, cell) {
    var g = this.ctx; if (!g) return;
    var px = x * CELL, py = y * CELL, cx = px + CELL / 2, cy = py + CELL / 2;
    if (this.kind === "sfml" && cell.symbol === "@") {       // drawSnakeHead
      var r = CELL / 2 - 1;
      g.beginPath(); g.arc(cx, cy, r + 1, 0, 6.2832); g.fillStyle = "rgb(20,180,40)"; g.fill();
      g.beginPath(); g.arc(cx, cy, r - 1, 0, 6.2832); g.fillStyle = rgb(cell.fg); g.fill();
      var er = CELL * 0.09, eo = CELL * 0.22;
      g.fillStyle = "#000";
      g.beginPath(); g.arc(cx - eo, cy - eo * 0.6, er, 0, 6.2832); g.fill();
      g.beginPath(); g.arc(cx + eo, cy - eo * 0.6, er, 0, 6.2832); g.fill();
      return;
    }
    if (this.kind === "sfml" && cell.symbol === "o") {       // drawSnakeBody
      g.beginPath(); g.arc(cx, cy, CELL / 2 - 3, 0, 6.2832); g.fillStyle = rgb(cell.fg); g.fill();
      return;
    }
    g.fillStyle = rgb(cell.bg);
    g.fillRect(px, py, CELL, CELL);
    if (cell.symbol === " ") {
      g.strokeStyle = "rgba(" + RGB[cell.fg] + ",0.47)"; g.lineWidth = 1;
      g.strokeRect(px + 0.5, py + 0.5, CELL - 1, CELL - 1);
      return;
    }
    if (cell.fg === cell.bg) return; // lettre de la même couleur que le fond : invisible, on économise le tracé
    g.font = "bold 14px " + MONO; g.textAlign = "center"; g.textBaseline = "middle";
    g.fillStyle = rgb(cell.fg);
    g.fillText(cell.symbol, cx, cy + 1);
  };
  CanvasDisplay.prototype.drawText = function (x, y, text, fg) {
    var g = this.ctx; if (!g || !text) return;
    var hud = y >= GRID_H; // tout texte sous la grille va dans la bande du bas
    g.fillStyle = rgb(fg || "WHITE"); g.textAlign = "left";
    if (this.kind === "sfml") {
      g.font = "bold " + (hud ? 16 : 11) + "px " + MONO; g.textBaseline = "top";
      if (hud) g.fillText(text, 8 + x * CELL, GRID_H * CELL + (TEXT_H - 16) / 2);
      else g.fillText(text, x * CELL, y * CELL + (CELL - 11) / 2);
    } else {
      g.font = "bold " + (hud ? 22 : 14) + "px " + MONO;
      if (hud) { g.textBaseline = "middle"; g.fillText(text, 8 + x * CELL, GRID_H * CELL + TEXT_H / 2 + 1); }
      else { g.textBaseline = "top"; g.fillText(text, x * CELL, y * CELL + 2); }
    }
  };
  CanvasDisplay.prototype.getInput = function () {
    // la boucle d'événements vide la file et garde la dernière touche connue
    var k = this.keys.length ? this.keys[this.keys.length - 1] : Key.UNKNOWN;
    this.keys.length = 0;
    return k;
  };
  CanvasDisplay.prototype.getChar = function () { return this.chars.length ? this.chars.shift() : null; };
  CanvasDisplay.prototype.getWidth = function () { return GRID_W; };
  CanvasDisplay.prototype.getHeight = function () { return GRID_H; };
  CanvasDisplay.prototype.mapKey = function (p) { return mapKey(p, true); };
  CanvasDisplay.prototype.toChar = function (p) { return toChar(p, this.kind === "sfml" ? 13 : 10); };
  // Écran « PLAY » avant la partie : l'appel ne rend la main qu'après une touche ou un clic.
  CanvasDisplay.prototype.showGameIntro = function (name) {
    this.blocking = true; this.introName = name; this.t0 = null;
  };
  CanvasDisplay.prototype.tick = function (ts) {
    var g = this.ctx; if (!this.blocking || !g) return;
    if (this.t0 === null) this.t0 = ts;
    var t = (ts - this.t0) / 1000;
    var W = GRID_W * CELL, H = GRID_H * CELL + TEXT_H, cx = W / 2, cy = H / 2;
    var scale = reduced ? 1 : 1 + 0.08 * Math.sin(t * 1.2 * 3.14159);
    var bw = 160 * scale, bh = 48 * scale;
    g.fillStyle = "rgb(8,14,10)"; g.fillRect(0, 0, W, H);
    g.textAlign = "center"; g.textBaseline = "middle";
    // SDL2 écrit le nom du jeu. SFML le prévoit aussi, mais avec une police absente du dépôt : il ne s'affiche pas.
    if (this.kind === "sdl2") { g.font = "bold 42px " + MONO; g.fillStyle = "#fff"; g.fillText(this.introName, cx, cy - 40); }
    g.fillStyle = "rgb(40,160,60)"; g.fillRect(cx - bw / 2, cy + 60 - bh / 2, bw, bh);
    g.strokeStyle = "rgb(80,255,100)"; g.lineWidth = this.kind === "sfml" ? 2 : 1;
    g.strokeRect(cx - bw / 2, cy + 60 - bh / 2, bw, bh);
    g.font = "bold 22px " + MONO; g.fillStyle = "#fff"; g.fillText("PLAY", cx, cy + 61);
  };
  CanvasDisplay.prototype.onBlockingKey = function (phys) {
    if (phys.name === "Enter" || phys.name === "Space" || phys.name === "Escape" ||
      (phys.name === "Char" && phys.ch.toLowerCase() === "q")) this.blocking = false;
  };
  CanvasDisplay.prototype.onPointer = function () { this.blocking = false; }; // clic de souris : comme dans le vrai

  /* ───────────── le journal et les compteurs d'appels ───────────── */

  var logEl = $("ar-log"), pending = [], frameCounts = {}, lastCounts = {}, lastDt = 0;
  var caller = "core";
  var QUIET = false;

  function log(text, cls) {
    pending.push([text, cls || ""]);
  }
  function flushLog() {
    if (!pending.length) return;
    var frag = document.createDocumentFragment();
    pending.splice(0, pending.length).slice(-120).forEach(function (p) {
      var d = document.createElement("div");
      if (p[1]) d.className = p[1];
      d.textContent = p[0];
      frag.appendChild(d);
    });
    logEl.appendChild(frag);
    while (logEl.childNodes.length > 140) logEl.removeChild(logEl.firstChild);
    logEl.scrollTop = logEl.scrollHeight;
  }
  function count(line) { frameCounts[line] = (frameCounts[line] || 0) + 1; }
  function note(target, method, text) { log(caller + " → " + target + "." + method + "  " + text, "t-dim"); }

  function fmtArg(a) {
    if (typeof a === "string") return A.Key[a] === a ? "Key::" + a : '"' + a + '"';
    if (typeof a === "number") return String(Math.round(a * 10000) / 10000);
    return "display";
  }

  var DISPLAY_METHODS = ["init", "close", "clear", "render", "drawCell", "drawText", "getInput", "getWidth", "getHeight", "showGameIntro", "getChar"];
  var GAME_METHODS = ["init", "close", "update", "handleInput", "render", "isOver", "getScore", "getName"];

  // Chaque objet sorti d'une bibliothèque est enveloppé : on voit passer tous les appels faits à travers l'interface.
  function wrapDisplay(d) {
    var w = { raw: d };
    DISPLAY_METHODS.forEach(function (m) {
      w[m] = function () {
        var r = d[m].apply(d, arguments);
        if (m === "getInput") {
          if (r !== Key.UNKNOWN) log(caller + " → display.getInput() = Key::" + r);
          else count(caller + " → display.getInput()");
        } else if (m === "getChar") {
          if (r !== null) log(caller + " → display.getChar() = " + (r >= 32 && r < 127 ? "'" + String.fromCharCode(r) + "'" : r));
          else count(caller + " → display.getChar()  (attend une touche)");
        } else if (m === "init" || m === "close") {
          log(caller + " → display." + m + "()");
        } else if (m === "showGameIntro") {
          log(caller + ' → display.showGameIntro("' + arguments[0] + '")');
        } else if (m === "getWidth" || m === "getHeight") {
          log(caller + " → display." + m + "() = " + r);
        } else {
          count(caller + " → display." + m + "()");
        }
        return r;
      };
    });
    return w;
  }
  function wrapGame(gm) {
    var w = { raw: gm };
    GAME_METHODS.forEach(function (m) {
      w[m] = function () {
        var args = Array.prototype.map.call(arguments, fmtArg).join(", ");
        var quietCall = (m === "update" || m === "render" || (m === "handleInput" && arguments[0] === Key.UNKNOWN));
        var prev = caller; caller = "jeu";
        var r;
        try { r = gm[m].apply(gm, arguments); } finally { caller = prev; }
        if (m === "update") { lastDt = arguments[0]; count(caller + " → game.update(dt)"); }
        else if (m === "isOver" && !r) count(caller + " → game.isOver()");
        else if (quietCall) count(caller + " → game." + m + "(" + args + ")");
        else log(caller + " → game." + m + "(" + args + ")" + (r !== undefined ? " = " + (typeof r === "string" ? '"' + r + '"' : r) : ""), "t-ok");
        return r;
      };
    });
    return w;
  }

  /* ───────────── le faux dossier ./lib et le faux chargeur dynamique ───────────── */

  var gameInstances = 0, displayLoads = 0, swapsSurvived = 0;

  var LIBS = {
    "./lib/arcade_ncurses.so": { createDisplay: function () { return new NcursesDisplay(); } },
    "./lib/arcade_sdl2.so": { createDisplay: function () { return new CanvasDisplay("sdl2"); } },
    "./lib/arcade_sfml.so": { createDisplay: function () { return new CanvasDisplay("sfml"); } },
    "./lib/arcade_snake.so": { createGame: function () { return new A.Snake(); } },
    "./lib/arcade_nibbler.so": { createGame: function () { return new A.Nibbler({ levels: LEVELS }); } },
    "./lib/arcade_minesweeper.so": { createGame: function () { return new A.Minesweeper(); } },
    "./lib/arcade_breakout.so": { createGame: function () { return new A.Breakout(); } }
  };
  var LIB_ORDER = Object.keys(LIBS);
  var nextAddr = 0x5a41c0;
  function shortName(path) { return path.replace("./lib/arcade_", "").replace(".so", ""); }

  var dl = {
    list: function () { return LIB_ORDER.slice(); },
    dlopen: function (path) {
      if (!LIBS[path]) { log('core → dlopen("' + path + '") = NULL', "t-err"); return null; }
      nextAddr += 0x2f0;
      var h = { path: path, addr: "0x7f" + nextAddr.toString(16) };
      if (!QUIET) log('core → dlopen("' + path + '", RTLD_LAZY) = ' + h.addr, "t-in");
      return h;
    },
    dlsym: function (h, name) {
      var fn = LIBS[h.path][name] || null;
      if (!QUIET) log("core → dlsym(" + h.addr + ', "' + name + '")' + (fn ? "" : " = NULL"), "t-in");
      if (!fn) return null;
      return function () {
        log("core → " + name + "()", "t-in");
        var obj = fn();
        if (name === "createGame") { gameInstances++; swapsSurvived = 0; return wrapGame(obj); }
        displayLoads++; if (core && core._game) swapsSurvived++;
        return wrapDisplay(obj);
      };
    },
    dlclose: function (h) { if (!QUIET) log("core → dlclose(" + h.addr + ")   " + shortName(h.path) + " déchargée", "t-in"); }
  };

  /* ───────────── scores.txt : gardé dans le navigateur ───────────── */

  var STORE = "arcade.scores.txt", memFile = "";
  function readFile() {
    try { var v = window.localStorage.getItem(STORE); if (v !== null) memFile = v; } catch (e) { /* stockage indisponible */ }
    return memFile;
  }
  function writeFile(name, text) {
    memFile = text;
    try { window.localStorage.setItem(STORE, text); } catch (e) { /* stockage indisponible */ }
    log('core → écrit scores.txt (' + text.split("\n").filter(Boolean).length + " ligne(s))", "t-in");
    showScores();
  }
  function showScores() {
    $("ar-scores").textContent = memFile || "(fichier vide)";
  }

  /* ───────────── l'horloge : elle s'arrête quand la page ne tourne pas ───────────── */

  var clock = { t: 0, last: null };

  /* ───────────── le programme ───────────── */

  var core = null, running = false, visible = true, onScreen = true, raf = 0;
  var msgEl = $("ar-msg"), statusEl = $("ar-status");

  var env = {
    dl: dl, readFile: readFile, writeFile: writeFile,
    now: function () { return clock.t; },
    exit: function (code) {
      log("le processus se termine (code " + code + ")", "t-err");
      running = false;
      showExit(code);
    },
    onGameOver: function (s) {
      msgEl.textContent = "Partie terminée : " + s[0] + ", " + s[2] + " point" + (s[2] > 1 ? "s" : "") + " pour " + s[1] +
        ". Une ligne est ajoutée à scores.txt et le cœur revient au menu.";
    }
  };

  function launch(lib) {
    screenEl.textContent = "";
    $("ar-exit").hidden = true;
    msgEl.textContent = "";
    clock.t = 0; clock.last = null;
    gameInstances = 0; displayLoads = 0; swapsSurvived = 0;
    log("$ ./arcade " + lib, "t-in");
    $("ar-cmd").textContent = "$ ./arcade " + lib;
    log("core → parcourt ./lib : dlopen, dlsym, dlclose sur chaque .so", "t-dim");
    QUIET = true;
    try {
      core = null;
      var c = new A.Core(lib, envScan());
      core = c;
    } catch (e) {
      log("Error: " + e.message, "t-err");
      QUIET = false;
      return;
    }
    running = true;
    showScores();
    kick();
  }
  // Pendant le parcours de ./lib, on résume au lieu d'écrire 20 lignes dans le journal.
  function envScan() {
    var real = env.dl;
    var e = Object.create(env);
    var scanning = true;
    e.dl = {
      list: function () {
        var l = real.list();
        return l;
      },
      dlopen: function (p) { return real.dlopen(p); },
      dlsym: function (h, n) {
        var r = real.dlsym(h, n);
        if (scanning && r) log("        " + h.path + " : " + (n === "createDisplay" ? "affichage" : "jeu") + "  (symbole " + n + ")", "t-dim");
        return r;
      },
      dlclose: function (h) {
        real.dlclose(h);
        if (scanning && h.path === LIB_ORDER[LIB_ORDER.length - 1]) { scanning = false; QUIET = false; }
      }
    };
    return e;
  }

  function showExit(code) {
    screenEl.textContent = "";
    $("ar-exit").hidden = false;
    $("ar-exit-code").textContent = String(code);
    nameRow(false);
    uiTick(true);
  }

  function activeDisplay() { return core && core._display ? core._display.raw : null; }

  var slowFrames = 0, lastTs = 0;
  function frame(ts) {
    raf = 0;
    if (!running || !visible || !onScreen) { clock.last = null; return; }
    if (clock.last !== null) clock.t += (ts - clock.last) / 1000;
    clock.last = ts;

    // machine lente : on baisse la finesse du canvas
    if (lastTs && canvasScale > 1) {
      slowFrames = (ts - lastTs > 30) ? slowFrames + 1 : Math.max(0, slowFrames - 1);
      if (slowFrames > 45) { canvasScale = 1; slowFrames = 0; var cd = activeDisplay(); if (cd && cd.resize) cd.resize(); }
    }
    lastTs = ts;

    var d = activeDisplay();
    if (d && d.blocking) {
      d.tick(ts); // le cœur est « coincé » dans init() ou showGameIntro() : lui ne tourne pas
    } else {
      frameCounts = {};
      try { core.step(); } catch (e) { log("Error: " + e.message, "t-err"); running = false; }
      lastCounts = frameCounts;
      d = activeDisplay();
      if (running && d && d.blocking) d.tick(ts);
    }
    uiTick(false, ts);
    if (running) raf = requestAnimationFrame(frame);
  }
  function kick() {
    if (!raf && running && visible && onScreen) { lastTs = 0; raf = requestAnimationFrame(frame); }
  }

  /* ───────────── panneaux d'état ───────────── */

  var lastUi = 0;
  function chipsFor(el, list, on, loaded) {
    var html = "";
    list.forEach(function (p, i) {
      html += '<span class="ar-lib' + (i === on ? " is-on" : "") + '">' + shortName(p) +
        (loaded === p ? ' <i title="en mémoire">●</i>' : "") + "</span>";
    });
    if (el._h !== html) { el.innerHTML = html; el._h = html; }
  }
  function setText(el, t) { if (el._t !== t) { el.textContent = t; el._t = t; } }

  function uiTick(force, ts) {
    flushLog();
    if (!force && ts - lastUi < 220) return;
    lastUi = ts || 0;
    if (!core) return;
    var d = activeDisplay(), ended = core.ended;
    var state = ended ? "terminé" : (d && d.blocking) ? (d.libName === "ncurses" ? "bloqué dans display.init()" : "bloqué dans display.showGameIntro()")
      : core._enteringName ? "saisie du nom (display.getChar())" : core._inMenu ? "menu" : "en partie";
    setText($("ar-p-core"), state);
    setText($("ar-p-display"), ended || !core._displayHandle ? "aucune" : core._displayHandle.path);
    setText($("ar-p-display-s"), ended || !core._displayHandle ? "—" : "handle " + core._displayHandle.addr + " · chargement n° " + displayLoads);
    if (core._game && !ended) {
      var gm = core._game.raw;
      setText($("ar-p-game"), core._gameHandle.path);
      setText($("ar-p-game-s"), "instance n° " + gameInstances + " · score " + gm.getScore() +
        (swapsSurvived ? " · a traversé " + swapsSurvived + " changement" + (swapsSurvived > 1 ? "s" : "") + " d'affichage" : ""));
    } else {
      setText($("ar-p-game"), "aucun jeu chargé");
      setText($("ar-p-game-s"), ended ? "—" : "ENTRÉE dans le menu pour en charger un");
    }
    chipsFor($("ar-displays"), core._availableDisplays, ended ? -1 : core._displayIdx, core._displayHandle && core._displayHandle.path);
    chipsFor($("ar-games"), core._availableGames, ended ? -1 : core._gameIdx, core._gameHandle && core._gameHandle.path);

    var st = ended ? "Programme terminé" : state.charAt(0).toUpperCase() + state.slice(1);
    if (!ended && !core._inMenu && core._gameHandle && core._availableGames[core._gameIdx] !== core._gameHandle.path)
      st = "Jeu suivant choisi : " + shortName(core._availableGames[core._gameIdx]) + ". Touche R pour le charger.";
    setText(statusEl, st);

    // appels de la dernière image
    var keys = Object.keys(lastCounts), html = "";
    keys.forEach(function (k) {
      var label = k === "core → game.update(dt)" ? "core → game.update(" + (Math.round(lastDt * 10000) / 10000) + ")" : k;
      html += "<tr><td>" + label.replace(/&/g, "&amp;").replace(/</g, "&lt;") + "</td><td>×" + lastCounts[k] + "</td></tr>";
    });
    if (!keys.length) html = "<tr><td>" + (d && d.blocking ? "le cœur attend que l'affichage rende la main" : "—") + "</td><td></td></tr>";
    var tb = $("ar-calls");
    // les nombres bougent peu : on ne réécrit que si le texte change (dt arrondi pour éviter le clignotement)
    var sig = html.replace(/update\([^)]*\)/, "update(dt)");
    if (tb._s !== sig || force) { tb.innerHTML = html; tb._s = sig; }

    nameRow(!ended && core._enteringName);
  }

  /* ───────────── clavier, boutons, tactile ───────────── */

  function feed(phys) {
    if (!core || core.ended || !running) return;
    var d = activeDisplay();
    if (!d) return;
    msgEl.textContent = "";
    if (d.blocking) { d.onBlockingKey(phys); return; }
    if (core._enteringName) {
      var c = d.toChar(phys);
      if (c !== null) d.chars.push(c);
      return;
    }
    var k = d.mapKey(phys);
    if (k === Key.UNKNOWN) return;
    if (k === Key.N && core._inMenu) nameRow(true, true);
    d.keys.push(k);
    kick();
  }
  function toPhys(e) {
    switch (e.key) {
      case "ArrowUp": return { name: "Up" };
      case "ArrowDown": return { name: "Down" };
      case "ArrowLeft": return { name: "Left" };
      case "ArrowRight": return { name: "Right" };
      case " ": case "Spacebar": return { name: "Space" };
      case "Enter": return { name: "Enter" };
      case "Tab": return { name: "Tab" };
      case "F2": return { name: "F2" };
      case "Escape": return { name: "Escape" };
      case "Backspace": return { name: "Backspace" };
    }
    if (e.key && e.key.length === 1) return { name: "Char", ch: e.key };
    return null;
  }
  screenEl.addEventListener("keydown", function (e) {
    if (!core || core.ended) return;                    // programme terminé : le clavier est rendu à la page
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === "Tab" && e.shiftKey) return;          // Maj + Tab sort toujours de l'écran
    var p = toPhys(e);
    if (!p) return;
    e.preventDefault();
    feed(p);
  });
  screenEl.addEventListener("pointerdown", function () {
    screenEl.focus({ preventScroll: true });
    var d = activeDisplay();
    if (d && d.blocking && d.onPointer) d.onPointer();
  });

  // boutons à l'écran : mêmes touches que le clavier
  document.querySelectorAll("[data-k]").forEach(function (b) {
    function fire() {
      var k = b.getAttribute("data-k");
      feed(k.length === 1 ? { name: "Char", ch: k } : { name: k });
    }
    b.addEventListener("pointerdown", function (e) { e.preventDefault(); fire(); });
    b.addEventListener("click", function (e) { if (e.detail === 0) fire(); }); // activation au clavier
  });

  // saisie du nom sur téléphone : un vrai champ, qui envoie les caractères à display.getChar()
  var nameInput = $("ar-name-input"), nameRowEl = $("ar-name-row");
  function nameRow(show, focus) {
    if (nameRowEl.hidden === !show) { if (show && focus && coarse) nameInput.focus(); return; }
    nameRowEl.hidden = !show;
    if (show && focus && coarse) nameInput.focus();
    if (!show && document.activeElement === nameInput) nameInput.blur();
  }
  nameInput.addEventListener("input", function () {
    var v = nameInput.value; nameInput.value = "";
    for (var i = 0; i < v.length; i++) feed(v[i] === " " ? { name: "Space" } : { name: "Char", ch: v[i] });
  });
  nameInput.addEventListener("keydown", function (e) {
    if (e.key === "Enter") { e.preventDefault(); feed({ name: "Enter" }); }
    else if (e.key === "Backspace") { e.preventDefault(); feed({ name: "Backspace" }); }
    else if (e.key === "Escape") { e.preventDefault(); feed({ name: "Escape" }); }
  });

  document.querySelectorAll("[data-launch]").forEach(function (b) {
    b.addEventListener("click", function () {
      launch(b.getAttribute("data-launch"));
      screenEl.focus({ preventScroll: true });
    });
  });
  $("ar-clear").addEventListener("click", function () {
    memFile = "";
    try { window.localStorage.removeItem(STORE); } catch (e) { /* stockage indisponible */ }
    if (core) core._scores = [];
    showScores();
    log("page → scores.txt effacé", "t-dim");
    kick();
  });

  /* ───────────── on ne tourne que si la scène est visible ───────────── */

  document.addEventListener("visibilitychange", function () {
    visible = !document.hidden;
    if (visible) kick();
  });
  if ("IntersectionObserver" in window) {
    new IntersectionObserver(function (entries) {
      onScreen = entries[0].isIntersecting;
      if (onScreen) kick();
    }, { threshold: 0.02 }).observe($("ar-stage"));
  }

  launch("./lib/arcade_ncurses.so");
})();
