/* Tests des règles (node tests.js). La comparaison avec les vrais jeux C++ est faite à part. */
const assert = require('assert');
const A = require('./core.js');
const LEVELS = require('./levels.js');
const K = A.Key;
let n = 0; function test(name, fn) { fn(); n++; console.log('ok  ' + name); }
function lcg(seed) { let s = seed >>> 0; return () => { s = (Math.imul(s, 1103515245) + 12345) & 0x7fffffff; return s; }; }
function steps(g, k, dt) { for (let i = 0; i < k; i++) g.update(dt); }

test('Snake : départ au centre, 4 segments, vers la droite', () => {
  const g = new A.Snake({ rand: lcg(1) }); g.init(30, 25);
  assert.deepStrictEqual(g._body, [[15, 12], [14, 12], [13, 12], [12, 12]]);
  assert.ok(!g.isWall(g._food[0], g._food[1]) && !g.isOnBody(g._food[0], g._food[1]));
});
test('Snake : avance d\'une case toutes les 0,2 s, pas à chaque image', () => {
  const g = new A.Snake({ rand: lcg(1) }); g.init(); g._food = [1, 1];
  g.update(0.1); assert.strictEqual(g._body[0][0], 15);
  g.update(0.11); assert.strictEqual(g._body[0][0], 16);
  assert.strictEqual(g._body.length, 4);
});
test('Snake : demi-tour interdit', () => {
  const g = new A.Snake({ rand: lcg(1) }); g.init();
  g.handleInput(K.LEFT); assert.strictEqual(g._nextDir, 'RIGHT');
  g.handleInput(K.UP); assert.strictEqual(g._nextDir, 'UP');
});
test('Snake : manger = +10, grandit, accélère de 0,01 s', () => {
  const g = new A.Snake({ rand: lcg(1) }); g.init(); g._food = [16, 12];
  g.update(0.25);
  assert.strictEqual(g.getScore(), 10); assert.strictEqual(g._body.length, 5);
  assert.ok(Math.abs(g._baseSpeed - 0.19) < 1e-6);
});
test('Snake : la vitesse ne descend pas sous 0,05 s', () => {
  const g = new A.Snake({ rand: lcg(1) }); g.init();
  for (let i = 0; i < 40; i++) { g._food = [g._body[0][0] + 1, 12]; if (g._food[0] >= 29) break; g.update(1); }
  const g2 = new A.Snake({ rand: lcg(1) }); g2.init(); g2._baseSpeed = Math.fround(0.05);
  g2._food = [16, 12]; g2.update(1); assert.ok(g2._baseSpeed >= 0.04 && g2._baseSpeed <= 0.0501);
});
test('Snake : mur = perdu ; se mordre = perdu', () => {
  const g = new A.Snake({ rand: lcg(1) }); g.init(); g._food = [1, 1];
  steps(g, 20, 0.25); assert.ok(g.isOver());
  const h = new A.Snake({ rand: lcg(1) }); h.init(); h._food = [1, 1];
  h._body = [[10, 10], [9, 10], [9, 11], [10, 11], [11, 11], [11, 10]]; h._dir = 'RIGHT'; h._nextDir = 'RIGHT';
  h.update(0.25); assert.ok(h.isOver());
});
test('Snake : ESPACE bascule le turbo (x0,4)', () => {
  const g = new A.Snake({ rand: lcg(1) }); g.init();
  g.handleInput(K.SPACE); assert.ok(Math.abs(g._speed - 0.08) < 1e-6);
  g.handleInput(K.SPACE); assert.ok(Math.abs(g._speed - 0.2) < 1e-6);
});
test('Snake : la pomme change de place après 7 s', () => {
  const g = new A.Snake({ rand: lcg(3) }); g.init(); const before = g._food.slice(); g._speed = 100;
  g.update(7.5); assert.notDeepStrictEqual(g._food, before);
});

