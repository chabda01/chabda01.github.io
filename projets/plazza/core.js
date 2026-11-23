/* The Plazza — cœur de la simulation, réécrit en JavaScript.
   Aucune dépendance, aucun accès au DOM : ce fichier se teste avec node.
   Les règles (grammaire, recettes, répartition, fermeture, octets des FIFO)
   reprennent le code C++ du projet : Parser.cpp, Reception.cpp, Kitchen.cpp,
   ThreadPool.cpp, IngredientStock.cpp, IPCPipe.hpp. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Plazza = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ───────── PizzaTypes.hpp ───────── */
  var INGREDIENTS = ['Dough', 'Tomato', 'Gruyere', 'Ham', 'Mushrooms', 'Steak',
    'Eggplant', 'GoatCheese', 'ChiefLove'];

  /* code = valeur de l'enum PizzaType ; time = secondes, avant le multiplicateur */
  var PIZZAS = {
    regina: { name: 'Regina', code: 1, time: 2, ing: ['Dough', 'Tomato', 'Gruyere', 'Ham', 'Mushrooms'] },
    margarita: { name: 'Margarita', code: 2, time: 1, ing: ['Dough', 'Tomato', 'Gruyere'] },
    americana: { name: 'Americana', code: 4, time: 2, ing: ['Dough', 'Tomato', 'Gruyere', 'Steak'] },
    fantasia: { name: 'Fantasia', code: 8, time: 4, ing: ['Dough', 'Tomato', 'Eggplant', 'GoatCheese', 'ChiefLove'] }
  };
  var SIZES = { S: 1, M: 2, L: 4, XL: 8, XXL: 16 };
  var TYPE_BY_CODE = {};
  Object.keys(PIZZAS).forEach(function (k) { TYPE_BY_CODE[PIZZAS[k].code] = k; });
  var SIZE_BY_CODE = {};
  Object.keys(SIZES).forEach(function (k) { SIZE_BY_CODE[SIZES[k]] = k; });

  var INITIAL_STOCK = 5;       /* IngredientStock::IngredientStock */
  var IDLE_TIMEOUT_MS = 5000;  /* Kitchen::run, idleTimeoutMs */

  /* ───────── Parser.cpp ───────── */
  function trim(s) { return s.replace(/^[ \t\r\n]+/, '').replace(/[ \t\r\n]+$/, ''); }

  function tokenize(s) {
    var out = s.split(/[ \t\n\v\f\r]+/);
    return out.filter(function (x) { return x.length > 0; });
  }

  function typeFromString(raw) {
    var s = raw.toLowerCase();
    if (Object.prototype.hasOwnProperty.call(PIZZAS, s)) return s;
    throw new Error('Unknown pizza type: ' + raw);
  }

  function sizeFromString(s) {
    if (Object.prototype.hasOwnProperty.call(SIZES, s)) return s;
    throw new Error('Unknown pizza size: ' + s);
  }

  function parseQuantity(token) {
    if (token.length === 0 || token[0] !== 'x')
      throw new Error("Invalid quantity '" + token + "': must start with 'x'");
    var digits = token.slice(1);
    if (digits.length === 0)
      throw new Error("Invalid quantity '" + token + "': no number after 'x'");
    if (!/^[0-9]+$/.test(digits))
      throw new Error("Invalid quantity '" + token + "': non-digit character");
    if (digits[0] === '0')
      throw new Error("Invalid quantity '" + token + "': must be a positive integer");
    /* std::stoi lève std::out_of_range au-delà d'un int : what() vaut "stoi" */
    if (digits.length > 10 || Number(digits) > 2147483647) throw new Error('stoi');
    return Number(digits);
  }

  function parseGroup(group, limit) {
    var tokens = tokenize(group);
    if (tokens.length !== 3)
      throw new Error("Invalid order '" + trim(group) + "': expected TYPE SIZE NUMBER");
    var type = typeFromString(tokens[0]);
    var size = sizeFromString(tokens[1]);
    var qty = parseQuantity(tokens[2]);
    return { type: type, size: size, qty: qty };
  }

  /* Rend { type: 'orders' | 'status' | 'exit', groups, count } ou lève une Error
     dont le message est celui du programme (affiché après « Error: »). */
  function parse(rawLine) {
    var line = trim(rawLine);
    if (line.length === 0) throw new Error('Empty command');
    var lower = line.toLowerCase();
    if (lower === 'status') return { type: 'status', groups: [], count: 0 };
    if (lower === 'exit' || lower === 'quit') return { type: 'exit', groups: [], count: 0 };
    var groups = [];
    var count = 0;
    line.split(';').forEach(function (part) {
      var g = trim(part);
      if (g.length === 0) throw new Error("Empty group: check for trailing or duplicate ';'");
      var parsed = parseGroup(g);
      groups.push(parsed);
      count += parsed.qty;
    });
    return { type: 'orders', groups: groups, count: count };
  }

  /* ───────── main.cpp : contrôle des trois arguments ───────── */
  function checkConfig(multiplier, cooks, restockMs) {
    if (!isFinite(multiplier) || !isFinite(cooks) || !isFinite(restockMs))
      return 'Error: invalid argument';
    if (multiplier <= 0) return 'Error: multiplier must be positive';
    if (Math.trunc(cooks) <= 0) return 'Error: cooks_per_kitchen must be at least 1';
    if (Math.trunc(restockMs) <= 0) return 'Error: restock_time must be positive';
    return null;
  }

  /* ───────── IPCPipe / FifoDescriptor : la structure est écrite telle quelle ───────── */
  function int32le(view, off, v) { view.setInt32(off, v, true); }

  /* struct PizzaOrder { int orderId; PizzaType type; PizzaSize size; } → 12 octets */
  function encodeOrder(o) {
    var b = new Uint8Array(12);
    var v = new DataView(b.buffer);
    int32le(v, 0, o.id); int32le(v, 4, PIZZAS[o.type].code); int32le(v, 8, SIZES[o.size]);
    return b;
  }

  /* struct PizzaResult { int orderId; PizzaType type; PizzaSize size; bool ready; }
     → 16 octets : 1 octet pour ready, 3 octets de bourrage */
  function encodeResult(o) {
    var b = new Uint8Array(16);
    var v = new DataView(b.buffer);
    int32le(v, 0, o.id); int32le(v, 4, PIZZAS[o.type].code); int32le(v, 8, SIZES[o.size]);
    b[12] = 1;
    return b;
  }

  function decodeOrder(b) {
    var v = new DataView(b.buffer, b.byteOffset, b.byteLength);
    return { id: v.getInt32(0, true), type: TYPE_BY_CODE[v.getInt32(4, true)], size: SIZE_BY_CODE[v.getInt32(8, true)] };
  }

  function hex(b) {
    var out = [];
    for (var i = 0; i < b.length; i++) out.push((b[i] < 16 ? '0' : '') + b[i].toString(16));
    return out.join(' ');
  }

  /* Cook::cook : sleep_for(duration<float>(cookingTime * multiplier)) */
  function cookMs(type, multiplier) {
    return Math.fround(PIZZAS[type].time * Math.fround(multiplier)) * 1000;
  }

  /* ───────── Simulation à temps virtuel ─────────
     cfg  : { multiplier, cooks, restockMs }
     opts : { fix: bool, pid: int }
       fix = false : Kitchen::accept compte comme le code d'origine
                     (_activePizzas + _pool.pending() >= 2 * cookCount)
       fix = true  : variante corrigée (_activePizzas >= 2 * cookCount)
     Le temps est en millisecondes. Rien ne dépend de l'horloge réelle. */
  function Sim(cfg, opts) {
    opts = opts || {};
    this.cfg = { multiplier: +cfg.multiplier, cooks: Math.trunc(cfg.cooks), restockMs: Math.trunc(cfg.restockMs) };
    this.fix = !!opts.fix;
    this.pid = opts.pid || 4242;
    this.t = 0;
    this.seq = 0;
    this.events = [];
    this.slots = [];          /* Reception::_kitchens, dans l'ordre d'ouverture */
    this.nextOrderId = 0;
    this.nextKitchenId = 0;
    this.pipeCounter = 0;
    this.exited = false;
    this.records = [];        /* tout ce qui s'est passé, à vider avec drain() */
    this.stats = { sent: 0, ready: 0, refused: 0, opened: 0, closed: 0, ipc: 0 };
  }

  Sim.prototype.capacity = function () { return 2 * this.cfg.cooks; };

  Sim.prototype.emit = function (rec) { rec.t = this.t; this.records.push(rec); };

  Sim.prototype.drain = function () { var r = this.records; this.records = []; return r; };

  Sim.prototype.schedule = function (t, type, k, data) {
    var ev = { t: t, seq: this.seq++, type: type, k: k, data: data };
    var a = this.events;
    var i = a.length;
    while (i > 0 && (a[i - 1].t > ev.t)) i--;
    a.splice(i, 0, ev);
  };

  Sim.prototype.nextEventTime = function () { return this.events.length ? this.events[0].t : Infinity; };

  /* Fait avancer le temps virtuel jusqu'à `to` en jouant les événements dans l'ordre. */
  Sim.prototype.advance = function (to) {
    while (this.events.length && this.events[0].t <= to) {
      var ev = this.events.shift();
      if (ev.t > this.t) this.t = ev.t;
      this.handle(ev);
    }
    if (to > this.t) this.t = to;
  };

  Sim.prototype.handle = function (ev) {
    var k = ev.k;
    if (k.closed) return;
    if (ev.type === 'wake') this.wake(k);
    else if (ev.type === 'done') this.cookDone(k, ev.data);
    else if (ev.type === 'restock') this.restock(k);
    else if (ev.type === 'idle') { if (ev.data === k.idleToken) this.idleTimeout(k); }
  };

  /* ── Réception ── */

  /* Reception::run : une ligne lue sur l'entrée standard */
  Sim.prototype.submit = function (line) {
    if (this.exited) return null;
    this.emit({ kind: 'in', text: line });
    var res;
    try { res = parse(line); }
    catch (e) { this.emit({ kind: 'err', text: 'Error: ' + e.message }); return null; }
    if (res.type === 'exit') { this.exit(); return res; }
    if (res.type === 'status') {
      var self = this;
      this.status().forEach(function (l) { self.emit({ kind: 'out', text: l }); });
      return res;
    }
    for (var g = 0; g < res.groups.length; g++) {
      for (var i = 0; i < res.groups[g].qty; i++) {
        var order = { id: this.nextOrderId++, type: res.groups[g].type, size: res.groups[g].size };
        this.dispatch(order);
      }
    }
    return res;
  };

  /* Reception::handleStatus — même texte que le programme */
  Sim.prototype.status = function () {
    if (this.slots.length === 0) return ['No kitchens open.'];
    var cap = this.capacity();
    return this.slots.map(function (s) { return 'Kitchen ' + s.id + ' | pending=' + s.pending + '/' + cap; });
  };

  /* Reception::findAvailableSlot : la première cuisine de la liste qui a de la place */
  Sim.prototype.findAvailableSlot = function () {
    for (var i = 0; i < this.slots.length; i++)
      if (this.slots[i].pending < 2 * this.cfg.cooks) return i;
    return -1;
  };

  /* Reception::dispatchPizza + sendOrder */
  Sim.prototype.dispatch = function (order) {
    var idx = this.findAvailableSlot();
    if (idx === -1) { this.spawnKitchen(); idx = this.findAvailableSlot(); }
    var slot = this.slots[idx];
    var bytes = encodeOrder(order);
    this.stats.sent++; this.stats.ipc++;
    this.emit({ kind: 'ipc', dir: 'down', kitchen: slot.id, fifo: slot.k.fifoOrders, bytes: bytes, order: order });
    slot.pending++;
    this.emit({ kind: 'out', text: '[Order ' + order.id + '] dispatched to Kitchen ' + slot.id });
    this.kitchenReceive(slot.k, order);
  };

  /* Reception::spawnKitchen : deux FIFO, puis fork() */
  Sim.prototype.spawnKitchen = function () {
    var id = this.nextKitchenId++;
    var k = {
      id: id,
      fifoOrders: '/tmp/plazza_' + this.pid + '_' + (this.pipeCounter++),
      fifoResults: '/tmp/plazza_' + this.pid + '_' + (this.pipeCounter++),
      workers: [], queue: [], active: 0, stock: {}, stockWaiters: [],
      idleToken: 0, deadline: 0, closed: false, stopping: false, stopAt: 0, nextRestock: this.t + this.cfg.restockMs, openedAt: this.t,
      received: 0, refused: 0, done: 0, restocks: 0
    };
    for (var i = 0; i < this.cfg.cooks; i++)
      k.workers.push({ id: i + 1, state: 'cond', order: null, since: this.t, start: 0, until: 0, missing: [] });
    INGREDIENTS.forEach(function (ing) { k.stock[ing] = INITIAL_STOCK; });
    var slot = { id: id, pending: 0, k: k };
    k.slot = slot;
    this.slots.push(slot);
    this.stats.opened++;
    this.emit({ kind: 'open', kitchen: id });
    this.emit({ kind: 'out', text: '[Kitchen ' + id + '] opened' });
    this.schedule(this.t + this.cfg.restockMs, 'restock', k);
    this.armIdle(k);
  };

  /* Reception::handleKitchenResult, cas normal */
  Sim.prototype.receptionResult = function (k, order) {
    var slot = k.slot;
    if (slot.pending > 0) slot.pending--;
    this.stats.ready++;
    this.emit({ kind: 'out', text: '[Order ' + order.id + '] ready (Kitchen ' + slot.id + ')' });
  };

  /* ── Cuisine (processus fils) ── */

  Sim.prototype.armIdle = function (k) {
    k.idleToken++;
    k.deadline = this.t + IDLE_TIMEOUT_MS;
    this.schedule(k.deadline, 'idle', k, k.idleToken);
  };

  /* Kitchen::run lit une commande, puis Kitchen::accept */
  Sim.prototype.kitchenReceive = function (k, order) {
    if (k.stopping) {
      /* Kitchen::run est déjà sorti : plus personne ne lit la FIFO des commandes */
      k.refused++; this.stats.refused++;
      this.emit({ kind: 'drop', reason: 'stopping', kitchen: k.id, order: order, active: 0, queued: 0, cap: 2 * this.cfg.cooks });
      return false;
    }
    k.received++;
    this.armIdle(k);                       /* poll() repart pour 5 s */
    var cap = 2 * this.cfg.cooks;
    var counted = this.fix ? k.active : k.active + k.queue.length;
    if (counted >= cap) {
      k.refused++; this.stats.refused++;
      this.emit({ kind: 'drop', reason: 'count', kitchen: k.id, order: order, active: k.active, queued: k.queue.length, cap: cap });
      return false;
    }
    k.active++;
    k.queue.push(order);                   /* ThreadPool::enqueue + notifyOne */
    /* Les cuisiniers endormis se réveillent juste après : toute la rafale
       est donc lue avant qu'un cuisinier ne prenne la première tâche. */
    this.schedule(this.t, 'wake', k);
    return true;
  };

  Sim.prototype.wake = function (k) {
    for (var i = 0; i < k.workers.length && k.queue.length; i++) {
      var w = k.workers[i];
      if (w.state === 'cond') { w.order = k.queue.shift(); this.tryStart(k, w, true); }
    }
  };

  Sim.prototype.missing = function (k, order) {
    return PIZZAS[order.type].ing.filter(function (ing) { return k.stock[ing] < 1; });
  };

  /* Kitchen::processOrder : consume() prend tout ou rien, sous le mutex du stock */
  Sim.prototype.tryStart = function (k, w, fresh) {
    var miss = this.missing(k, w.order);
    if (miss.length) {
      if (w.state !== 'stock') { w.state = 'stock'; w.since = this.t; k.stockWaiters.push(w); }
      w.missing = miss;
      return false;
    }
    PIZZAS[w.order.type].ing.forEach(function (ing) { k.stock[ing]--; });
    w.state = 'cook'; w.missing = [];
    w.start = this.t;
    w.until = this.t + cookMs(w.order.type, this.cfg.multiplier);
    this.emit({ kind: 'cook', kitchen: k.id, cook: w.id, order: w.order, until: w.until });
    this.schedule(w.until, 'done', k, w);
    return true;
  };

  Sim.prototype.cookDone = function (k, w) {
    var order = w.order;
    k.active--; k.done++;
    var bytes = encodeResult(order);
    this.stats.ipc++;
    this.emit({ kind: 'ipc', dir: 'up', kitchen: k.id, fifo: k.fifoResults, bytes: bytes, order: order });
    this.receptionResult(k, order);
    /* ThreadPool::workerLoop : tâche suivante, ou attente sur la variable de condition */
    w.order = null;
    if (k.queue.length) { w.order = k.queue.shift(); w.state = 'cond'; this.tryStart(k, w, true); }
    else { w.state = 'cond'; w.since = this.t; }
  };

  /* Kitchen::restockLoop + IngredientStock::refillOne : +1 de chaque ingrédient */
  Sim.prototype.restock = function (k) {
    /* ~Kitchen attend la fin du sleep du thread de stock (join) avant de sortir */
    if (k.stopping && this.t > k.stopAt) { this.closeKitchen(k); return; }
    INGREDIENTS.forEach(function (ing) { k.stock[ing]++; });
    k.restocks++;
    this.emit({ kind: 'restock', kitchen: k.id });
    var waiters = k.stockWaiters;
    k.stockWaiters = [];
    for (var i = 0; i < waiters.length; i++) {
      var w = waiters[i];
      if (!this.tryStart(k, w)) k.stockWaiters.push(w);
    }
    k.nextRestock = this.t + this.cfg.restockMs;
    this.schedule(k.nextRestock, 'restock', k);
  };

  /* Kitchen::run : poll() a attendu 5 s sans commande */
  Sim.prototype.idleTimeout = function (k) {
    if (k.active + k.queue.length === 0) {
      k.stopping = true; k.stopAt = this.t;
      this.emit({ kind: 'stopping', kitchen: k.id });
      return;
    }
    this.armIdle(k);
  };

  /* La cuisine sort : la réception lit 0 octet sur la FIFO des résultats */
  Sim.prototype.closeKitchen = function (k) {
    k.closed = true;
    var i = this.slots.indexOf(k.slot);
    if (i !== -1) this.slots.splice(i, 1);
    this.stats.closed++;
    this.emit({ kind: 'eof', kitchen: k.id, fifo: k.fifoResults });
    this.emit({ kind: 'close', kitchen: k.id, lost: k.slot.pending });
    this.emit({ kind: 'out', text: '[Kitchen ' + k.id + '] closed' });
  };

  Sim.prototype.exit = function () {
    this.exited = true;
    this.slots.forEach(function (s) { s.k.closed = true; });
    this.slots = [];
    this.events = [];
    this.emit({ kind: 'exit' });
  };

  Sim.prototype.kitchens = function () { return this.slots.map(function (s) { return s.k; }); };

  return {
    INGREDIENTS: INGREDIENTS, PIZZAS: PIZZAS, SIZES: SIZES,
    INITIAL_STOCK: INITIAL_STOCK, IDLE_TIMEOUT_MS: IDLE_TIMEOUT_MS,
    parse: parse, checkConfig: checkConfig, cookMs: cookMs,
    encodeOrder: encodeOrder, encodeResult: encodeResult, decodeOrder: decodeOrder, hex: hex,
    Sim: Sim
  };
});
