/* Raytracer — cœur du calcul (fonctions pures, sans DOM).
   Réécriture en JavaScript du projet C++ G-OOP-400.
   Chargé par la page, par le Web Worker et par node (tests). */
(function (root) {
'use strict';

/* ───────── erreurs avec numéro de ligne ───────── */
function SceneError(message, line) {
  this.name = 'SceneError';
  this.message = message;
  this.line = line || 0;
}
SceneError.prototype = Object.create(Error.prototype);

/* ───────── 1. lecture du format .cfg (sous-ensemble de libconfig) ───────── */
function tokenize(src) {
  var toks = [], i = 0, line = 1, n = src.length, c, m;
  var reNum = /^[-+]?(0[xX][0-9a-fA-F]+|(\d+\.\d*|\.\d+|\d+)([eE][-+]?\d+)?)(LL?)?/;
  var reId = /^[A-Za-z*][-A-Za-z0-9_*]*/;
  while (i < n) {
    c = src[i];
    if (c === '\n') { line++; i++; continue; }
    if (c === ' ' || c === '\t' || c === '\r') { i++; continue; }
    if (c === '#' || (c === '/' && src[i + 1] === '/')) {
      while (i < n && src[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && src[i + 1] === '*') {
      var end = src.indexOf('*/', i + 2);
      if (end < 0) throw new SceneError('commentaire /* jamais fermé', line);
      for (var k = i; k < end; k++) if (src[k] === '\n') line++;
      i = end + 2;
      continue;
    }
    if ('{}()[]=:;,'.indexOf(c) >= 0) { toks.push({ t: c, line: line }); i++; continue; }
    if (c === '"') {
      var j = i + 1, s = '';
      while (j < n && src[j] !== '"') {
        if (src[j] === '\n') throw new SceneError('guillemet " jamais fermé', line);
        if (src[j] === '\\' && j + 1 < n) { j++; }
        s += src[j]; j++;
      }
      if (j >= n) throw new SceneError('guillemet " jamais fermé', line);
      toks.push({ t: 'str', v: s, line: line });
      i = j + 1;
      continue;
    }
    var rest = src.substr(i, 64);
    m = reNum.exec(rest);
    if (m && !/^[A-Za-z_]/.test(rest.substr(m[0].length, 1))) {
      var txt = m[0].replace(/L+$/, '');
      var isHex = /^[-+]?0[xX]/.test(txt);
      var isFloat = !isHex && /[.eE]/.test(txt);
      toks.push({ t: 'num', v: isHex ? parseInt(txt, 16) : parseFloat(txt), kind: isFloat ? 'float' : 'int', line: line });
      i += m[0].length;
      continue;
    }
    m = reId.exec(rest);
    if (m) {
      var low = m[0].toLowerCase();
      if (low === 'true' || low === 'false') toks.push({ t: 'bool', v: low === 'true', line: line });
      else toks.push({ t: 'id', v: m[0], line: line });
      i += m[0].length;
      continue;
    }
    throw new SceneError('caractère inattendu « ' + c + ' »', line);
  }
  toks.push({ t: 'eof', line: line });
  return toks;
}

function describe(tok) {
  if (tok.t === 'eof') return 'la fin du fichier';
  if (tok.t === 'id' || tok.t === 'num' || tok.t === 'bool') return '« ' + tok.v + ' »';
  if (tok.t === 'str') return 'le texte "' + tok.v + '"';
  return '« ' + tok.t + ' »';
}

/* Renvoie l'arbre : {type:'group', members:{}, line} | {type:'list', items:[], line}
   | {type:'int'|'float'|'bool'|'string', value, line} */
function parseConfig(src) {
  var toks = tokenize(String(src)), p = 0;

  function settings(closer) {
    var members = {};
    for (;;) {
      var tok = toks[p];
      if (tok.t === closer) return members;
      if (tok.t === 'eof') throw new SceneError('il manque une accolade fermante « } »', tok.line);
      if (tok.t !== 'id') throw new SceneError('nom de réglage attendu, mais j\'ai trouvé ' + describe(tok), tok.line);
      p++;
      var eq = toks[p];
      if (eq.t !== '=' && eq.t !== ':') throw new SceneError('il manque « = » ou « : » après « ' + tok.v + ' »', tok.line);
      p++;
      if (Object.prototype.hasOwnProperty.call(members, tok.v)) throw new SceneError('le réglage « ' + tok.v + ' » est écrit deux fois', tok.line);
      members[tok.v] = value(tok.v);
      if (toks[p].t === ';' || toks[p].t === ',') p++;
    }
  }

  function value(name) {
    var tok = toks[p];
    if (tok.t === 'num') { p++; return { type: tok.kind, value: tok.v, line: tok.line }; }
    if (tok.t === 'bool') { p++; return { type: 'bool', value: tok.v, line: tok.line }; }
    if (tok.t === 'str') { p++; return { type: 'string', value: tok.v, line: tok.line }; }
    if (tok.t === '{') {
      p++;
      var g = { type: 'group', members: settings('}'), line: tok.line };
      p++;
      return g;
    }
    if (tok.t === '(' || tok.t === '[') {
      var close = tok.t === '(' ? ')' : ']';
      p++;
      var items = [];
      while (toks[p].t !== close) {
        if (toks[p].t === 'eof') throw new SceneError('la liste ouverte ici n\'est jamais fermée par « ' + close + ' »', tok.line);
        items.push(value(name));
        if (toks[p].t === ',') p++;
        else if (toks[p].t !== close) throw new SceneError('il manque une virgule ou « ' + close + ' » dans la liste « ' + name + ' », avant ' + describe(toks[p]), toks[p].line);
      }
      p++;
      return { type: 'list', items: items, line: tok.line };
    }
    throw new SceneError('valeur attendue pour « ' + name + ' », mais j\'ai trouvé ' + describe(tok), tok.line);
  }

  var members = settings('eof');
  return { type: 'group', members: members, line: 1 };
}

/* ───────── 2. de l'arbre à la scène (mêmes champs que SceneParser.cpp) ───────── */
function buildScene(tree) {
  var warnings = [];

  function has(g, key) { return g.type === 'group' && Object.prototype.hasOwnProperty.call(g.members, key); }
  function get(g, key, where) {
    if (g.type !== 'group') throw new SceneError('« ' + where + ' » doit être un bloc { ... }', g.line);
    if (!has(g, key)) throw new SceneError('il manque « ' + key + ' » dans ' + where, g.line);
    return g.members[key];
  }
  function num(g, key, where) {
    var s = get(g, key, where);
    if (s.type !== 'int' && s.type !== 'float') throw new SceneError('« ' + key + ' » doit être un nombre (' + where + ')', s.line);
    return s.value;
  }
  function vec3(g, key, where) {
    var s = get(g, key, where), w = '« ' + key + ' » (' + where + ')';
    return [num(s, 'x', w), num(s, 'y', w), num(s, 'z', w)];
  }
  function color(g, key, where) {
    var s = get(g, key, where), w = '« ' + key + ' » (' + where + ')';
    return [num(s, 'r', w) / 255, num(s, 'g', w) / 255, num(s, 'b', w) / 255];
  }
  function list(g, key, where) {
    var s = g.members[key];
    if (s.type !== 'list') throw new SceneError('« ' + key + ' » doit être une liste ( ... )', s.line);
    return s.items.map(function (it, i) {
      if (it.type !== 'group') throw new SceneError('chaque élément de « ' + key + ' » doit être un bloc { ... }', it.line);
      return { g: it, where: where + ' n°' + (i + 1) };
    });
  }
  function unknown(g, known, where) {
    Object.keys(g.members).forEach(function (k) {
      if (known.indexOf(k) < 0) warnings.push({ line: g.members[k].line, message: '« ' + k + ' » n\'est pas lu dans ' + where + ' : il est ignoré, comme dans le projet d\'origine.' });
    });
  }
  function norm(v) {
    var l = Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
    return l === 0 ? [0, 0, 0] : [v[0] / l, v[1] / l, v[2] / l];
  }

  var scene = { camera: null, primitives: [], ambient: [], directional: [], point: [], warnings: warnings };
  var top = tree.members;

  if (top.camera) {
    var cam = top.camera, res = get(cam, 'resolution', 'la caméra');
    scene.camera = {
      width: Math.trunc(num(res, 'width', 'la résolution de la caméra')),
      height: Math.trunc(num(res, 'height', 'la résolution de la caméra')),
      position: vec3(cam, 'position', 'la caméra'),
      rotation: vec3(cam, 'rotation', 'la caméra'),
      fov: num(cam, 'fieldOfView', 'la caméra'),
      line: cam.line
    };
  }

  if (top.primitives) {
    var prims = top.primitives;
    if (prims.type !== 'group') throw new SceneError('« primitives » doit être un bloc { ... }', prims.line);
    unknown(prims, ['spheres', 'planes', 'cylinders', 'cones', 'cylindreslimites', 'coneslimites', 'conesfantomes', 'triangles'], '« primitives »');

    if (has(prims, 'spheres')) list(prims, 'spheres', 'la sphère').forEach(function (e) {
      scene.primitives.push({ type: 'sphere', line: e.g.line,
        center: [num(e.g, 'x', e.where), num(e.g, 'y', e.where), num(e.g, 'z', e.where)],
        radius: num(e.g, 'r', e.where), color: color(e.g, 'color', e.where) });
    });
    if (has(prims, 'planes')) list(prims, 'planes', 'le plan').forEach(function (e) {
      var ax = get(e.g, 'axis', e.where);
      if (ax.type !== 'string') throw new SceneError('« axis » d\'un plan doit valoir "X", "Y" ou "Z" (entre guillemets)', ax.line);
      var pos = num(e.g, 'position', e.where);
      var n = [ax.value === 'X' ? 1 : 0, ax.value === 'Y' ? 1 : 0, ax.value === 'Z' ? 1 : 0];
      if (!n[0] && !n[1] && !n[2]) warnings.push({ line: ax.line, message: 'axis = "' + ax.value + '" : seuls "X", "Y" et "Z" donnent un plan visible.' });
      var pl = { type: 'plane', line: e.g.line, point: [n[0] * pos, n[1] * pos, n[2] * pos], normal: n,
        color: color(e.g, 'color', e.where), checker: false, checkerScale: 0.3, color2: [0.05, 0.05, 0.05] };
      if (has(e.g, 'checker')) {
        var ck = e.g.members.checker;
        if (ck.type !== 'bool') throw new SceneError('« checker » doit valoir true ou false', ck.line);
        if (ck.value) {
          pl.checker = true;
          pl.checkerScale = has(e.g, 'checkerScale') ? num(e.g, 'checkerScale', e.where) : 1;
          pl.color2 = has(e.g, 'checkerColor') ? color(e.g, 'checkerColor', e.where) : [0.05, 0.05, 0.05];
        }
      }
      scene.primitives.push(pl);
    });
    if (has(prims, 'cylinders')) list(prims, 'cylinders', 'le cylindre').forEach(function (e) {
      scene.primitives.push({ type: 'cylinder', line: e.g.line, center: vec3(e.g, 'center', e.where),
        axis: norm(vec3(e.g, 'axis', e.where)), radius: num(e.g, 'radius', e.where), color: color(e.g, 'color', e.where) });
    });
    if (has(prims, 'cones')) list(prims, 'cones', 'le cône').forEach(function (e) {
      scene.primitives.push({ type: 'cone', line: e.g.line, apex: vec3(e.g, 'apex', e.where),
        axis: norm(vec3(e.g, 'axis', e.where)), k: Math.tan(num(e.g, 'angle', e.where)), color: color(e.g, 'color', e.where) });
    });
    if (has(prims, 'cylindreslimites')) list(prims, 'cylindreslimites', 'le cylindre limité').forEach(function (e) {
      scene.primitives.push({ type: 'cylindrelimite', line: e.g.line, center: vec3(e.g, 'center', e.where),
        axis: norm(vec3(e.g, 'axis', e.where)), radius: num(e.g, 'radius', e.where),
        height: num(e.g, 'height', e.where), color: color(e.g, 'color', e.where) });
    });
    if (has(prims, 'coneslimites')) list(prims, 'coneslimites', 'le cône limité').forEach(function (e) {
      scene.primitives.push({ type: 'conelimite', line: e.g.line, apex: vec3(e.g, 'apex', e.where),
        axis: norm(vec3(e.g, 'axis', e.where)), k: Math.tan(num(e.g, 'angle', e.where)),
        height: num(e.g, 'height', e.where), color: color(e.g, 'color', e.where) });
    });
    if (has(prims, 'conesfantomes')) list(prims, 'conesfantomes', 'le cône fantôme').forEach(function (e) {
      scene.primitives.push({ type: 'conefantome', line: e.g.line, apex: vec3(e.g, 'apex', e.where),
        axis: norm(vec3(e.g, 'axis', e.where)), k: Math.tan(num(e.g, 'angle', e.where)), color: color(e.g, 'color', e.where) });
    });
    if (has(prims, 'triangles')) list(prims, 'triangles', 'le triangle').forEach(function (e) {
      scene.primitives.push({ type: 'triangle', line: e.g.line, v0: vec3(e.g, 'v0', e.where),
        v1: vec3(e.g, 'v1', e.where), v2: vec3(e.g, 'v2', e.where), color: color(e.g, 'color', e.where) });
    });
  }

  if (top.lights) {
    var lights = top.lights;
    if (lights.type !== 'group') throw new SceneError('« lights » doit être un bloc { ... }', lights.line);
    unknown(lights, ['ambient', 'directional', 'point'], '« lights »');
    if (has(lights, 'ambient')) scene.ambient.push(num(lights, 'ambient', 'les lumières'));
    ['directional', 'point'].forEach(function (kind) {
      if (!has(lights, kind)) return;
      list(lights, kind, kind === 'point' ? 'la lumière ponctuelle' : 'la lumière directionnelle').forEach(function (e) {
        var v = [num(e.g, 'x', e.where), num(e.g, 'y', e.where), num(e.g, 'z', e.where)];
        var col = has(e.g, 'color') ? color(e.g, 'color', e.where) : [1, 1, 1];
        if (kind === 'point') scene.point.push({ position: v, color: col });
        else scene.directional.push({ direction: norm(v), color: col });
      });
    });
  }

  Object.keys(top).forEach(function (k) {
    if (['camera', 'primitives', 'lights'].indexOf(k) < 0) warnings.push({ line: top[k].line, message: '« ' + k + ' » n\'est pas un bloc connu : il est ignoré.' });
  });
  if (!scene.camera) throw new SceneError('Aucune caméra définie dans la scène (bloc « camera »)', 0);
  return scene;
}

function parseScene(src) { return buildScene(parseConfig(src)); }

/* ───────── 3. intersections rayon / objet ─────────
   Chaque fonction écrit dans rec seulement si le rayon touche l'objet
   entre tMin et tMax. Les formules suivent src/primitives/*.cpp. */
function faceNormal(rec, dx, dy, dz, nx, ny, nz) {
  var front = dx * nx + dy * ny + dz * nz < 0;
  rec.front = front;
  if (front) { rec.nx = nx; rec.ny = ny; rec.nz = nz; }
  else { rec.nx = -nx; rec.ny = -ny; rec.nz = -nz; }
}
function setPoint(rec, t, ox, oy, oz, dx, dy, dz, prim) {
  rec.t = t; rec.px = ox + dx * t; rec.py = oy + dy * t; rec.pz = oz + dz * t; rec.prim = prim;
}

/* Chaque fabrique lit les nombres de l'objet une fois, puis renvoie la fonction d'intersection. */
function makeSphere(s) {
  var X = +s.center[0], Y = +s.center[1], Z = +s.center[2], rad = +s.radius;
  return function (ox, oy, oz, dx, dy, dz, tMin, tMax, rec) {
    var cx = ox - X, cy = oy - Y, cz = oz - Z;
    var a = dx * dx + dy * dy + dz * dz;
    var b = 2 * (cx * dx + cy * dy + cz * dz);
    var c = cx * cx + cy * cy + cz * cz - rad * rad;
    var disc = b * b - 4 * a * c;
    if (disc < 0) return false;
    var sq = Math.sqrt(disc);
    var t = (-b - sq) / (2 * a);
    if (t < tMin || t > tMax) {
      t = (-b + sq) / (2 * a);
      if (t < tMin || t > tMax) return false;
    }
    setPoint(rec, t, ox, oy, oz, dx, dy, dz, s);
    faceNormal(rec, dx, dy, dz, (rec.px - X) / rad, (rec.py - Y) / rad, (rec.pz - Z) / rad);
    return true;
  };
}

function makePlane(p) {
  var n0 = +p.normal[0], n1 = +p.normal[1], n2 = +p.normal[2];
  var P0 = +p.point[0], P1 = +p.point[1], P2 = +p.point[2];
  return function (ox, oy, oz, dx, dy, dz, tMin, tMax, rec) {
    var denom = dx * n0 + dy * n1 + dz * n2;
    if (Math.abs(denom) < 1e-8) return false;
    var t = ((P0 - ox) * n0 + (P1 - oy) * n1 + (P2 - oz) * n2) / denom;
    if (t < tMin || t > tMax) return false;
    setPoint(rec, t, ox, oy, oz, dx, dy, dz, p);
    faceNormal(rec, dx, dy, dz, n0, n1, n2);
    return true;
  };
}

/* cylindre infini (limited = false) ou coupé à ± height / 2 */
function makeCylinder(c, limited) {
  var ax = +c.axis[0], ay = +c.axis[1], az = +c.axis[2];
  var X = +c.center[0], Y = +c.center[1], Z = +c.center[2];
  var rad = +c.radius, half = limited ? c.height * 0.5 : 0;
  return function (ox, oy, oz, dx, dy, dz, tMin, tMax, rec) {
    var cx = ox - X, cy = oy - Y, cz = oz - Z;
    var dA = dx * ax + dy * ay + dz * az;
    var oA = cx * ax + cy * ay + cz * az;
    var px = dx - ax * dA, py = dy - ay * dA, pz = dz - az * dA;
    var qx = cx - ax * oA, qy = cy - ay * oA, qz = cz - az * oA;
    var a = px * px + py * py + pz * pz;
    var b = 2 * (px * qx + py * qy + pz * qz);
    var cc = qx * qx + qy * qy + qz * qz - rad * rad;
    var disc = b * b - 4 * a * cc;
    if (disc < 0) return false;
    var sq = Math.sqrt(disc);
    var t = (-b - sq) / (2 * a);
    if (t < tMin || t > tMax) {
      t = (-b + sq) / (2 * a);
      if (t < tMin || t > tMax) return false;
    }
    var hx = ox + dx * t - X, hy = oy + dy * t - Y, hz = oz + dz * t - Z;
    var h = hx * ax + hy * ay + hz * az;
    if (limited && Math.abs(h) > half) return false;
    setPoint(rec, t, ox, oy, oz, dx, dy, dz, c);
    faceNormal(rec, dx, dy, dz, (hx - ax * h) / rad, (hy - ay * h) / rad, (hz - az * h) / rad);
    return true;
  };
}

/* mode 0 : cône (une nappe), 1 : cône limité, 2 : cône fantôme (deux nappes) */
function makeCone(c, mode) {
  var ax = +c.axis[0], ay = +c.axis[1], az = +c.axis[2], K = +c.k, k2 = K * K;
  var X = +c.apex[0], Y = +c.apex[1], Z = +c.apex[2], height = mode === 1 ? +c.height : 0;
  return function (ox, oy, oz, dx, dy, dz, tMin, tMax, rec) {
    var cx = ox - X, cy = oy - Y, cz = oz - Z;
    var dA = dx * ax + dy * ay + dz * az;
    var oA = cx * ax + cy * ay + cz * az;
    var px = dx - ax * dA, py = dy - ay * dA, pz = dz - az * dA;
    var qx = cx - ax * oA, qy = cy - ay * oA, qz = cz - az * oA;
    var a = px * px + py * py + pz * pz - k2 * dA * dA;
    var b = 2 * (px * qx + py * qy + pz * qz - k2 * dA * oA);
    var cc = qx * qx + qy * qy + qz * qz - k2 * oA * oA;
    var disc = b * b - 4 * a * cc;
    if (disc < 0) return false;
    var sq = Math.sqrt(disc);
    var r1 = (-b - sq) / (2 * a), r2 = (-b + sq) / (2 * a), tmp;
    if (r1 > r2) { tmp = r1; r1 = r2; r2 = tmp; }
    var t = -1, h;
    if (mode === 2) {
      if (r1 >= tMin && r1 <= tMax) t = r1;
      else if (r2 >= tMin && r2 <= tMax) t = r2;
    } else {
      h = oA + dA * r1;
      if (r1 >= tMin && r1 <= tMax && h >= 0 && (mode === 0 || h <= height)) t = r1;
      else {
        h = oA + dA * r2;
        if (r2 >= tMin && r2 <= tMax && h >= 0 && (mode === 0 || h <= height)) t = r2;
      }
    }
    if (!(t >= 0)) return false;
    setPoint(rec, t, ox, oy, oz, dx, dy, dz, c);
    var hx = rec.px - X, hy = rec.py - Y, hz = rec.pz - Z;
    var hh = hx * ax + hy * ay + hz * az;
    var rx = hx - ax * hh, ry = hy - ay * hh, rz = hz - az * hh;
    var kr = K * Math.sqrt(rx * rx + ry * ry + rz * rz);
    var nx = rx - ax * kr, ny = ry - ay * kr, nz = rz - az * kr;
    var l = Math.sqrt(nx * nx + ny * ny + nz * nz);
    if (l !== 0) { nx /= l; ny /= l; nz /= l; }
    faceNormal(rec, dx, dy, dz, nx, ny, nz);
    return true;
  };
}

function makeTriangle(tr) {
  var ax = +tr.v0[0], ay = +tr.v0[1], az = +tr.v0[2];
  var bx = +tr.v1[0], by = +tr.v1[1], bz = +tr.v1[2];
  var cx = +tr.v2[0], cy = +tr.v2[1], cz = +tr.v2[2];
  /* normale = (v1 - v0) x (v2 - v0), normalisée */
  var n0 = (by - ay) * (cz - az) - (bz - az) * (cy - ay);
  var n1 = (bz - az) * (cx - ax) - (bx - ax) * (cz - az);
  var n2 = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  var nl = Math.sqrt(n0 * n0 + n1 * n1 + n2 * n2);
  if (nl !== 0) { n0 /= nl; n1 /= nl; n2 /= nl; }
  /* le point P est-il du bon côté de l'arête (ux,uy,uz) → (vx,vy,vz) ? */
  function side(ux, uy, uz, vx, vy, vz, px, py, pz) {
    var ex = vx - ux, ey = vy - uy, ez = vz - uz;
    var wx = px - ux, wy = py - uy, wz = pz - uz;
    return (ey * wz - ez * wy) * n0 + (ez * wx - ex * wz) * n1 + (ex * wy - ey * wx) * n2;
  }
  return function (ox, oy, oz, dx, dy, dz, tMin, tMax, rec) {
    var denom = dx * n0 + dy * n1 + dz * n2;
    if (Math.abs(denom) < 1e-8) return false;
    var t = ((ax - ox) * n0 + (ay - oy) * n1 + (az - oz) * n2) / denom;
    if (t < tMin || t > tMax) return false;
    var px = ox + dx * t, py = oy + dy * t, pz = oz + dz * t;
    if (side(ax, ay, az, bx, by, bz, px, py, pz) < 0) return false;
    if (side(bx, by, bz, cx, cy, cz, px, py, pz) < 0) return false;
    if (side(cx, cy, cz, ax, ay, az, px, py, pz) < 0) return false;
    setPoint(rec, t, ox, oy, oz, dx, dy, dz, tr);
    faceNormal(rec, dx, dy, dz, n0, n1, n2);
    return true;
  };
}

/* renvoie la fonction hit(ox, oy, oz, dx, dy, dz, tMin, tMax, rec) d'un objet de la scène */
function makeHit(p) {
  switch (p.type) {
    case 'sphere': return makeSphere(p);
    case 'plane': return makePlane(p);
    case 'cylinder': return makeCylinder(p, false);
    case 'cylindrelimite': return makeCylinder(p, true);
    case 'cone': return makeCone(p, 0);
    case 'conelimite': return makeCone(p, 1);
    case 'conefantome': return makeCone(p, 2);
    case 'triangle': return makeTriangle(p);
  }
  throw new SceneError('type d\'objet inconnu : ' + p.type, p.line);
}

function newRecord() { return { t: 0, px: 0, py: 0, pz: 0, nx: 0, ny: 0, nz: 0, front: true, prim: null }; }

/* ───────── 4. caméra (Camera.cpp : Z vers le haut, la caméra regarde vers +Y) ───────── */
function cameraBasis(cam) {
  var yaw = cam.rotation[1] * Math.PI / 180, pitch = cam.rotation[0] * Math.PI / 180;
  var f = [Math.cos(pitch) * Math.sin(yaw), Math.cos(pitch) * Math.cos(yaw), Math.sin(pitch)];
  var r = [f[1], -f[0], 0];
  var rl = Math.sqrt(r[0] * r[0] + r[1] * r[1]);
  if (rl !== 0) { r[0] /= rl; r[1] /= rl; }
  var u = [r[1] * f[2] - r[2] * f[1], r[2] * f[0] - r[0] * f[2], r[0] * f[1] - r[1] * f[0]];
  var ul = Math.sqrt(u[0] * u[0] + u[1] * u[1] + u[2] * u[2]);
  if (ul !== 0) { u[0] /= ul; u[1] /= ul; u[2] /= ul; }
  return { forward: f, right: r, up: u };
}

/* ───────── 5. le rendu ───────── */
var AO_RADIUS = 15, AO_SAMPLES = 16;
var AO_DIRS = [
  [0.196, 0.000], [0.588, 2.399], [0.785, 4.799], [0.392, 1.257],
  [0.981, 3.656], [0.588, 6.055], [0.196, 0.913], [0.785, 3.312],
  [0.392, 5.711], [0.981, 0.170], [0.588, 2.569], [0.196, 4.968],
  [0.785, 3.825], [0.392, 6.224], [0.981, 1.426], [0.588, 3.826]
].map(function (d) { return [Math.sin(d[0]) * Math.cos(d[1]), Math.sin(d[0]) * Math.sin(d[1]), Math.cos(d[0])]; });

/* Prépare un rendu de `scene` en width × height.
   step(ms) calcule des pixels pendant ms millisecondes et renvoie true quand l'image est finie.
   Le rendu se fait en 4 passes (1 pixel sur 8, puis 4, 2, 1) : chaque pixel n'est calculé qu'une fois. */
function createRenderer(scene, width, height, now, opts) {
  now = now || Date.now;
  var fast = !!(opts && opts.fast);       // aperçu en direct : sans occlusion ambiante (16 rayons de moins par pixel)
  var hits = scene.primitives.map(makeHit), nP = hits.length, i;
  var cam = scene.camera, basis = cameraBasis(cam);
  var F = basis.forward, R = basis.right, U = basis.up, O = cam.position;
  var aspect = width / height, halfFov = Math.tan(cam.fov * Math.PI / 180 / 2);
  var data = new Uint8ClampedArray(width * height * 4);
  for (i = 3; i < data.length; i += 4) data[i] = 255;
  var rec = newRecord(), tmp = newRecord();
  var out = [0, 0, 0];
  var state = { data: data, width: width, height: height, rays: 0, pixels: 0, total: width * height, done: false };

  function closest(ox, oy, oz, dx, dy, dz, tMin, tMax, r) {
    state.rays++;
    var found = false, near = tMax;
    for (var j = 0; j < nP; j++) {
      if (hits[j](ox, oy, oz, dx, dy, dz, tMin, near, r)) { found = true; near = r.t; }
    }
    return found;
  }
  /* ShadowChecker : un objet se trouve-t-il entre le point et la lumière ? */
  function inShadow(ox, oy, oz, dx, dy, dz, maxDist) {
    state.rays++;
    for (var j = 0; j < nP; j++) {
      if (hits[j](ox, oy, oz, dx, dy, dz, 0.001, maxDist, tmp)) return true;
    }
    return false;
  }

  var sr, sg, sb;
  /* diffus + reflet spéculaire d'une lumière (phongContrib) */
  function addLight(r, br, bg, bb, lx, ly, lz, col, vx, vy, vz) {
    var diff = Math.max(r.nx * lx + r.ny * ly + r.nz * lz, 0);
    var hx = lx + vx, hy = ly + vy, hz = lz + vz;
    var hl = Math.sqrt(hx * hx + hy * hy + hz * hz);
    if (hl !== 0) { hx /= hl; hy /= hl; hz /= hl; }
    var spec = Math.pow(Math.max(r.nx * hx + r.ny * hy + r.nz * hz, 0), 32) * 0.4;
    sr += br * col[0] * diff + col[0] * spec;
    sg += bg * col[1] * diff + col[1] * spec;
    sb += bb * col[2] * diff + col[2] * spec;
  }

  function ambientOcclusion(r) {
    var nx = r.nx, ny = r.ny, nz = r.nz;
    var ux = Math.abs(nx) < 0.9 ? 1 : 0, uy = 1 - ux;
    var tx = ny * 0 - nz * uy, ty = nz * ux - nx * 0, tz = nx * uy - ny * ux;
    var l = Math.sqrt(tx * tx + ty * ty + tz * tz);
    if (l !== 0) { tx /= l; ty /= l; tz /= l; }
    var bx = ny * tz - nz * ty, by = nz * tx - nx * tz, bz = nx * ty - ny * tx;
    l = Math.sqrt(bx * bx + by * by + bz * bz);
    if (l !== 0) { bx /= l; by /= l; bz /= l; }
    var blocked = 0;
    for (var s = 0; s < AO_SAMPLES; s++) {
      var d = AO_DIRS[s];
      var dx = tx * d[0] + bx * d[1] + nx * d[2];
      var dy = ty * d[0] + by * d[1] + ny * d[2];
      var dz = tz * d[0] + bz * d[1] + nz * d[2];
      l = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (l !== 0) { dx /= l; dy /= l; dz /= l; }
      if (inShadow(r.px, r.py, r.pz, dx, dy, dz, AO_RADIUS)) blocked++;
    }
    return 0.7 + 0.3 * (1 - blocked / AO_SAMPLES);
  }

  /* ShadingEngine::computeColor */
  function shade(r, ox, oy, oz) {
    var p = r.prim, base = p.color, j, L;
    if (p.checker) {
      var s = p.checkerScale > 0 ? p.checkerScale : 1;
      if ((Math.floor(r.px / s) + Math.floor(r.py / s) + Math.floor(r.pz / s)) & 1) base = p.color2;
    }
    var br = base[0], bg = base[1], bb = base[2];
    var vx = ox - r.px, vy = oy - r.py, vz = oz - r.pz;
    var vl = Math.sqrt(vx * vx + vy * vy + vz * vz);
    if (vl !== 0) { vx /= vl; vy /= vl; vz /= vl; }
    sr = 0; sg = 0; sb = 0;
    for (j = 0; j < scene.ambient.length; j++) {
      sr += br * scene.ambient[j]; sg += bg * scene.ambient[j]; sb += bb * scene.ambient[j];
    }
    for (j = 0; j < scene.directional.length; j++) {
      L = scene.directional[j];
      var lx = -L.direction[0], ly = -L.direction[1], lz = -L.direction[2];
      if (!inShadow(r.px, r.py, r.pz, lx, ly, lz, 1e9)) addLight(r, br, bg, bb, lx, ly, lz, L.color, vx, vy, vz);
    }
    for (j = 0; j < scene.point.length; j++) {
      L = scene.point[j];
      var wx = L.position[0] - r.px, wy = L.position[1] - r.py, wz = L.position[2] - r.pz;
      var dist = Math.sqrt(wx * wx + wy * wy + wz * wz);
      wx /= dist; wy /= dist; wz /= dist;
      if (!inShadow(r.px, r.py, r.pz, wx, wy, wz, dist)) addLight(r, br, bg, bb, wx, wy, wz, L.color, vx, vy, vz);
    }
    var ao = fast ? 1 : ambientOcclusion(r);
    out[0] = Math.min(sr * ao, 1); out[1] = Math.min(sg * ao, 1); out[2] = Math.min(sb * ao, 1);
  }

  function toInt(v) { return v < 0 || v !== v ? 0 : v > 1 ? 255 : Math.floor(v * 255); }

  /* couleur du pixel (px, py) : renvoie out = [r, g, b] entre 0 et 255 */
  function pixel(px, py) {
    var u = (2 * (px + 0.5) / width - 1) * aspect * halfFov;
    var v = (1 - 2 * (py + 0.5) / height) * halfFov;
    var dx = F[0] + R[0] * u + U[0] * v, dy = F[1] + R[1] * u + U[1] * v, dz = F[2] + R[2] * u + U[2] * v;
    var l = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (l !== 0) { dx /= l; dy /= l; dz /= l; }
    if (closest(O[0], O[1], O[2], dx, dy, dz, 0.001, 1e9, rec)) {
      shade(rec, O[0], O[1], O[2]);
      out[0] = toInt(out[0]); out[1] = toInt(out[1]); out[2] = toInt(out[2]);
    } else { out[0] = 0; out[1] = 0; out[2] = 0; }
    return out;
  }

  var STEPS = [8, 4, 2, 1], pass = 0, y = 0;
  function row(yy, st, first) {
    for (var x = 0; x < width; x += st) {
      if (!first && yy % (st * 2) === 0 && x % (st * 2) === 0) continue;
      var c = pixel(x, yy);
      state.pixels++;
      var yEnd = Math.min(yy + st, height), xEnd = Math.min(x + st, width);
      for (var by = yy; by < yEnd; by++) {
        var o = (by * width + x) * 4;
        for (var bx = x; bx < xEnd; bx++, o += 4) { data[o] = c[0]; data[o + 1] = c[1]; data[o + 2] = c[2]; }
      }
    }
  }
  state.step = function (budgetMs) {
    var end = now() + budgetMs;
    while (!state.done) {
      row(y, STEPS[pass], pass === 0);
      y += STEPS[pass];
      if (y >= height) { y = 0; pass++; if (pass >= STEPS.length) state.done = true; }
      if (now() >= end) break;
    }
    return state.done;
  };
  /* toute l'image d'un coup, sans passes : pour l'aperçu pendant qu'on tourne la caméra */
  state.renderAll = function () {
    for (var yy = 0, o = 0; yy < height; yy++) {
      for (var x = 0; x < width; x++, o += 4) {
        var c = pixel(x, yy);
        data[o] = c[0]; data[o + 1] = c[1]; data[o + 2] = c[2];
      }
    }
    state.pixels = state.total; state.done = true;
    return state;
  };
  state.pixel = pixel;
  /* distance du premier objet vu au centre de l'image (sert à faire tourner la caméra autour) */
  state.centerDistance = function () {
    return closest(O[0], O[1], O[2], F[0], F[1], F[2], 0.001, 1e9, rec) ? rec.t : null;
  };
  return state;
}

/* taille du rendu : on garde les proportions du fichier, on change seulement la largeur */
function renderSize(cam, targetWidth) {
  if (!(cam.width > 0) || !(cam.height > 0)) throw new SceneError('Renderer : résolution invalide (width et height doivent être positifs)', cam.line);
  if (!targetWidth || targetWidth >= cam.width) targetWidth = cam.width;
  var h = Math.max(1, Math.round(targetWidth * cam.height / cam.width));
  if (targetWidth * h > 2560 * 1440) throw new SceneError('résolution trop grande pour cette page (maximum 2560 × 1440)', cam.line);
  return { width: targetWidth, height: h };
}

var api = {
  SceneError: SceneError, parseConfig: parseConfig, buildScene: buildScene, parseScene: parseScene,
  makeHit: makeHit, newRecord: newRecord,
  cameraBasis: cameraBasis, createRenderer: createRenderer, renderSize: renderSize
};
if (typeof module !== 'undefined' && module.exports) module.exports = api;
else root.RT = api;
})(typeof self !== 'undefined' ? self : this);
