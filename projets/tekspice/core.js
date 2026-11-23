/* NanoTekSpice — cœur du simulateur, réécrit en JavaScript.
   Reprend le projet C++ fichier par fichier : Parser.cpp, Circuit.cpp, Shell.cpp,
   AComponent.cpp et les composants. Fonctions pures, sans DOM : tourne aussi sous node. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.NTS = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // enum Tristate { Undefined = -1, True = 1, False = 0 }
  var U = -1, T = 1, F = 0;

  function NtsError(message, line) {
    this.name = 'NtsError';
    this.message = message;
    this.line = line || 0; // ligne du fichier en cours de lecture (0 = aucune)
  }
  NtsError.prototype = Object.create(Error.prototype);

  /* ───────── Utils.cpp ───────── */
  function isWs(c) { return c === ' ' || c === '\t' || c === '\n' || c === '\r'; }
  function trim(s) {
    var a = 0, b = s.length;
    while (a < b && isWs(s[a])) a++;
    while (b > a && isWs(s[b - 1])) b--;
    return s.slice(a, b);
  }
  function removeComment(s) {
    var p = s.indexOf('#');
    return p < 0 ? s : s.slice(0, p);
  }
  function splitWhitespace(s) {
    // cleanSpaces puis « stream >> token » (qui coupe aussi sur \v et \f)
    return s.split(/[ \t\n\r\v\f]+/).filter(function (t) { return t.length > 0; });
  }

  /* ───────── tables de vérité à trois états ───────── */
  function gAnd(a, b) { if (a === F || b === F) return F; if (a === T && b === T) return T; return U; }
  function gNand(a, b) { if (a === F || b === F) return T; if (a === T && b === T) return F; return U; }
  function gOr(a, b) { if (a === T || b === T) return T; if (a === F && b === F) return F; return U; }
  function gNor(a, b) { if (a === T || b === T) return F; if (a === F && b === F) return T; return U; }
  function gXor(a, b) { if (a === U || b === U) return U; return a !== b ? T : F; }
  function gNot(a) { if (a === T) return F; if (a === F) return T; return U; }

  // Portes à deux entrées d'une puce 40xx : sortie -> [entrée, entrée]
  var QUAD = { 3: [1, 2], 4: [5, 6], 10: [8, 9], 11: [12, 13] };
  // Puce 4069 (six inverseurs) : sortie -> entrée
  var HEX = { 2: 1, 4: 3, 6: 5, 8: 9, 10: 11, 12: 13 };

  // La fabrique de Circuit::createComponent : 17 types.
  var TYPES = {
    input: { kind: 'source' }, clock: { kind: 'source' }, 'true': { kind: 'source' }, 'false': { kind: 'source' },
    output: { kind: 'sink' },
    and: { kind: 'gate', fn: gAnd, gates: { 3: [1, 2] } },
    or: { kind: 'gate', fn: gOr, gates: { 3: [1, 2] } },
    xor: { kind: 'gate', fn: gXor, gates: { 3: [1, 2] } },
    nand: { kind: 'gate', fn: gNand, gates: { 3: [1, 2] } },
    nor: { kind: 'gate', fn: gNor, gates: { 3: [1, 2] } },
    not: { kind: 'gate', fn: gNot, gates: { 2: [1] } },
    '4081': { kind: 'chip', fn: gAnd, gates: QUAD },
    '4071': { kind: 'chip', fn: gOr, gates: QUAD },
    '4030': { kind: 'chip', fn: gXor, gates: QUAD },
    '4011': { kind: 'chip', fn: gNand, gates: QUAD },
    '4001': { kind: 'chip', fn: gNor, gates: QUAD },
    '4069': { kind: 'chip', fn: gNot, gates: {} }
  };
  Object.keys(HEX).forEach(function (o) { TYPES['4069'].gates[o] = [HEX[o]]; });
  Object.keys(TYPES).forEach(function (t) {
    var d = TYPES[t]; d.inputs = {};
    if (d.gates) Object.keys(d.gates).forEach(function (o) { d.gates[o].forEach(function (i) { d.inputs[i] = true; }); });
  });

  /* Rôle d'une broche : 'out' (elle donne une valeur), 'in' (elle en lit une) ou null (broche inconnue). */
  function pinRole(type, pin) {
    var d = TYPES[type];
    if (!d) return null;
    if (d.kind === 'source') return 'out';       // compute() ignore le numéro de broche
    if (d.kind === 'sink') return pin === 1 ? 'in' : null;
    if (d.gates[pin]) return 'out';
    if (d.inputs[pin]) return 'in';
    return null;
  }

  /* ───────── AComponent + composants ───────── */
  function Component(type, name) {
    this.type = type; this.name = name;
    this.links = {};            // broche -> [composant, broche] ; un nouveau lien remplace l'ancien
    this.computing = false;     // le garde anti-boucle de AComponent::getLink
    this.state = U;             // input, clock
    this.pendingSet = false; this.pendingState = U; // clock
  }
  var budget = { n: 0, max: Infinity };
  Component.prototype.getLink = function (pin) {
    var l = this.links[pin];
    if (!l) return U;
    if (this.computing) return U;   // déjà en cours de calcul : boucle -> indéfini
    if (++budget.n > budget.max) throw new NtsError('circuit trop profond pour cette page (calcul arrêté)');
    this.computing = true;
    var r;
    try { r = l[0].compute(l[1]); } finally { this.computing = false; }
    return r;
  };
  Component.prototype.compute = function (pin) {
    var t = this.type;
    if (t === 'input' || t === 'clock') return this.state;
    if (t === 'true') return T;
    if (t === 'false') return F;
    if (t === 'output') return pin === 1 ? this.getLink(1) : U;
    var d = TYPES[t], g = d.gates[pin];
    if (g) return g.length === 1 ? d.fn(this.getLink(g[0])) : d.fn(this.getLink(g[0]), this.getLink(g[1]));
    if (d.inputs[pin]) return this.getLink(pin);
    return U;
  };
  Component.prototype.simulate = function () {
    if (this.type !== 'clock') return;
    if (this.pendingSet) { this.state = this.pendingState; this.pendingSet = false; return; }
    if (this.state === T) this.state = F;
    else if (this.state === F) this.state = T;
  };

  /* ───────── Circuit.cpp ───────── */
  function byName(a, b) { return a < b ? -1 : a > b ? 1 : 0; }

  function Circuit() {
    this.components = [];   // [{type, name}] dans l'ordre du fichier
    this.links = [];        // [{c1, p1, c2, p2, line}]
    this.objects = {};
    this.inputValues = {};  // std::map : affiché trié par nom
    this.pending = {};
    this.outputValues = {};
    this.outputs = [];      // trié par nom
    this.tick = 0;
  }
  Circuit.prototype.exists = function (name) { return Object.prototype.hasOwnProperty.call(this.objects, name); };
  Circuit.prototype.typeOf = function (name) { return this.exists(name) ? this.objects[name].type : ''; };
  Circuit.prototype.addComponent = function (type, name) {
    if (this.exists(name)) throw new NtsError("Component '" + name + "' already exists");
    if (!Object.prototype.hasOwnProperty.call(TYPES, type)) throw new NtsError('Unknown component type: ' + type);
    this.components.push({ type: type, name: name });
    this.objects[name] = new Component(type, name);
    if (type === 'input' || type === 'clock') this.inputValues[name] = U;
    if (type === 'output') { this.outputs.push(name); this.outputs.sort(byName); this.outputValues[name] = U; }
  };
  Circuit.prototype.addLink = function (c1, p1, c2, p2, line) {
    if (!this.exists(c1)) throw new NtsError('Unknown component: ' + c1);
    if (!this.exists(c2)) throw new NtsError('Unknown component: ' + c2);
    this.links.push({ c1: c1, p1: p1, c2: c2, p2: p2, line: line || 0 });
    this.objects[c1].links[p1] = [this.objects[c2], p2];
    this.objects[c2].links[p2] = [this.objects[c1], p1];
  };
  Circuit.prototype.setValue = function (name, value) {
    if (!this.exists(name)) throw new NtsError('Unknown component: ' + name);
    var t = this.typeOf(name);
    if (t !== 'input' && t !== 'clock') throw new NtsError("Component '" + name + "' is not an input or clock");
    this.pending[name] = value;   // appliqué au prochain simulate
  };
  Circuit.prototype.inputNames = function () { return Object.keys(this.inputValues).sort(byName); };
  function ch(v) { return v === T ? '1' : v === F ? '0' : 'U'; }
  Circuit.prototype.display = function () {
    var s = 'tick: ' + this.tick + '\ninput(s):\n', self = this;
    this.inputNames().forEach(function (n) { s += '  ' + n + ': ' + ch(self.inputValues[n]) + '\n'; });
    s += 'output(s):\n';
    this.outputs.forEach(function (n) { s += '  ' + n + ': ' + ch(self.outputValues[n]) + '\n'; });
    return s;
  };
  Circuit.prototype.simulate = function () {
    var self = this, o = this.objects;
    Object.keys(this.pending).forEach(function (n) {
      var v = self.pending[n];
      self.inputValues[n] = v;
      if (o[n].type === 'input') o[n].state = v;
      if (o[n].type === 'clock') { o[n].pendingSet = true; o[n].pendingState = v; }
    });
    this.pending = {};
    this.tick++;
    Object.keys(o).forEach(function (n) { o[n].simulate(); });
    Object.keys(this.inputValues).forEach(function (n) {
      if (o[n].type === 'clock') self.inputValues[n] = o[n].compute(1);
    });
    budget.n = 0;
    this.outputs.forEach(function (n) { self.outputValues[n] = o[n].compute(1); });
  };

  /* ───────── Parser.cpp ───────── */
  var MAX64 = (BigInt(1) << BigInt(64)) - BigInt(1);
  // std::stoull : espaces, signe, chiffres ; le reste est ignoré ; « -1 » fait le tour du compteur.
  function stoull(s) {
    var m = /^[ \t\n\v\f\r]*([+-]?)([0-9]+)/.exec(s);
    if (!m) return null;
    var v = BigInt(m[2]);
    if (v > MAX64) return null;
    if (m[1] === '-' && v > BigInt(0)) v = MAX64 + BigInt(1) - v;
    return v <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(v) : v.toString();
  }
  function parse(text) {
    var circuit = new Circuit(), section = 0, n = 0;
    var lines = text.split('\n');
    if (lines.length && lines[lines.length - 1] === '') lines.pop();
    function syntax(msg) { return new NtsError('Line ' + n + ': ' + msg, n); }
    function parsePin(tok) {
      var c = tok.indexOf(':');
      if (c < 0) throw syntax("Invalid pin format (expected 'component:pin')");
      var comp = tok.slice(0, c), ps = tok.slice(c + 1);
      if (comp === '') throw syntax('Empty component name');
      var pin = stoull(ps);
      if (pin === null) throw syntax('Invalid pin number: ' + ps);
      if (pin === 0) throw syntax('Pin numbers start at 1');
      return [comp, pin];
    }
    for (var i = 0; i < lines.length; i++) {
      n = i + 1;
      var line = trim(removeComment(lines[i]));
      if (line === '') continue;
      if (line === '.chipsets:') { section = 1; continue; }
      if (line === '.links:') { section = 2; continue; }
      var tok;
      try {
        if (section === 1) {
          tok = splitWhitespace(line);
          if (tok.length !== 2) throw syntax("Invalid chipset declaration (expected 'type name')");
          circuit.addComponent(tok[0], tok[1]);
        } else if (section === 2) {
          tok = splitWhitespace(line);
          if (tok.length !== 2) throw syntax("Invalid link declaration (expected 'comp1:pin comp2:pin')");
          var a = parsePin(tok[0]), b = parsePin(tok[1]);
          circuit.addLink(a[0], a[1], b[0], b[1], n);
        } else {
          throw syntax('Content outside of section');
        }
      } catch (e) {
        if (e instanceof NtsError && !e.line) e.line = n; // le vrai message n'a pas toujours la ligne : on la garde à part
        throw e;
      }
    }
    if (circuit.components.length === 0) throw new NtsError('Circuit contains no components');
    return circuit;
  }

  /* ───────── Shell.cpp ───────── */
  var HELP = '  exit\n    Quit the program\n\n  display\n    Display current tick and all input/output values\n\n' +
    '  simulate\n    Run one simulation tick\n\n  loop\n    Continuously simulate and display (CTRL+C to stop)\n\n' +
    '  help\n    Show this help message\n\n';
  /* Exécute une ligne tapée. Renvoie {out, err, exit, loop, simulated}. */
  function exec(circuit, line) {
    var r = { out: '', err: '', exit: false, loop: false, simulated: false };
    if (trim(line) === '') return r;
    var cmd = trim(line);
    try {
      var eq = cmd.indexOf('=');
      if (eq >= 0) {
        var name = trim(cmd.slice(0, eq)), vs = trim(cmd.slice(eq + 1)), v;
        if (name === '') throw new NtsError('Empty component name');
        if (vs === '1') v = T; else if (vs === '0') v = F; else if (vs === 'U' || vs === 'u') v = U;
        else throw new NtsError('Invalid value: ' + vs + ' (expected 0, 1, or U)');
        circuit.setValue(name, v);
        return r;
      }
      var args = splitWhitespace(cmd);
      if (!args.length) return r;
      switch (args[0]) {
        case 'exit': r.exit = true; break;
        case 'display': r.out = circuit.display(); break;
        case 'simulate': circuit.simulate(); r.simulated = true; break;
        case 'loop': r.loop = true; break;
        case 'help': r.out = HELP; break;
        default: r.err = 'Unknown command: ' + args[0] + '\n';
      }
    } catch (e) {
      if (!(e instanceof NtsError)) throw e;
      r.err = 'Error: ' + e.message + '\n';
    }
    return r;
  }

  /* ───────── pour le schéma (ajout de la page, lecture seule) ─────────
     Pour chaque lien du fichier : dans quel sens la valeur circule, et laquelle.
     Un lien est « vivant » côté A si A garde encore ce lien sur sa broche (pas remplacé par un lien plus récent). */
  function wires(circuit, max) {
    var o = circuit.objects;
    budget.n = 0; budget.max = max || 200000;
    try {
      return circuit.links.map(function (l, i) {
        var A = o[l.c1], B = o[l.c2];
        var ra = pinRole(A.type, l.p1), rb = pinRole(B.type, l.p2);
        var la = A.links[l.p1] && A.links[l.p1][0] === B && A.links[l.p1][1] === l.p2;
        var lb = B.links[l.p2] && B.links[l.p2][0] === A && B.links[l.p2][1] === l.p1;
        var intoA = ra === 'in' && la, intoB = rb === 'in' && lb;
        var w = { i: i, line: l.line, a: { name: l.c1, pin: l.p1, role: ra }, b: { name: l.c2, pin: l.p2, role: rb }, flow: 'none', value: null };
        if (intoB) { w.flow = 'ab'; w.value = A.compute(l.p1); }
        else if (intoA) { w.flow = 'ba'; w.value = B.compute(l.p2); }
        return w;
      });
    } finally { budget.max = Infinity; }
  }

  return { U: U, T: T, F: F, TYPES: TYPES, NtsError: NtsError, Circuit: Circuit, parse: parse, exec: exec,
    wires: wires, pinRole: pinRole, ch: ch, HELP: HELP };
});
