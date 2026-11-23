/* my_torch — cœur du calcul, réécrit en JavaScript depuis le C++ du projet.
   Fonctions pures, sans DOM : elles tournent dans la page et dans node (tests).
   Fichiers d'origine : chess/src/Fen.cpp, ChessEncoder.cpp, ChessGeometry.cpp,
   ChessLabel.cpp, src/Layer.cpp, src/Activations.cpp, src/Network.cpp. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MyTorch = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var POSITIONAL = 774;   // kPositionalFeatureCount
  var GEOMETRY = 276;     // kGeometryFeatureCount
  var INPUT = POSITIONAL + GEOMETRY;  // 1050
  var LABELS = ['Nothing', 'Check White', 'Check Black', 'Checkmate White', 'Checkmate Black'];
  var PIECES = 'pnbrqkPNBRQK';

  /* ───────── Fen.cpp ───────── */

  function validatePlacement(placement) {
    var rankCount = 1, fileSum = 0;
    for (var i = 0; i < placement.length; i++) {
      var c = placement[i];
      if (c === '/') {
        if (fileSum !== 8) throw new Error("Fen: rank does not sum to 8 squares: '" + placement + "'");
        fileSum = 0; rankCount++;
        continue;
      }
      if (c >= '0' && c <= '9') {
        var n = c.charCodeAt(0) - 48;
        if (n < 1 || n > 8) throw new Error("Fen: invalid empty-square count in '" + placement + "'");
        fileSum += n;
        continue;
      }
      if (PIECES.indexOf(c) < 0) throw new Error("Fen: invalid piece letter '" + c + "' in '" + placement + "'");
      fileSum += 1;
    }
    if (fileSum !== 8) throw new Error("Fen: last rank does not sum to 8 squares: '" + placement + "'");
    if (rankCount !== 8) throw new Error("Fen: placement does not have 8 ranks: '" + placement + "'");
  }

  // Une ligne de CHESSFILE : 6 champs FEN, puis (facultatif) la réponse attendue.
  function parseFenLine(line) {
    var tokens = String(line).trim().split(/\s+/).filter(Boolean);
    if (tokens.length < 6) throw new Error('expected at least 6 FEN fields, got ' + tokens.length);
    var fen = {
      placement: tokens[0], activeColor: tokens[1], castling: tokens[2],
      enPassant: tokens[3], halfmove: tokens[4], fullmove: tokens[5],
      expected: null
    };
    validatePlacement(fen.placement);
    if (fen.activeColor !== 'w' && fen.activeColor !== 'b')
      throw new Error("Fen: active color must be 'w' or 'b', got '" + fen.activeColor + "'");
    var extra = tokens.length - 6;
    if (extra > 2) throw new Error('too many trailing tokens after the FEN fields');
    if (extra > 0) {
      // Dataset.cpp : "Check" sans couleur = couleur de l'attaquant (le camp qui n'a pas le trait).
      var state = tokens[6];
      var color = extra === 2 ? tokens[7] : (state === 'Nothing' ? '' : (fen.activeColor === 'w' ? 'Black' : 'White'));
      var label = state === 'Nothing' ? 'Nothing' : state + ' ' + color;
      var idx = LABELS.indexOf(label);
      if (idx < 0)
        throw new Error("invalid expected output '" + tokens.slice(6).join(' ') + "'");
      fen.expected = idx;
    }
    return fen;
  }

  /* ───────── plateau ───────── */

  // index = rank * 8 + file ; rank 0 = rangée du haut (la 8e), file 0 = colonne a.
  function parseBoard(placement) {
    var board = new Array(64).fill('');
    var rank = 0, file = 0;
    for (var i = 0; i < placement.length; i++) {
      var c = placement[i];
      if (c === '/') { rank++; file = 0; continue; }
      if (c >= '0' && c <= '9') { file += c.charCodeAt(0) - 48; continue; }
      if (rank < 8 && file < 8) board[rank * 8 + file] = c;
      file++;
    }
    return board;
  }

  function boardToPlacement(board) {
    var out = '';
    for (var r = 0; r < 8; r++) {
      var empty = 0;
      for (var f = 0; f < 8; f++) {
        var p = board[r * 8 + f];
        if (!p) { empty++; continue; }
        if (empty) { out += empty; empty = 0; }
        out += p;
      }
      if (empty) out += empty;
      if (r < 7) out += '/';
    }
    return out;
  }

  /* ───────── ChessGeometry.cpp ───────── */

  var ROOK = [[-1, 0], [1, 0], [0, -1], [0, 1]];
  var BISHOP = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
  var KNIGHT = [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]];
  var KING = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];

  function onBoard(r, f) { return r >= 0 && r < 8 && f >= 0 && f < 8; }
  function isWhite(c) { return c !== '' && c >= 'A' && c <= 'Z'; }

  // Combien de pièces de la couleur `white` contrôlent chaque case.
  // Une case occupée par une pièce amie compte aussi (elle est défendue).
  // skipSquare : on fait « disparaître » une pièce (le roi) pour voir à travers.
  function countAttacks(board, white, skipSquare) {
    var counts = new Int32Array(64);
    if (skipSquare === undefined) skipSquare = -1;
    for (var sq = 0; sq < 64; sq++) {
      var p = board[sq];
      if (!p || sq === skipSquare || isWhite(p) !== white) continue;
      var r = sq >> 3, f = sq & 7, type = p.toLowerCase(), i, o;
      if (type === 'p') {
        var dr = white ? -1 : 1;
        for (var df = -1; df <= 1; df += 2)
          if (onBoard(r + dr, f + df)) counts[(r + dr) * 8 + f + df]++;
        continue;
      }
      if (type === 'n' || type === 'k') {
        var offs = type === 'n' ? KNIGHT : KING;
        for (i = 0; i < 8; i++) {
          o = offs[i];
          if (onBoard(r + o[0], f + o[1])) counts[(r + o[0]) * 8 + f + o[1]]++;
        }
        continue;
      }
      var dirs = type === 'b' ? BISHOP : type === 'r' ? ROOK : BISHOP.concat(ROOK);
      for (i = 0; i < dirs.length; i++) {
        var rr = r + dirs[i][0], ff = f + dirs[i][1];
        while (onBoard(rr, ff)) {
          var target = rr * 8 + ff;
          counts[target]++;
          if (board[target] && target !== skipSquare) break;
          rr += dirs[i][0]; ff += dirs[i][1];
        }
      }
    }
    return counts;
  }

  function findKing(board, white) {
    return board.indexOf(white ? 'K' : 'k');
  }

  // Cases qui comptent pour dégager le roi : la pièce qui le vise, et les cases vides entre elle et lui.
  function markCheckLines(board, white, kingSquare, out, base) {
    var r = kingSquare >> 3, f = kingSquare & 7, d, i, rr, ff, sq;
    for (d = 0; d < 8; d++) {
      var dr = KING[d][0], df = KING[d][1];
      var diagonal = dr !== 0 && df !== 0;
      var empties = [];
      rr = r + dr; ff = f + df;
      while (onBoard(rr, ff)) {
        sq = rr * 8 + ff;
        if (board[sq]) {
          var type = board[sq].toLowerCase();
          var enemy = isWhite(board[sq]) !== white;
          var slides = diagonal ? (type === 'b' || type === 'q') : (type === 'r' || type === 'q');
          if (enemy && slides) {
            out[base + sq] = 1;
            for (i = 0; i < empties.length; i++) out[base + empties[i]] = 1;
          }
          break;
        }
        empties.push(sq);
        rr += dr; ff += df;
      }
    }
    for (i = 0; i < 8; i++) {
      rr = r + KNIGHT[i][0]; ff = f + KNIGHT[i][1];
      if (!onBoard(rr, ff)) continue;
      sq = rr * 8 + ff;
      if (board[sq] && isWhite(board[sq]) !== white && board[sq].toLowerCase() === 'n') out[base + sq] = 1;
    }
    var pawnDr = white ? -1 : 1;
    for (var k = -1; k <= 1; k += 2) {
      rr = r + pawnDr; ff = f + k;
      if (!onBoard(rr, ff)) continue;
      sq = rr * 8 + ff;
      if (board[sq] && isWhite(board[sq]) !== white && board[sq].toLowerCase() === 'p') out[base + sq] = 1;
    }
  }

  // Écrit les 276 nombres dans out[base ...].
  function encodeGeometry(board, out, base) {
    var whiteAttacks = countAttacks(board, true);
    var blackAttacks = countAttacks(board, false);
    for (var sq = 0; sq < 64; sq++) {
      out[base + sq] = whiteAttacks[sq] > 0 ? 1 : 0;
      out[base + 64 + sq] = blackAttacks[sq] > 0 ? 1 : 0;
    }
    var kings = [
      { white: true, flags: 128, count: 144, attack: 146, lines: 148 },
      { white: false, flags: 136, count: 145, attack: 147, lines: 212 }
    ];
    for (var k = 0; k < 2; k++) {
      var king = kings[k];
      var square = findKing(board, king.white);
      if (square < 0) continue;
      var through = countAttacks(board, !king.white, square);
      var enemyHere = king.white ? blackAttacks : whiteAttacks;
      var r = square >> 3, f = square & 7, viable = 0;
      for (var i = 0; i < 8; i++) {
        var rr = r + KING[i][0], ff = f + KING[i][1];
        if (!onBoard(rr, ff)) continue;
        var target = rr * 8 + ff;
        var occupant = board[target];
        if (occupant && isWhite(occupant) === king.white) continue;
        if (through[target] > 0) continue;
        out[base + king.flags + i] = 1;
        viable++;
      }
      out[base + king.count] = viable / 8;
      var attackers = enemyHere[square];
      out[base + king.attack] = attackers > 4 ? 1 : attackers / 4;
      markCheckLines(board, king.white, square, out, base + king.lines);
    }
  }

  /* ───────── ChessEncoder.cpp ───────── */

  var TYPE_INDEX = { p: 0, n: 1, b: 2, r: 3, q: 4, k: 5 };

  function encodeFen(fen) {
    var x = new Float32Array(INPUT);
    var board = parseBoard(fen.placement);
    for (var sq = 0; sq < 64; sq++) {
      var c = board[sq];
      if (!c) continue;
      var plane = (isWhite(c) ? 0 : 6) + TYPE_INDEX[c.toLowerCase()];
      x[sq * 12 + plane] = 1;
    }
    x[768] = fen.activeColor === 'w' ? 1 : 0;
    x[769] = fen.castling.indexOf('K') >= 0 ? 1 : 0;
    x[770] = fen.castling.indexOf('Q') >= 0 ? 1 : 0;
    x[771] = fen.castling.indexOf('k') >= 0 ? 1 : 0;
    x[772] = fen.castling.indexOf('q') >= 0 ? 1 : 0;
    x[773] = fen.enPassant !== '-' ? 1 : 0;
    encodeGeometry(board, x, POSITIONAL);
    return x;
  }

  // Relit la partie géométrique du vecteur pour l'affichage (aucun calcul en plus).
  function describeGeometry(x, board) {
    var g = POSITIONAL;
    function squares(base) {
      var a = [];
      for (var i = 0; i < 64; i++) if (x[g + base + i] > 0) a.push(i);
      return a;
    }
    function escapes(white, base) {
      var k = findKing(board, white), a = [];
      if (k < 0) return a;
      for (var i = 0; i < 8; i++)
        if (x[g + base + i] > 0) a.push(((k >> 3) + KING[i][0]) * 8 + (k & 7) + KING[i][1]);
      return a;
    }
    return {
      whiteControl: squares(0), blackControl: squares(64),
      whiteKing: findKing(board, true), blackKing: findKing(board, false),
      whiteEscapes: escapes(true, 128), blackEscapes: escapes(false, 136),
      whiteAttackers: Math.round(x[g + 146] * 4), blackAttackers: Math.round(x[g + 147] * 4),
      whiteLine: squares(148), blackLine: squares(212)
    };
  }

  /* ───────── réseau : NetworkIO (version binaire), Layer.cpp, Activations.cpp ───────── */

  // Fichier binaire fait pour cette page à partir du .nn texte du projet :
  // Uint32 [0x4E4E544D, nbCouches, tailles...] puis, par couche, W (IN x OUT, ligne par ligne) et B, en Float32.
  function loadNetwork(buffer) {
    var head = new Uint32Array(buffer, 0, 2);
    if (head[0] !== 0x4E4E544D) throw new Error('fichier réseau non reconnu');
    var n = head[1];
    var sizes = Array.prototype.slice.call(new Uint32Array(buffer, 8, n + 1));
    var offset = 8 + 4 * (n + 1);
    var layers = [];
    for (var l = 0; l < n; l++) {
      var nin = sizes[l], nout = sizes[l + 1];
      var W = new Float32Array(buffer, offset, nin * nout); offset += 4 * nin * nout;
      var B = new Float32Array(buffer, offset, nout); offset += 4 * nout;
      layers.push({ nin: nin, nout: nout, W: W, B: B, activation: l === n - 1 ? 'softmax' : 'relu' });
    }
    if (offset !== buffer.byteLength) throw new Error('fichier réseau tronqué');
    return { sizes: sizes, layers: layers };
  }

  // Passe avant, sans dropout (mode prédiction). Renvoie la sortie de chaque couche.
  function forward(net, input) {
    var a = input, acts = [];
    for (var l = 0; l < net.layers.length; l++) {
      var L = net.layers[l], nout = L.nout, W = L.W, z = new Float64Array(nout), j;
      for (j = 0; j < nout; j++) z[j] = 0;
      // entrée * poids : les entrées à 0 n'apportent rien, on les saute.
      for (var i = 0; i < L.nin; i++) {
        var v = a[i];
        if (v === 0) continue;
        var row = i * nout;
        for (j = 0; j < nout; j++) z[j] += v * W[row + j];
      }
      for (j = 0; j < nout; j++) z[j] += L.B[j];
      if (L.activation === 'relu') {
        for (j = 0; j < nout; j++) if (!(z[j] > 0)) z[j] = 0;
      } else {
        // softmax : on retire le maximum avant exp(), comme dans Activations.cpp.
        var max = z[0], sum = 0;
        for (j = 1; j < nout; j++) if (z[j] > max) max = z[j];
        for (j = 0; j < nout; j++) { z[j] = Math.exp(z[j] - max); sum += z[j]; }
        for (j = 0; j < nout; j++) z[j] /= sum;
      }
      acts.push(z);
      a = z;
    }
    var probs = acts[acts.length - 1], best = 0;
    for (var c = 1; c < probs.length; c++) if (probs[c] > probs[best]) best = c;
    return { acts: acts, probs: probs, cls: best, label: LABELS[best] };
  }

  function predictLine(net, line) {
    return forward(net, encodeFen(parseFenLine(line)));
  }

  return {
    INPUT: INPUT, POSITIONAL: POSITIONAL, GEOMETRY: GEOMETRY, LABELS: LABELS, PIECES: PIECES,
    parseFenLine: parseFenLine, validatePlacement: validatePlacement,
    parseBoard: parseBoard, boardToPlacement: boardToPlacement,
    countAttacks: countAttacks, encodeGeometry: encodeGeometry, encodeFen: encodeFen,
    describeGeometry: describeGeometry, loadNetwork: loadNetwork, forward: forward, predictLine: predictLine
  };
});
