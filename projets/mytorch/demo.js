/* my_torch — interface de la démo. Le calcul est dans core.js (MyTorch). */
(function () {
  'use strict';
  var M = window.MyTorch;
  var $ = function (id) { return document.getElementById(id); };

  // Positions du projet : ex.txt (dépôt) et training_data/test.txt (jeu de test, tiré des données du sujet).
  var PRESETS = [
    { name: 'Départ', line: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1 Nothing' },
    { name: 'Rien à signaler', line: '7k/1n5p/6p1/3PR3/3r4/6P1/7P/7K w - - 0 39 Nothing' },
    { name: 'Échec des blancs', line: '6k1/1R6/1b2rN2/6PK/8/5P2/8/8 b - - 2 70 Check White' },
    { name: 'Échec des noirs', line: '6k1/6p1/1R5p/2b5/8/7P/6P1/6K1 w - - 1 55 Check Black' },
    { name: 'Mat des blancs', line: '6rk/2R5/7Q/1p6/8/1P6/q5PP/6K1 b - - 0 35 Checkmate White' },
    { name: 'Mat des noirs', line: 'R7/5Qpk/8/1p6/4P3/4n2P/6q1/7K w - - 2 45 Checkmate Black' },
    { name: 'Mat en deux coups', line: 'rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3 Checkmate Black' },
    { name: 'Une erreur du réseau', line: '4rQk1/1r5p/2q4B/p7/1n6/8/6PP/3R1RK1 b - - 4 37 Check White' }
  ];
  var GLOSS = [
    'Le réseau ne voit ni échec ni mat.',
    'Les blancs font échec au roi noir.',
    'Les noirs font échec au roi blanc.',
    'Les blancs font échec et mat.',
    'Les noirs font échec et mat.'
  ];
  var CMD = './my_torch_analyzer --predict my_torch_network_chess.nn plateau.txt';

  var state = {
    board: new Array(64).fill(''), active: 'w', castling: '-', ep: '-', half: '0', full: '1',
    expected: null, preset: -1
  };
  var net = null, netError = false;
  var overlay = 'line';
  var sel = -1;          // case choisie au toucher
  var armed = null;      // pièce de la réserve choisie ('x' = gomme)
  var last = null;       // dernier calcul, pour redessiner au changement de taille

  var boardEl = $('mt-board'), trayEl = $('mt-tray'), fenEl = $('mt-fen'), errEl = $('mt-err');
  var squares = [];

  function esc(s) { return String(s).replace(/[&<>]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]; }); }
  function pieceSvg(c) {
    var white = c >= 'A' && c <= 'Z';
    return '<svg viewBox="0 0 45 45" class="' + (white ? 'pw' : 'pb') + '" aria-hidden="true"><use href="#pc-' + c.toLowerCase() + '"/></svg>';
  }
  var NAMES = { p: 'pion', n: 'cavalier', b: 'fou', r: 'tour', q: 'dame', k: 'roi' };
  function pieceName(c) { return NAMES[c.toLowerCase()] + (c >= 'A' && c <= 'Z' ? ' blanc' : ' noir'); }
  function sqName(sq) { return 'abcdefgh'[sq & 7] + (8 - (sq >> 3)); }

  /* ───────── construction ───────── */

  function build() {
    var i, b;
    for (i = 0; i < 64; i++) {
      b = document.createElement('button');
      b.type = 'button';
      b.className = 'mt-sq' + ((((i >> 3) + (i & 7)) & 1) ? ' is-dark' : '');
      b.dataset.sq = i;
      boardEl.appendChild(b);
      squares.push(b);
    }
    var order = 'KQRBNPkqrbnp';
    for (i = 0; i < order.length; i++) {
      b = document.createElement('button');
      b.type = 'button';
      b.dataset.p = order[i];
      b.className = order[i] >= 'a' ? 'mt-b' : '';
      b.setAttribute('aria-pressed', 'false');
      b.setAttribute('aria-label', 'Poser un ' + pieceName(order[i]));
      b.innerHTML = pieceSvg(order[i]);
      trayEl.appendChild(b);
    }
    b = document.createElement('button');
    b.type = 'button'; b.dataset.p = 'x'; b.className = 'mt-erase';
    b.setAttribute('aria-pressed', 'false');
    b.setAttribute('aria-label', 'Gomme : enlever une pièce');
    b.textContent = '✕';
    trayEl.appendChild(b);

    var chips = $('mt-presets');
    PRESETS.forEach(function (p, k) {
      var c = document.createElement('button');
      c.type = 'button'; c.className = 'chip'; c.textContent = p.name;
      c.setAttribute('aria-pressed', 'false');
      c.addEventListener('click', function () { loadLine(p.line, k); });
      chips.appendChild(c);
    });

    var probs = $('mt-probs');
    M.LABELS.forEach(function (l) {
      var row = document.createElement('div');
      row.className = 'mt-prob';
      row.innerHTML = '<span class="mono">' + l + '</span><span class="bar"><i></i></span><b>–</b>';
      probs.appendChild(row);
    });
  }

  /* ───────── état → FEN → calcul ───────── */

  function fenOf(board) {
    return [M.boardToPlacement(board), state.active, state.castling, state.ep, state.half, state.full].join(' ');
  }

  function showError(msg) {
    if (!msg) { errEl.hidden = true; return; }
    var full = /^Fen:/.test(msg) ? msg : 'Dataset: plateau.txt:1: ' + msg;
    errEl.innerHTML = '<span class="t-dim">$ ' + CMD + '</span>\n<span class="t-err">Error: ' + esc(full) + '</span>\n<span class="t-dim">Le programme s\'arrête avec le code 84. Le plateau affiché n\'a pas changé.</span>';
    errEl.hidden = false;
  }

  function loadLine(line, presetIndex) {
    var fen;
    try { fen = M.parseFenLine(line); }
    catch (e) { showError(e.message); return false; }
    showError(null);
    state.board = M.parseBoard(fen.placement);
    state.active = fen.activeColor; state.castling = fen.castling; state.ep = fen.enPassant;
    state.half = fen.halfmove; state.full = fen.fullmove;
    state.expected = fen.expected;
    state.preset = presetIndex === undefined ? -1 : presetIndex;
    sel = -1;
    refresh();
    return true;
  }

  // Après un changement fait à la main : l'étiquette du jeu de données ne vaut plus.
  function edited() {
    state.expected = null; state.preset = -1;
    showError(null);
    refresh();
  }

  function refresh() {
    fenEl.value = fenOf(state.board);
    compute(state.board, -1);
    var chips = $('mt-presets').children;
    for (var i = 0; i < chips.length; i++) chips[i].setAttribute('aria-pressed', i === state.preset ? 'true' : 'false');
    var turn = $('mt-turn').children;
    for (i = 0; i < turn.length; i++) turn[i].setAttribute('aria-pressed', turn[i].dataset.t === state.active ? 'true' : 'false');
  }

  // Encode le plateau, fait la passe avant, met tout l'affichage à jour.
  // lifted : case d'où part la pièce en cours de glissement (aperçu), sinon -1.
  function compute(board, lifted, target) {
    var t0 = performance.now();
    var fen = { placement: M.boardToPlacement(board), activeColor: state.active, castling: state.castling, enPassant: state.ep };
    var x = M.encodeFen(fen);
    var res = net ? M.forward(net, x) : null;
    var ms = performance.now() - t0;
    last = { board: board, x: x, res: res, geo: M.describeGeometry(x, board), ms: ms, lifted: lifted, target: target === undefined ? -1 : target };
    paintBoard();
    paintAnswer();
    paintLayers();
  }

  /* ───────── affichage ───────── */

  function paintBoard() {
    var board = last.board, geo = last.geo, marks = new Array(64).fill(''), i;
    function add(list, cls) { for (var k = 0; k < list.length; k++) marks[list[k]] += ' ' + cls; }
    if (overlay === 'line') {
      add(geo.whiteLine, 'o-line'); add(geo.blackLine, 'o-line');
      add(geo.whiteEscapes, 'o-esc'); add(geo.blackEscapes, 'o-esc');
      if (geo.whiteKing >= 0 && geo.whiteAttackers > 0) marks[geo.whiteKing] += ' o-king';
      if (geo.blackKing >= 0 && geo.blackAttackers > 0) marks[geo.blackKing] += ' o-king';
    } else if (overlay === 'cw') add(geo.whiteControl, 'o-cw');
    else if (overlay === 'cb') add(geo.blackControl, 'o-cb');

    for (i = 0; i < 64; i++) {
      var el = squares[i], p = board[i];
      var cls = 'mt-sq' + ((((i >> 3) + (i & 7)) & 1) ? ' is-dark' : '') + (p ? ' has-piece' : '') + marks[i] +
        (i === sel ? ' is-sel' : '') + (i === last.target ? ' is-target' : '');
      if (el.className !== cls) el.className = cls;
      if (el.dataset.p !== p) {
        el.dataset.p = p;
        var html = p ? pieceSvg(p) : '';
        if ((i & 7) === 0) html += '<span class="mt-coord mt-coord--r">' + (8 - (i >> 3)) + '</span>';
        if ((i >> 3) === 7) html += '<span class="mt-coord mt-coord--f">' + 'abcdefgh'[i & 7] + '</span>';
        el.innerHTML = html;
        el.setAttribute('aria-label', sqName(i) + (p ? ' : ' + pieceName(p) : ' : vide'));
      }
    }

    var lg = $('mt-legend'), html = '';
    function kingText(name, sq, n, escapes) {
      if (sq < 0) return 'Pas de roi ' + name + '.';
      return 'Roi ' + name + ' : ' + (n === 0 ? 'aucune pièce ne le vise' : n === 1 ? '1 pièce le vise' : n + ' pièces le visent') +
        ', ' + (escapes === 0 ? 'aucune fuite' : escapes === 1 ? '1 fuite' : escapes + ' fuites') + '.';
    }
    if (overlay === 'line') {
      html = '<span><i style="background:#E0775F"></i>ligne d\'attaque</span><span><i style="background:#2E8B57;border-radius:50%"></i>fuite du roi</span>' +
        '<span>' + kingText('blanc', geo.whiteKing, geo.whiteAttackers, geo.whiteEscapes.length) + '</span>' +
        '<span>' + kingText('noir', geo.blackKing, geo.blackAttackers, geo.blackEscapes.length) + '</span>';
    } else if (overlay === 'cw') {
      html = '<span><i style="background:#3C96B4"></i>' + geo.whiteControl.length + ' cases tenues par les blancs (une pièce amie défendue compte aussi)</span>';
    } else if (overlay === 'cb') {
      html = '<span><i style="background:#9650AF"></i>' + geo.blackControl.length + ' cases tenues par les noirs (une pièce amie défendue compte aussi)</span>';
    }
    if (lg.innerHTML !== html) lg.innerHTML = html;
  }

  function paintAnswer() {
    var res = last.res, rows = $('mt-probs').children, i;
    if (!res) {
      $('mt-verdict').textContent = '…';
      $('mt-gloss').textContent = netError ? 'Le fichier du réseau n\'a pas pu être chargé. Rechargez la page.' : 'Chargement du réseau (1,2 Mo)…';
      $('mt-term').innerHTML = '<span class="t-in">$ ' + CMD + '</span>';
      return;
    }
    $('mt-verdict').textContent = res.label;
    $('mt-quick').textContent = res.label;
    $('mt-gloss').textContent = GLOSS[res.cls];
    var exp = $('mt-exp');
    if (state.expected !== null && last.lifted < 0 && last.target < 0) {
      var good = state.expected === res.cls;
      exp.innerHTML = 'Étiquette du jeu de données : <span class="mono">' + M.LABELS[state.expected] + '</span>. ' +
        (good ? '<span class="ok">Le réseau a raison.</span>' : '<span class="bad">Le réseau se trompe ici.</span>');
      exp.hidden = false;
    } else exp.hidden = true;
    $('mt-term').innerHTML = '<span class="t-in">$ ' + CMD + '</span>\n' + res.label;
    for (i = 0; i < rows.length; i++) {
      var p = res.probs[i];
      rows[i].className = 'mt-prob' + (i === res.cls ? ' is-on' : '');
      rows[i].querySelector('i').style.transform = 'scaleX(' + Math.max(p, 0.004).toFixed(4) + ')';
      rows[i].querySelector('b').textContent = (p * 100 >= 99.95 ? '100' : (p * 100).toFixed(p < 0.0995 ? 2 : 1)).replace('.', ',') + ' %';
    }
    var ms = last.ms;
    $('mt-status').textContent = 'Encodage et réseau : ' + (ms < 1 ? 'moins de 1 ms' : ms.toFixed(1).replace('.', ',') + ' ms');
  }

  function drawGrid(canvas, n, cols, colorAt) {
    var w = canvas.clientWidth;
    if (!w) return;
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var rows = Math.ceil(n / cols), cell = w / cols, h = Math.round(rows * cell);
    var W = Math.round(w * dpr), H = Math.round(h * dpr);
    if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; canvas.style.height = h + 'px'; }
    var ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, W, H);
    var cw = W / cols, gap = cw > 5 ? 1 : 0.5;
    for (var i = 0; i < n; i++) {
      var cx = (i % cols) * cw, cy = Math.floor(i / cols) * cw;
      ctx.fillStyle = colorAt(i);
      ctx.fillRect(cx, cy, cw - gap, cw - gap);
    }
  }

  function paintLayers() {
    if (!last) return;
    var x = last.x, res = last.res, n0 = 0, i;
    for (i = 0; i < x.length; i++) if (x[i] !== 0) n0++;
    drawGrid($('mt-c0'), x.length, 75, function (k) {
      var v = x[k];
      if (v === 0) return 'rgba(255,255,255,.07)';
      var a = (0.35 + 0.65 * v).toFixed(2);
      return k < M.POSITIONAL ? 'rgba(233,168,85,' + a + ')' : 'rgba(127,183,126,' + a + ')';
    });
    $('mt-n0').textContent = n0 + ' non nuls';
    [[1, 'mt-c1', 'mt-n1'], [2, 'mt-c2', 'mt-n2']].forEach(function (d) {
      var canvas = $(d[1]);
      if (!res) {
        drawGrid(canvas, net ? 0 : (d[0] === 1 ? 256 : 128), 32, function () { return 'rgba(255,255,255,.07)'; });
        return;
      }
      var a = res.acts[d[0] - 1], max = 0, on = 0;
      for (i = 0; i < a.length; i++) { if (a[i] > max) max = a[i]; if (a[i] > 0) on++; }
      drawGrid(canvas, a.length, 32, function (k) {
        if (!(a[k] > 0)) return 'rgba(255,255,255,.07)';
        return 'rgba(233,168,85,' + (0.15 + 0.85 * Math.sqrt(a[k] / max)).toFixed(2) + ')';
      });
      $(d[2]).textContent = on + ' actifs';
    });
  }

  /* ───────── gestes : glisser, toucher ───────── */

  var g = null;       // geste en cours
  var ghost = null, raf = 0;

  function squareAt(x, y) {
    var r = boardEl.getBoundingClientRect();
    if (x < r.left || x >= r.right || y < r.top || y >= r.bottom) return -1;
    var f = Math.min(7, Math.floor((x - r.left) / (r.width / 8)));
    var rk = Math.min(7, Math.floor((y - r.top) / (r.height / 8)));
    return rk * 8 + f;
  }

  function boardAfter(from, to, piece) {
    var b = state.board.slice();
    if (from >= 0) b[from] = '';
    if (to >= 0) b[to] = piece;
    return b;
  }

  function onDown(e) {
    if (g || (e.pointerType === 'mouse' && e.button !== 0)) return;
    var t = e.target.closest('button');
    if (!t) return;
    var from = -1, piece = '';
    if (t.parentNode === boardEl) { from = +t.dataset.sq; piece = state.board[from]; }
    else if (t.parentNode === trayEl) { piece = t.dataset.p === 'x' ? '' : t.dataset.p; }
    else return;
    g = { id: e.pointerId, from: from, tray: t.parentNode === trayEl ? t.dataset.p : null, piece: piece,
      x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, drag: false, over: -2 };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
  }

  function startDrag() {
    g.drag = true;
    sel = -1;
    var size = squares[0].getBoundingClientRect().width;
    ghost = document.createElement('div');
    ghost.className = 'mt-ghost';
    ghost.style.width = ghost.style.height = size * 1.15 + 'px';
    ghost.innerHTML = pieceSvg(g.piece);
    document.body.appendChild(ghost);
    if (g.from >= 0) squares[g.from].classList.add('is-lifted');
    tick();
  }

  // Une seule mise à jour par image : le fantôme suit le doigt, le calcul ne part que si la case change.
  function tick() {
    raf = 0;
    if (!g || !g.drag) return;
    var half = ghost.offsetWidth / 2;
    ghost.style.transform = 'translate(' + (g.x - half) + 'px,' + (g.y - half) + 'px)';
    var over = squareAt(g.x, g.y);
    if (over !== g.over) {
      g.over = over;
      if (g.from < 0 && over < 0) compute(state.board, -1);
      else compute(boardAfter(g.from, over, g.piece), g.from, over === g.from ? -1 : over);
      if (g.from >= 0 && over !== g.from) squares[g.from].classList.add('is-lifted');
    }
  }

  function onMove(e) {
    if (!g || e.pointerId !== g.id) return;
    g.x = e.clientX; g.y = e.clientY;
    if (!g.drag) {
      if (!g.piece) return;
      var dx = g.x - g.x0, dy = g.y - g.y0;
      if (dx * dx + dy * dy < 36) return;
      startDrag();
      return;
    }
    e.preventDefault();
    if (!raf) raf = requestAnimationFrame(tick);
  }

  function endGesture() {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onCancel);
    if (raf) { cancelAnimationFrame(raf); raf = 0; }
    if (ghost) { ghost.remove(); ghost = null; }
    g = null;
  }

  function onUp(e) {
    if (!g || e.pointerId !== g.id) return;
    var cur = g;
    if (cur.drag) {
      var over = squareAt(e.clientX, e.clientY);
      endGesture();
      if (cur.from < 0 && over < 0) { refresh(); return; }       // pièce de la réserve lâchée hors du plateau
      if (over === cur.from) { refresh(); return; }
      state.board = boardAfter(cur.from, over, cur.piece);
      edited();
      return;
    }
    endGesture();
    if (cur.tray !== null) tapTray(cur.tray);
    else tapSquare(cur.from);
  }

  function onCancel(e) {
    if (!g || e.pointerId !== g.id) return;
    endGesture();
    refresh();
  }

  function tapSquare(sq) {
    if (armed !== null) {
      var p = armed === 'x' ? '' : armed;
      if (state.board[sq] === p) return;
      state.board[sq] = p;
      edited();
      return;
    }
    if (sel >= 0) {
      if (sq !== sel) {
        state.board = boardAfter(sel, sq, state.board[sel]);
        sel = -1;
        edited();
        return;
      }
      sel = -1;
    } else if (state.board[sq]) sel = sq;
    paintBoard();
  }

  function tapTray(p) {
    armed = armed === p ? null : p;
    sel = -1;
    var btns = trayEl.children;
    for (var i = 0; i < btns.length; i++) btns[i].setAttribute('aria-pressed', btns[i].dataset.p === armed ? 'true' : 'false');
    paintBoard();
  }

  /* ───────── branchements ───────── */

  function init() {
    build();
    boardEl.addEventListener('pointerdown', onDown);
    trayEl.addEventListener('pointerdown', onDown);
    // Clavier : Entrée ou Espace sur une case ou une pièce de la réserve (clic sans pointeur).
    boardEl.addEventListener('click', function (e) {
      var t = e.target.closest('button');
      if (t && e.detail === 0) tapSquare(+t.dataset.sq);
    });
    trayEl.addEventListener('click', function (e) {
      var t = e.target.closest('button');
      if (t && e.detail === 0) tapTray(t.dataset.p);
    });
    boardEl.addEventListener('dragstart', function (e) { e.preventDefault(); });

    $('mt-overlay').addEventListener('click', function (e) {
      var t = e.target.closest('button');
      if (!t) return;
      overlay = t.dataset.o;
      var c = this.children;
      for (var i = 0; i < c.length; i++) c[i].setAttribute('aria-pressed', c[i] === t ? 'true' : 'false');
      paintBoard();
    });
    $('mt-turn').addEventListener('click', function (e) {
      var t = e.target.closest('button');
      if (!t || t.dataset.t === state.active) return;
      state.active = t.dataset.t;
      edited();
    });
    function go() { loadLine(fenEl.value); }
    $('mt-go').addEventListener('click', go);
    fenEl.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); go(); } });

    var pending = 0;
    if (window.ResizeObserver) {
      new ResizeObserver(function () {
        if (pending) return;
        pending = requestAnimationFrame(function () { pending = 0; paintLayers(); });
      }).observe($('mt-c0').parentNode);
    }

    loadLine(PRESETS[4].line, 4);

    fetch('reseau.bin').then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.arrayBuffer();
    }).then(function (buf) {
      net = M.loadNetwork(buf);
      if (!g) refresh();
    }).catch(function () {
      netError = true;
      $('mt-status').textContent = 'Réseau non chargé';
      paintAnswer();
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