test('Nibbler : 32 niveaux de 30 x 25, départ libre partout', () => {
  assert.strictEqual(LEVELS.length, 32);
  LEVELS.forEach((m, i) => {
    assert.strictEqual(m.length, 25); m.forEach(r => assert.strictEqual(r.length, 30));
    for (let x = 12; x <= 16; x++) assert.strictEqual(m[23][x], ' ', 'niveau ' + (i + 1));
  });
  assert.deepStrictEqual(LEVELS[0], A.NIBBLER_BASE_MAP);
});
test('Nibbler : 6 pommes au niveau 1, posées sur des cases libres', () => {
  const g = new A.Nibbler({ rand: lcg(2), levels: LEVELS }); g.init();
  assert.strictEqual(g._food.length, 6);
  g._food.forEach(f => assert.ok(!g.isWall(f[0], f[1]) && !g.isOnBody(f[0], f[1])));
});
test('Nibbler : un seul côté libre = virage automatique', () => {
  const g = new A.Nibbler({ rand: lcg(2), levels: LEVELS }); g.init(); g._food = [[1, 1]];
  // tête en (28,23) vers la droite : mur devant, mur en bas, libre en haut
  g._body = [[28, 23], [27, 23], [26, 23], [25, 23]];
  g.update(0.25);
  assert.deepStrictEqual(g._body[0], [28, 22]); assert.strictEqual(g._dir, 'UP'); assert.ok(!g.isOver());
});
test('Nibbler : carrefour en T = attente, puis perdu après 3 s', () => {
  const g = new A.Nibbler({ rand: lcg(2), levels: LEVELS }); g.init(); g._food = [[1, 1]];
  g._body = [[28, 12], [27, 12], [26, 12], [25, 12]].map(p => [p[0], 11]); // ligne 11 libre, mur à droite
  g.update(0.25); assert.ok(g._waiting); assert.deepStrictEqual(g._body[0], [28, 11]);
  g.update(1); assert.ok(!g.isOver());
  g.update(2.1); assert.ok(g.isOver());
});
test('Nibbler : au carrefour, choisir un côté fait repartir le serpent', () => {
  const g = new A.Nibbler({ rand: lcg(2), levels: LEVELS }); g.init(); g._food = [[1, 1]];
  g._body = [[28, 11], [27, 11], [26, 11], [25, 11]];
  g.update(0.25); assert.ok(g._waiting);
  g.handleInput(K.UP); g.update(0.016); assert.ok(!g._waiting);
  g.update(0.016); assert.deepStrictEqual(g._body[0], [28, 10]);
});
test('Nibbler : cul-de-sac = perdu', () => {
  const g = new A.Nibbler({ rand: lcg(2), levels: LEVELS }); g.init(); g._food = [[1, 1]];
  g._map = g._map.slice(); g._map[22] = '#                          # #'; g._map[21] = '#                          ###';
  g._body = [[28, 22], [28, 23], [27, 23], [26, 23]]; g._dir = 'UP'; g._nextDir = 'UP';
  g.update(0.25); assert.ok(g.isOver());
});
test('Nibbler : score = 10 x niveau ; dernier fruit = niveau suivant avec 3 pommes de plus', () => {
  const g = new A.Nibbler({ rand: lcg(2), levels: LEVELS }); g.init();
  g._food = [[16, 23]]; g._foodLeft = 1;
  g.update(0.25);
  assert.strictEqual(g.getScore(), 10); assert.strictEqual(g._level, 2);
  assert.strictEqual(g._foodLeft, 9); assert.strictEqual(g._food.length, 9);
  assert.deepStrictEqual(g._map, LEVELS[1]); assert.strictEqual(g._body.length, 4);
  g._food = [[16, 23]]; g._foodLeft = 5; g.update(0.25); assert.strictEqual(g.getScore(), 30);
});
test('Nibbler : finir le niveau 32 = gagné', () => {
  const g = new A.Nibbler({ rand: lcg(2), levels: LEVELS }); g.init();
  g._level = 32; g.loadLevel(); g._food = [[16, 23]]; g._foodLeft = 1;
  g.update(0.25); assert.ok(g._won && g.isOver());
});

