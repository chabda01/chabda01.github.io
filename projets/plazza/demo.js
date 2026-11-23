/* The Plazza — interface de la démo. La simulation est dans core.js. */
(function () {
  'use strict';
  var P = window.Plazza;
  if (!P) return;

  /* 'origine' = Kitchen::accept comme dans le dépôt ; 'corrige' = variante de la page */
  var MODE_DEFAUT = 'origine';
  var MAX_PAR_LIGNE = 60;
  var PID = 4242; /* inventé : le vrai programme met son getpid() */

  var LEGER = (window.matchMedia && matchMedia('(pointer: coarse)').matches) || (navigator.hardwareConcurrency || 8) <= 4;
  var SANS_MOUVEMENT = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  var MAX_LIGNES = LEGER ? 90 : 220;
  var MAX_POINTS = LEGER ? 12 : 40;

  var ING = { Dough: 'Pâte', Tomato: 'Tomate', Gruyere: 'Gruyère', Ham: 'Jambon', Mushrooms: 'Champignons',
    Steak: 'Steak', Eggplant: 'Aubergine', GoatCheese: 'Chèvre', ChiefLove: 'Amour du chef' };
  var ING_COURT = { Dough: 'Pâte', Tomato: 'Tomate', Gruyere: 'Gruyère', Ham: 'Jambon', Mushrooms: 'Champ.',
    Steak: 'Steak', Eggplant: 'Auberg.', GoatCheese: 'Chèvre', ChiefLove: 'Amour' };

  var RUSH = [
    { dt: 0, line: 'margarita M x4; regina L x3' },
    { dt: 1200, line: 'americana XL x3; fantasia S x2' },
    { dt: 2400, line: 'regina XXL x4; margarita S x5' },
    { dt: 3600, line: 'fantasia L x3; americana M x4' },
    { dt: 4800, line: 'margarita XL x6' }
  ];

  function $(id) { return document.getElementById(id); }
  var elKits = $('kits'), elEmpty = $('empty'), elOut = $('out'), elIpc = $('ipc'), elClock = $('clock'),
    elLine = $('line'), elCmd = $('cmdline'), elStage = $('stage');

  var sim = null, mode = MODE_DEFAUT, speed = 1, script = [], cards = {};
  var raf = 0, last = 0, visible = true, avg = 16, frameNo = 0, points = 0;

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function setText(e, s) { if (e._t !== s) { e._t = s; e.textContent = s; } }
  function setClass(e, s) { if (e._c !== s) { e._c = s; e.className = s; } }
  function setScale(e, v) {
    v = Math.max(0, Math.min(1, v));
    var s = v.toFixed(3);
    if (e._s !== s) { e._s = s; e.style.transform = 'scaleX(' + s + ')'; }
  }
  function sec(ms, d) { return (ms / 1000).toFixed(d == null ? 1 : d).replace('.', ','); }
  function pizza(o) { return '#' + o.id + ' ' + P.PIZZAS[o.type].name + ' ' + o.size; }
  function base(p) { return p.slice(p.lastIndexOf('/') + 1); }

  /* ───── journaux ───── */
  function log(box, text, cls, extra) {
    var d = el('div', cls || '', text);
    if (extra) d.appendChild(extra);
    var bas = box.scrollHeight - box.scrollTop - box.clientHeight < 40;
    box.appendChild(d);
    while (box.childNodes.length > MAX_LIGNES) box.removeChild(box.firstChild);
    if (bas) box.scrollTop = box.scrollHeight;
  }
  function stamp(t) { var s = (t / 1000).toFixed(3); while (s.length < 7) s = ' ' + s; return s + '  '; }

  function consume(recs) {
    var parCarte = {};
    for (var i = 0; i < recs.length; i++) {
      var r = recs[i], c;
      if (r.kind === 'in') log(elOut, '> ' + r.text, 't-in');
      else if (r.kind === 'out') log(elOut, r.text, /ready/.test(r.text) ? 't-ok' : '');
      else if (r.kind === 'err') log(elOut, r.text, 't-err');
      else if (r.kind === 'open') {
        var k = kitchenById(r.kitchen);
        log(elIpc, stamp(r.t) + 'fork() → Cuisine ' + r.kitchen + ' · mkfifo ' + k.fifoOrders + ' et ' + k.fifoResults, 't-dim');
      } else if (r.kind === 'ipc') {
        var down = r.dir === 'down';
        var h = el('span', 't-hex', P.hex(r.bytes));
        var d = el('div', '', stamp(r.t) + (down ? 'R → C' + r.kitchen : 'C' + r.kitchen + ' → R') + '  ' + base(r.fifo) + '  ');
        d.appendChild(h);
        d.appendChild(document.createTextNode('  ' + (down ? 'PizzaOrder ' : 'PizzaResult ') + pizza(r.order) + (down ? '' : ' ready=1')));
        logNode(elIpc, d);
        c = cards[r.kitchen];
        if (c) {
          var key = r.kitchen + r.dir;
          parCarte[key] = (parCarte[key] || 0) + 1;
          pulse(down ? c.down : c.up, parCarte[key] - 1);
          if (down) c.nDown++; else c.nUp++;
        }
      } else if (r.kind === 'drop') {
        if (r.reason === 'stopping')
          log(elIpc, stamp(r.t) + 'C' + r.kitchen + ' ne lit plus son tube (fermeture en cours) : ' + pizza(r.order) + ' perdue', 't-err');
        else
          log(elIpc, stamp(r.t) + 'C' + r.kitchen + ' refuse ' + pizza(r.order) + ' : ' + r.active + ' en cours + ' + r.queued + ' en file ≥ ' + r.cap + ' — perdue, sans message', 't-err');
      } else if (r.kind === 'stopping') {
        log(elIpc, stamp(r.t) + 'C' + r.kitchen + ' : 5 s sans commande, rien en cours → sort de sa boucle', 't-dim');
      } else if (r.kind === 'eof') {
        log(elIpc, stamp(r.t) + 'C' + r.kitchen + ' → R  ' + base(r.fifo) + '  read() = 0 octet : la cuisine a fermé', 't-dim');
      } else if (r.kind === 'close') {
        closeCard(r.kitchen);
      } else if (r.kind === 'exit') {
        log(elOut, '(programme terminé — la prochaine commande le relance)', 't-dim');
        Object.keys(cards).forEach(function (id) { closeCard(+id); });
      }
    }
  }
  function logNode(box, d) {
    var bas = box.scrollHeight - box.scrollTop - box.clientHeight < 40;
    box.appendChild(d);
    while (box.childNodes.length > MAX_LIGNES) box.removeChild(box.firstChild);
    if (bas) box.scrollTop = box.scrollHeight;
  }

  function pulse(track, rang) {
    if (SANS_MOUVEMENT || points >= MAX_POINTS || rang > 7) return;
    var s = document.createElement('s');
    s.style.animationDelay = (rang * 70) + 'ms';
    points++;
    s.addEventListener('animationend', function () { points--; if (s.parentNode) s.parentNode.removeChild(s); });
    track.appendChild(s);
  }

  /* ───── cartes des cuisines ───── */
  function kitchenById(id) {
    var ks = sim.kitchens();
    for (var i = 0; i < ks.length; i++) if (ks[i].id === id) return ks[i];
    return null;
  }

  function buildCard(k) {
    var c = { k: k, nDown: 0, nUp: 0, cooks: [], stock: {}, stockPrev: {} };
    var a = el('article', 'kit');
    var head = el('header');
    head.appendChild(el('b', '', 'Cuisine ' + k.id));
    c.idle = el('span'); head.appendChild(c.idle);
    a.appendChild(head);

    var load = el('div', 'kit__load');
    c.pend = el('span'); c.real = el('span');
    var bar = el('i'); c.loadBar = el('u'); bar.appendChild(c.loadBar);
    load.appendChild(c.pend); load.appendChild(c.real); load.appendChild(bar);
    a.appendChild(load);

    function fifo(cls, label) {
      var f = el('div', 'fifo ' + cls);
      f.appendChild(el('span', '', label));
      var tr = el('i'); f.appendChild(tr);
      var n = el('em', '', '0'); f.appendChild(n);
      a.appendChild(f);
      return { track: tr, n: n };
    }
    var fd = fifo('fifo--down', '↓ ' + base(k.fifoOrders));
    var fu = fifo('fifo--up', '↑ ' + base(k.fifoResults));
    c.down = fd.track; c.downN = fd.n; c.up = fu.track; c.upN = fu.n;

    var h1 = el('h4', '', 'Cuisiniers '); h1.appendChild(el('em', '', '· threads')); a.appendChild(h1);
    var ul = el('ul', 'cooks');
    k.workers.forEach(function (w) {
      var li = el('li', 'cook');
      li.appendChild(el('b', '', 'C' + w.id));
      var txt = el('span'); li.appendChild(txt);
      var i = el('i'); var u = el('u'); i.appendChild(u); li.appendChild(i);
      ul.appendChild(li);
      c.cooks.push({ li: li, txt: txt, bar: u });
    });
    a.appendChild(ul);

    c.qTitle = el('h4', '', 'File de tâches'); a.appendChild(c.qTitle);
    c.queue = el('div', 'kit__queue'); a.appendChild(c.queue);

    var h3 = el('h4', '', 'Stock '); h3.appendChild(el('em', '', '· +1 de tout toutes les ' + sec(sim.cfg.restockMs) + ' s')); a.appendChild(h3);
    var st = el('div', 'kit__stock');
    P.INGREDIENTS.forEach(function (ing) {
      var s = el('span'); s.title = ING[ing];
      s.appendChild(document.createTextNode(ING_COURT[ing]));
      var b = el('b', '', '5'); s.appendChild(b);
      st.appendChild(s);
      c.stock[ing] = { box: s, n: b };
      c.stockPrev[ing] = P.INITIAL_STOCK;
    });
    a.appendChild(st);

    c.root = a;
    elKits.appendChild(a);
    cards[k.id] = c;
    return c;
  }

  function closeCard(id) {
    var c = cards[id];
    if (!c) return;
    delete cards[id];
    updateCard(c, true);
    c.root.className = 'kit is-closed';
    c.idle.textContent = 'fermée';
    setTimeout(function () { if (c.root.parentNode) c.root.parentNode.removeChild(c.root); showEmpty(); }, SANS_MOUVEMENT ? 600 : 1500);
  }

  function showEmpty() {
    var vide = !elKits.querySelector('.kit');
    elEmpty.hidden = !vide;
  }

  function updateCard(c, final) {
    var k = c.k, t = sim.t, cap = sim.capacity();
    var inside = k.active;
    if (!final) {
      setClass(c.root, 'kit' + (k.stopping ? ' is-stopping' : ''));
      if (k.stopping) setText(c.idle, 'ferme (attend son thread de stock)');
      else if (inside === 0) setText(c.idle, 'inactive · ferme dans ' + sec(Math.max(0, k.deadline - t)) + ' s');
      else setText(c.idle, 'au travail');
    }
    setText(c.pend, 'réception : pending=' + k.slot.pending + '/' + cap);
    setText(c.real, 'réellement : ' + inside);
    setClass(c.real, k.slot.pending !== inside ? 'is-gap' : '');
    setScale(c.loadBar, k.slot.pending / cap);
    setText(c.downN, String(c.nDown));
    setText(c.upN, String(c.nUp));

    for (var i = 0; i < k.workers.length; i++) {
      var w = k.workers[i], v = c.cooks[i];
      if (w.state === 'cook') {
        setClass(v.li, 'cook is-cook');
        setText(v.txt, 'cuit ' + pizza(w.order) + ' · ' + sec(Math.max(0, w.until - t)) + ' s');
        setScale(v.bar, (t - w.start) / (w.until - w.start));
      } else if (w.state === 'stock') {
        setClass(v.li, 'cook is-stock');
        setText(v.txt, 'attend le stock pour ' + pizza(w.order) + ' : manque ' + w.missing.map(function (m) { return ING[m]; }).join(', '));
        setScale(v.bar, 1 - Math.max(0, k.nextRestock - t) / sim.cfg.restockMs);
      } else {
        setClass(v.li, 'cook is-cond');
        setText(v.txt, 'dort · attend une tâche (variable de condition)');
        setScale(v.bar, 0);
      }
    }

    var q = k.queue.map(pizza).join('|');
    if (c.queue._q !== q) {
      c.queue._q = q;
      c.queue.textContent = '';
      if (!k.queue.length) c.queue.appendChild(el('em', '', 'vide'));
      k.queue.forEach(function (o) { c.queue.appendChild(el('span', '', pizza(o))); });
    }

    P.INGREDIENTS.forEach(function (ing) {
      var n = k.stock[ing], s = c.stock[ing];
      if (c.stockPrev[ing] !== n) {
        var up = n > c.stockPrev[ing];
        c.stockPrev[ing] = n;
        s.n.textContent = String(n);
        s.box.className = (n === 0 ? 'is-zero' : '') + (up ? ' is-up' : '');
        if (up) { clearTimeout(s.tm); s.tm = setTimeout(function () { s.box.className = c.stockPrev[ing] === 0 ? 'is-zero' : ''; }, 500); }
      }
    });
  }

  function render() {
    if (!sim) return;
    var ks = sim.kitchens();
    for (var i = 0; i < ks.length; i++) {
      var c = cards[ks[i].id] || buildCard(ks[i]);
      updateCard(c);
    }
    showEmpty();
    setText(elClock, 't = ' + sec(sim.t) + ' s (temps virtuel)' + (speed === 0 ? ' · en pause' : ''));
    setText($('s-sent'), String(sim.stats.sent));
    setText($('s-ready'), String(sim.stats.ready));
    setText($('s-lost'), String(sim.stats.refused));
    setClass($('s-lost-box'), 'stat' + (sim.stats.refused ? ' is-bad' : ''));
    setText($('s-kit'), String(sim.slots.length));
  }

  /* ───── boucle : temps virtuel, arrêtée hors écran ou sans rien à faire ───── */
  function active() {
    return visible && !document.hidden && speed > 0 && sim && !sim.exited && (sim.slots.length > 0 || script.length > 0);
  }
  function kick() {
    if (raf || !active()) return;
    last = performance.now();
    raf = requestAnimationFrame(frame);
  }
  function step(dt) {
    var target = sim.t + dt;
    while (script.length && script[0].t <= target) {
      var s = script.shift();
      sim.advance(s.t);
      sim.submit(s.line);
    }
    sim.advance(target);
    consume(sim.drain());
  }
  function frame(now) {
    raf = 0;
    if (!active()) { render(); return; }
    var real = now - last;
    last = now;
    avg += (real - avg) * 0.1;
    step(Math.min(100, real) * speed);
    frameNo++;
    /* machine lente : l'affichage passe à une image sur deux, la simulation reste exacte */
    if (avg < 28 || frameNo % 2 === 0) render();
    if (active()) raf = requestAnimationFrame(frame);
    else render();
  }

  /* ───── programme ───── */
  function readNum(id) { return parseFloat(String($(id).value).replace(',', '.')); }
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  function launch() {
    var m = readNum('a-mult'), c = readNum('a-cooks'), r = readNum('a-restock');
    Object.keys(cards).forEach(function (id) { var x = cards[id]; if (x.root.parentNode) x.root.parentNode.removeChild(x.root); });
    Array.prototype.slice.call(elKits.querySelectorAll('.kit')).forEach(function (n) { n.parentNode.removeChild(n); });
    cards = {}; script = []; points = 0;
    elOut.textContent = ''; elIpc.textContent = '';
    var cmd = './plazza ' + (isNaN(m) ? '?' : m) + ' ' + (isNaN(c) ? '?' : Math.trunc(c)) + ' ' + (isNaN(r) ? '?' : Math.trunc(r));
    elCmd.textContent = '$ ' + cmd;
    var err = P.checkConfig(m, c, r);
    if (err) {
      sim = null;
      log(elOut, '$ ' + cmd, 't-in');
      log(elOut, err, 't-err');
      log(elOut, '(le programme sort avec le code 84 — corrigez les arguments)', 't-dim');
      ['s-sent', 's-ready', 's-lost', 's-kit'].forEach(function (id) { setText($(id), '0'); });
      setClass($('s-lost-box'), 'stat');
      showEmpty();
      return false;
    }
    /* bornes de la page, pas du programme */
    var m2 = clamp(m, 0.1, 5), c2 = clamp(Math.trunc(c), 1, 8), r2 = clamp(Math.trunc(r), 200, 20000);
    if (m2 !== m || c2 !== c || r2 !== r) {
      $('a-mult').value = m2; $('a-cooks').value = c2; $('a-restock').value = r2;
      cmd = './plazza ' + m2 + ' ' + c2 + ' ' + r2;
      elCmd.textContent = '$ ' + cmd;
    }
    sim = new P.Sim({ multiplier: m2, cooks: c2, restockMs: r2 }, { fix: mode === 'corrige', pid: PID });
    log(elOut, '$ ' + cmd, 't-in');
    log(elIpc, '(aucun message pour l\'instant)', 't-dim');
    render();
    return true;
  }

  function send(line) {
    if (!sim || sim.exited) { if (!launch()) return; }
    var res = null;
    try { res = P.parse(line); } catch (e) { /* le programme affichera l'erreur */ }
    if (res && res.type === 'orders' && res.count > MAX_PAR_LIGNE) {
      log(elOut, '> ' + line, 't-in');
      log(elOut, '(page web : ' + MAX_PAR_LIGNE + ' pizzas au plus par ligne — le vrai programme n\'a pas cette limite)', 't-dim');
      return;
    }
    sim.submit(line);
    sim.advance(sim.t);
    consume(sim.drain());
    render();
    kick();
  }

  function rush() {
    if (!sim || sim.exited) { if (!launch()) return; }
    var t0 = sim.t;
    RUSH.forEach(function (r) { script.push({ t: t0 + r.dt, line: r.line }); });
    script.sort(function (a, b) { return a.t - b.t; });
    if (speed === 0) setSpeed(1);
    step(0);
    render();
    kick();
  }

  function setPressed(box, attr, val) {
    Array.prototype.forEach.call(box.querySelectorAll('.chip'), function (b) {
      b.setAttribute('aria-pressed', b.getAttribute(attr) === String(val) ? 'true' : 'false');
    });
  }
  function setSpeed(v) { speed = v; setPressed($('speeds'), 'data-speed', v); render(); kick(); }
  function setMode(v) {
    mode = v;
    if (sim) sim.fix = v === 'corrige';
    setPressed($('modes'), 'data-mode', v);
    $('mode-note').innerHTML = v === 'corrige'
      ? '<b>Ajout de la page.</b> La cuisine compte chaque pizza une seule fois. Plus aucune commande n\'est perdue pendant une rafale.'
      : '<b>Comme dans le dépôt.</b> La cuisine compte deux fois les pizzas en file. En rafale, elle en refuse une partie sans le dire&nbsp;: voir les lignes rouges du journal.';
  }

  /* ───── événements ───── */
  $('form').addEventListener('submit', function (e) { e.preventDefault(); send(elLine.value); });
  $('examples').addEventListener('click', function (e) {
    var b = e.target.closest ? e.target.closest('.chip') : null;
    if (!b) return;
    if (b.getAttribute('data-rush')) { rush(); return; }
    var l = b.getAttribute('data-line');
    elLine.value = l;
    send(l);
  });
  $('relaunch').addEventListener('click', launch);
  ['a-mult', 'a-cooks', 'a-restock'].forEach(function (id) { $(id).addEventListener('change', launch); });
  $('speeds').addEventListener('click', function (e) {
    var b = e.target.closest ? e.target.closest('.chip') : null;
    if (b) setSpeed(parseFloat(b.getAttribute('data-speed')));
  });
  $('modes').addEventListener('click', function (e) {
    var b = e.target.closest ? e.target.closest('.chip') : null;
    if (b) setMode(b.getAttribute('data-mode'));
  });
  document.addEventListener('visibilitychange', kick);
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(function (en) { visible = en[0].isIntersecting; kick(); }, { threshold: 0 }).observe(elStage);
  }

  setMode(MODE_DEFAUT);
  launch();
})();
