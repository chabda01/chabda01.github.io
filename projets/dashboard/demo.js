/* Dashboard — la page. Les règles et le faux serveur sont dans core.js. */
(function () {
  'use strict';
  var C = window.DashCore;
  var $ = function (id) { return document.getElementById(id); };
  var LS_KEY = 'portfolio.dashboard.v1';
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var light = window.matchMedia('(max-width: 640px)').matches;   // petit écran : tableau plus court
  var grid = $('grid');

  var st = { profile: 'equipe', catalog: [], widgets: [], status: 'loading', epoch: 0, calls: 0,
    menuId: null, expandedId: null, outage: false, running: true };
  var server = null, modal = null, drag = null, pendM = null, pendT = null, justDragged = false;

  /* ───────────── petits outils ───────────── */

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function status(t) { $('status').textContent = t; }
  function announce(t) { $('live').textContent = t; }
  function clock(d) { return d.toLocaleTimeString('fr-FR'); }
  function left(ms) {
    var s = Math.max(0, Math.ceil(ms / 1000));
    if (s >= 3600) return Math.floor(s / 3600) + ' h ' + Math.floor((s % 3600) / 60) + ' min';
    if (s >= 60) return Math.floor(s / 60) + ' min ' + (s % 60) + ' s';
    return s + ' s';
  }
  function byId(id) { return st.widgets.filter(function (w) { return w.id === id; })[0] || null; }

  var ICONS = {
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    cloud: '<path d="M6.5 19a4.5 4.5 0 0 1-.4-8.98A6 6 0 0 1 17.7 11.1 4 4 0 0 1 17 19z"/>',
    cloudsun: '<path d="M10 3v1.5M4.6 5.6l1.1 1.1M3 11h1.5M15.4 5.6l-1.1 1.1M7.2 10.5a3.5 3.5 0 0 1 5.6-2.3"/><path d="M9.5 20a3.5 3.5 0 0 1-.3-6.98A4.7 4.7 0 0 1 18.3 13.9 3.1 3.1 0 0 1 17.8 20z"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
    rain: '<path d="M6.5 16a4.5 4.5 0 0 1-.4-8.98A6 6 0 0 1 17.7 8.1 4 4 0 0 1 17 16z"/><path d="M8 19v2M12 19v2M16 19v2"/>',
    drizzle: '<path d="M6.5 16a4.5 4.5 0 0 1-.4-8.98A6 6 0 0 1 17.7 8.1 4 4 0 0 1 17 16z"/><path d="M8 19v1M12 20v1M16 19v1"/>',
    snow: '<path d="M6.5 16a4.5 4.5 0 0 1-.4-8.98A6 6 0 0 1 17.7 8.1 4 4 0 0 1 17 16z"/><path d="M8 20h.01M12 21h.01M16 20h.01"/>',
    lightning: '<path d="M6.5 16a4.5 4.5 0 0 1-.4-8.98A6 6 0 0 1 17.7 8.1 4 4 0 0 1 17 16z"/><path d="M13 17l-2 3h3l-2 3"/>',
    fog: '<path d="M6.5 16a4.5 4.5 0 0 1-.4-8.98A6 6 0 0 1 17.7 8.1 4 4 0 0 1 17 16z"/><path d="M5 19.5h14M8 22.5h8"/>',
    drop: '<path d="M12 3s6 6.2 6 10.5a6 6 0 0 1-12 0C6 9.2 12 3 12 3z"/>',
    github: '<circle cx="6" cy="6" r="2.5"/><circle cx="6" cy="18" r="2.5"/><circle cx="18" cy="8" r="2.5"/><path d="M6 8.5v7M18 10.5a6 6 0 0 1-6 6H8.5"/>',
    rss: '<path d="M5 5a14 14 0 0 1 14 14M5 11a8 8 0 0 1 8 8"/><circle cx="6" cy="18" r="1.5"/>',
    hackernews: '<path d="M12 3c1 3.5 5 5.5 5 10a5 5 0 0 1-10 0c0-2 1-3.2 2-4.2.3 1.6 1 2.4 2 2.7C10.6 9 11 6 12 3z"/>',
    currency: '<circle cx="9" cy="9" r="6"/><path d="M16.04 9.09A6 6 0 1 1 9.09 16.04"/>',
    gmail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3.5 7l8.5 6 8.5-6"/>',
    dots: '<circle cx="5" cy="12" r="1.3" fill="currentColor"/><circle cx="12" cy="12" r="1.3" fill="currentColor"/><circle cx="19" cy="12" r="1.3" fill="currentColor"/>',
    commit: '<circle cx="12" cy="12" r="3.5"/><path d="M2 12h6.5M15.5 12H22"/>',
    issue: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="1.5" fill="currentColor"/>',
    pr: '<circle cx="6" cy="6" r="2.5"/><circle cx="6" cy="18" r="2.5"/><circle cx="18" cy="18" r="2.5"/><path d="M6 8.5v7M18 15.5V11a3 3 0 0 0-3-3h-3M14 5.5L11.5 8 14 10.5"/>',
    star: '<path d="M12 3l2.7 5.6 6.1.8-4.5 4.3 1.1 6.1L12 16.9 6.6 19.8l1.1-6.1L3.2 9.4l6.1-.8z"/>',
    up: '<path d="M12 19V5M6 11l6-6 6 6"/>',
    msg: '<path d="M4 5h16v11H9l-5 4z"/>',
    trendup: '<path d="M3 17l6-6 4 4 8-8M15 7h6v6"/>',
    trenddown: '<path d="M3 7l6 6 4-4 8 8M15 17h6v-6"/>',
    pin: '<path d="M12 21s-6.5-5.6-6.5-10.5a6.5 6.5 0 0 1 13 0C18.5 15.4 12 21 12 21z"/><circle cx="12" cy="10.5" r="2.3"/>'
  };
  ICONS.weather = ICONS.cloudsun; ICONS.primary = ICONS.clock;
  function ic(name) {
    return '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + ICONS[name] + '</svg>';
  }

  /* ───────────── sauvegarde dans le navigateur ───────────── */

  function loadSaved() {
    try { var s = localStorage.getItem(LS_KEY); return s ? JSON.parse(s) : null; } catch (e) { return null; }
  }
  function save() {
    try { localStorage.setItem(LS_KEY, JSON.stringify({ v: 1, profile: st.profile, db: server.dump() })); } catch (e) { /* stockage refusé */ }
  }

  /* ───────────── le Timer central (Timer.ts) ───────────── */
  // Ajouts pour la page : l'heure du prochain tour (compte à rebours) et la pause.
  var timer = {
    map: {}, paused: false, pausedAt: 0,
    start: function (e) {
      e.next = Date.now() + e.ms;
      e.h = setInterval(function () { e.next = Date.now() + e.ms; e.cb(); }, e.ms);
    },
    register: function (id, seconds, cb) {
      this.unregister(id);
      var e = { ms: Math.max(1, seconds) * 1000, cb: cb, h: null, next: 0 };
      this.map[id] = e;
      if (!this.paused) this.start(e); else e.next = Date.now() + e.ms;
    },
    unregister: function (id) {
      var e = this.map[id];
      if (e) { clearInterval(e.h); delete this.map[id]; }
    },
    pause: function () {
      if (this.paused) return;
      this.paused = true; this.pausedAt = Date.now();
      for (var id in this.map) clearInterval(this.map[id].h);
    },
    resume: function () {
      if (!this.paused) return;
      this.paused = false;
      var away = Date.now() - this.pausedAt;
      for (var id in this.map) { var e = this.map[id]; this.start(e); if (away >= e.ms) e.cb(); }
    },
    nextAt: function (id) { return this.map[id] ? this.map[id].next : 0; }
  };

  /* ───────────── appels à l'API (simulée) et journal ───────────── */

  function api(method, path, body) {
    var epoch = st.epoch;
    return new Promise(function (resolve, reject) {
      setTimeout(function () {
        if (epoch !== st.epoch) return;                    // le tableau a été remplacé entre-temps
        var now = Date.now();
        var r = server.handle(method, path, body, now);
        st.calls++;
        logCall(method, path, body, r, now);
        if (method !== 'GET') save();
        paintStats();
        if (r.status >= 400) reject({ status: r.status, message: (r.body && r.body.error) || 'Une erreur est survenue.', details: r.body });
        else resolve(r.body);
      }, 90 + Math.random() * 180);
    });
  }

  function logLine(html, cls) {
    var log = $('log'), near = log.scrollHeight - log.scrollTop - log.clientHeight < 40;
    var d = document.createElement('div');
    if (cls) d.className = cls;
    d.innerHTML = html;
    log.appendChild(d);
    while (log.children.length > 120) log.removeChild(log.firstChild);
    if (near) log.scrollTop = log.scrollHeight;
  }
  function logCall(method, path, body, r, now) {
    var h = '<span class="t-dim">' + clock(new Date(now)) + '</span> <span class="t-in">' + method + '</span> ' + esc(path) +
      ' <span class="' + (r.status >= 400 ? 't-err' : 't-ok') + '">' + r.status + '</span>';
    if (body) h += ' <span class="t-dim">' + esc(JSON.stringify(body)) + '</span>';
    if (r.cache === 'HIT') h += ' <span class="t-dim">· cache</span>';
    if (r.cache === 'MISS') h += ' <span class="t-dim">· lecture du service ' + esc(r.key.split('/')[0]) + '</span>';
    if (r.status >= 400 && r.body) h += ' <span class="t-err">' + esc(r.body.error) + '</span>';
    logLine(h);
  }
  function paintStats() {
    var s = server.stats();
    $('sCalls').textContent = st.calls;
    $('sWidgets').textContent = st.widgets.length;
    $('sMiss').textContent = s.misses;
    $('sHit').textContent = s.hits;
  }

  /* ───────────── affichage de chaque widget (components/widgets/data) ───────────── */

  function fake(url, inner, cls) {
    return '<a href="#" draggable="false" data-fake="' + esc(url) + '"' + (cls ? ' class="' + cls + '"' : '') + '>' + inner + '</a>';
  }
  function rel(v) { return esc(C.formatRelative(v, Date.now())); }
  function x(on) { return on ? ' is-x' : ''; }

  var RENDER = {
    'weather/city_temperature': function (d, big) {
      var unit = d.units === 'imperial' ? '°F' : '°C';
      var hum = Math.min(100, Math.max(0, d.humidity));
      var cond = d.conditions ? C.capitalizeFirst(d.conditions) : 'Conditions inconnues';
      return '<div class="wt' + x(big) + '"><div class="tile wt__main"><div><div class="wt__t">' + Math.round(d.temperature) + '<span>' + unit + '</span></div>' +
        '<div class="wt__feel">Ressenti ' + Math.round(d.feelsLike) + unit + '</div><div class="trunc wt__cond">' + esc(cond) + '</div></div>' +
        ic(C.weatherIconName(d.conditions)) + '</div>' +
        '<div class="tile wt__hum"><div><span class="lbl">' + ic('drop') + 'Humidité</span><b>' + d.humidity + ' %</b></div>' +
        '<div class="meter"><i style="width:' + hum + '%"></i></div></div></div>';
    },
    'weather/city_forecast': function (d, big) {
      return '<ul class="wf' + x(big) + '">' + d.forecast.map(function (day) {
        var cond = day.conditions ? C.capitalizeFirst(day.conditions) : '—';
        var mm = day.precipitation.toLocaleString('fr-FR');
        var date = C.capitalizeFirst(C.formatLocalDate(day.date, { weekday: 'long', day: 'numeric', month: 'long' }));
        return '<li class="tile" title="' + esc(date + ' · ' + cond + (day.precipitation > 0 ? ' · ' + mm + ' mm' : '')) + '">' +
          '<span class="lbl">' + esc(C.formatLocalDate(day.date, { weekday: big ? 'long' : 'short' })) + '</span>' +
          '<span class="more">' + esc(C.formatLocalDate(day.date, { day: 'numeric', month: 'short' })) + '</span>' +
          ic(C.weatherIconName(day.conditions)) + '<b>' + Math.round(day.max) + '°</b><span class="min">' + Math.round(day.min) + '°</span>' +
          '<span class="more">' + esc(cond) + '</span>' +
          '<span class="rain">' + (day.precipitation > 0 ? ic('drop') + mm + (big ? ' mm' : '') : '') + '</span></li>';
      }).join('') + '</ul>';
    },
    'rss/article_list': function (d, big) {
      if (!d.articles.length) {
        return '<div class="muted">' + (d.keyword ? 'Aucun article ne contient « ' + esc(d.keyword) + ' ».' : 'Ce flux ne contient aucun article.') + '</div>';
      }
      return '<ul class="wl' + x(big) + '">' + d.articles.map(function (a) {
        var host = C.hostnameOf(a.link);
        return '<li class="tile">' + (a.link ? fake(a.link, esc(a.title)) : '<span>' + esc(a.title) + '</span>') +
          '<div class="wl__meta">' + (a.publishedAt ? '<span class="wl__when" title="' + esc(C.formatDateTime(a.publishedAt)) + '">' + rel(a.publishedAt) + '</span>' : '') +
          (host ? '<span class="trunc">' + esc(host) + '</span>' : '') + '</div></li>';
      }).join('') + '</ul>';
    },
    'github/recent_commits': function (d, big) {
      if (!d.commits.length) return '<div class="muted">Aucun commit dans ce dépôt.</div>';
      return '<ul class="wr' + x(big) + '">' + d.commits.map(function (c) {
        return '<li>' + ic('commit') + '<div class="wr__txt"><div class="trunc" title="' + esc(c.message) + '">' + esc(c.message.split('\n')[0]) + '</div>' +
          '<small class="trunc">' + esc(c.author) + (c.date ? ' · <time title="' + esc(C.formatDateTime(c.date)) + '">' + rel(c.date) + '</time>' : '') + '</small></div>' +
          '<code>' + esc(c.sha.slice(0, 7)) + '</code></li>';
      }).join('') + '</ul>';
    },
    'github/repo_activity': function (d, big) {
      var stats = [['Issues', 'Issues ouvertes', d.openIssues, 'issue'], ['PRs', 'Pull requests ouvertes', d.openPullRequests, 'pr'], ['Étoiles', 'Étoiles', d.stars, 'star']];
      return '<div class="wa' + x(big) + '"><dl>' + stats.map(function (s) {
        return '<div class="tile" title="' + s[1] + '"><dt class="lbl trunc">' + ic(s[3]) + (big ? s[1] : s[0]) + '</dt><dd title="' + s[2].toLocaleString('fr-FR') + '">' + esc(C.formatCount(s[2])) + '</dd></div>';
      }).join('') + '</dl><div class="wa__br">' + ic('github') + 'Branche <code>' + esc(d.branch) + '</code></div></div>';
    },
    'hackernews/top_stories': function (d, big) { return stories(d.stories, 'Aucun article en première page pour le moment.', big); },
    'hackernews/story_search': function (d, big) { return stories(d.stories, 'Aucun article ne contient « ' + esc(d.keyword) + ' ».', big); },
    'currency/exchange_rate': function (d, big) {
      return '<div class="tile wx' + x(big) + '"><div class="lbl">1 ' + esc(d.base) + ' vaut</div><div class="wx__v"><b>' + C.formatRate(d.rate) + '</b><span>' + esc(d.target) + '</span></div>' +
        '<div class="wx__d">Taux du ' + esc(C.formatLocalDate(d.date, { day: 'numeric', month: 'short', year: 'numeric' })) + '</div></div>';
    },
    'currency/rate_history': function (d, big) {
      if (!d.history.length) return '<div class="muted">Aucune donnée sur cette période.</div>';
      var rates = d.history.map(function (p) { return p.rate; });
      var change = (rates[rates.length - 1] - rates[0]) / rates[0] * 100, up = change >= 0;
      var line = C.sparklinePoints(rates);
      return '<div class="wh' + x(big) + '"><div class="tile wh__sum"><div class="wh__top"><span>' + esc(d.base) + ' <span class="muted">/</span> ' + esc(d.target) + '</span>' +
        '<span class="wh__chg' + (up ? '' : ' is-down') + '">' + ic(up ? 'trendup' : 'trenddown') + (up ? '+' : '') + change.toLocaleString('fr-FR', { maximumFractionDigits: 2 }) + ' %</span></div>' +
        '<svg class="spark" viewBox="0 0 100 32" preserveAspectRatio="none" role="img" aria-label="Évolution du taux sur la période">' +
        '<polygon points="0,32 ' + line + ' 100,32" fill="currentColor" opacity="0.12"/><polyline points="' + line + '" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" vector-effect="non-scaling-stroke"/></svg>' +
        '<div class="wh__mm"><span>Min ' + C.formatRate(Math.min.apply(null, rates)) + '</span><span>Max ' + C.formatRate(Math.max.apply(null, rates)) + '</span></div></div>' +
        '<ul class="wr wh__list' + (big ? ' tile' : '') + '">' + d.history.map(function (p) {
          return '<li><span>' + esc(C.formatLocalDate(p.date, { day: 'numeric', month: 'short' })) + '</span><span class="num">' + C.formatRate(p.rate) + '</span></li>';
        }).join('') + '</ul></div>';
    },
    'gmail/inbox_preview': function (d, big) {
      if (!d.messages.length) return '<div class="muted">Boîte de réception vide.</div>';
      return '<ul class="wr wm' + x(big) + '">' + d.messages.map(function (m) {
        return '<li>' + fake('https://mail.google.com/', ic('gmail') + '<div class="wr__txt"><div class="wm__top"><div class="trunc" title="' + esc(m.subject) + '">' + esc(m.subject) + '</div>' +
          (m.receivedAt ? '<time title="' + esc(C.formatDateTime(m.receivedAt)) + '">' + rel(m.receivedAt) + '</time>' : '') + '</div>' +
          '<small class="trunc" title="' + esc(m.from) + '">' + esc(m.from) + '</small><small class="trunc" title="' + esc(m.snippet) + '">' + esc(m.snippet) + '</small></div>') + '</li>';
      }).join('') + '</ul>';
    }
  };
  RENDER['rss/feed_search'] = RENDER['rss/article_list'];

  function stories(list, empty, big) {
    if (!list.length) return '<div class="muted">' + empty + '</div>';
    return '<ul class="wl' + x(big) + '">' + list.map(function (s) {
      var com = ic('msg') + '<span class="num">' + s.comments + '</span><span class="sr">commentaires</span>';
      return '<li class="tile">' + fake(s.url, esc(s.title)) + '<div class="wl__meta"><span class="wl__pts">' + ic('up') + s.points + '<span class="sr">points</span></span>' +
        (s.url !== s.discussionUrl ? fake(s.discussionUrl, com) : '<span>' + com + '</span>') +
        (s.author ? '<span class="trunc">' + esc(s.author) + '</span>' : '') +
        (s.createdAt ? '<span title="' + esc(C.formatDateTime(s.createdAt)) + '">' + rel(s.createdAt) + '</span>' : '') + '</div></li>';
    }).join('') + '</ul>';
  }

  function currencyName(c) {
    try {
      var name = new Intl.DisplayNames(['fr'], { type: 'currency' }).of(c.code);
      return C.capitalizeFirst(name && name !== c.code ? name : c.name);
    } catch (e) { return c.name; }
  }
  function errorHTML(w) {
    var err = w.live.error, list = err.details && Array.isArray(err.details.currencies) ? err.details.currencies : [];
    var h = '<div class="werr" role="alert"><div class="werr__msg">' + esc(err.message) + '</div>';
    if (err.status === 422) h += '<button class="linkbtn" type="button" data-act="edit">Reconfigurer le widget</button>';
    if (list.length) {
      h += '<div class="muted" style="font-size:.75rem">Devises disponibles (' + list.length + ') :</div><ul>' + list.map(function (c) {
        return '<li><code>' + esc(c.code) + '</code><span class="trunc muted">' + esc(currencyName(c)) + '</span></li>';
      }).join('') + '</ul>';
    }
    return h + '</div>';
  }

  function liveHTML(w, big, fresh) {
    var l = w.live;
    if (l.data === null) return l.error ? errorHTML(w) : '<div class="muted" role="status">Chargement...</div>';
    return '<div class="live"><div class="live__scroll">' + RENDER[w.def.service + '/' + w.def.type](l.data, big) + '</div>' +
      (l.error ? '<div class="live__err" role="alert">Actualisation impossible : ' + esc(l.error.message) + '</div>' : '') +
      (l.fetchedAt ? '<div class="live__foot' + (fresh ? ' is-new' : '') + '"><span class="dot' + (l.error ? ' is-bad' : '') + '"></span>Actualisé à ' + clock(l.fetchedAt) +
        '<span class="live__next" data-next>prochain dans ' + left(timer.nextAt(w.id) - Date.now()) + '</span></div>' : '') + '</div>';
  }

  function clockHTML(big) {
    return '<div class="wk' + x(big) + '"><div class="tile wk__box"><div class="wk__time"><b data-hm></b><span data-s></span></div><div class="wk__date" data-d></div></div>' +
      '<div class="wk__geo">' + ic('pin') + '<span>Position non demandée dans cette démo.</span></div></div>';
  }
  function tickClock() {
    var host = hostOf(byId('clock'));
    if (!host || !host.querySelector('[data-hm]')) return;
    var now = new Date();
    host.querySelector('[data-hm]').textContent = now.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    host.querySelector('[data-s]').textContent = String(now.getSeconds()).padStart(2, '0');
    host.querySelector('[data-d]').textContent = now.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  }

  /* ───────────── cartes ───────────── */

  var CLOCK = function () { return { id: 'clock', accent: 'primary', title: 'Horloge', subtitle: 'Heure, date et position' }; };

  function toWidget(inst) {
    var def = st.catalog.filter(function (d) { return d.service === inst.service && d.type === inst.widgetType; })[0];
    if (!def) return null;
    var t = C.cardTitle(def, inst.config);
    return { id: String(inst.id), backendId: inst.id, accent: C.accentFor(def.service), title: t.title, subtitle: t.subtitle,
      def: def, config: inst.config, rate: inst.refreshRateSeconds, live: { data: null, fetchedAt: null, error: null }, token: 0 };
  }

  function headHTML(w, big) {
    var open = st.menuId === w.id;
    return '<div class="wcard__id"><span class="wcard__ico">' + ic(w.accent) + '</span><div class="wcard__names"><div class="wcard__title trunc">' + esc(w.title) + '</div>' +
      '<div class="wcard__sub trunc">' + esc(w.subtitle) + '</div></div></div>' +
      '<div class="wcard__menu" data-nodrag><button class="wcard__dots" type="button" data-act="menu" aria-haspopup="menu" aria-expanded="' + open + '" aria-label="Options du widget">' + ic('dots') + '</button>' +
      (open ? '<div class="menu" role="menu"><button type="button" role="menuitem" data-act="expand">' + (big ? 'Réduire' : 'Agrandir') + '</button>' +
        (w.backendId !== undefined ? '<button type="button" role="menuitem" data-act="edit">Reconfigurer</button>' : '') +
        '<button type="button" role="menuitem" class="is-danger" data-act="delete">Supprimer</button></div>' : '') + '</div>';
  }

  function makeCard(w) {
    var el = document.createElement('div');
    el.className = 'wcard'; el.tabIndex = 0; el.dataset.id = w.id; el.dataset.accent = w.accent;
    el.setAttribute('role', 'group'); el.setAttribute('aria-roledescription', 'widget déplaçable');
    el.innerHTML = '<div class="wcard__head"></div><div class="wcard__body"></div>' + (w.backendId !== undefined ? '<div class="wbar"><i></i></div>' : '');
    w.el = el;
    return el;
  }
  function hostOf(w) {
    if (!w) return null;
    if (st.expandedId === w.id) return $('fullBody');
    return w.el ? w.el.querySelector('.wcard__body') : null;
  }
  function paintHead(w) {
    if (w.el) {
      w.el.querySelector('.wcard__head').innerHTML = headHTML(w, false);
      w.el.setAttribute('aria-label', w.title + ' — ' + w.subtitle);
      w.el.classList.toggle('has-menu', st.menuId === w.id && st.expandedId !== w.id);
    }
    if (st.expandedId === w.id) $('fullHead').innerHTML = headHTML(w, true);
  }
  function paintBody(w, fresh) {
    var host = hostOf(w);
    if (!host) return;
    var big = st.expandedId === w.id;
    if (w.backendId === undefined) { host.innerHTML = clockHTML(big); tickClock(); return; }
    var sc = host.querySelector('.live__scroll'), top = sc ? sc.scrollTop : 0;
    host.innerHTML = liveHTML(w, big, fresh && !reduce);
    sc = host.querySelector('.live__scroll');
    if (sc && top) sc.scrollTop = top;
  }

  // useWidgetData : une lecture au montage, puis à chaque tour du Timer.
  function load(w) {
    var token = w.token;
    api('GET', '/dashboard/widgets/' + w.backendId + '/data').then(function (res) {
      if (w.token !== token || !byId(w.id)) return;
      w.live = { data: res.data, fetchedAt: new Date(res.fetchedAt), error: null };
      paintBody(w, true);
    }, function (err) {
      if (w.token !== token || !byId(w.id)) return;
      w.live = { data: w.live.data, fetchedAt: w.live.fetchedAt, error: err };   // on garde les dernières données bonnes
      paintBody(w, false);
    });
  }
  function mount(w) {
    if (w.backendId === undefined) { timer.register('clock', 1, tickClock); return; }
    w.token++;
    w.live = { data: null, fetchedAt: null, error: null };
    load(w);
    timer.register(w.id, w.rate, function () { load(w); });
  }
  function unmount(w) { timer.unregister(w.id); w.token++; }

  function renderGrid() {
    $('loading').hidden = st.status !== 'loading';
    $('loading').textContent = st.status === 'error' ? 'Impossible de charger le dashboard.' : 'Chargement du dashboard...';
    var loaded = st.status === 'loaded';
    $('empty').hidden = !loaded || st.widgets.some(function (w) { return w.backendId !== undefined; });
    grid.hidden = !loaded;
    if (!loaded) { grid.innerHTML = ''; return; }
    var keep = {};
    st.widgets.forEach(function (w) {
      if (!w.el) { makeCard(w); paintHead(w); paintBody(w); }
      keep[w.id] = true;
      grid.appendChild(w.el);                              // remet les cartes dans l'ordre
    });
    Array.prototype.slice.call(grid.children).forEach(function (el) { if (!keep[el.dataset.id]) grid.removeChild(el); });
    paintStats();
  }

  function tickUi() {
    var now = Date.now();
    st.widgets.forEach(function (w) {
      if (w.backendId === undefined || !w.el) return;
      var rem = Math.max(0, timer.nextAt(w.id) - now), host = hostOf(w);
      var n = host && host.querySelector('[data-next]');
      if (n) n.textContent = 'prochain dans ' + left(rem);
      w.el.querySelector('.wbar i').style.width = Math.min(100, rem / (w.rate * 10)) + '%';
    });
  }

  /* ───────────── actions (WidgetsContext) ───────────── */

  function actionError(msg) { $('alertMsg').textContent = msg; $('alert').hidden = false; }

  function resync() {
    api('GET', '/dashboard').then(function (res) {
      var old = {};
      st.widgets.forEach(function (w) { old[w.id] = w; });
      var clockW = old.clock || CLOCK(), next = [clockW];
      res.widgets.forEach(function (inst) {
        var w = old[String(inst.id)];
        if (!w) { w = toWidget(inst); if (w) mount(w); }
        if (w) next.push(w);
      });
      st.widgets.forEach(function (w) { if (next.indexOf(w) === -1) unmount(w); });
      if (!old.clock) mount(clockW);
      st.widgets = next;
      renderGrid();
    });
  }

  function deleteWidget(id) {
    var w = byId(id);
    if (!w) return;
    if (st.expandedId === id) closeExpanded();
    if (st.menuId === id) st.menuId = null;
    unmount(w);
    st.widgets = st.widgets.filter(function (o) { return o !== w; });
    renderGrid();
    status('Widget supprimé : ' + w.title + '.');
    if (w.backendId !== undefined) {
      api('DELETE', '/dashboard/widgets/' + w.backendId).catch(function (err) {
        actionError('Suppression échouée : ' + err.message); resync();
      });
    }
  }

  function swapWidgets(idA, idB) {
    var ia = st.widgets.indexOf(byId(idA)), ib = st.widgets.indexOf(byId(idB));
    if (ia === -1 || ib === -1) return;
    st.widgets = C.swap(st.widgets, ia, ib);
    renderGrid();
    status('Cartes échangées : ' + byId(idA).title + ' et ' + byId(idB).title + '.');
    // Les deux PATCH partent l'un après l'autre, jamais en même temps.
    var updates = C.positionUpdates(st.widgets, idA, idB);
    (function next(i) {
      if (i >= updates.length) return;
      api('PATCH', '/dashboard/widgets/' + updates[i].backendId, { position: updates[i].position }).then(function () { next(i + 1); }, function (err) {
        actionError('Déplacement échoué : ' + err.message); resync();
      });
    })(0);
  }

  function addWidget(def, config, rate) {
    return api('POST', '/dashboard/widgets', { service: def.service, widgetType: def.type, config: config, refreshRateSeconds: rate }).then(function (res) {
      var w = toWidget(res.widget);
      if (!w) return;
      st.widgets.push(w);
      mount(w);
      renderGrid();
      status('Widget ajouté : ' + w.title + '.');
      if (w.el.scrollIntoView) w.el.scrollIntoView({ block: 'nearest', behavior: reduce ? 'auto' : 'smooth' });
    });
  }

  function updateWidget(id, config, rate) {
    var w = byId(id);
    if (!w || w.backendId === undefined) return Promise.resolve();
    return api('PATCH', '/dashboard/widgets/' + w.backendId, { config: config, refreshRateSeconds: rate }).then(function (res) {
      var t = C.cardTitle(w.def, res.widget.config);
      w.config = res.widget.config; w.rate = res.widget.refreshRateSeconds; w.title = t.title; w.subtitle = t.subtitle;
      mount(w);                                            // autre réglage = on repart de zéro
      paintHead(w); paintBody(w);
      status('Widget reconfiguré : ' + w.title + ', toutes les ' + left(w.rate * 1000) + '.');
    });
  }

  /* ───────────── menu « ••• » et plein écran ───────────── */

  function setMenu(id) {
    var prev = st.menuId;
    st.menuId = id;
    [prev, id].forEach(function (k) { var w = k && byId(k); if (w) paintHead(w); });
  }
  function openExpanded(id) {
    st.expandedId = id;
    $('fullBack').hidden = false; $('full').hidden = false;
    var w = byId(id);
    $('full').dataset.accent = w.accent;
    w.el.querySelector('.wcard__body').innerHTML = '';
    paintHead(w); paintBody(w);
    $('full').focus();
  }
  function closeExpanded() {
    var w = byId(st.expandedId);
    st.expandedId = null;
    $('fullBack').hidden = true; $('full').hidden = true;
    $('fullHead').innerHTML = ''; $('fullBody').innerHTML = '';
    if (w) { paintHead(w); paintBody(w); if (w.el) w.el.focus({ preventScroll: true }); }
  }

  function onAction(e) {
    var link = e.target.closest('[data-fake]');
    if (link) {
      e.preventDefault();
      status('Lien fictif (' + (C.hostnameOf(link.dataset.fake) || 'exemple') + ') : la démo ne quitte pas la page.');
      return;
    }
    var btn = e.target.closest('[data-act]');
    if (!btn) return;
    var holder = e.target.closest('.wcard'), id = holder ? holder.dataset.id : st.expandedId, act = btn.dataset.act;
    if (!id) return;
    if (act === 'menu') { setMenu(st.menuId === id ? null : id); return; }
    setMenu(null);
    if (act === 'expand') { if (st.expandedId === id) closeExpanded(); else openExpanded(id); }
    else if (act === 'edit') openModal('edit', id);
    else if (act === 'delete') deleteWidget(id);
  }

  /* ───────────── fenêtre d'ajout / de réglage (WidgetModal) ───────────── */

  var FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])';

  function openModal(mode, widgetId) {
    modal = { mode: mode, widgetId: widgetId, selected: null, config: {}, refresh: '60', touched: {}, notices: {},
      serverError: null, submitting: false, prev: document.activeElement };
    if (mode === 'edit') {
      var w = byId(widgetId);
      modal.selected = w.def; modal.refresh = String(w.rate);
      for (var k in w.config) modal.config[k] = String(w.config[k]);
    }
    $('modalBack').hidden = false; $('modal').hidden = false;
    $('modal').setAttribute('aria-label', mode === 'edit' ? 'Reconfigurer le widget' : 'Ajouter un widget');
    buildModal();
  }
  function closeModal() {
    if (!modal) return;
    var prev = modal.prev;
    modal = null;
    $('modalBack').hidden = true; $('modal').hidden = true; $('modal').innerHTML = '';
    if (prev && prev.focus && document.contains(prev)) prev.focus({ preventScroll: true });
  }

  function examplesFor(def, param) {
    var E = C.EXAMPLES;
    if (param.name === 'city') return E.city.slice(0, 7);
    if (param.name === 'repository') return E.repository;
    if (param.name === 'link') return E.link;
    if (def.service === 'currency' && (param.name === 'base' || param.name === 'target')) return E.currency;
    if (param.name === 'keyword') return E.keyword[def.service] || [];
    return [];
  }

  function buildModal() {
    var m = modal, dlg = $('modal'), h;
    if (!m.selected) {
      h = '<h2>Choisir un widget</h2><div class="pick">' + st.catalog.map(function (d, i) {
        return '<button type="button" data-pick="' + i + '" data-accent="' + C.accentFor(d.service) + '"><b>' + esc(d.name) + '</b><span>' + esc(d.description) + '</span></button>';
      }).join('') + '</div><button class="textbtn" type="button" data-m="cancel" style="margin-top:1rem">Annuler</button>';
    } else {
      h = (m.mode === 'edit' ? '<div class="tag">&lt;reconfigurer/&gt;</div>' : '<button class="textbtn" type="button" data-m="back">← Changer de widget</button>') +
        '<h2 style="margin-top:.5rem">' + esc(m.selected.name) + '</h2><div class="form">' + m.selected.params.map(function (p) {
          var ex = examplesFor(m.selected, p);
          return '<div><label for="f-' + p.name + '">' + esc(p.label) + '</label>' +
            '<input id="f-' + p.name + '" data-param="' + p.name + '" type="text" autocomplete="off"' + (p.type === 'integer' ? ' inputmode="numeric"' : '') +
            ' value="' + esc(m.config[p.name] === undefined ? '' : m.config[p.name]) + '"><div class="err" id="e-' + p.name + '" hidden></div>' +
            (ex.length ? '<div class="ex">Exemples de la démo : ' + ex.map(function (v) {
              return '<button type="button" data-ex="' + p.name + '" data-val="' + esc(v) + '">' + esc(C.shortLabel(v)) + '</button>';
            }).join('') + '</div>' : '') + '</div>';
        }).join('') +
        '<div><label for="f-refreshRate">Fréquence de rafraîchissement (secondes, ' + C.REFRESH_MIN_SECONDS + ' minimum)</label>' +
        '<input id="f-refreshRate" data-param="refreshRate" type="text" inputmode="numeric" autocomplete="off" value="' + esc(m.refresh) + '"><div class="err" id="e-refreshRate" hidden></div></div></div>' +
        '<div class="srv" id="srvErr" hidden></div>' +
        '<div class="acts"><button class="textbtn" type="button" data-m="cancel">Annuler</button><button class="btn" type="button" data-m="confirm" id="confirmBtn"></button></div>';
    }
    dlg.innerHTML = h;
    dlg.scrollTop = 0;
    if (m.selected) refreshForm();
    var first = dlg.querySelector(FOCUSABLE);
    (first || dlg).focus();
  }

  function formState() {
    var m = modal;
    var fieldErrors = C.validateConfig(m.selected, m.config), refreshError = C.validateRefreshRate(m.refresh);
    return { fieldErrors: fieldErrors, refreshError: refreshError, valid: Object.keys(fieldErrors).length === 0 && refreshError === null };
  }
  // Un refus à la frappe prime ; sinon l'erreur d'un champ déjà quitté.
  function refreshForm() {
    var m = modal, s = formState();
    function show(name, error) {
      var msg = m.notices[name] || (m.touched[name] ? error : null) || null;
      var e = $('e-' + name), input = $('f-' + name);
      e.hidden = !msg; e.textContent = msg || '';
      input.classList.toggle('is-bad', !!msg); input.setAttribute('aria-invalid', String(!!msg));
    }
    m.selected.params.forEach(function (p) { show(p.name, s.fieldErrors[p.name]); });
    show('refreshRate', s.refreshError);
    var b = $('confirmBtn');
    b.disabled = !s.valid || m.submitting;
    b.textContent = m.submitting ? 'Enregistrement...' : m.mode === 'edit' ? 'Enregistrer' : 'Ajouter au dashboard';
    $('srvErr').hidden = !m.serverError; $('srvErr').textContent = m.serverError || '';
  }
  function setField(name, raw) {
    var m = modal, r;
    if (name === 'refreshRate') { r = C.sanitizeDigits(raw); m.refresh = r.value; }
    else {
      var p = m.selected.params.filter(function (q) { return q.name === name; })[0];
      r = C.sanitizeInput(m.selected, p, raw); m.config[name] = r.value;
    }
    m.notices[name] = r.notice;
    var input = $('f-' + name);
    if (input.value !== r.value) input.value = r.value;
    refreshForm();
  }
  function confirmModal() {
    var m = modal;
    if (!m || !m.selected || !formState().valid || m.submitting) return;
    m.serverError = null; m.submitting = true; refreshForm();
    var cfg = {};
    m.selected.params.forEach(function (p) { cfg[p.name] = p.type === 'integer' ? Number(m.config[p.name]) : m.config[p.name].trim(); });
    var job = m.mode === 'edit' ? updateWidget(m.widgetId, cfg, Number(m.refresh)) : addWidget(m.selected, cfg, Number(m.refresh));
    job.then(function () { if (modal === m) closeModal(); }, function (err) {
      if (modal !== m) return;
      m.serverError = err && err.message ? err.message : 'Une erreur est survenue.'; m.submitting = false; refreshForm();
    });
  }

  /* ───────────── glisser-déposer : échange de deux cartes ───────────── */
  // Mêmes réglages que dans le projet : souris après 4 px, doigt après 200 ms
  // d'appui (8 px de tolérance), carte visée = celle dont le centre est le plus proche.

  function cardEls() { return Array.prototype.slice.call(grid.children); }
  function pageRect(el) {
    var r = el.getBoundingClientRect();
    return { left: r.left + window.scrollX, top: r.top + window.scrollY, width: r.width, height: r.height };
  }
  function dragBegin(id, mode, cx, cy) {
    setMenu(null);
    var els = cardEls(), ids = els.map(function (e) { return e.dataset.id; }), a = ids.indexOf(id);
    if (a === -1) return;
    drag = { mode: mode, els: els, ids: ids, rects: els.map(pageRect), a: a, over: a, raf: 0,
      sx: cx + window.scrollX, sy: cy + window.scrollY, cx: cx, cy: cy };
    els.forEach(function (e, i) { if (i !== a) e.classList.add('is-shift'); });
    els[a].classList.add('is-drag');
    if (mode !== 'mouse') els[a].classList.add('is-held');
    if (mode === 'key') els[a].classList.add('is-key');
    document.body.classList.add('dz-dragging');
  }
  function dragOver(i) {
    var d = drag;
    if (i === d.over) return;
    if (d.over !== d.a) d.els[d.over].style.transform = '';
    d.over = i;
    var ra = d.rects[d.a], ro = d.rects[i];
    if (i !== d.a) d.els[i].style.transform = 'translate(' + (ra.left - ro.left) + 'px,' + (ra.top - ro.top) + 'px)';
    if (d.mode === 'key') d.els[d.a].style.transform = i === d.a ? '' : 'translate(' + (ro.left - ra.left) + 'px,' + (ro.top - ra.top) + 'px)';
  }
  // Une seule image en attente : le dernier mouvement gagne.
  function dragFrame() {
    var d = drag;
    if (!d) return;
    d.raf = 0;
    var edge = 64, s = 0;
    if (d.cy < edge) s = -Math.ceil((edge - d.cy) / 5);
    else if (d.cy > window.innerHeight - edge) s = Math.ceil((d.cy - (window.innerHeight - edge)) / 5);
    if (s) {
      var before = window.scrollY;
      window.scrollBy({ top: s, behavior: 'instant' });
      if (window.scrollY !== before) d.raf = requestAnimationFrame(dragFrame);
    }
    var dx = d.cx + window.scrollX - d.sx, dy = d.cy + window.scrollY - d.sy, ra = d.rects[d.a];
    d.els[d.a].style.transform = 'translate3d(' + dx + 'px,' + dy + 'px,0)';
    dragOver(C.closestCenter({ x: ra.left + ra.width / 2 + dx, y: ra.top + ra.height / 2 + dy }, d.rects));
  }
  function dragMove(cx, cy) {
    drag.cx = cx; drag.cy = cy;
    if (!drag.raf) drag.raf = requestAnimationFrame(dragFrame);
  }
  function dragEnd(commit) {
    var d = drag;
    if (!d) return;
    drag = null;
    if (d.raf) cancelAnimationFrame(d.raf);
    var act = d.els[d.a], from = act.getBoundingClientRect();
    d.els.forEach(function (e) { e.classList.remove('is-shift', 'is-drag', 'is-held', 'is-key'); e.style.transform = ''; });
    document.body.classList.remove('dz-dragging');
    if (commit && d.over !== d.a) swapWidgets(d.ids[d.a], d.ids[d.over]);
    if (!reduce) {                                         // la carte glisse jusqu'à sa place
      var to = act.getBoundingClientRect(), fx = from.left - to.left, fy = from.top - to.top;
      if (fx || fy) {
        act.style.transition = 'none'; act.style.transform = 'translate(' + fx + 'px,' + fy + 'px)';
        void act.offsetWidth;
        act.style.transition = 'transform .2s ease'; act.style.transform = '';
        setTimeout(function () { act.style.transition = ''; }, 240);
      }
    }
    if (d.mode === 'key') act.focus({ preventScroll: true });
  }
  function canDrag(target) { return !target.closest('button, input, [data-nodrag]'); }

  // souris
  grid.addEventListener('mousedown', function (e) {
    var card = e.target.closest('.wcard');
    if (!card || e.button !== 0 || drag || !canDrag(e.target)) return;
    pendM = { id: card.dataset.id, x: e.clientX, y: e.clientY };
  });
  document.addEventListener('mousemove', function (e) {
    if (pendM && !drag) {
      if (Math.abs(e.clientX - pendM.x) + Math.abs(e.clientY - pendM.y) > 0 &&
          Math.hypot(e.clientX - pendM.x, e.clientY - pendM.y) > 4) { dragBegin(pendM.id, 'mouse', pendM.x, pendM.y); pendM = null; }
    }
    if (drag && drag.mode === 'mouse') { e.preventDefault(); dragMove(e.clientX, e.clientY); }
  });
  document.addEventListener('mouseup', function () {
    pendM = null;
    if (drag && drag.mode === 'mouse') {
      dragEnd(true);
      justDragged = true; setTimeout(function () { justDragged = false; }, 0);
    }
  });
  document.addEventListener('click', function (e) { if (justDragged) { e.preventDefault(); e.stopPropagation(); } }, true);
  window.addEventListener('scroll', function () { if (drag && drag.mode !== 'key' && !drag.raf) drag.raf = requestAnimationFrame(dragFrame); }, { passive: true });

  // doigt
  function clearPendT() { if (pendT) { clearTimeout(pendT.h); pendT = null; } }
  grid.addEventListener('touchstart', function (e) {
    var card = e.target.closest('.wcard');
    clearPendT();
    if (!card || e.touches.length !== 1 || drag || !canDrag(e.target)) return;
    var t = e.touches[0];
    pendT = { id: card.dataset.id, x: t.clientX, y: t.clientY, h: setTimeout(function () {
      var p = pendT; pendT = null;
      if (p && !drag) { dragBegin(p.id, 'touch', p.x, p.y); if (drag) drag.touched = true; }
    }, 200) };
  }, { passive: true });
  grid.addEventListener('touchmove', function (e) {
    var t = e.touches[0];
    if (pendT && Math.hypot(t.clientX - pendT.x, t.clientY - pendT.y) > 8) clearPendT();   // c'était un défilement
    if (drag && drag.mode === 'touch') { e.preventDefault(); dragMove(t.clientX, t.clientY); }
  }, { passive: false });
  grid.addEventListener('touchend', function (e) {
    clearPendT();
    if (drag && drag.mode === 'touch') { e.preventDefault(); dragEnd(true); }
  });
  grid.addEventListener('touchcancel', function () { clearPendT(); if (drag && drag.mode === 'touch') dragEnd(false); });
  grid.addEventListener('contextmenu', function (e) { if (pendT || (drag && drag.mode === 'touch')) e.preventDefault(); });

  // clavier
  grid.addEventListener('keydown', function (e) {
    var card = e.target;
    if (!card.classList || !card.classList.contains('wcard')) return;
    var w = byId(card.dataset.id);
    if (drag && drag.mode === 'key') {
      var cols = drag.rects.filter(function (r) { return Math.abs(r.top - drag.rects[0].top) < 2; }).length;
      var step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -cols, ArrowDown: cols }[e.key];
      if (step) {
        e.preventDefault();
        var i = drag.over + step;
        if (i >= 0 && i < drag.els.length) { dragOver(i); announce('Place ' + (i + 1) + ' sur ' + drag.els.length + '.'); }
      } else if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        var moved = drag.over !== drag.a;
        dragEnd(true);
        announce(moved ? 'Carte déposée.' : 'Carte reposée à sa place.');
      } else if (e.key === 'Escape') { e.preventDefault(); dragEnd(false); announce('Déplacement annulé.'); }
      return;
    }
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      dragBegin(card.dataset.id, 'key', 0, 0);
      announce(w.title + ' : carte saisie. Flèches pour choisir la place, Espace pour déposer, Échap pour annuler.');
    } else if (e.key === 'Backspace') { e.preventDefault(); deleteWidget(card.dataset.id); }
  });
  grid.addEventListener('focusout', function () { if (drag && drag.mode === 'key') dragEnd(false); });

  /* ───────────── tableaux d'exemple, démarrage ───────────── */

  function boot() {
    st.epoch++;
    st.widgets.forEach(unmount);
    if (st.expandedId) { st.expandedId = null; $('fullBack').hidden = true; $('full').hidden = true; }
    st.widgets = []; st.menuId = null; st.status = 'loading';
    $('alert').hidden = true;
    renderGrid();
    Array.prototype.forEach.call($('profiles').children, function (b) { b.setAttribute('aria-pressed', String(b.dataset.p === st.profile)); });
    $('profileNote').textContent = C.PROFILES[st.profile].note;
    // Le catalogue et le tableau sont lus en même temps, comme dans le projet.
    Promise.all([api('GET', '/about.json'), api('GET', '/dashboard')]).then(function (r) {
      st.catalog = C.buildCatalog(r[0].server.services);
      st.widgets = [CLOCK()].concat(r[1].widgets.map(toWidget).filter(Boolean));
      st.status = 'loaded';
      renderGrid();
      st.widgets.forEach(mount);
      tickUi();
      status('Tableau chargé : ' + (st.widgets.length - 1) + ' widgets et l’horloge.');
    }, function () { st.status = 'error'; renderGrid(); });
  }
  function loadProfile(name) {
    st.profile = name;
    server = C.createServer(C.profileState(name, Date.now(), light));
    server.setOutage('weather', st.outage);
    save();
    logLine('— tableau d’exemple : ' + esc(C.PROFILES[name].label) + ' —', 'sep');
    boot();
  }

  function setRunning(on) {
    if (on === st.running) return;
    st.running = on;
    if (on) { timer.resume(); tickClock(); tickUi(); } else timer.pause();
  }
  var visible = true;
  function checkRunning() { setRunning(visible && !document.hidden); }

  function init() {
    // fenêtres posées sur la page (hors de la scène)
    var wrap = document.createElement('div');
    wrap.className = 'dz';
    wrap.innerHTML = '<div class="dz-back" id="fullBack" hidden></div>' +
      '<div class="dz-full" id="full" role="dialog" aria-modal="true" aria-label="Widget agrandi" tabindex="-1" hidden><div class="wcard__head" id="fullHead"></div><div class="wcard__body" id="fullBody"></div></div>' +
      '<div class="dz-back is-modal" id="modalBack" hidden></div><div class="dz-modal" id="modal" role="dialog" aria-modal="true" tabindex="-1" hidden></div>';
    document.body.appendChild(wrap);

    $('profiles').innerHTML = Object.keys(C.PROFILES).map(function (k) {
      return '<button class="chip" type="button" data-p="' + k + '" aria-pressed="false">' + esc(C.PROFILES[k].label) + '</button>';
    }).join('');
    $('profiles').addEventListener('click', function (e) { var b = e.target.closest('[data-p]'); if (b) loadProfile(b.dataset.p); });
    $('resetBtn').addEventListener('click', function () {
      try { localStorage.removeItem(LS_KEY); } catch (e) { /* rien à effacer */ }
      st.outage = false; $('outageBtn').setAttribute('aria-pressed', 'false');
      st.calls = 0; $('log').innerHTML = '';
      loadProfile('equipe');
      status('Tout est remis à zéro.');
    });
    $('outageBtn').addEventListener('click', function () {
      st.outage = !st.outage;
      this.setAttribute('aria-pressed', String(st.outage));
      server.setOutage('weather', st.outage);
      logLine('— panne du service météo : ' + (st.outage ? 'simulée' : 'terminée') + ' —', 'sep');
      status(st.outage ? 'Panne météo simulée : les cartes météo le diront à leur prochain rafraîchissement.' : 'Service météo rétabli.');
    });
    $('addBtn').addEventListener('click', function () { if (st.status === 'loaded') openModal('add'); });
    $('emptyAdd').addEventListener('click', function () { openModal('add'); });
    $('alertClose').addEventListener('click', function () { $('alert').hidden = true; });

    grid.addEventListener('click', onAction);
    $('full').addEventListener('click', onAction);
    $('fullBack').addEventListener('click', closeExpanded);
    document.addEventListener('mousedown', function (e) { if (st.menuId && !e.target.closest('.wcard__menu')) setMenu(null); });

    var dlg = $('modal');
    $('modalBack').addEventListener('click', closeModal);
    dlg.addEventListener('click', function (e) {
      var b = e.target.closest('button');
      if (!b || !modal) return;
      if (b.dataset.pick !== undefined) {
        var def = st.catalog[Number(b.dataset.pick)];
        modal.selected = def; modal.config = {}; modal.touched = {}; modal.notices = {};
        def.params.forEach(function (p) { if (p.defaultValue !== undefined) modal.config[p.name] = String(p.defaultValue); });
        buildModal();
      } else if (b.dataset.ex) { setField(b.dataset.ex, b.dataset.val); modal.touched[b.dataset.ex] = true; refreshForm(); }
      else if (b.dataset.m === 'back') { modal.selected = null; buildModal(); }
      else if (b.dataset.m === 'cancel') closeModal();
      else if (b.dataset.m === 'confirm') confirmModal();
    });
    dlg.addEventListener('input', function (e) { if (modal && e.target.dataset.param) setField(e.target.dataset.param, e.target.value); });
    dlg.addEventListener('focusout', function (e) {
      if (modal && modal.selected && e.target.dataset && e.target.dataset.param) { modal.touched[e.target.dataset.param] = true; refreshForm(); }
    });

    document.addEventListener('keydown', function (e) {
      if (modal) {
        if (e.key === 'Escape') { closeModal(); return; }
        if (e.key !== 'Tab') return;                       // Tab reste dans la fenêtre
        var f = dlg.querySelectorAll(FOCUSABLE);
        if (!f.length) return;
        var first = f[0], last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
        return;
      }
      if (e.key === 'Escape') {
        if (st.menuId) setMenu(null);
        else if (st.expandedId) closeExpanded();
      }
    });

    // Rien ne tourne quand la scène est hors écran ou l'onglet caché.
    document.addEventListener('visibilitychange', checkRunning);
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (en) { visible = en[en.length - 1].isIntersecting; checkRunning(); }).observe($('stage'));
    }
    setInterval(function () { if (st.running) tickUi(); }, 1000);

    var saved = loadSaved();
    if (saved && saved.db && C.PROFILES[saved.profile]) {
      st.profile = saved.profile;
      server = C.createServer(saved.db);
      logLine('— tableau retrouvé dans ce navigateur —', 'sep');
      boot();
    } else loadProfile('equipe');
  }

  init();
})();