test('Minesweeper : 70 mines, jamais sur le premier clic ni autour', () => {
  for (let s = 1; s <= 30; s++) {
    const g = new A.Minesweeper({ rand: lcg(s) }); g.init();
    for (let i = 0; i < s % 9; i++) g.handleInput(K.LEFT);
    g.handleInput(K.SPACE);
    let mines = 0;
    g._grid.forEach((row, y) => row.forEach((c, x) => {
      if (c.mine) { mines++; assert.ok(Math.abs(x - g._curX) > 1 || Math.abs(y - g._curY) > 1); }
    }));
    assert.strictEqual(mines, 70); assert.ok(!g.isOver() || g._won);
  }
});
test('Minesweeper : chiffres = mines voisines ; 10 points par case révélée', () => {
  const g = new A.Minesweeper({ rand: lcg(5) }); g.init(); g.handleInput(K.SPACE);
  let revealed = 0;
  g._grid.forEach((row, y) => row.forEach((c, x) => {
    if (c.revealed) revealed++;
    if (c.mine) return;
    let k = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const r = g._grid[y + dy]; if (r && r[x + dx] && r[x + dx].mine) k++;
    }
    assert.strictEqual(c.adjacent, k);
  }));
  assert.ok(revealed >= 9); assert.strictEqual(g.getScore(), revealed * 10);
});
test('Minesweeper : drapeau protège la case ; mine = perdu ; curseur borné', () => {
  const g = new A.Minesweeper({ rand: lcg(5) }); g.init(); g.handleInput(K.SPACE);
  let mx = -1, my = -1;
  g._grid.forEach((row, y) => row.forEach((c, x) => { if (c.mine && mx < 0) { mx = x; my = y; } }));
  g._curX = mx; g._curY = my;
  g.handleInput(K.ENTER); g.handleInput(K.SPACE); assert.ok(!g.isOver());
  g.handleInput(K.ENTER); g.handleInput(K.SPACE); assert.ok(g.isOver() && !g._won);
  const h = new A.Minesweeper({ rand: lcg(5) }); h.init();
  for (let i = 0; i < 40; i++) { h.handleInput(K.LEFT); h.handleInput(K.UP); }
  assert.deepStrictEqual([h._curX, h._curY], [0, 0]);
});
test('Minesweeper : tout révéler sauf les mines = gagné', () => {
  const g = new A.Minesweeper({ rand: lcg(9) }); g.init(); g.handleInput(K.SPACE);
  g._grid.forEach((row, y) => row.forEach((c, x) => { if (!c.mine && !c.revealed) { g._curX = x; g._curY = y; g.handleInput(K.SPACE); } }));
  assert.ok(g._won); assert.strictEqual(g.getScore(), (26 * 18 - 70) * 10);
});

test('Breakout : la balle suit la raquette avant le lancer ; ESPACE lance', () => {
  const g = new A.Breakout({ rand: lcg(4) }); g.init();
  g.handleInput(K.RIGHT); steps(g, 10, 0.05);
  assert.strictEqual(g._ballX, Math.trunc(g._paddleX) + 2); assert.strictEqual(g._ballY, 21);
  g.handleInput(K.SPACE); assert.ok(g._launched && !g._rightHeld);
});
test('Breakout : raquette bornée entre 1 et 24', () => {
  const g = new A.Breakout({ rand: lcg(4) }); g.init();
  g.handleInput(K.LEFT); steps(g, 100, 0.05); assert.strictEqual(g._paddleX, 1);
  g.handleInput(K.RIGHT); steps(g, 100, 0.05); assert.strictEqual(g._paddleX, 24);
});
test('Breakout : une brique du haut vaut 50, du bas 10 ; 3 vies', () => {
  const g = new A.Breakout({ rand: lcg(4) }); g.init();
  assert.ok(g.checkBrickAt(5, 2)); assert.strictEqual(g.getScore(), 50);
  assert.ok(g.checkBrickAt(5, 6)); assert.strictEqual(g.getScore(), 60);
  assert.ok(!g.checkBrickAt(5, 6));
  const h = new A.Breakout({ rand: lcg(4) }); h.init();
  for (let i = 0; i < 20000 && !h.isOver(); i++) { if (!h._launched) h.handleInput(K.SPACE); h.update(0.05); }
  assert.ok(h.isOver()); assert.strictEqual(h._lives, 0);
});

test('scores.txt : même lecture que le C++ (trois mots par ligne)', () => {
  const s = A.parseScores('Nibbler Unknown 510\nBreakout Unknown 60\nBreakout Bob 40\n');
  assert.deepStrictEqual(s, [['Nibbler', 'Unknown', 510], ['Breakout', 'Unknown', 60], ['Breakout', 'Bob', 40]]);
  assert.strictEqual(A.formatScores(s), 'Nibbler Unknown 510\nBreakout Unknown 60\nBreakout Bob 40\n');
  assert.deepStrictEqual(A.bestScores(s), [['Breakout', 'Unknown', 60], ['Nibbler', 'Unknown', 510]]);
  assert.deepStrictEqual(A.parseScores('Snake Jean Paul 30\nSnake A 10\n'), []); // un nom avec espace arrête la lecture
});

