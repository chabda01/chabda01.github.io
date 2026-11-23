/* myFTP — interface de la démo. Le serveur lui-même est dans core.js. */
(function () {
  'use strict';
  var F = window.MyFTP;
  var LAT = 130;      // délai simulé d'un message sur le canal de contrôle (ms)
  var TICK = 80;      // un bloc de BUFFER_SIZE octets toutes les 80 ms sur le canal de données
  var PAUSE = 380;    // pause entre deux commandes d'un scénario
  var MAX_UPLOAD = 1024 * 1024;
  var BIG = '/sauvegardes/base_complete.sql';

  var $ = function (id) { return document.getElementById(id); };
  var elClients = $('clients'), elNet = $('net'), elTree = $('tree'), elLoop = $('loop');
  var elStatus = $('status'), elUpload = $('upload');
  var btnPlay = $('play'), btnDuo = $('duo'), btnSecond = $('second'), btnReset = $('reset');

  var srv, gen = 0, uis = {}, knownPaths = null, uploadFor = null, playing = false;

  var CHIPS = [
    ['Connexion', 'login'], ['Lister', 'list'], ['Entrer dans exports', 'cwd'], ['Remonter', 'cdup'],
    ['Télécharger un CSV', 'get'], ['Gros transfert lent', 'big'], ['Envoyer un fichier', 'put'],
    ['Lister en mode actif', 'port'], ['Aide', 'help'], ['Quitter', 'quit']
  ];

  /* ───────── petits outils ───────── */
  function el(tag, cls, txt) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (txt != null) e.textContent = txt;
    return e;
  }
  function later(fn, ms) {
    var g = gen;
    setTimeout(function () { if (g === gen) fn(); }, ms);
  }
  function wait(ms) { return new Promise(function (ok) { later(ok, ms); }); }
  function size(n) {
    if (n < 1024) return n + ' o';
    if (n < 1024 * 1024) return Math.round(n / 1024) + ' Ko';
    return (n / 1024 / 1024).toFixed(1).replace('.', ',') + ' Mo';
  }
  function status(t) { elStatus.textContent = t; }

  /* ───────── affichage ───────── */
  function print(ui, txt, cls) {
    var d = el('div', cls || '', txt);
    ui.term.appendChild(d);
    while (ui.term.childNodes.length > 300) ui.term.removeChild(ui.term.firstChild);
    ui.term.scrollTop = ui.term.scrollHeight;
    return d;
  }
  function printReply(ui, r) {
    var k = r.charAt(0);
    print(ui, r, k === '4' || k === '5' ? 't-err' : 't-ok');
  }
  function loop(lines, cls) {
    var last = null;
    (Array.isArray(lines) ? lines : [lines]).forEach(function (l) {
      last = el('div', cls || '', l);
      elLoop.appendChild(last);
    });
    while (elLoop.childNodes.length > 140) elLoop.removeChild(elLoop.firstChild);
    elLoop.scrollTop = elLoop.scrollHeight;
    return last;
  }

  function renderTree() {
    var paths = {};
    function walk(node, base) {
      var ul = el('ul');
      Object.keys(node.kids).sort(function (a, b) {
        var da = node.kids[a].dir, db = node.kids[b].dir;
        if (da !== db) return da ? -1 : 1;
        return a < b ? -1 : a > b ? 1 : 0;
      }).forEach(function (name) {
        var n = node.kids[name], p = base + '/' + name, li = el('li');
        var row = el('span', n.dir ? 'is-dir' : '');
        row.appendChild(el('span', 'tree__name', name + (n.dir ? '/' : '')));
        if (!n.dir) row.appendChild(el('small', '', size(n.data.length)));
        li.appendChild(row);
        paths[p] = true;
        if (knownPaths && !knownPaths[p]) li.className = 'is-new';
        if (n.dir) li.appendChild(walk(n, p));
        ul.appendChild(li);
      });
      return ul;
    }
    var root = walk(srv.fs, '');
    elTree.textContent = '';
    while (root.firstChild) elTree.appendChild(root.firstChild);
    if (!knownPaths) knownPaths = paths;
  }

  function renderStats() {
    var x = 0;
    Object.keys(uis).forEach(function (k) { if (uis[k].transfer) x++; });
    $('st-clients').textContent = srv.nb_clients;
    $('st-xfer').textContent = x;
  }

  var AUTH_FR = ['pas identifié', 'nom reçu, mot de passe attendu', 'identifié'];
  function renderState(ui) {
    var c = ui.c, on = c && c.ctrl_fd !== -1, t = ui.transfer;
    var rows = [], mode, wireTxt, wireCls = 'wire wire--data';
    if (!on) {
      rows = [['ctrl_fd', '-1', 'déconnecté']];
      wireTxt = 'données · fermé';
    } else {
      if (t) {
        mode = 'transfert ' + t.kind; wireCls += ' is-busy';
        wireTxt = 'données · ' + t.kind + ' ' + (ui.total ? Math.round(100 * ui.sent / ui.total) : 0) + ' %';
        rows.push(['données', mode, 'pid ' + t.pid + ', fd ' + t.fd]);
      } else if (F.dataMode(c) === 'pasv') {
        wireCls += ' is-open'; wireTxt = 'données · port ' + c.data_port + ' ouvert (PASV)';
        rows.push(['données', 'passif', 'écoute sur ' + c.data_port + ', fd ' + c.pasv_listen_fd]);
      } else if (F.dataMode(c) === 'port') {
        wireCls += ' is-open'; wireTxt = 'données · vers ' + c.data_ip + ':' + c.data_port + ' (PORT)';
        rows.push(['données', 'actif', 'vers ' + c.data_ip + ':' + c.data_port]);
      } else {
        wireTxt = 'données · fermé';
        rows.push(['données', 'aucun canal', 'PASV ou PORT d\'abord']);
      }
      rows.unshift(['ctrl_fd', String(c.ctrl_fd), 'connecté'],
        ['auth_state', F.AUTH_NAMES[c.auth_state], AUTH_FR[c.auth_state]],
        ['cwd', srv.home + (c.cwd.length ? F.vpath(c.cwd) : ''), '']);
    }
    ui.state.textContent = '';
    ui.state.appendChild(el('div', 'cstate__title', 'État vu par le serveur'));
    rows.forEach(function (r) {
      ui.state.appendChild(el('dt', '', r[0]));
      var dd = el('dd', '', r[1] + (r[2] ? ' ' : ''));
      if (r[2]) dd.appendChild(el('em', '', '· ' + r[2]));
      ui.state.appendChild(dd);
    });
    ui.fd.textContent = on ? 'fd ' + c.ctrl_fd : 'déconnecté';
    ui.reco.hidden = on;
    ui.row.classList.toggle('is-off', !on);
    ui.wCtrl.firstChild.textContent = on ? 'contrôle · port ' + srv.port : 'contrôle · fermé';
    ui.wData.className = wireCls;
    ui.wData.firstChild.textContent = wireTxt;
    ui.bar.style.width = t && ui.total ? Math.round(100 * ui.sent / ui.total) + '%' : (t ? '100%' : '0');
    renderStats();
  }

  function packet(ui, back) {
    var w = ui.wCtrl, p = el('em', 'pkt' + (back ? ' pkt--back' : ''));
    w.lastChild.appendChild(p);
    w.classList.add('is-hot');
    setTimeout(function () { p.remove(); w.classList.remove('is-hot'); }, LAT + 60);
  }

  /* ───────── construction d'un terminal ───────── */
  function build(id) {
    var ui = { id: id, c: null, transfer: null, sent: 0, total: 0, busy: false };
    var sec = el('section', 'cli');
    var head = el('div', 'cli__head');
    head.appendChild(el('b', '', 'Client ' + id));
    ui.fd = el('span', 'ftp-mono', '');
    ui.reco = el('button', 'chip', 'Se reconnecter'); ui.reco.type = 'button'; ui.reco.hidden = true;
    head.appendChild(ui.fd); head.appendChild(ui.reco);
    ui.term = el('div', 'term'); ui.term.setAttribute('role', 'log'); ui.term.tabIndex = 0;
    ui.term.setAttribute('aria-label', 'Terminal du client ' + id);
    var form = el('form', 'cli__in');
    form.appendChild(el('span', 'ftp-mono', 'ftp>'));
    ui.input = el('input');
    ui.input.setAttribute('aria-label', 'Commande FTP pour le client ' + id);
    ui.input.autocomplete = 'off'; ui.input.spellcheck = false;
    ui.input.setAttribute('autocapitalize', 'off');
    ui.input.placeholder = id === 'A' ? 'USER Anonymous' : 'PWD';
    var go = el('button', 'btn', 'Envoyer'); go.type = 'submit';
    form.appendChild(ui.input); form.appendChild(go);
    var chips = el('div', 'chips');
    CHIPS.forEach(function (c) {
      var b = el('button', 'chip', c[0]); b.type = 'button';
      b.addEventListener('click', function () { shortcut(ui, c[1]); });
      chips.appendChild(b);
    });
    ui.state = el('dl', 'cstate ftp-mono');
    sec.appendChild(head); sec.appendChild(ui.term); sec.appendChild(form); sec.appendChild(chips); sec.appendChild(ui.state);
    elClients.appendChild(sec);
    ui.sec = sec;

    ui.row = el('div', 'net__row');
    ui.row.appendChild(el('div', 'node', 'Client ' + id));
    var wires = el('div', 'wires');
    ui.wCtrl = el('div', 'wire wire--ctrl'); ui.wCtrl.appendChild(el('span', 'ftp-mono', '')); ui.wCtrl.appendChild(el('i'));
    ui.wData = el('div', 'wire wire--data'); ui.wData.appendChild(el('span', 'ftp-mono', ''));
    var line = el('i'); ui.bar = el('b'); line.appendChild(ui.bar); ui.wData.appendChild(line);
    wires.appendChild(ui.wCtrl); wires.appendChild(ui.wData);
    ui.row.appendChild(wires);
    elNet.appendChild(ui.row);

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var v = ui.input.value.trim();
      if (!v) return;
      ui.input.value = '';
      if (!ui.c || ui.c.ctrl_fd === -1) { print(ui, 'Pas de connexion. Cliquez sur « Se reconnecter ».', 't-dim'); return; }
      send(ui, v);
    });
    ui.reco.addEventListener('click', function () { connect(ui); });
    uis[id] = ui;
    return ui;
  }

  /* ───────── réseau simulé ───────── */
  function connect(ui) {
    var r = F.accept(srv);
    ui.c = r.client;
    loop(r.log);
    print(ui, 'Connexion à 127.0.0.1:' + srv.port + '…', 't-dim');
    renderState(ui);
    packet(ui, true);
    return new Promise(function (ok) {
      later(function () { r.replies.forEach(function (x) { printReply(ui, x); }); ok(); }, LAT);
    });
  }

  /* Envoie une ligne au serveur. La promesse rend les réponses, et « done » se termine avec le transfert. */
  function send(ui, line, payload) {
    print(ui, '> ' + line, 't-in');
    packet(ui, false);
    return new Promise(function (ok) {
      later(function () {
        var c = ui.c;
        if (!c || c.ctrl_fd === -1) { ok({ replies: [], done: null }); return; }
        var r = F.handleLine(srv, c, line), done = null;
        loop(r.log);
        if (r.closed && ui.transfer) stopTransfer(ui);
        if (r.transfer) done = runTransfer(ui, r.transfer, payload);
        renderState(ui);
        renderTree();
        packet(ui, true);
        later(function () {
          r.replies.forEach(function (x) { printReply(ui, x); });
          if (r.closed) print(ui, 'Connexion fermée par le serveur.', 't-dim');
          ok({ replies: r.replies, done: done });
        }, LAT);
      }, LAT);
    });
  }

  function sample() {
    return F.bytes('Fichier d\'essai envoyé depuis la démo myFTP.\n');
  }

  function runTransfer(ui, t, payload) {
    if (t.kind === 'STOR' && !payload) payload = sample();
    var data = t.kind === 'STOR' ? payload : t.bytes;
    var c = ui.c, g = gen;
    ui.transfer = t; ui.sent = 0; ui.total = data.length;
    var slow = data.length > F.BUFFER_SIZE;
    var verb = t.kind === 'STOR' ? 'reçus' : 'envoyés';
    var pLine = null, lLine = null;
    return new Promise(function (ok) {
      function step() {
        if (g !== gen || ui.transfer !== t) { ok(false); return; }
        ui.sent = Math.min(ui.total, ui.sent + F.BUFFER_SIZE);
        if (slow) {
          if (!pLine) { pLine = print(ui, '', 't-data'); lLine = loop('', 't-live'); }
          var pc = Math.round(100 * ui.sent / ui.total);
          pLine.textContent = 'canal de données : ' + size(ui.sent) + ' / ' + size(ui.total) + ' (' + pc + ' %)';
          lLine.textContent = 'pid ' + t.pid + ' : ' + pc + ' % ' + verb + ', par blocs de ' + F.BUFFER_SIZE + ' octets';
        }
        renderState(ui);
        if (ui.sent < ui.total) { setTimeout(step, TICK); return; }
        var r = F.finishTransfer(srv, c, t, payload);
        ui.transfer = null;
        if (lLine) lLine.className = '';
        loop(r.log);
        renderState(ui);
        renderTree();
        later(function () {
          showData(ui, t, data);
          r.replies.forEach(function (x) { printReply(ui, x); });
          ok(true);
        }, LAT);
      }
      setTimeout(step, LAT + 20);   // les octets partent après la réponse 150
    });
  }

  function stopTransfer(ui) {
    var t = ui.transfer;
    if (!t) return;
    ui.transfer = null;
    loop(F.abortTransfer(srv, ui.c, t).log);
  }

  function showData(ui, t, data) {
    if (t.kind === 'STOR') {
      print(ui, 'canal de données : ' + t.name + ' envoyé (' + size(data.length) + ')', 't-data');
      return;
    }
    var txt = F.text(data.length > 6000 ? data.subarray(0, 6000) : data);
    var lines = txt.replace(/\r/g, '').replace(/\n$/, '').split('\n');
    var max = t.kind === 'LIST' ? 40 : 9;
    if (t.kind === 'LIST' && lines.length === 1 && lines[0] === '') lines = ['(dossier vide)'];
    lines.slice(0, max).forEach(function (l) { print(ui, l, 't-data'); });
    if (lines.length > max || data.length > 6000) print(ui, '… la suite est dans le fichier (' + size(data.length) + ')', 't-data');
    if (t.kind === 'RETR') {
      var d = print(ui, '', 't-data');
      var b = el('button', 't-save', 'Enregistrer ' + t.name + ' sur mon ordinateur');
      b.type = 'button';
      b.addEventListener('click', function () {
        var url = URL.createObjectURL(new Blob([data], { type: 'application/octet-stream' }));
        var a = el('a'); a.href = url; a.download = t.name;
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
      });
      d.appendChild(b);
    }
  }

  /* ───────── scénarios ───────── */
  /* Joue une suite de commandes : chaque commande attend la réponse (et la fin du transfert) de la précédente. */
  function run(ui, steps) {
    if (ui.busy) return Promise.resolve();
    ui.busy = true;
    var g = gen;
    var p = Promise.resolve();
    if (!ui.c || ui.c.ctrl_fd === -1) p = connect(ui).then(function () { return wait(PAUSE); });
    steps.forEach(function (s, i) {
      p = p.then(function () {
        if (g !== gen || !ui.c || ui.c.ctrl_fd === -1) return null;
        var line = typeof s === 'string' ? s : s.line;
        return send(ui, line, s.payload).then(function (r) {
          if (s.nowait) return null;
          return r.done;
        }).then(function () { return i < steps.length - 1 ? wait(PAUSE) : null; });
      });
    });
    return p.then(function () { if (g === gen) ui.busy = false; });
  }

  function shortcut(ui, what) {
    if (ui.busy) return;
    switch (what) {
    case 'login': run(ui, ['USER ' + F.LOGIN, 'PASS']); break;
    case 'list': run(ui, ['PASV', 'LIST']); break;
    case 'cwd': run(ui, ['CWD /exports', 'PWD']); break;
    case 'cdup': run(ui, ['CDUP', 'PWD']); break;
    case 'get': run(ui, ['PASV', 'RETR /exports/commandes_2026-11.csv']); break;
    case 'big': run(ui, ['PASV', { line: 'RETR ' + BIG, nowait: true }]); break;
    case 'port': run(ui, ['PORT 127,0,0,1,195,80', 'LIST']); break;
    case 'help': run(ui, ['HELP']); break;
    case 'quit': run(ui, ['QUIT']); break;
    case 'put': uploadFor = ui; elUpload.value = ''; elUpload.click(); break;
    }
  }

  elUpload.addEventListener('change', function () {
    var f = elUpload.files && elUpload.files[0], ui = uploadFor;
    if (!f || !ui) return;
    if (f.size > MAX_UPLOAD) { print(ui, 'Fichier trop gros pour la démo (1 Mo au plus).', 't-err'); return; }
    var g = gen, rd = new FileReader();
    rd.onload = function () {
      if (g !== gen) return;
      var name = f.name.replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 60) || 'fichier';
      run(ui, ['PASV', { line: 'STOR /depot/' + name, payload: new Uint8Array(rd.result) }, 'PASV', 'LIST /depot']);
    };
    rd.readAsArrayBuffer(f);
  });

  function lock(on) {
    playing = on;
    btnPlay.disabled = on; btnDuo.disabled = on; btnSecond.disabled = on;
  }

  function openSecond(open) {
    var B = uis.B;
    if (open === !B.sec.hidden) return Promise.resolve();
    btnSecond.setAttribute('aria-pressed', open ? 'true' : 'false');
    btnSecond.textContent = open ? 'Fermer le deuxième client' : 'Ouvrir un deuxième client';
    B.sec.hidden = !open; B.row.hidden = !open;
    if (open) { B.term.textContent = ''; return connect(B); }
    if (B.c && B.c.ctrl_fd !== -1) {
      stopTransfer(B);
      loop(F.handleLine(srv, B.c, 'QUIT').log);
    }
    B.busy = false;
    renderState(B);
    return Promise.resolve();
  }

  function playSession() {
    var A = uis.A, g = gen;
    if (playing || A.busy) return;
    lock(true);
    status('Session en cours sur le client A…');
    run(A, ['USER ' + F.LOGIN, 'PASS', 'PWD', 'PASV', 'LIST', 'CWD exports', 'PASV',
      'RETR commandes_2026-11.csv', 'CDUP', 'PASV', 'STOR depot/note.txt', 'PASV', 'LIST depot',
      'DELE depot/note.txt', 'NOOP', 'QUIT']).then(function () {
      if (g !== gen) return;
      lock(false);
      status('Session terminée. Le client A a quitté (221).');
    });
  }

  function playDuo() {
    var A = uis.A, B = uis.B, g = gen;
    if (playing || A.busy || B.busy) return;
    lock(true);
    status('Deux clients : A et B se connectent…');
    openSecond(true).then(function () {
      return Promise.all([run(A, ['USER ' + F.LOGIN, 'PASS']), run(B, ['USER ' + F.LOGIN, 'PASS'])]);
    }).then(function () {
      if (g !== gen) return null;
      return wait(PAUSE);
    }).then(function () {
      if (g !== gen) return null;
      status('A reçoit un gros fichier. B continue de recevoir ses réponses.');
      A.busy = true;
      var big = send(A, 'PASV').then(function () { return send(A, 'RETR ' + BIG); })
        .then(function (r) { return r.done; });
      var small = wait(900).then(function () {
        return run(B, ['PWD', 'CWD factures', 'PASV', 'LIST', 'NOOP', 'PASV', 'RETR FAC-2026-0413.txt', 'CDUP', 'PWD', 'NOOP']);
      });
      return Promise.all([big, small]);
    }).then(function () {
      if (g !== gen) return;
      A.busy = false;
      lock(false);
      status('Terminé. B a été servi pendant tout le transfert de A.');
    });
  }

  function reset() {
    gen++;
    srv = F.createServer();
    knownPaths = null;
    elLoop.textContent = '';
    Object.keys(uis).forEach(function (k) {
      var u = uis[k];
      u.c = null; u.transfer = null; u.busy = false; u.term.textContent = ''; u.input.value = '';
    });
    uis.B.sec.hidden = true; uis.B.row.hidden = true;
    btnSecond.setAttribute('aria-pressed', 'false');
    btnSecond.textContent = 'Ouvrir un deuxième client';
    lock(false);
    status('Prêt');
    loop(['socket() + bind() + listen() sur le port ' + srv.port + ' → fd ' + srv.listen_fd,
      'boucle : poll() attend sur tous les descripteurs']);
    renderTree();
    renderState(uis.B);
    connect(uis.A);
  }

  btnPlay.addEventListener('click', playSession);
  btnDuo.addEventListener('click', playDuo);
  btnSecond.addEventListener('click', function () { if (!playing) openSecond(uis.B.sec.hidden); });
  btnReset.addEventListener('click', reset);

  build('A');
  build('B');
  reset();
})();
