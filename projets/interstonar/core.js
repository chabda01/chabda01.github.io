/* Interstonar — cœur du calcul, réécrit en JavaScript depuis le C++ du projet.
   Chaque fonction suit le fichier d'origine indiqué. Aucun accès au DOM. */
(function (root) {
  'use strict';

  var G = 6.674e-11;        // GlobalSim.cpp
  var MAX_STEPS = 1000;     // GlobalSim.cpp et LocalSim.cpp
  var SDF_HIT = 0.1;        // LocalSim.cpp
  var SDF_OUT = 1000.0;     // LocalSim.cpp

  function SimError(msg) { this.message = msg; }

  /* ───── std::stod : lit le plus long nombre en tête de chaîne ───── */
  var RE_NUM = /^[ \t\n\v\f\r]*([+-]?(?:\d+\.?\d*(?:[eE][+-]?\d+)?|\.\d+(?:[eE][+-]?\d+)?))/;
  var RE_INF = /^[ \t\n\v\f\r]*([+-]?)(infinity|inf|nan)/i;
  function stod(s) {
    var m = RE_NUM.exec(s);
    if (m) {
      var v = Number(m[1]);
      if (!isFinite(v)) throw new SimError('stod');
      return v;
    }
    m = RE_INF.exec(s);
    if (m) {
      if (m[2].toLowerCase() === 'nan') return NaN;
      return m[1] === '-' ? -Infinity : Infinity;
    }
    throw new SimError('stod');
  }

  /* ───── Vec3.cpp ───── */
  function vlen(x, y, z) { return Math.sqrt(x * x + y * y + z * z); }

  /* ───── Args.cpp ───── */
  var HELP =
    'USAGE\n' +
    '    ./interstonar [--global | --local] CONFIG_FILE [-d TIME | --delta=TIME] Px Py Pz Vx Vy Vz\n\n' +
    'DESCRIPTION\n' +
    '    --global\n        Launch in global mode (moving celestial bodies)\n\n' +
    '    --local\n        Launch in local mode (static shapes, ray marching)\n\n' +
    '    -d TIME, --delta=TIME\n        Global only. Time step in seconds (default: 1)\n\n' +
    '    CONFIG_FILE\n        TOML file describing the scene\n\n' +
    '    Px Py Pz\n        Initial position of the rock\n\n' +
    '    Vx Vy Vz\n        Initial velocity of the rock\n';

  // argv : les arguments sans le nom du programme.
  function parseArgs(argv) {
    var a = { mode: 0, config: '', delta: 1.0, pos: [0, 0, 0], vel: [0, 0, 0], help: false };
    var nums = [], deltaSet = false, sawG = false, sawL = false;
    if (argv.length === 1 && argv[0] === '--help') { a.help = true; return a; }
    for (var i = 0; i < argv.length; i++) {
      var arg = argv[i], c = arg.charAt(0);
      if (arg === '--global') { sawG = true; a.mode = 1; }
      else if (arg === '--local') { sawL = true; a.mode = 2; }
      else if (arg === '-d' && i + 1 < argv.length) { deltaSet = true; a.delta = stod(argv[++i]); }
      else if (arg.lastIndexOf('--delta=', 0) === 0) { deltaSet = true; a.delta = stod(arg.slice(8)); }
      else if (nums.length < 6 && (c === '-' || (c >= '0' && c <= '9'))) nums.push(stod(arg));
      else a.config = arg;
    }
    if (a.mode === 0 || a.config === '' || nums.length < 6) throw new SimError('missing arguments');
    if (sawG && sawL) throw new SimError('cannot use --global and --local together');
    if (a.mode === 2 && deltaSet) throw new SimError('--delta is only valid in global mode');
    if (a.mode === 1 && deltaSet && a.delta <= 0) throw new SimError('delta must be positive');
    a.pos = [nums[0], nums[1], nums[2]];
    a.vel = [nums[3], nums[4], nums[5]];
    return a;
  }

  /* ───── Body.cpp ───── */
  function newBody() {
    return { name: '', pos: [0, 0, 0], radius: 0, vel: [0, 0, 0], mass: 0,
             type: '', sides: [0, 0, 0], height: -1, inner_r: 0, outer_r: 0 };
  }

  function sdf(b, px, py, pz) {
    var x = px - b.pos[0], y = py - b.pos[1], z = pz - b.pos[2];
    if (b.type === 'sphere') return vlen(x, y, z) - b.radius;
    if (b.type === 'cylinder') {
      var dxy = Math.sqrt(x * x + y * y) - b.radius;
      if (b.height < 0) return dxy;
      var dz = Math.abs(z) - b.height / 2;
      var ox = Math.max(dxy, 0), oz = Math.max(dz, 0);
      return Math.min(Math.max(dxy, dz), 0) + Math.sqrt(ox * ox + oz * oz);
    }
    if (b.type === 'box') {
      var qx = Math.abs(x) - b.sides[0] / 2, qy = Math.abs(y) - b.sides[1] / 2, qz = Math.abs(z) - b.sides[2] / 2;
      var bx = Math.max(qx, 0), by = Math.max(qy, 0), bz = Math.max(qz, 0);
      return Math.sqrt(bx * bx + by * by + bz * bz) + Math.min(Math.max(qx, Math.max(qy, qz)), 0);
    }
    if (b.type === 'torus') {
      var tx = Math.sqrt(x * x + y * y) - b.inner_r;
      return Math.sqrt(tx * tx + z * z) - b.outer_r;
    }
    return 1e18;
  }

  /* ───── Scene.cpp ───── */
  function trim(s) {
    var a = 0, b = s.length;
    while (a < b && ' \t\r\n'.indexOf(s.charAt(a)) >= 0) a++;
    while (b > a && ' \t\r\n'.indexOf(s.charAt(b - 1)) >= 0) b--;
    return s.slice(a, b);
  }
  function parseNumber(s) { return stod(s.split('_').join('')); }
  function parseString(s) {
    var a = s.indexOf('"'), b = s.lastIndexOf('"');
    if (a < 0 || a === b) return '';
    return s.slice(a + 1, b);
  }
  function parseVec(s) {
    function extract(axis) {
      var p = s.indexOf(axis + ' =');
      if (p < 0) p = s.indexOf(axis + '=');
      if (p < 0) return 0;
      var eq = s.indexOf('=', p);
      return parseNumber(trim(s.slice(eq + 1)));
    }
    return [extract('x'), extract('y'), extract('z')];
  }
  function applyKeyValue(b, key, value) {
    var k = trim(key), v = trim(value);
    if (k === 'name') b.name = parseString(v);
    else if (k === 'type') b.type = parseString(v);
    else if (k === 'mass') b.mass = parseNumber(v);
    else if (k === 'radius') b.radius = parseNumber(v);
    else if (k === 'height') b.height = parseNumber(v);
    else if (k === 'inner_radius') b.inner_r = parseNumber(v);
    else if (k === 'outer_radius') b.outer_r = parseNumber(v);
    else if (k === 'position') b.pos = parseVec(v);
    else if (k === 'direction') b.vel = parseVec(v);
    else if (k === 'sides') b.sides = parseVec(v);
  }
  // text : contenu du fichier ; filename : sert au message d'erreur ; mode : 1 global, 2 local.
  function parseScene(text, filename, mode) {
    var bodies = [], cur = null;
    var lines = text.split('\n');
    if (lines.length && lines[lines.length - 1] === '') lines.pop();
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      var c = line.indexOf('#');
      if (c >= 0) line = line.slice(0, c);
      line = trim(line);
      if (line === '') continue;
      if (line.lastIndexOf('[[body]]', 0) === 0) {
        if (cur) bodies.push(cur);
        cur = newBody();
        continue;
      }
      var eq = line.indexOf('=');
      if (eq >= 0 && cur) applyKeyValue(cur, line.slice(0, eq), line.slice(eq + 1));
    }
    if (cur) bodies.push(cur);
    if (!bodies.length) throw new SimError('no valid bodies in file: ' + filename);
    if (mode === 2) {
      for (var j = 0; j < bodies.length; j++) {
        if (bodies[j].name === '' && bodies[j].type !== '') {
          var n = 0;
          for (var q = 0; q < j; q++) if (bodies[q].type === bodies[j].type) n++;
          bodies[j].name = bodies[j].type.replace(/[a-z]/g, function (ch) { return ch.toUpperCase(); }) + '_' + (n + 1);
        }
      }
    }
    return bodies;
  }

  /* ───── affichage des nombres ───── */
  // std::llround puis séparateur de milliers (GlobalSim::printInt).
  function fmtInt(v) {
    var digits, neg = false;
    if (!(Math.abs(v) < 9223372036854775808)) { neg = true; digits = '-9223372036854775808'; }
    else {
      var r = Math.round(Math.abs(v));        // arrondi au plus proche, moitié loin de zéro
      neg = v < 0 && r !== 0;
      digits = r < 9007199254740992 ? String(r) : BigInt(r).toString();
    }
    var out = neg ? '-' : '', len = digits.length;
    for (var i = 0; i < len; i++) {
      if (i > 0 && (len - i) % 3 === 0) out += ',';
      out += digits.charAt(i);
    }
    return out;
  }
  // std::fixed << std::setprecision(2) (glibc : cas d'égalité arrondi au chiffre pair).
  function fmt2(v) {
    if (v !== v) return 'nan';
    if (v === Infinity) return 'inf';
    if (v === -Infinity) return '-inf';
    var neg = v < 0 || Object.is(v, -0), a = Math.abs(v), s;
    if (a >= 1e21) s = BigInt(a).toString() + '.00';
    else {
      var k = a * 8;
      if (k < 9007199254740992 && Math.floor(k) === k && k % 2 === 1) {
        // a = k/8 : pile entre deux valeurs à 2 décimales
        var lo = Math.floor(k * 12.5);
        var n = lo % 2 === 0 ? lo : lo + 1;
        var ip = Math.floor(n / 100), fp = n % 100;
        s = ip + '.' + (fp < 10 ? '0' : '') + fp;
      } else s = a.toFixed(2);
    }
    return (neg ? '-' : '') + s;
  }

  /* ───── GlobalSim.cpp ───── */
  function mergeBodies(a, b) {
    var m = newBody();
    m.mass = a.mass + b.mass;
    m.radius = Math.cbrt(a.radius * a.radius * a.radius + b.radius * b.radius * b.radius);
    var sa = vlen(a.vel[0], a.vel[1], a.vel[2]), sb = vlen(b.vel[0], b.vel[1], b.vel[2]);
    var tot = sa + sb, i, w;
    if (tot > 0) { w = 1.0 / tot; for (i = 0; i < 3; i++) m.pos[i] = (a.pos[i] * sa + b.pos[i] * sb) * w; }
    else for (i = 0; i < 3; i++) m.pos[i] = (a.pos[i] + b.pos[i]) * 0.5;
    w = 1.0 / m.mass;
    for (i = 0; i < 3; i++) m.vel[i] = (a.vel[i] * a.mass + b.vel[i] * b.mass) * w;
    m.name = a.name < b.name ? a.name + '-' + b.name : b.name + '-' + a.name;
    m.type = 'sphere';
    return m;
  }
  // Modifie bodies. Renvoie la liste des fusions faites (pour l'affichage).
  function handleMerges(bodies) {
    var done = [], merged = true;
    while (merged) {
      merged = false;
      for (var i = 0; i < bodies.length && !merged; i++) {
        for (var j = i + 1; j < bodies.length && !merged; j++) {
          var a = bodies[i], b = bodies[j];
          var d = vlen(a.pos[0] - b.pos[0], a.pos[1] - b.pos[1], a.pos[2] - b.pos[2]);
          if (d <= a.radius + b.radius) {
            var nb = mergeBodies(a, b);
            bodies.splice(j, 1);
            bodies.splice(i, 1);
            bodies.push(nb);
            done.push({ a: a, b: b, into: nb });
            merged = true;
          }
        }
      }
    }
    return done;
  }
  function accelAt(bodies, px, py, pz, out) {
    var ax = 0, ay = 0, az = 0;
    for (var i = 0; i < bodies.length; i++) {
      var b = bodies[i];
      var tx = b.pos[0] - px, ty = b.pos[1] - py, tz = b.pos[2] - pz;
      var d = Math.sqrt(tx * tx + ty * ty + tz * tz);
      if (d === 0) continue;
      var mag = G * b.mass / (d * d);
      var inv = 1.0 / d;                    // Vec3::normalize
      ax = ax + tx * inv * mag; ay = ay + ty * inv * mag; az = az + tz * inv * mag;
    }
    out[0] = ax; out[1] = ay; out[2] = az;
  }
  function hitIndex(bodies, px, py, pz) {
    for (var i = 0; i < bodies.length; i++) {
      var b = bodies[i];
      if (vlen(b.pos[0] - px, b.pos[1] - py, b.pos[2] - pz) <= b.radius) return i;
    }
    return -1;
  }
  function posLine(x, y, z, step) {
    return 't = ' + step + ': (' + fmtInt(x) + ' ' + fmtInt(y) + ' ' + fmtInt(z) + ')';
  }

  /* Mode global. bodies est modifié (fusions). opts.text=false : pas de lignes de texte (aperçu).
     Renvoie positions et vitesses à chaque pas, plus la sortie texte du programme. */
  function runGlobal(args, bodies, opts) {
    var text = !opts || opts.text !== false;
    var dt = args.delta;
    var P = new Float64Array(3 * (MAX_STEPS + 1)), V = new Float64Array(3 * (MAX_STEPS + 1));
    var px = args.pos[0], py = args.pos[1], pz = args.pos[2];
    var vx = args.vel[0], vy = args.vel[1], vz = args.vel[2];
    var acc = [0, 0, 0], lines = [], merges = [], hit = -1, n = 0;
    P[0] = px; P[1] = py; P[2] = pz; V[0] = vx; V[1] = vy; V[2] = vz;
    if (text) { lines.push('Rock coordinates (x y z) are:'); lines.push(posLine(px, py, pz, 0)); }
    for (var step = 1; step <= MAX_STEPS; step++) {
      var mg = handleMerges(bodies);
      if (mg.length) merges = merges.concat(mg);
      accelAt(bodies, px, py, pz, acc);
      px = px + vx * dt; py = py + vy * dt; pz = pz + vz * dt;
      vx = vx + acc[0] * dt; vy = vy + acc[1] * dt; vz = vz + acc[2] * dt;
      n = step;
      P[3 * step] = px; P[3 * step + 1] = py; P[3 * step + 2] = pz;
      V[3 * step] = vx; V[3 * step + 1] = vy; V[3 * step + 2] = vz;
      if (text) lines.push(posLine(px, py, pz, step));
      hit = hitIndex(bodies, px, py, pz);
      if (hit >= 0) break;
    }
    var tail = hit >= 0 ? ['Collision between rock and ' + bodies[hit].name, '', 'Mission success']
                        : ['', 'Mission failure'];
    return { mode: 1, n: n, P: P, V: V, bodies: bodies, merges: merges, hit: hit,
             head: 1, lines: lines, tail: tail, delta: dt };
  }

  /* ───── LocalSim.cpp ───── */
  function p3(v) { return '(' + fmt2(v[0]) + ', ' + fmt2(v[1]) + ', ' + fmt2(v[2]) + ')'; }
  function localHeader(args, bodies) {
    var L = ['Rock thrown at the point ' + p3(args.pos) + ' and parallel to the vector ' + p3(args.vel)];
    for (var i = 0; i < bodies.length; i++) {
      var b = bodies[i];
      if (b.type === 'sphere') L.push('Sphere of radius ' + fmt2(b.radius) + ' at position ' + p3(b.pos));
      else if (b.type === 'cylinder') {
        if (b.height < 0) L.push('Cylinder of radius ' + fmt2(b.radius) + ' and infinite height at position ' + p3(b.pos));
        else L.push('Cylinder of radius ' + fmt2(b.radius) + ' and height ' + fmt2(b.height) + ' at position ' + p3(b.pos));
      } else if (b.type === 'box') L.push('Box of dimensions ' + p3(b.sides) + ' at position ' + p3(b.pos));
      else if (b.type === 'torus') L.push('Torus of inner radius ' + fmt2(b.inner_r) + ' and outer radius ' + fmt2(b.outer_r) + ' at position ' + p3(b.pos));
    }
    L.push('');
    return L;
  }
  function runLocal(args, bodies, opts) {
    var text = !opts || opts.text !== false;
    var P = new Float64Array(3 * (MAX_STEPS + 1)), D = new Float64Array(MAX_STEPS + 1);
    var px = args.pos[0], py = args.pos[1], pz = args.pos[2];
    var l = vlen(args.vel[0], args.vel[1], args.vel[2]);
    var w = l === 0 ? 0 : 1.0 / l;
    var dx = l === 0 ? 0 : args.vel[0] * w, dy = l === 0 ? 0 : args.vel[1] * w, dz = l === 0 ? 0 : args.vel[2] * w;
    var lines = text ? localHeader(args, bodies) : [], head = lines.length - 1;
    var closest = -1, n = 0, result = 'limit', tail = ['', 'Result: Steps limit reached'];
    P[0] = px; P[1] = py; P[2] = pz;
    for (var step = 1; step <= MAX_STEPS; step++) {
      var best = Number.MAX_VALUE; closest = -1;
      for (var i = 0; i < bodies.length; i++) {
        var d = sdf(bodies[i], px, py, pz);
        if (d < best) { best = d; closest = i; }
      }
      px = px + dx * best; py = py + dy * best; pz = pz + dz * best;
      n = step; D[step] = best;
      P[3 * step] = px; P[3 * step + 1] = py; P[3 * step + 2] = pz;
      if (text) lines.push('Step ' + step + ': (' + fmt2(px) + ', ' + fmt2(py) + ', ' + fmt2(pz) + ')');
      if (best <= SDF_HIT) {
        result = 'hit';
        tail = ['', 'Result: Intersection with ' + (closest >= 0 ? bodies[closest].name : '')];
        break;
      }
      if (best > SDF_OUT) { result = 'out'; tail = ['', 'Result: Out of scene']; break; }
    }
    return { mode: 2, n: n, P: P, D: D, bodies: bodies, hit: result === 'hit' ? closest : -1,
             result: result, head: head, lines: lines, tail: tail };
  }

  /* ───── main.cpp : le programme entier ─────
     argv sans le nom du programme ; files : { nom: contenu }.
     Renvoie { code, stdout, stderr, sim, args }. */
  function runProgram(argv, files, opts) {
    try {
      var args = parseArgs(argv);
      if (args.help) return { code: 0, stdout: HELP, stderr: '', sim: null, args: args };
      if (!Object.prototype.hasOwnProperty.call(files, args.config))
        throw new SimError('cannot open file: ' + args.config);
      var bodies = parseScene(files[args.config], args.config, args.mode);
      var sim = args.mode === 1 ? runGlobal(args, bodies, opts) : runLocal(args, bodies, opts);
      return { code: 0, stdout: sim.lines.concat(sim.tail).join('\n') + '\n', stderr: '', sim: sim, args: args };
    } catch (e) {
      if (!(e instanceof SimError)) throw e;
      return { code: 84, stdout: '', stderr: 'Error: ' + e.message + '\n', sim: null, args: null };
    }
  }

  // Découpe une ligne de commande comme un shell simple (espaces, guillemets).
  function splitCommand(line) {
    var out = [], re = /"([^"]*)"|'([^']*)'|(\S+)/g, m;
    while ((m = re.exec(line))) out.push(m[1] !== undefined ? m[1] : m[2] !== undefined ? m[2] : m[3]);
    return out;
  }

  /* ═════ Ajouts de la page web (absents du programme d'origine) ═════ */

  // Énergie mécanique de la roche par kilo : v²/2 − Σ G·M/d. Constante si le calcul était exact.
  function energyAt(bodies, P, V, i) {
    var vx = V[3 * i], vy = V[3 * i + 1], vz = V[3 * i + 2];
    var e = 0.5 * (vx * vx + vy * vy + vz * vz);
    for (var k = 0; k < bodies.length; k++) {
      var b = bodies[k];
      var d = vlen(b.pos[0] - P[3 * i], b.pos[1] - P[3 * i + 1], b.pos[2] - P[3 * i + 2]);
      if (d > 0) e -= G * b.mass / d;
    }
    return e;
  }
  // Écart d'énergie à chaque pas par rapport au départ, rapporté à l'énergie de départ
  // (la plus grande des deux parts : mouvement ou attraction, pour ne jamais diviser par presque zéro).
  function energyDrift(sim) {
    var out = new Float64Array(sim.n + 1);
    var e0 = energyAt(sim.bodies, sim.P, sim.V, 0);
    var k0 = 0.5 * (sim.V[0] * sim.V[0] + sim.V[1] * sim.V[1] + sim.V[2] * sim.V[2]);
    var ref = Math.max(k0, Math.abs(e0 - k0));
    if (!(ref > 0) || !isFinite(ref)) ref = 1;
    for (var i = 0; i <= sim.n; i++) out[i] = (energyAt(sim.bodies, sim.P, sim.V, i) - e0) / ref;
    return out;
  }
  // Trajectoire de comparaison : la même méthode, avec un pas `sub` fois plus petit.
  // Un point gardé par pas du programme. S'arrête à la première collision.
  function runReference(args, bodies, sub, steps) {
    var dt = args.delta / sub, N = steps || MAX_STEPS;
    var P = new Float64Array(3 * (N + 1)), acc = [0, 0, 0];
    var px = args.pos[0], py = args.pos[1], pz = args.pos[2];
    var vx = args.vel[0], vy = args.vel[1], vz = args.vel[2];
    var n = 0, hit = -1;
    P[0] = px; P[1] = py; P[2] = pz;
    outer:
    for (var s = 1; s <= N; s++) {
      for (var k = 0; k < sub; k++) {
        accelAt(bodies, px, py, pz, acc);
        px = px + vx * dt; py = py + vy * dt; pz = pz + vz * dt;
        vx = vx + acc[0] * dt; vy = vy + acc[1] * dt; vz = vz + acc[2] * dt;
        hit = hitIndex(bodies, px, py, pz);
        if (hit >= 0) { n = s; P[3 * s] = px; P[3 * s + 1] = py; P[3 * s + 2] = pz; break outer; }
      }
      n = s; P[3 * s] = px; P[3 * s + 1] = py; P[3 * s + 2] = pz;
    }
    return { n: n, P: P, hit: hit };
  }

  var api = {
    G: G, MAX_STEPS: MAX_STEPS, SDF_HIT: SDF_HIT, SDF_OUT: SDF_OUT, HELP: HELP,
    stod: stod, parseArgs: parseArgs, parseScene: parseScene, sdf: sdf,
    fmtInt: fmtInt, fmt2: fmt2, handleMerges: handleMerges, mergeBodies: mergeBodies,
    runGlobal: runGlobal, runLocal: runLocal, runProgram: runProgram, splitCommand: splitCommand,
    energyDrift: energyDrift, runReference: runReference, SimError: SimError
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Interstonar = api;
})(typeof self !== 'undefined' ? self : this);