// Le cœur, avec un faux affichage et un faux chargeur
function makeEnv(keys) {
  const calls = []; let file = 'Snake Zed 30\n'; let t = 0; const st = { exit: null };
  const disp = () => ({
    init() { calls.push('d.init'); }, close() { calls.push('d.close'); }, clear() {}, render() {},
    drawCell() {}, drawText(x, y, s) { st.text = (st.text || '') + s + '\n'; },
    getInput() { return keys.length ? keys.shift() : K.UNKNOWN; }, getChar() { return st.chars && st.chars.length ? st.chars.shift() : null; },
    getWidth() { return 30; }, getHeight() { return 25; }, showGameIntro(n) { calls.push('intro ' + n); }
  });
  const libs = { 'a.so': { createDisplay: disp }, 'b.so': { createDisplay: disp },
    'snake.so': { createGame: () => new A.Snake({ rand: lcg(1) }) }, 'mine.so': { createGame: () => new A.Minesweeper({ rand: lcg(1) }) }, 'x.txt': {} };
  const env = { dl: { list: () => Object.keys(libs), dlopen: p => { calls.push('open ' + p); return { p }; },
    dlsym: (h, nme) => libs[h.p][nme] || null, dlclose: h => calls.push('close ' + h.p) },
    readFile: () => file, writeFile: (nme, txt) => { file = txt; }, now: () => (t += 0.25), exit: c => { st.exit = c; } };
  return { env, calls, st, file: () => file };
}
test('Cœur : trie les .so par symbole, charge l\'affichage demandé', () => {
  const e = makeEnv([]); const c = new A.Core('b.so', e.env);
  assert.deepStrictEqual(c._availableDisplays, ['a.so', 'b.so']); assert.deepStrictEqual(c._availableGames, ['snake.so', 'mine.so']);
  assert.strictEqual(c._displayIdx, 1); assert.ok(!e.calls.includes('open x.txt'));
  assert.deepStrictEqual(c._scores, [['Snake', 'Zed', 30]]);
});
test('Cœur : changer d\'affichage en partie garde la même instance de jeu', () => {
  const e = makeEnv([K.ENTER, K.UNKNOWN, K.NEXT_LIB, K.UNKNOWN]); const c = new A.Core('a.so', e.env);
  c.step(); assert.ok(!c._inMenu); assert.ok(e.calls.includes('intro Snake'));
  c.step(); const game = c._game, head = JSON.stringify(game._body);
  e.calls.length = 0; c.step();
  assert.deepStrictEqual(e.calls, ['d.close', 'close a.so', 'open b.so', 'd.init']);
  assert.strictEqual(c._game, game); assert.strictEqual(JSON.stringify(game._body), head);
  c.step(); assert.strictEqual(game._body[0][0], 17);
});
test('Cœur : F2 ne charge rien, R charge le jeu choisi', () => {
  const e = makeEnv([K.ENTER, K.NEXT_GAME, K.RESTART]); const c = new A.Core('a.so', e.env);
  c.step(); c.step(); assert.strictEqual(c._game.getName(), 'Snake'); assert.strictEqual(c._gameIdx, 1);
  c.step(); assert.strictEqual(c._game.getName(), 'Minesweeper');
});
test('Cœur : fin de partie = score ajouté à scores.txt et retour au menu', () => {
  const e = makeEnv([K.ENTER]); const c = new A.Core('a.so', e.env);
  for (let i = 0; i < 80 && (i === 0 || !c._inMenu); i++) c.step();
  assert.ok(c._inMenu); assert.strictEqual(e.file(), 'Snake Zed 30\nSnake Unknown 0\n');
  e.st.text = ''; c.step(); assert.ok(e.st.text.includes('Snake  ->  Zed  30'));
});
test('Cœur : saisie du nom (N, lettres, retour arrière, ENTREE), 20 caractères au plus', () => {
  const e = makeEnv([K.N]); const c = new A.Core('a.so', e.env);
  c.step(); assert.ok(c._enteringName);
  e.st.chars = [65, 98, 99, 127, 13]; for (let i = 0; i < 6; i++) c.step();
  assert.strictEqual(c._playerName, 'Ab'); assert.ok(!c._enteringName);
  e.st.chars = []; c._enteringName = true; c._playerName = '';
  for (let i = 0; i < 30; i++) e.st.chars.push(97); for (let i = 0; i < 31; i++) c.step();
  assert.strictEqual(c._playerName.length, 20);
});
test('Cœur : Q en partie décharge tout puis quitte', () => {
  const e = makeEnv([K.ENTER, K.EXIT]); const c = new A.Core('a.so', e.env);
  c.step(); e.calls.length = 0; assert.strictEqual(c.step(), false);
  assert.deepStrictEqual(e.calls, ['d.close', 'close a.so', 'close snake.so']); assert.strictEqual(e.st.exit, 0);
});
console.log('\n' + n + ' tests réussis');
