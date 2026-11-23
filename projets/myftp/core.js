/* myFTP — cœur du serveur, réécrit en JavaScript.
   Aucune dépendance, aucun accès au DOM : ce fichier se teste avec node.
   Les noms (client_t, auth_state, pasv_listen_fd…) reprennent ceux du projet en C. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MyFTP = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var MAX_CLIENTS = 64;
  var BUFFER_SIZE = 4096;
  var CMD_SIZE = 1024;
  var AUTH_NONE = 0, AUTH_USER_SENT = 1, AUTH_LOGGED_IN = 2;
  var AUTH_NAMES = ['AUTH_NONE', 'AUTH_USER_SENT', 'AUTH_LOGGED_IN'];
  var COMMANDS = ['USER', 'PASS', 'CWD', 'CDUP', 'QUIT', 'DELE', 'PWD',
    'PASV', 'PORT', 'HELP', 'NOOP', 'RETR', 'STOR', 'LIST'];
  var LOGIN = 'Anonymous';
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  /* ───────── octets ───────── */
  var enc = new TextEncoder();
  var dec = new TextDecoder();
  function bytes(s) { return enc.encode(s); }
  function text(b) { return dec.decode(b); }

  /* ───────── système de fichiers virtuel ───────── */
  function dir(mtime, kids) { return { dir: true, kids: kids || {}, mtime: mtime }; }
  function file(mtime, content) {
    return { dir: false, data: typeof content === 'string' ? bytes(content) : content, mtime: mtime };
  }

  function pad(n, w) { n = String(n); while (n.length < w) n = '0' + n; return n; }

  /* Un gros fichier, pour montrer un transfert qui dure. Contenu généré, toujours le même. */
  function bigDump() {
    var villes = ['Cotonou', 'Lyon', 'Nantes', 'Lille', 'Paris', 'Bordeaux', 'Porto-Novo', 'Toulouse'];
    var etats = ['payee', 'expediee', 'livree', 'en_attente'];
    var out = ['-- Sauvegarde complete (donnees d\'exemple fictives)',
      'CREATE TABLE commandes (id INT PRIMARY KEY, client VARCHAR(12), ville VARCHAR(24), total_cts INT, etat VARCHAR(12), jour DATE);'];
    for (var i = 1; i <= 4200; i++) {
      out.push('INSERT INTO commandes VALUES (' + i + ', \'CLI-' + pad((i * 37) % 900 + 100, 4) + '\', \'' +
        villes[(i * 7) % villes.length] + '\', ' + ((i * 7919) % 48000 + 1500) + ', \'' +
        etats[(i * 3) % etats.length] + '\', \'2026-' + pad((i % 11) + 1, 2) + '-' + pad((i * 5) % 28 + 1, 2) + '\');');
    }
    out.push('-- fin de la sauvegarde');
    return out.join('\n') + '\n';
  }

  function createFS() {
    return dir('Nov 10 02:00', {
      'LISEZ-MOI.txt': file('Nov 03 09:12',
        'Serveur de fichiers de demonstration.\n' +
        'Toutes les donnees sont fictives : aucune entreprise, aucun client reel.\n' +
        'Deposez vos fichiers dans le dossier depot/.\n'),
      'exports': dir('Nov 10 06:30', {
        'commandes_2026-10.csv': file('Nov 01 06:30',
          'numero;date;client;produit;quantite;total_ttc\n' +
          'CMD-1041;2026-10-02;CLI-0012;Cartouche filtre A4;12;142.80\n' +
          'CMD-1042;2026-10-02;CLI-0031;Pompe 12V;1;89.00\n' +
          'CMD-1043;2026-10-05;CLI-0007;Joint torique 18mm;200;64.00\n' +
          'CMD-1044;2026-10-09;CLI-0012;Cartouche filtre A4;24;285.60\n' +
          'CMD-1045;2026-10-14;CLI-0044;Vanne laiton 3/4;6;111.60\n' +
          'CMD-1046;2026-10-21;CLI-0019;Pompe 12V;2;178.00\n' +
          'CMD-1047;2026-10-28;CLI-0031;Raccord rapide 16mm;40;92.00\n'),
        'commandes_2026-11.csv': file('Nov 10 06:30',
          'numero;date;client;produit;quantite;total_ttc\n' +
          'CMD-1048;2026-11-02;CLI-0007;Joint torique 18mm;150;48.00\n' +
          'CMD-1049;2026-11-03;CLI-0052;Vanne laiton 3/4;10;186.00\n' +
          'CMD-1050;2026-11-04;CLI-0012;Cartouche filtre A4;12;142.80\n' +
          'CMD-1051;2026-11-06;CLI-0019;Pompe 12V;1;89.00\n' +
          'CMD-1052;2026-11-09;CLI-0044;Raccord rapide 16mm;80;184.00\n')
      }),
      'factures': dir('Nov 09 17:45', {
        'FAC-2026-0412.txt': file('Nov 04 10:02',
          'FACTURE FAC-2026-0412            (document d\'exemple fictif)\n' +
          'Date : 2026-11-04      Client : CLI-0052\n' +
          '------------------------------------------------------\n' +
          'Vanne laiton 3/4        10 x 15.50      155.00\n' +
          '                        TVA 20 %         31.00\n' +
          '                        TOTAL TTC       186.00 EUR\n' +
          'Reglement a 30 jours.\n'),
        'FAC-2026-0413.txt': file('Nov 09 17:45',
          'FACTURE FAC-2026-0413            (document d\'exemple fictif)\n' +
          'Date : 2026-11-09      Client : CLI-0044\n' +
          '------------------------------------------------------\n' +
          'Raccord rapide 16mm     80 x 1.9167     153.33\n' +
          '                        TVA 20 %         30.67\n' +
          '                        TOTAL TTC       184.00 EUR\n' +
          'Reglement a 30 jours.\n')
      }),
      'sauvegardes': dir('Nov 10 02:00', {
        'base_2026-11-10.sql': file('Nov 10 02:00',
          '-- Sauvegarde de nuit (donnees d\'exemple fictives)\n' +
          'CREATE TABLE clients (id INT PRIMARY KEY, code VARCHAR(12), ville VARCHAR(24));\n' +
          'INSERT INTO clients VALUES (7, \'CLI-0007\', \'Cotonou\');\n' +
          'INSERT INTO clients VALUES (12, \'CLI-0012\', \'Lyon\');\n' +
          'INSERT INTO clients VALUES (19, \'CLI-0019\', \'Nantes\');\n' +
          'INSERT INTO clients VALUES (31, \'CLI-0031\', \'Lille\');\n' +
          'INSERT INTO clients VALUES (44, \'CLI-0044\', \'Paris\');\n' +
          'INSERT INTO clients VALUES (52, \'CLI-0052\', \'Bordeaux\');\n'),
        'base_complete.sql': file('Nov 10 02:00', bigDump())
      }),
      'journaux': dir('Nov 10 23:59', {
        'acces.log': file('Nov 10 23:59',
          '2026-11-10 06:30:02 export commandes_2026-11.csv ecrit (5 lignes)\n' +
          '2026-11-10 08:14:51 connexion comptabilite depuis 10.0.2.14\n' +
          '2026-11-10 08:15:03 RETR /factures/FAC-2026-0413.txt 226\n' +
          '2026-11-10 12:02:40 connexion entrepot depuis 10.0.3.8\n' +
          '2026-11-10 12:02:44 RETR /exports/commandes_2026-11.csv 226\n' +
          '2026-11-10 23:59:00 rotation du journal\n'),
        'erreurs.log': file('Nov 10 14:21',
          '2026-11-10 09:41:12 530 mot de passe refuse depuis 10.0.2.77\n' +
          '2026-11-10 14:21:30 550 /exports/commandes_2026-12.csv introuvable\n')
      }),
      'depot': dir('Nov 08 11:20', {})
    });
  }

  /* Chemin demandé → liste de noms depuis la racine du serveur. On ne sort jamais de la racine. */
  function resolve(cwd, arg) {
    var parts = (arg.charAt(0) === '/' ? [] : cwd.slice());
    arg.split('/').forEach(function (p) {
      if (p === '' || p === '.') return;
      if (p === '..') parts.pop();
      else parts.push(p);
    });
    return parts;
  }
  function lookup(fs, parts) {
    var n = fs;
    for (var i = 0; i < parts.length; i++) {
      if (!n || !n.dir || !Object.prototype.hasOwnProperty.call(n.kids, parts[i])) return null;
      n = n.kids[parts[i]];
    }
    return n;
  }
  function vpath(parts) { return '/' + parts.join('/'); }

  function listing(node, name) {
    function line(n, nm) {
      var size = String(n.dir ? 4096 : n.data.length);
      while (size.length < 7) size = ' ' + size;
      return (n.dir ? 'drwxr-xr-x 2' : '-rw-r--r-- 1') + ' ftp ftp ' + size + ' ' + n.mtime + ' ' + nm;
    }
    if (!node.dir) return line(node, name) + '\r\n';
    var names = Object.keys(node.kids).sort(function (a, b) {
      var da = node.kids[a].dir, db = node.kids[b].dir;
      if (da !== db) return da ? -1 : 1;
      return a < b ? -1 : a > b ? 1 : 0;
    });
    return names.map(function (nm) { return line(node.kids[nm], nm) + '\r\n'; }).join('');
  }

  /* ───────── serveur ───────── */
  function newClient() {
    return {
      ctrl_fd: -1, data_fd: -1, pasv_listen_fd: -1, auth_state: AUTH_NONE,
      cwd: [], cmd_buf: '', passive_mode: 0, data_ip: '', data_port: 0,
      user: '', index: -1
    };
  }

  function createServer(opts) {
    opts = opts || {};
    var srv = {
      listen_fd: 3,
      port: opts.port || 4242,
      home: opts.home || '/srv/ftp',
      fs: opts.fs || createFS(),
      clients: [],
      nb_clients: 0,
      fds: { 3: true },
      next_pid: 4311,
      next_pasv: 50001,
      clock: opts.clock || function () { return new Date(); }
    };
    for (var i = 0; i < MAX_CLIENTS; i++) srv.clients.push(newClient());
    return srv;
  }

  /* Comme le noyau : le plus petit descripteur libre. */
  function fdOpen(srv) { var fd = 4; while (srv.fds[fd]) fd++; srv.fds[fd] = true; return fd; }
  function fdClose(srv, fd) { if (fd > 0) delete srv.fds[fd]; }

  function watched(srv) { return 1 + srv.nb_clients; }

  function accept(srv) {
    var idx = -1, i;
    for (i = 0; i < MAX_CLIENTS; i++) if (srv.clients[i].ctrl_fd === -1) { idx = i; break; }
    if (idx === -1) return { client: null, replies: [], log: ['accept() refusé : ' + MAX_CLIENTS + ' clients déjà connectés'] };
    var c = newClient();
    c.index = idx;
    c.ctrl_fd = fdOpen(srv);
    srv.clients[idx] = c;
    srv.nb_clients++;
    return {
      client: c,
      replies: ['220 Service ready for new user.'],
      log: ['poll() → fd ' + srv.listen_fd + ' prêt : nouvelle connexion',
        'accept() → fd ' + c.ctrl_fd + ' (' + watched(srv) + ' descripteurs surveillés)']
    };
  }

  function closeData(srv, c) {
    if (c.pasv_listen_fd !== -1) { fdClose(srv, c.pasv_listen_fd); c.pasv_listen_fd = -1; }
    c.passive_mode = 0; c.data_ip = ''; c.data_port = 0;
  }

  function clientRemove(srv, c) {
    closeData(srv, c);
    fdClose(srv, c.ctrl_fd);
    c.ctrl_fd = -1;
    c.auth_state = AUTH_NONE;
    srv.nb_clients--;
  }

  function dataMode(c) {
    if (c.passive_mode) return 'pasv';
    if (c.data_port) return 'port';
    return 'none';
  }

  function stamp(srv) {
    var d = srv.clock();
    return MONTHS[d.getMonth()] + ' ' + pad(d.getDate(), 2) + ' ' + pad(d.getHours(), 2) + ':' + pad(d.getMinutes(), 2);
  }

  /* Ouvre le canal de données pour un transfert et rend la main tout de suite :
     c'est un processus enfant (fork) qui envoie ou reçoit les octets. */
  function startTransfer(srv, c, kind, parts, payload) {
    var t = {
      pid: srv.next_pid++, kind: kind, parts: parts, path: vpath(parts),
      name: parts.length ? parts[parts.length - 1] : '/',
      bytes: payload || null, total: payload ? payload.length : 0,
      mode: dataMode(c), port: c.data_port, ip: c.data_ip, client: c.index, fd: -1
    };
    if (c.pasv_listen_fd !== -1) { t.fd = c.pasv_listen_fd; c.pasv_listen_fd = -1; }
    else t.fd = fdOpen(srv);
    c.data_fd = t.fd;
    c.passive_mode = 0; c.data_ip = ''; c.data_port = 0;
    return t;
  }

  function transferLog(t) {
    return [(t.mode === 'pasv' ? 'accept() sur le port ' + t.port : 'connect() vers ' + t.ip + ':' + t.port) + ' → fd ' + t.fd,
      'fork() → pid ' + t.pid + ' s\'occupe de ' + t.kind + ' ; le parent retourne à poll()'];
  }

  var R = {
    need_login: '530 Please login with USER and PASS.',
    syntax: '501 Syntax error in parameters or arguments.',
    no_mode: '425 Use PORT or PASV first.',
    opening: '150 File status okay; about to open data connection.',
    okay: '200 Command okay.',
    done: '250 Requested file action okay, completed.'
  };

  function execute(srv, c, line) {
    var out = { replies: [], log: [], transfer: null, closed: false };
    var sp = line.indexOf(' ');
    var cmd = (sp === -1 ? line : line.slice(0, sp)).toUpperCase();
    var arg = sp === -1 ? '' : line.slice(sp + 1).trim();
    var parts, node, parent, name, m, nums, i;

    function say(r) { out.replies.push(r); }

    if (COMMANDS.indexOf(cmd) === -1) { say('500 Unknown command.'); return out; }

    if (cmd === 'QUIT') {
      say('221 Service closing control connection.');
      out.log.push('close(fd ' + c.ctrl_fd + ') : le client est parti');
      clientRemove(srv, c);
      out.closed = true;
      return out;
    }
    if (cmd === 'USER') {
      if (!arg) { say(R.syntax); return out; }
      c.user = arg; c.auth_state = AUTH_USER_SENT;
      say('331 User name okay, need password.');
      return out;
    }
    if (cmd === 'PASS') {
      if (c.auth_state === AUTH_LOGGED_IN) { say('230 User logged in, proceed.'); return out; }
      if (c.auth_state !== AUTH_USER_SENT) { say('332 Need account for login.'); return out; }
      if (c.user.toLowerCase() === LOGIN.toLowerCase() && arg === '') {
        c.auth_state = AUTH_LOGGED_IN; c.cwd = [];
        say('230 User logged in, proceed.');
      } else {
        c.auth_state = AUTH_NONE; c.user = '';
        say('530 Login incorrect.');
      }
      return out;
    }
    if (c.auth_state !== AUTH_LOGGED_IN) { say(R.need_login); return out; }

    switch (cmd) {
    case 'NOOP':
      say(R.okay); break;
    case 'HELP':
      say('214 Commands: ' + COMMANDS.join(' ')); break;
    case 'PWD':
      say('257 "' + vpath(c.cwd) + '" is the current directory.'); break;
    case 'CWD':
      if (!arg) { say(R.syntax); break; }
      parts = resolve(c.cwd, arg); node = lookup(srv.fs, parts);
      if (!node || !node.dir) { say('550 Failed to change directory.'); break; }
      c.cwd = parts; say(R.done); break;
    case 'CDUP':
      c.cwd = c.cwd.slice(0, -1); say(R.okay); break;
    case 'DELE':
      if (!arg) { say(R.syntax); break; }
      parts = resolve(c.cwd, arg); node = lookup(srv.fs, parts);
      if (!node || node.dir) { say('550 File not found.'); break; }
      delete lookup(srv.fs, parts.slice(0, -1)).kids[parts[parts.length - 1]];
      say(R.done); break;
    case 'PASV':
      closeData(srv, c);
      c.pasv_listen_fd = fdOpen(srv);
      c.passive_mode = 1; c.data_ip = '127.0.0.1'; c.data_port = srv.next_pasv++;
      if (srv.next_pasv > 65535) srv.next_pasv = 50001;
      out.log.push('socket() + bind() + listen() sur le port ' + c.data_port + ' → fd ' + c.pasv_listen_fd);
      say('227 Entering Passive Mode (127,0,0,1,' + (c.data_port >> 8) + ',' + (c.data_port & 255) + ').');
      break;
    case 'PORT':
      m = /^(\d{1,3}),(\d{1,3}),(\d{1,3}),(\d{1,3}),(\d{1,3}),(\d{1,3})$/.exec(arg);
      nums = m ? m.slice(1).map(Number) : [];
      for (i = 0; i < nums.length; i++) if (nums[i] > 255) m = null;
      if (!m) { say(R.syntax); break; }
      closeData(srv, c);
      c.data_ip = nums.slice(0, 4).join('.'); c.data_port = nums[4] * 256 + nums[5];
      say(R.okay); break;
    case 'LIST':
      if (dataMode(c) === 'none') { say(R.no_mode); break; }
      parts = arg ? resolve(c.cwd, arg) : c.cwd.slice(); node = lookup(srv.fs, parts);
      if (!node) { say('550 File not found.'); break; }
      out.transfer = startTransfer(srv, c, 'LIST', parts, bytes(listing(node, parts[parts.length - 1])));
      out.log = out.log.concat(transferLog(out.transfer));
      say(R.opening); break;
    case 'RETR':
      if (!arg) { say(R.syntax); break; }
      if (dataMode(c) === 'none') { say(R.no_mode); break; }
      parts = resolve(c.cwd, arg); node = lookup(srv.fs, parts);
      if (!node || node.dir) { say('550 File not found.'); break; }
      out.transfer = startTransfer(srv, c, 'RETR', parts, node.data);
      out.log = out.log.concat(transferLog(out.transfer));
      say(R.opening); break;
    case 'STOR':
      if (!arg) { say(R.syntax); break; }
      if (dataMode(c) === 'none') { say(R.no_mode); break; }
      parts = resolve(c.cwd, arg); name = parts[parts.length - 1];
      parent = lookup(srv.fs, parts.slice(0, -1)); node = lookup(srv.fs, parts);
      if (!name || !parent || !parent.dir || (node && node.dir)) { say('550 Cannot create file.'); break; }
      out.transfer = startTransfer(srv, c, 'STOR', parts, null);
      out.log = out.log.concat(transferLog(out.transfer));
      say(R.opening); break;
    }
    return out;
  }

  /* Les octets arrivent par morceaux : on les range dans cmd_buf et on traite chaque ligne finie. */
  function feed(srv, c, chunk) {
    var out = { replies: [], log: [], transfers: [], closed: false };
    if (c.ctrl_fd === -1) return out;
    out.log.push('poll() → fd ' + c.ctrl_fd + ' prêt : read() de ' + bytes(chunk).length + ' octets');
    c.cmd_buf += chunk;
    for (;;) {
      var nl = c.cmd_buf.indexOf('\n');
      if (nl === -1) break;
      var line = c.cmd_buf.slice(0, nl).replace(/\r$/, '');
      c.cmd_buf = c.cmd_buf.slice(nl + 1);
      if (line.trim() === '') continue;
      var fd = c.ctrl_fd;
      var r = execute(srv, c, line.trim());
      var pasv = /^pasv$/i.test(line.trim());
      if (pasv) out.log = out.log.concat(r.log);   // le port est ouvert avant la réponse 227
      r.replies.forEach(function (rep) {
        out.replies.push(rep);
        out.log.push('fd ' + fd + ' : « ' + line.trim().split(' ')[0].toUpperCase() + ' » → ' + rep.slice(0, 3));
      });
      if (!pasv) out.log = out.log.concat(r.log);
      if (r.transfer) out.transfers.push(r.transfer);
      if (r.closed) { out.closed = true; c.cmd_buf = ''; break; }
    }
    if (c.cmd_buf.length >= CMD_SIZE) {
      c.cmd_buf = '';
      out.replies.push('500 Command line too long.');
    }
    return out;
  }

  function handleLine(srv, c, line) {
    var r = feed(srv, c, line + '\r\n');
    r.transfer = r.transfers[0] || null;
    return r;
  }

  /* Fin d'un transfert : l'enfant ferme le canal de données et le serveur confirme sur le canal de contrôle. */
  function finishTransfer(srv, c, t, payload) {
    var out = { replies: [], log: [] };
    fdClose(srv, t.fd);
    if (c.data_fd === t.fd) c.data_fd = -1;
    if (t.kind === 'STOR') {
      var parent = lookup(srv.fs, t.parts.slice(0, -1));
      if (!parent || !parent.dir) {
        out.log.push('pid ' + t.pid + ' : écriture impossible');
        if (c.ctrl_fd !== -1) out.replies.push('550 Cannot create file.');
        return out;
      }
      parent.kids[t.name] = file(stamp(srv), payload || new Uint8Array(0));
      t.total = parent.kids[t.name].data.length;
    }
    out.log.push('pid ' + t.pid + ' : ' + t.kind + ' terminé (' + t.total + ' octets), close(fd ' + t.fd + ')');
    if (c.ctrl_fd !== -1) out.replies.push('226 Closing data connection.');
    return out;
  }

  function abortTransfer(srv, c, t) {
    fdClose(srv, t.fd);
    if (c.data_fd === t.fd) c.data_fd = -1;
    return { replies: [], log: ['pid ' + t.pid + ' : ' + t.kind + ' interrompu, close(fd ' + t.fd + ')'] };
  }

  return {
    MAX_CLIENTS: MAX_CLIENTS, BUFFER_SIZE: BUFFER_SIZE, CMD_SIZE: CMD_SIZE,
    AUTH_NONE: AUTH_NONE, AUTH_USER_SENT: AUTH_USER_SENT, AUTH_LOGGED_IN: AUTH_LOGGED_IN,
    AUTH_NAMES: AUTH_NAMES, COMMANDS: COMMANDS, LOGIN: LOGIN,
    bytes: bytes, text: text,
    createFS: createFS, resolve: resolve, lookup: lookup, vpath: vpath, listing: listing,
    createServer: createServer, accept: accept, feed: feed, handleLine: handleLine,
    finishTransfer: finishTransfer, abortTransfer: abortTransfer, dataMode: dataMode, watched: watched
  };
});
