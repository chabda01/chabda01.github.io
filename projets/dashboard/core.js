/* Dashboard — le cœur, en fonctions pures (aucun DOM, aucun réseau).
   1. Ce qui vient du vrai frontend (TypeScript -> JavaScript) : catalogue,
      règles de saisie, formats d'affichage, échange de deux cartes.
   2. Un faux serveur : mêmes routes, mêmes contrôles et même règle de cache
      que le backend du projet, mais il répond avec des données d'exemple.
   3. Les données d'exemple : FICTIVES, calculées à partir de l'heure. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.DashCore = factory();
})(this, function () {
  'use strict';

  /* ══════════ 1. Registry du serveur (source de /about.json) ══════════ */

  var CITY_RE = /^[\p{L}\s'’.,-]+$/u;
  var CITY = { pattern: CITY_RE, patternMessage: "un nom de ville s'écrit avec des lettres, sans chiffres ni symboles." };
  var CUR = { pattern: /^[A-Za-z]{3}$/, patternMessage: "une devise s'écrit avec 3 lettres (ex. EUR, USD)." };
  function P(name, type, extra) {
    var p = { name: name, type: type };
    for (var k in extra) p[k] = extra[k];
    return p;
  }

  var SERVICES = [
    { name: 'weather', requiresSubscription: false, widgets: [
      { name: 'city_temperature', description: 'Display temperature for a city',
        params: [P('city', 'string', CITY), P('units', 'string', { oneOf: ['metric', 'imperial'] })] },
      { name: 'city_forecast', description: 'Display the weather forecast for a city over several days',
        params: [P('city', 'string', CITY), P('days', 'integer', { min: 1, max: 5 })] }
    ] },
    { name: 'rss', requiresSubscription: false, widgets: [
      { name: 'article_list', description: 'Displaying the list of the last articles',
        params: [P('link', 'string'), P('number', 'integer', { min: 1, max: 50 })] },
      { name: 'feed_search', description: 'Displaying the articles of a feed matching a keyword',
        params: [P('link', 'string'), P('keyword', 'string'), P('number', 'integer', { min: 1, max: 50 })] }
    ] },
    { name: 'github', requiresSubscription: true, widgets: [
      { name: 'recent_commits', description: 'Display the latest commits of a repository',
        params: [P('repository', 'string'), P('number', 'integer', { min: 1, max: 50 })] },
      { name: 'repo_activity', description: 'Display open issues, open pull requests and stars of a repository',
        params: [P('repository', 'string'), P('branch', 'string')] }
    ] },
    { name: 'hackernews', requiresSubscription: false, widgets: [
      { name: 'top_stories', description: 'Display the current front-page stories of Hacker News',
        params: [P('number', 'integer', { min: 1, max: 30 })] },
      { name: 'story_search', description: 'Display the Hacker News stories matching a keyword',
        params: [P('keyword', 'string'), P('number', 'integer', { min: 1, max: 30 })] }
    ] },
    { name: 'currency', requiresSubscription: false, widgets: [
      { name: 'exchange_rate', description: 'Display the current exchange rate between two currencies',
        params: [P('base', 'string', CUR), P('target', 'string', CUR)] },
      { name: 'rate_history', description: 'Display the recent history of an exchange rate',
        params: [P('base', 'string', CUR), P('target', 'string', CUR), P('days', 'integer', { min: 2, max: 30 })] }
    ] },
    { name: 'gmail', requiresSubscription: true, widgets: [
      { name: 'inbox_preview', description: 'Display the most recent emails (sender, subject, snippet)',
        params: [P('count', 'integer', { min: 1, max: 20 })] }
    ] }
  ];

  function getService(name) {
    for (var i = 0; i < SERVICES.length; i++) if (SERVICES[i].name === name) return SERVICES[i];
    return null;
  }
  function getWidget(serviceName, widgetName) {
    var s = getService(serviceName);
    if (!s) return null;
    for (var i = 0; i < s.widgets.length; i++) if (s.widgets[i].name === widgetName) return s.widgets[i];
    return null;
  }

  // GET /about.json : seulement nom + type des paramètres, comme le serveur.
  function aboutServices() {
    return SERVICES.map(function (s) {
      return { name: s.name, widgets: s.widgets.map(function (w) {
        return { name: w.name, description: w.description,
          params: w.params.map(function (p) { return { name: p.name, type: p.type }; }) };
      }) };
    });
  }

  /* ══════════ 2. Repris du frontend : catalogue ══════════ */

  var KNOWN_SERVICES = ['weather', 'github', 'rss', 'hackernews', 'currency', 'gmail'];
  function accentFor(service) { return KNOWN_SERVICES.indexOf(service) !== -1 ? service : 'primary'; }

  var PRESENTATION = {
    'weather/city_temperature': { name: "Température d'une ville",
      description: 'Température actuelle, ressenti et conditions pour une ville.',
      params: { city: { label: 'Ville' }, units: { label: 'Unités (metric ou imperial)', defaultValue: 'metric' } } },
    'weather/city_forecast': { name: 'Prévisions météo',
      description: 'Prévisions sur plusieurs jours pour une ville.',
      params: { city: { label: 'Ville' }, days: { label: 'Nombre de jours (1 à 5)', defaultValue: 5, min: 1, max: 5 } } },
    'rss/article_list': { name: 'Derniers articles', description: "Derniers articles d'un flux RSS.",
      params: { link: { label: 'Lien du flux' }, number: { label: "Nombre d'articles", defaultValue: 5, min: 1, max: 50 } } },
    'rss/feed_search': { name: 'Recherche dans un flux',
      description: "Articles d'un flux dont le titre contient un mot-clé.",
      params: { link: { label: 'Lien du flux' }, keyword: { label: 'Mot-clé' },
        number: { label: "Nombre d'articles", defaultValue: 5, min: 1, max: 50 } } },
    'github/recent_commits': { name: 'Derniers commits',
      description: "Derniers commits d'un dépôt, avec auteur et message.",
      params: { repository: { label: 'Dépôt (owner/repo)' },
        number: { label: 'Nombre de commits', defaultValue: 5, min: 1, max: 50 } } },
    'github/repo_activity': { name: 'Activité du dépôt',
      description: "Issues, pull requests et étoiles d'un dépôt.",
      params: { repository: { label: 'Dépôt (owner/repo)' }, branch: { label: 'Branche', defaultValue: 'main' } } },
    'hackernews/top_stories': { name: 'Une de Hacker News',
      description: 'Articles actuellement en première page de Hacker News.',
      params: { number: { label: "Nombre d'articles (1 à 30)", defaultValue: 10, min: 1, max: 30 } } },
    'hackernews/story_search': { name: 'Recherche Hacker News',
      description: 'Articles Hacker News dont le titre contient un mot-clé.',
      params: { keyword: { label: 'Mot-clé' },
        number: { label: "Nombre d'articles (1 à 30)", defaultValue: 10, min: 1, max: 30 } } },
    'currency/exchange_rate': { name: 'Taux de change',
      description: 'Taux de change actuel entre deux devises.',
      params: { base: { label: 'Devise de base (ex. EUR)' }, target: { label: 'Devise cible (ex. USD)' } } },
    'currency/rate_history': { name: 'Historique du taux de change',
      description: "Évolution récente d'un taux de change.",
      params: { base: { label: 'Devise de base (ex. EUR)' }, target: { label: 'Devise cible (ex. USD)' },
        days: { label: 'Nombre de jours (2 à 30)', defaultValue: 7, min: 2, max: 30 } } },
    'gmail/inbox_preview': { name: 'Aperçu de la boîte de réception',
      description: 'Derniers mails reçus : expéditeur, objet et début du message.',
      params: { count: { label: 'Nombre de mails (1 à 20)', defaultValue: 5, min: 1, max: 20 } } }
  };

  function humanize(technicalName) {
    var spaced = technicalName.replace(/_/g, ' ');
    return spaced.charAt(0).toUpperCase() + spaced.slice(1);
  }

  function buildCatalog(services) {
    var out = [];
    services.forEach(function (service) {
      service.widgets.forEach(function (widget) {
        var pres = PRESENTATION[service.name + '/' + widget.name];
        out.push({
          service: service.name, type: widget.name,
          name: pres ? pres.name : humanize(widget.name),
          description: pres ? pres.description : widget.description,
          params: widget.params.map(function (param) {
            var pp = pres && pres.params[param.name];
            return { name: param.name, type: param.type === 'integer' ? 'integer' : 'string',
              label: pp ? pp.label : param.name,
              defaultValue: pp ? pp.defaultValue : undefined,
              min: pp ? pp.min : undefined, max: pp ? pp.max : undefined };
          })
        });
      });
    });
    return out;
  }

  /* ══════════ 2 bis. Repris du frontend : règles de saisie ══════════ */

  var REFRESH_MIN_SECONDS = 10;
  var REFRESH_MAX_SECONDS = 24 * 60 * 60;
  var CITY_FORBIDDEN = /[^\p{L}\s'’.,-]/gu;
  var CITY_MESSAGE = "Un nom de ville s'écrit avec des lettres, sans chiffres ni symboles.";
  var CURRENCY_MESSAGE = "Une devise s'écrit avec 3 lettres (ex. EUR, USD).";
  var INTEGER_MESSAGE = 'Chiffres uniquement, sans lettres ni symboles.';

  function isCity(param) { return param.name === 'city'; }
  function isCurrencyCode(definition, param) {
    return definition.service === 'currency' && (param.name === 'base' || param.name === 'target');
  }

  function sanitizeDigits(raw) {
    var value = raw.replace(/\D/g, '');
    return { value: value, notice: value === raw ? null : INTEGER_MESSAGE };
  }

  function sanitizeInput(definition, param, raw) {
    if (param.type === 'integer') return sanitizeDigits(raw);
    if (isCity(param)) {
      var value = raw.replace(CITY_FORBIDDEN, '');
      return { value: value, notice: value === raw ? null : CITY_MESSAGE };
    }
    if (isCurrencyCode(definition, param)) {
      var letters = raw.replace(/[^A-Za-z]/g, '');
      var rejected = letters.length !== raw.length || letters.length > 3;
      return { value: letters.slice(0, 3).toUpperCase(), notice: rejected ? CURRENCY_MESSAGE : null };
    }
    return { value: raw, notice: null };
  }

  function integerError(value, min, max) {
    if (value.trim() === '') return 'Champ requis.';
    if (!/^\d+$/.test(value)) return INTEGER_MESSAGE;
    var number = Number(value);
    if (min !== undefined && max !== undefined && (number < min || number > max)) {
      return 'Un nombre entre ' + min + ' et ' + max + '.';
    }
    if (min !== undefined && number < min) return 'Minimum ' + min + '.';
    if (max !== undefined && number > max) return 'Maximum ' + max + '.';
    return null;
  }

  function validateField(definition, param, value) {
    if (param.type === 'integer') return integerError(value, param.min, param.max);
    var trimmed = value.trim();
    if (trimmed === '') return 'Champ requis.';
    if (isCity(param) && !(CITY_RE.test(trimmed) && /\p{L}/u.test(trimmed))) return CITY_MESSAGE;
    if (isCurrencyCode(definition, param) && !/^[A-Za-z]{3}$/.test(trimmed)) return CURRENCY_MESSAGE;
    if (param.name === 'units' && trimmed !== 'metric' && trimmed !== 'imperial') return 'Écris metric ou imperial.';
    return null;
  }

  function validateRefreshRate(value) { return integerError(value, REFRESH_MIN_SECONDS, REFRESH_MAX_SECONDS); }

  function validateConfig(definition, config) {
    var errors = {};
    definition.params.forEach(function (param) {
      var v = config[param.name];
      var error = validateField(definition, param, v === undefined || v === null ? '' : v);
      if (error) errors[param.name] = error;
    });
    if (definition.service === 'currency' && !errors.base && !errors.target &&
        config.base.trim().toUpperCase() === config.target.trim().toUpperCase()) {
      errors.target = 'La devise cible doit être différente de la devise de base.';
    }
    return errors;
  }

  /* ══════════ 2 ter. Repris du frontend : affichage ══════════ */

  function capitalizeFirst(text) { return text.charAt(0).toUpperCase() + text.slice(1); }

  function formatLocalDate(date, options) {
    return new Date(date + 'T12:00:00').toLocaleDateString('fr-FR', options);
  }

  function formatDateTime(value) {
    var date = new Date(value);
    if (isNaN(date.getTime())) return value;
    return date.toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  }

  // "il y a 2 h". `now` est passé en paramètre pour rester testable.
  function formatRelative(value, now) {
    var date = new Date(value);
    if (isNaN(date.getTime())) return value;
    var seconds = Math.round((date.getTime() - (now === undefined ? Date.now() : now)) / 1000);
    var abs = Math.abs(seconds);
    if (abs >= 30 * 86400) return date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
    var rtf = new Intl.RelativeTimeFormat('fr-FR', { numeric: 'auto', style: 'short' });
    if (abs >= 86400) return rtf.format(Math.round(seconds / 86400), 'day');
    if (abs >= 3600) return rtf.format(Math.round(seconds / 3600), 'hour');
    if (abs >= 60) return rtf.format(Math.round(seconds / 60), 'minute');
    return "à l'instant";
  }

  function hostnameOf(link) {
    if (!link) return null;
    try { return new URL(link).hostname.replace(/^www\./, ''); } catch (e) { return null; }
  }

  // Titre d'une carte : pour une URL, seulement le nom de domaine.
  function shortLabel(value) {
    try {
      var url = new URL(value);
      if (url.protocol === 'http:' || url.protocol === 'https:') return url.hostname;
    } catch (e) { /* pas une URL */ }
    return value;
  }

  function formatRate(rate) {
    return rate.toLocaleString('fr-FR', { minimumFractionDigits: 4, maximumFractionDigits: 4 });
  }

  function formatCount(value) {
    if (value < 10000) return value.toLocaleString('fr-FR');
    return new Intl.NumberFormat('fr-FR', { notation: 'compact', maximumFractionDigits: 1 }).format(value);
  }

  // Points de la petite courbe (repère 100 x 32, sans axes).
  function sparklinePoints(values) {
    var width = 100, height = 32;
    var min = Math.min.apply(null, values);
    var span = Math.max.apply(null, values) - min || 1;
    return values.map(function (value, i) {
      var x = values.length === 1 ? width / 2 : (i / (values.length - 1)) * width;
      var y = height - 2 - ((value - min) / span) * (height - 4);
      return x.toFixed(2) + ',' + y.toFixed(2);
    }).join(' ');
  }

  // Les conditions arrivent en texte libre ("overcast clouds", "light rain"...).
  function weatherIconName(conditions) {
    var c = (conditions || '').toLowerCase();
    if (/thunder|storm/.test(c)) return 'lightning';
    if (/snow|sleet/.test(c)) return 'snow';
    if (/drizzle/.test(c)) return 'drizzle';
    if (/rain|shower/.test(c)) return 'rain';
    if (/mist|fog|haze|smoke|dust/.test(c)) return 'fog';
    if (/few clouds|scattered/.test(c)) return 'cloudsun';
    if (/cloud|overcast/.test(c)) return 'cloud';
    if (/clear|sun/.test(c)) return 'sun';
    return 'cloudsun';
  }

  // Titre et sous-titre d'une carte : ce qui distingue l'instance passe en titre.
  function cardTitle(definition, config) {
    var first = definition.params[0];
    var v = first ? String(config[first.name] === undefined || config[first.name] === null ? '' : config[first.name]) : '';
    return { title: v ? shortLabel(v) : definition.name, subtitle: definition.name };
  }

  /* ══════════ 2 quater. Repris du frontend : la grille ══════════ */

  function swap(items, indexA, indexB) {
    var next = items.slice();
    var t = next[indexA]; next[indexA] = next[indexB]; next[indexB] = t;
    return next;
  }

  // Après un échange, les PATCH à envoyer : l'horloge (sans backendId) ne compte pas.
  function positionUpdates(next, idA, idB) {
    var backendOrder = next.filter(function (w) { return w.backendId !== undefined; });
    var out = [];
    [idA, idB].forEach(function (id) {
      var w = next.filter(function (x) { return x.id === id; })[0];
      if (!w || w.backendId === undefined) return;
      out.push({ backendId: w.backendId, position: backendOrder.indexOf(w) });
    });
    return out;
  }

  // Détection « centre le plus proche » (celle choisie dans le projet avec dnd-kit).
  function closestCenter(point, rects) {
    var best = -1, bestD = Infinity;
    for (var i = 0; i < rects.length; i++) {
      var r = rects[i];
      var dx = r.left + r.width / 2 - point.x, dy = r.top + r.height / 2 - point.y;
      var d = dx * dx + dy * dy;
      if (d < bestD) { bestD = d; best = i; }
    }
    return best;
  }

  /* ══════════ 3. Faux serveur : validation (comme validateParams.js) ══════════ */

  var MAX_STRING_LENGTH = 200;

  function validateParams(widget, config) {
    if (typeof config !== 'object' || config === null || Array.isArray(config)) {
      return 'La configuration doit être un objet.';
    }
    var declared = widget.params.map(function (p) { return p.name; });
    var keys = Object.keys(config);
    for (var i = 0; i < keys.length; i++) {
      if (declared.indexOf(keys[i]) === -1) {
        return 'Paramètre inconnu "' + keys[i] + '" pour le widget "' + widget.name + '".';
      }
    }
    for (var j = 0; j < widget.params.length; j++) {
      var param = widget.params[j], value = config[param.name];
      if (value === undefined || value === null) return 'Paramètre "' + param.name + '" manquant.';
      if (param.type === 'string') {
        if (typeof value !== 'string' || value.trim().length === 0) {
          return 'Paramètre "' + param.name + '" : une chaîne non vide est attendue.';
        }
        if (value.length > MAX_STRING_LENGTH) return 'Paramètre "' + param.name + '" : ' + MAX_STRING_LENGTH + ' caractères maximum.';
        if (param.oneOf && param.oneOf.indexOf(value) === -1) {
          return 'Paramètre "' + param.name + '" : valeur attendue parmi ' + param.oneOf.join(', ') + '.';
        }
        if (param.pattern && !param.pattern.test(value.trim())) {
          return 'Paramètre "' + param.name + '" : ' + param.patternMessage;
        }
      } else if (param.type === 'integer') {
        if (!Number.isInteger(value)) return 'Paramètre "' + param.name + '" : un entier est attendu.';
        if (param.min !== undefined && value < param.min) return 'Paramètre "' + param.name + '" : minimum ' + param.min + '.';
        if (param.max !== undefined && value > param.max) return 'Paramètre "' + param.name + '" : maximum ' + param.max + '.';
      }
    }
    return null;
  }

  function serverRefreshError(value) {
    if (!Number.isInteger(value) || value < REFRESH_MIN_SECONDS || value > REFRESH_MAX_SECONDS) {
      return 'refreshRateSeconds doit être un entier entre ' + REFRESH_MIN_SECONDS + ' et ' + REFRESH_MAX_SECONDS + '.';
    }
    return null;
  }

  /* ══════════ 3 bis. Faux serveur : clé de cache (comme widgetCache.js) ══════════ */

  function normalize(value) {
    if (typeof value === 'string') return value.trim();
    if (value && typeof value === 'object') {
      var out = {};
      Object.keys(value).sort().forEach(function (k) { out[k] = normalize(value[k]); });
      return out;
    }
    return value;
  }
  function keyOf(instance) {
    return instance.service + '/' + instance.widgetType + ':' + JSON.stringify(normalize(instance.config));
  }
  var FRESHNESS_SLACK_MS = 1000;

  /* ══════════ 4. Données d'exemple — FICTIVES ══════════ */

  function hash(str) {
    var h = 2166136261 >>> 0;
    for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    h ^= h >>> 13; h = Math.imul(h, 0x5bd1e995); h ^= h >>> 15;
    return h >>> 0;
  }
  function rnd(seed) { return hash(String(seed)) / 4294967296; }
  // Bruit lisse entre -1 et 1, qui change toutes les `period` ms.
  function wave(seed, t, period) {
    var k = Math.floor(t / period), f = (t - k * period) / period;
    var a = rnd(seed + '~' + k), b = rnd(seed + '~' + (k + 1));
    var s = (1 - Math.cos(Math.PI * f)) / 2;
    return (a + (b - a) * s) * 2 - 1;
  }
  // Événements passés (commits, articles, mails) : au plus un par tranche de temps.
  function stream(seed, bucketMs, p, now, max, scan) {
    var out = [], b = Math.floor(now / bucketMs);
    for (var i = 0; i < scan && out.length < max; i++) {
      var k = b - i;
      if (rnd(seed + '#' + k) < p) {
        var t = k * bucketMs + Math.floor(rnd(seed + '@' + k) * bucketMs);
        if (t <= now) out.push({ k: k, t: t });
      }
    }
    return out;
  }
  function pick(list, seed) { return list[hash(String(seed)) % list.length]; }
  function iso(t) { return new Date(t).toISOString(); }
  function fold(s) {
    return String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  }
  function fail(message, status, details) {
    var e = new Error(message); e.status = status; e.details = details; return e;
  }

  /* ── météo ── */
  // [nom, décalage horaire, moyenne annuelle °C, amplitude saison, jour le plus chaud,
  //  amplitude jour/nuit, humidité %, part de jours de pluie]
  var CITIES = {
    'cotonou': ['Cotonou', 1, 27.6, 1.6, 75, 2.6, 80, 0.28],
    'porto-novo': ['Porto-Novo', 1, 27.4, 1.7, 75, 3.0, 79, 0.28],
    'abomey-calavi': ['Abomey-Calavi', 1, 27.5, 1.6, 75, 2.9, 79, 0.28],
    'parakou': ['Parakou', 1, 27.0, 2.6, 85, 5.5, 56, 0.16],
    'lome': ['Lomé', 0, 27.3, 1.5, 75, 2.8, 79, 0.24],
    'lagos': ['Lagos', 1, 27.4, 1.5, 70, 2.8, 82, 0.32],
    'abidjan': ['Abidjan', 0, 26.8, 1.5, 75, 2.6, 82, 0.34],
    'accra': ['Accra', 0, 27.0, 1.5, 75, 2.6, 78, 0.2],
    'dakar': ['Dakar', 0, 24.8, 3.2, 270, 2.8, 72, 0.08],
    'paris': ['Paris', 1, 12.4, 8.0, 200, 3.8, 76, 0.36],
    'lyon': ['Lyon', 1, 13.0, 9.0, 200, 4.6, 72, 0.3],
    'marseille': ['Marseille', 1, 15.6, 8.4, 205, 4.4, 63, 0.16],
    'lille': ['Lille', 1, 11.0, 7.4, 200, 3.6, 81, 0.44],
    'toulouse': ['Toulouse', 1, 14.0, 8.0, 203, 4.8, 73, 0.28],
    'bordeaux': ['Bordeaux', 1, 14.0, 7.4, 203, 4.4, 77, 0.34],
    'nantes': ['Nantes', 1, 12.7, 6.8, 203, 4.0, 80, 0.36],
    'bruxelles': ['Bruxelles', 1, 11.0, 7.4, 200, 3.6, 80, 0.44],
    'londres': ['London', 0, 11.6, 6.8, 200, 3.6, 78, 0.42],
    'london': ['London', 0, 11.6, 6.8, 200, 3.6, 78, 0.42],
    'montreal': ['Montréal', -5, 7.4, 15.4, 200, 4.6, 70, 0.36],
    'new-york': ['New York', -5, 13.0, 12.0, 203, 4.2, 64, 0.3],
    'tokyo': ['Tokyo', 9, 16.4, 10.6, 215, 3.8, 66, 0.3]
  };
  var CITY_EXAMPLES = ['Cotonou', 'Paris', 'Parakou', 'Lomé', 'Dakar', 'Lyon', 'Marseille', 'Lille', 'London', 'Montréal', 'New York', 'Tokyo'];

  function findCity(q) {
    var key = fold(q).split(',')[0].replace(/[’']/g, '').trim().replace(/\s+/g, '-');
    return CITIES[key] || null;
  }
  function localParts(now, tz) {
    var d = new Date(now + tz * 3600000);
    var start = Date.UTC(d.getUTCFullYear(), 0, 0);
    return { date: d.toISOString().slice(0, 10), hour: d.getUTCHours() + d.getUTCMinutes() / 60,
      doy: Math.floor((d.getTime() - start) / 86400000) };
  }
  function dayMean(c, doy) { return c[2] + c[3] * Math.cos(2 * Math.PI * (doy - c[4]) / 365); }
  function r1(x) { return Math.round(x * 10) / 10; }
  function skyFor(c, seed, temp) {
    var r = rnd(seed), r2 = rnd(seed + 'b');
    if (r < c[7]) {
      if (temp < 1) return 'light snow';
      if (c[2] > 22 && r2 < 0.3) return 'thunderstorm';
      return r2 < 0.55 ? 'light rain' : r2 < 0.8 ? 'moderate rain' : 'light intensity drizzle';
    }
    var cloudy = (c[6] - 50) / 60;                       // air humide = plus de nuages
    if (r2 < 0.3 - cloudy * 0.25) return 'clear sky';
    if (r2 < 0.5) return 'few clouds';
    if (r2 < 0.68) return 'scattered clouds';
    if (r2 < 0.86) return 'broken clouds';
    return 'overcast clouds';
  }

  function fetchCurrentTemperature(cfg, now) {
    var c = findCity(cfg.city);
    if (!c) throw fail('Ville introuvable : ' + cfg.city + '.', 404);
    var lp = localParts(now, c[1]);
    var t = dayMean(c, lp.doy) + c[5] * Math.cos(2 * Math.PI * (lp.hour - 15) / 24) + 0.9 * wave('t' + c[0], now, 40000);
    var hum = Math.round(Math.min(98, Math.max(18,
      c[6] - 9 * Math.cos(2 * Math.PI * (lp.hour - 15) / 24) + 4 * wave('h' + c[0], now, 30000))));
    var feels = t + (t > 24 ? (hum - 45) / 11 : t < 10 ? -1.8 : -0.3);
    var conditions = skyFor(c, 'sky' + c[0] + Math.floor(now / 600000), t);
    var imp = cfg.units === 'imperial';
    var conv = function (x) { return Math.round((imp ? x * 9 / 5 + 32 : x) * 100) / 100; };
    return { city: c[0], temperature: conv(t), feelsLike: conv(feels), humidity: hum, conditions: conditions, units: cfg.units };
  }

  function fetchForecast(cfg, now) {
    var c = findCity(cfg.city);
    if (!c) throw fail('Ville introuvable : ' + cfg.city + '.', 404);
    var out = [];
    for (var i = 0; i < cfg.days; i++) {
      var lp = localParts(now + i * 86400000, c[1]);
      var seed = 'fc' + c[0] + lp.date;
      var mid = dayMean(c, lp.doy) + (rnd(seed) - 0.5) * 3 + (i === 0 ? 0.3 * wave(seed, now, 60000) : 0);
      var sky = skyFor(c, seed + 's', mid - c[5]);
      var wet = /rain|drizzle|thunder|snow/.test(sky);
      out.push({ date: lp.date, min: r1(mid - c[5] - rnd(seed + 'n')), max: r1(mid + c[5] + rnd(seed + 'x')),
        precipitation: wet ? r1(0.3 + rnd(seed + 'p') * (sky === 'moderate rain' || sky === 'thunderstorm' ? 14 : 4)) : 0,
        conditions: sky });
    }
    return { city: c[0], forecast: out };
  }

  /* ── GitHub (dépôts inventés) ── */
  var REPOS = {
    'atelier-nord/boutique-web': { stars: 148, issues: 12, prs: 4, pace: 0.24, msgs: [
      'feat(panier): garder le panier après connexion', 'fix(paiement): arrondi des centimes sur la TVA',
      'refactor(catalogue): un seul composant pour la carte produit', 'test(panier): cas du code promo expiré',
      'feat(recherche): suggestions pendant la frappe', 'fix(a11y): focus visible sur le menu mobile',
      'chore(deps): mise à jour de Next.js', 'perf(images): tailles adaptées au téléphone',
      'fix(commande): double clic sur « Payer »', 'docs: guide de mise en route en 5 minutes',
      'feat(compte): export des factures en PDF', 'style(fiche): espacements de la galerie'] },
    'atelier-nord/api-commandes': { stars: 37, issues: 7, prs: 2, pace: 0.16, msgs: [
      'feat(commandes): filtre par statut', 'fix(stock): réservation libérée après 15 min',
      'refactor(auth): jetons courts + renouvellement', 'test(api): contrat de la route /orders',
      'chore(ci): cache des dépendances', 'fix(webhook): nouvelle tentative après un échec 502',
      'feat(export): CSV des commandes du jour', 'perf(sql): index sur created_at',
      'docs(openapi): exemples de réponses', 'fix(tz): date de livraison en heure locale'] },
    'atelier-nord/app-mobile': { stars: 64, issues: 19, prs: 6, pace: 0.2, msgs: [
      'feat(notif): rappel de panier abandonné', 'fix(android): clavier qui cache le bouton',
      'feat(hors-ligne): catalogue consultable sans réseau', 'refactor(nav): onglets en bas',
      'fix(ios): zone sûre sous l’encoche', 'test(e2e): parcours de commande',
      'chore(release): version 2.4.1', 'perf(liste): défilement à 60 images/s',
      'feat(scan): lecture du code-barres', 'fix(login): message clair si mot de passe faux'] }
  };
  var REPO_EXAMPLES = Object.keys(REPOS);
  var DEVS = ['amina-k', 'theo-dev', 'sena.o', 'lea-m', 'kofi-b', 'jb-roux'];

  function findRepo(name) {
    var r = REPOS[String(name).trim().toLowerCase()];
    if (!r) throw fail('Dépôt introuvable (ou privé, non accessible).', 404);
    return r;
  }
  function sha40(seed) {
    var s = '';
    for (var i = 0; i < 5; i++) s += ('0000000' + hash(seed + ':' + i).toString(16)).slice(-8);
    return s;
  }
  function fetchRecentCommits(cfg, now) {
    var repo = findRepo(cfg.repository), key = String(cfg.repository).trim().toLowerCase();
    var ev = stream('gh' + key, 30000, repo.pace, now, cfg.number, 2000);
    return { repository: cfg.repository, commits: ev.map(function (e) {
      return { sha: sha40(key + e.k), author: pick(DEVS, key + 'a' + e.k), message: repo.msgs[(e.k * 7 + hash(key)) % repo.msgs.length], date: iso(e.t) };
    }) };
  }
  function fetchRepoActivity(cfg, now) {
    var repo = findRepo(cfg.repository), key = String(cfg.repository).trim().toLowerCase();
    return { repository: cfg.repository, branch: cfg.branch,
      openIssues: Math.max(0, repo.issues + Math.round(3 * wave('i' + key, now, 45000))),
      openPullRequests: Math.max(0, repo.prs + Math.round(2 * wave('p' + key, now, 60000))),
      stars: repo.stars + Math.floor((now / 120000) % 400) };
  }

  /* ── Hacker News (titres inventés) ── */
  var HN_TITLES = [
    ['Show HN: A dashboard that fits in one HTML file', 'onefile.example'],
    ['Why we moved our cron jobs back to a single server', 'smallinfra.example'],
    ['Ask HN: How do you keep product metrics honest?', null],
    ['Postgres as a queue: two years later', 'dbnotes.example'],
    ['The hidden cost of a 200 ms API', 'latency.example'],
    ['Show HN: Open-source status page for small teams', 'statuskit.example'],
    ['What I learned shipping a design system alone', 'uilog.example'],
    ['AI code review: what it catches and what it misses', 'reviewlab.example'],
    ['A gentle introduction to OAuth 2.0 with drawings', 'authdraw.example'],
    ['Ask HN: What is on your team dashboard?', null],
    ['Rust for web developers: the first week', 'rustweek.example'],
    ['Caching is easy, invalidation is the product', 'cachework.example'],
    ['Show HN: RSS reader with keyword alerts', 'feedwatch.example'],
    ['How a tiny team runs on-call without burning out', 'calmops.example'],
    ['The case for boring technology in 2026', 'boringtech.example'],
    ['AI assistants and the return of the plain text file', 'plaintext.example'],
    ['Drag and drop on touch screens is still hard', 'touchnotes.example'],
    ['We measured our bundle size every day for a year', 'bundlediary.example'],
    ['Ask HN: Best way to learn system design by doing?', null],
    ['Accessibility checks that fit in a code review', 'a11yreview.example'],
    ['Show HN: Self-hosted exchange rate API', 'ratebox.example'],
    ['Dark mode done right: contrast first', 'contrastfirst.example'],
    ['Why your product needs a changelog people read', 'changelogs.example'],
    ['SQLite in production: notes from a small shop', 'smallshop.example'],
    ['Open-source maintainers and the funding gap', 'ossfund.example'],
    ['AI search over your own docs with 200 lines of code', 'docsearch.example'],
    ['Rate limiting explained with water buckets', 'buckets.example'],
    ['Show HN: Weather widgets without tracking', 'plainweather.example'],
    ['The product spec is a conversation, not a document', 'specnotes.example'],
    ['Teaching juniors to read stack traces', 'tracecamp.example']
  ];
  var HN_USERS = ['mkovac', 'tinyteam', 'lena_w', 'opsfox', 'dbdave', 'ayo_dev', 'pixelpat', 'rgrant'];

  function hnStory(p, t, now) {
    var ageMin = Math.max(0, (now - t) / 60000);
    var heat = 0.6 + rnd('hn-heat' + p + ':' + Math.floor(t / 1000)) * 5;
    var points = Math.round(3 + heat * Math.pow(ageMin, 0.85) * 1.6);
    var id = String(41000000 + Math.floor(t / 1000) % 900000);
    var disc = 'https://news.ycombinator.com/item?id=' + id;
    var host = HN_TITLES[p][1];
    return { id: id, title: HN_TITLES[p][0], url: host ? 'https://' + host + '/' : disc, discussionUrl: disc,
      author: pick(HN_USERS, 'hn-u' + p), points: points,
      comments: Math.round(points * (0.25 + rnd('hn-c' + p) * 0.7)), createdAt: iso(t) };
  }
  // Dernier passage de chaque titre dans le flux.
  function hnLatest(now) {
    var ev = stream('hn', 60000, 0.5, now, 400, 800), seen = {}, out = [];
    for (var i = 0; i < ev.length && out.length < HN_TITLES.length; i++) {
      var p = hash('hn-t' + ev[i].k) % HN_TITLES.length;
      if (seen[p]) continue;
      seen[p] = true;
      out.push(hnStory(p, ev[i].t, now));
    }
    return out;
  }
  function fetchTopStories(cfg, now) {
    var all = hnLatest(now);
    all.sort(function (a, b) {
      var ra = a.points / Math.pow((now - Date.parse(a.createdAt)) / 3600000 + 0.4, 1.4);
      var rb = b.points / Math.pow((now - Date.parse(b.createdAt)) / 3600000 + 0.4, 1.4);
      return rb - ra;
    });
    return { stories: all.slice(0, cfg.number) };
  }
  function fetchStorySearch(cfg, now) {
    var needle = fold(cfg.keyword.trim());
    // Comme un moteur de recherche : le mot-clé doit commencer un mot du titre.
    var hits = hnLatest(now).filter(function (s) { return (' ' + fold(s.title).replace(/[^a-z0-9]+/g, ' ')).indexOf(' ' + needle.replace(/[^a-z0-9]+/g, ' ').trim()) !== -1; });
    hits.sort(function (a, b) { return b.points - a.points; });
    return { keyword: cfg.keyword, stories: hits.slice(0, cfg.number) };
  }

  /* ── flux RSS (flux inventés, domaine .example) ── */
  var FEEDS = {
    'https://blog.atelier-nord.example/rss.xml': { pace: 0.3, titles: [
      'Nouvelle page de paiement : ce qui change', 'Retour sur la panne du 12 : ce que nous avons appris',
      'Le panier se souvient maintenant de vous', 'Comment nous testons une idée en une semaine',
      'Recherche : des résultats dès la première lettre', 'Accessibilité : notre liste de contrôle',
      'Trois chiffres que nous regardons chaque lundi', 'Pourquoi nous avons retiré une fonctionnalité',
      'Application mobile : le mode hors ligne arrive', 'Nos notes de version, en clair',
      'Un tableau de bord pour toute l’équipe produit', 'Livraison : des délais plus fiables'] },
    'https://veille-produit.example/feed': { pace: 0.36, titles: [
      'Dix questions à poser avant d’écrire une spécification', 'Mesurer l’adoption sans se mentir',
      'Le tableau de bord qui tient sur un écran', 'Prioriser : la méthode des trois colonnes',
      'Entretiens clients : écouter avant de proposer', 'Tarifs : tester sans perdre la confiance',
      'Quand dire non à une demande de fonctionnalité', 'Feuille de route : moins de dates, plus de problèmes',
      'Le produit minimum, vraiment minimum', 'Lire un entonnoir de conversion',
      'Notes de version : écrire pour être lu', 'Réunion produit : trente minutes suffisent'] },
    'https://actu-tech.example/rss': { pace: 0.42, titles: [
      'Navigateurs : le glisser-déposer tactile progresse', 'Une nouvelle version majeure pour un cadre web populaire',
      'Bases de données : le retour du fichier unique', 'Sécurité : pourquoi faire tourner ses jetons',
      'Centres de données : la course à la sobriété', 'IA : les assistants de code entrent dans les équipes',
      'Logiciel libre : qui paie la maintenance ?', 'Mobile : les applications hors ligne reviennent',
      'CSS : les requêtes de conteneur partout', 'Cloud : la facture, premier sujet des directions techniques',
      'Accessibilité : de nouvelles règles en Europe', 'Paiement en ligne : moins d’étapes, plus de ventes',
      'Auto-hébergement : la tendance s’installe', 'Tests : mesurer avant d’optimiser'] }
  };
  var FEED_EXAMPLES = Object.keys(FEEDS);

  function slug(s) { return fold(s).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48); }
  function loadFeed(link, now) {
    var feed = FEEDS[String(link).trim()];
    if (!feed) throw fail('Impossible de lire le flux : ' + link + '.', 502);
    var ev = stream('rss' + link, 120000, feed.pace, now, 200, 400), seen = {}, out = [];
    var origin = String(link).trim().replace(/^(https?:\/\/[^/]+).*$/, '$1');
    for (var i = 0; i < ev.length; i++) {
      var title = pick(feed.titles, 'rss-t' + link + ev[i].k);
      if (seen[title]) continue;
      seen[title] = true;
      out.push({ title: title, link: origin + '/articles/' + slug(title), publishedAt: iso(ev[i].t) });
    }
    return out;
  }
  function fetchArticleList(cfg, now) {
    return { link: cfg.link, articles: loadFeed(cfg.link, now).slice(0, cfg.number) };
  }
  function fetchFeedSearch(cfg, now) {
    var needle = cfg.keyword.toLowerCase();
    var matching = loadFeed(cfg.link, now).filter(function (a) { return a.title.toLowerCase().indexOf(needle) !== -1; });
    return { link: cfg.link, keyword: cfg.keyword, articles: matching.slice(0, cfg.number) };
  }

  /* ── taux de change (valeurs plausibles, pas des cours réels) ── */
  // Les 31 devises publiées par la BCE. Valeur : combien pour 1 euro.
  var CURRENCIES = {
    AUD: ['Australian Dollar', 1.66], BGN: ['Bulgarian Lev', 1.9558], BRL: ['Brazilian Real', 6.15],
    CAD: ['Canadian Dollar', 1.52], CHF: ['Swiss Franc', 0.94], CNY: ['Chinese Renminbi Yuan', 7.75],
    CZK: ['Czech Koruna', 25.2], DKK: ['Danish Krone', 7.46], EUR: ['Euro', 1],
    GBP: ['British Pound', 0.84], HKD: ['Hong Kong Dollar', 8.45], HUF: ['Hungarian Forint', 405],
    IDR: ['Indonesian Rupiah', 17300], ILS: ['Israeli New Sheqel', 4.05], INR: ['Indian Rupee', 91.5],
    ISK: ['Icelandic Króna', 149], JPY: ['Japanese Yen', 163], KRW: ['South Korean Won', 1500],
    MXN: ['Mexican Peso', 21.8], MYR: ['Malaysian Ringgit', 4.75], NOK: ['Norwegian Krone', 11.8],
    NZD: ['New Zealand Dollar', 1.81], PHP: ['Philippine Peso', 62.5], PLN: ['Polish Złoty', 4.32],
    RON: ['Romanian Leu', 4.98], SEK: ['Swedish Krona', 11.5], SGD: ['Singapore Dollar', 1.44],
    THB: ['Thai Baht', 37.5], TRY: ['Turkish Lira', 37], USD: ['United States Dollar', 1.085],
    ZAR: ['South African Rand', 19.6]
  };
  function currencyList() {
    return Object.keys(CURRENCIES).sort().map(function (code) { return { code: code, name: CURRENCIES[code][0] }; });
  }
  function normalizePair(base, target) {
    var from = String(base).trim().toUpperCase(), to = String(target).trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(from) || !/^[A-Z]{3}$/.test(to)) throw fail("Une devise s'écrit avec 3 lettres (ex. EUR, USD).", 422);
    if (from === to) throw fail('La devise de base et la devise cible doivent être différentes.', 422);
    var unknown = [from, to].filter(function (c, i, a) { return !CURRENCIES[c] && a.indexOf(c) === i; });
    if (unknown.length) throw fail('Devise inconnue : ' + unknown.join(', ') + '.', 422, { currencies: currencyList() });
    return [from, to];
  }
  function perEuro(code, day, now) {
    if (code === 'EUR') return 1;
    var ph = rnd('fx' + code) * 6.283;
    var osc = 0.012 * Math.sin(day / 5.3 + ph) + 0.006 * Math.sin(day / 1.9 + ph * 2) + 0.003 * (rnd('fx' + code + day) - 0.5);
    var intra = now === undefined ? 0 : 0.0007 * wave('fxi' + code, now, 20000);
    return CURRENCIES[code][1] * (1 + osc + intra);
  }
  function isBusinessDay(day) { var wd = new Date(day * 86400000).getUTCDay(); return wd !== 0 && wd !== 6; }
  function dayStr(day) { return new Date(day * 86400000).toISOString().slice(0, 10); }
  function round5(x) { return Math.round(x * 100000) / 100000; }
  function pairRate(from, to, day, now) { return round5(perEuro(to, day, now) / perEuro(from, day, now)); }

  function fetchExchangeRate(cfg, now) {
    var pair = normalizePair(cfg.base, cfg.target);
    var day = Math.floor(now / 86400000);
    while (!isBusinessDay(day)) day--;                   // pas de taux publié le week-end
    return { base: pair[0], target: pair[1], rate: pairRate(pair[0], pair[1], day, now), date: dayStr(day) };
  }
  function fetchRateHistory(cfg, now) {
    var pair = normalizePair(cfg.base, cfg.target);
    var end = Math.floor(now / 86400000), history = [];
    for (var day = end - cfg.days; day <= end; day++) {
      if (!isBusinessDay(day)) continue;
      history.push({ date: dayStr(day), rate: pairRate(pair[0], pair[1], day, day === end ? now : undefined) });
    }
    return { base: pair[0], target: pair[1], history: history };
  }

  /* ── Gmail (expéditeurs et messages inventés) ── */
  var MAILS = [
    ['Léa Martin <lea@atelier-nord.example>', 'Point produit de jeudi : ordre du jour', 'Bonjour à tous, voici les trois sujets que je propose pour jeudi : le panier, la recherche et…'],
    ['Suivi des commandes <noreply@atelier-nord.example>', 'Rapport du jour : 3 commandes en attente', 'Trois commandes attendent une validation manuelle depuis plus de deux heures. Détail ci-dessous…'],
    ['Théo Durand <theo@atelier-nord.example>', 'Re: maquette de la page de paiement', 'J’ai repris tes remarques : le bouton passe en bas et le récapitulatif reste visible pendant…'],
    ['Support client <support@atelier-nord.example>', 'Ticket 4821 : remboursement demandé', 'Une cliente signale un double prélèvement sur sa commande de mardi. Peux-tu vérifier côté…'],
    ['Amina Koné <amina@atelier-nord.example>', 'Tests utilisateurs : les enregistrements sont prêts', 'Les cinq sessions sont en ligne. Le point qui revient le plus : on ne trouve pas le code promo…'],
    ['Intégration continue <ci@atelier-nord.example>', 'Échec du build sur la branche main', 'Le test « panier — code promo expiré » échoue depuis le dernier commit. Journal complet en pièce…'],
    ['Comptabilité <compta@atelier-nord.example>', 'Facture d’hébergement du mois', 'Bonjour, la facture d’hébergement est disponible. Montant en légère hausse par rapport au mois…'],
    ['Séna Okou <sena@atelier-nord.example>', 'Idée : un tableau de bord pour l’équipe', 'Et si on affichait sur un écran les commits, les tickets ouverts et la météo du bureau ? J’ai vu…'],
    ['Partenaire livraison <contact@colis-rapide.example>', 'Nouveaux délais pour la zone nord', 'À partir de lundi, les colis de la zone nord seront livrés en 48 h au lieu de 72 h. Merci de…'],
    ['Léa Martin <lea@atelier-nord.example>', 'Feuille de route : version à relire', 'J’ai retiré deux dates et ajouté le problème que chaque chantier doit résoudre. Vos retours avant…'],
    ['Kofi Bello <kofi@atelier-nord.example>', 'Application mobile : version 2.4.1 publiée', 'La version est en ligne sur les deux magasins. Elle corrige le clavier qui cachait le bouton…'],
    ['Agenda <agenda@atelier-nord.example>', 'Rappel : démonstration client à 15 h', 'Démonstration du nouveau parcours de commande. Salle du premier étage, lien visio dans…']
  ];
  function fetchInboxPreview(cfg, now) {
    var ev = stream('mail', 90000, 0.36, now, cfg.count, 2000);
    return { messages: ev.map(function (e) {
      var m = MAILS[(e.k * 7) % MAILS.length];
      return { id: ('00000000' + hash('mail-id' + e.k).toString(16)).slice(-8) + ('00000000' + hash('mail-ie' + e.k).toString(16)).slice(-8),
        from: m[0], subject: m[1], snippet: m[2], receivedAt: iso(e.t) };
    }) };
  }

  var CONNECTORS = {
    'weather/city_temperature': fetchCurrentTemperature, 'weather/city_forecast': fetchForecast,
    'rss/article_list': fetchArticleList, 'rss/feed_search': fetchFeedSearch,
    'github/recent_commits': fetchRecentCommits, 'github/repo_activity': fetchRepoActivity,
    'hackernews/top_stories': fetchTopStories, 'hackernews/story_search': fetchStorySearch,
    'currency/exchange_rate': fetchExchangeRate, 'currency/rate_history': fetchRateHistory,
    'gmail/inbox_preview': fetchInboxPreview
  };
  var OUTAGE_MESSAGES = {
    weather: 'Service météo injoignable.', rss: null, github: "Erreur lors de l'appel à l'API GitHub.",
    hackernews: 'Hacker News injoignable.', currency: 'Service de taux de change injoignable.', gmail: null
  };

  function fetchWidgetData(instance, now, outages) {
    if (outages && outages[instance.service]) {
      throw fail(OUTAGE_MESSAGES[instance.service] || 'Service tiers injoignable.', 502);
    }
    var fn = CONNECTORS[instance.service + '/' + instance.widgetType];
    if (!fn) throw fail('Widget inconnu.', 501);
    return fn(instance.config, now);
  }

  /* ══════════ 5. Faux serveur : les routes du vrai backend ══════════ */

  var UPSTREAM_STATUS = { 403: 403, 404: 422, 422: 422, 501: 501 };

  function createServer(saved) {
    var db = { nextId: 1, widgets: [] };
    if (saved && Array.isArray(saved.widgets)) {
      db.widgets = saved.widgets.filter(function (w) { return w && getWidget(w.service, w.widgetType); })
        .map(function (w) { return JSON.parse(JSON.stringify(w)); });
      db.nextId = Math.max(Number(saved.nextId) || 1, 1 + db.widgets.reduce(function (m, w) { return Math.max(m, w.id); }, 0));
    }
    var cache = {};      // clé -> { data | error, fetchedAt }  (repart à vide au rechargement)
    var outages = {};
    var stats = { requests: 0, hits: 0, misses: 0 };

    function ordered() {
      return db.widgets.slice().sort(function (a, b) { return a.position - b.position || a.id - b.id; });
    }
    function applyOrder(list) { list.forEach(function (w, i) { w.position = i; }); }
    function find(id) { return db.widgets.filter(function (w) { return w.id === id; })[0] || null; }
    function copy(w) { return JSON.parse(JSON.stringify(w)); }
    function parseId(raw) { var id = Number(raw); return Number.isInteger(id) && id > 0 ? id : null; }

    // Même règle que widgetCache.refresh : on ne rappelle le service tiers que
    // si l'entrée est absente ou plus vieille que la fréquence (moins 1 s).
    function refresh(instance, now) {
      var key = keyOf(instance);
      var limit = instance.refreshRateSeconds * 1000 - FRESHNESS_SLACK_MS;
      var cached = cache[key];
      if (cached && now - cached.fetchedAt < limit) { stats.hits++; return { entry: cached, cache: 'HIT', key: key }; }
      stats.misses++;
      var entry;
      try { entry = { data: fetchWidgetData(instance, now, outages), fetchedAt: now }; }
      catch (err) { entry = { error: { status: err.status || 502, message: err.message, details: err.details }, fetchedAt: now }; }
      cache[key] = entry;
      return { entry: entry, cache: 'MISS', key: key };
    }

    function handle(method, path, body, now) {
      stats.requests++;
      body = body || {};
      var m;
      if (method === 'GET' && path === '/about.json') {
        return { status: 200, body: { client: { host: 'demo' }, server: { current_time: Math.floor(now / 1000), services: aboutServices() } } };
      }
      if (method === 'GET' && path === '/dashboard') {
        return { status: 200, body: { widgets: ordered().map(copy) } };
      }
      if (method === 'POST' && path === '/dashboard/widgets') {
        var refreshRateSeconds = body.refreshRateSeconds === undefined ? 60 : body.refreshRateSeconds;
        if (typeof body.service !== 'string' || typeof body.widgetType !== 'string') {
          return { status: 400, body: { error: 'service et widgetType sont requis.' } };
        }
        var widget = getWidget(body.service, body.widgetType);
        if (!widget) return { status: 400, body: { error: 'Widget inconnu : ' + body.service + '/' + body.widgetType + '.' } };
        var configError = validateParams(widget, body.config);
        if (configError) return { status: 400, body: { error: configError } };
        var rateError = serverRefreshError(refreshRateSeconds);
        if (rateError) return { status: 400, body: { error: rateError } };
        var maxPos = db.widgets.reduce(function (mx, w) { return Math.max(mx, w.position); }, -1);
        var created = { id: db.nextId++, service: body.service, widgetType: body.widgetType, config: copy(body.config),
          refreshRateSeconds: refreshRateSeconds, position: maxPos + 1, createdAt: iso(now), updatedAt: iso(now) };
        db.widgets.push(created);
        return { status: 201, body: { widget: copy(created) } };
      }
      if ((m = /^\/dashboard\/widgets\/([^/]+)\/data$/.exec(path)) && method === 'GET') {
        var idD = parseId(m[1]);
        if (idD === null) return { status: 400, body: { error: 'Identifiant invalide.' } };
        var inst = find(idD);
        if (!inst) return { status: 404, body: { error: 'Widget introuvable.' } };
        var r = refresh(inst, now), fetchedAt = iso(r.entry.fetchedAt);
        if (r.entry.error) {
          var status = UPSTREAM_STATUS[r.entry.error.status] || 502;
          var out = {};
          for (var k in (r.entry.error.details || {})) out[k] = r.entry.error.details[k];
          out.error = r.entry.error.message; out.fetchedAt = fetchedAt;
          return { status: status, body: out, cache: r.cache, key: r.key };
        }
        return { status: 200, body: { data: r.entry.data, fetchedAt: fetchedAt }, cache: r.cache, key: r.key };
      }
      if ((m = /^\/dashboard\/widgets\/([^/]+)$/.exec(path)) && method === 'PATCH') {
        var id = parseId(m[1]);
        if (id === null) return { status: 400, body: { error: 'Identifiant invalide.' } };
        if (body.config === undefined && body.refreshRateSeconds === undefined && body.position === undefined) {
          return { status: 400, body: { error: 'Rien à modifier : config, refreshRateSeconds ou position attendu.' } };
        }
        if (body.refreshRateSeconds !== undefined) {
          var re = serverRefreshError(body.refreshRateSeconds);
          if (re) return { status: 400, body: { error: re } };
        }
        if (body.position !== undefined && (!Number.isInteger(body.position) || body.position < 0)) {
          return { status: 400, body: { error: 'position doit être un entier positif ou nul.' } };
        }
        var existing = find(id);
        if (!existing) return { status: 404, body: { error: 'Widget introuvable.' } };
        if (body.config !== undefined) {
          var ce = validateParams(getWidget(existing.service, existing.widgetType), body.config);
          if (ce) return { status: 400, body: { error: ce } };
          existing.config = copy(body.config);
        }
        if (body.refreshRateSeconds !== undefined) existing.refreshRateSeconds = body.refreshRateSeconds;
        if (body.position !== undefined) {
          // « position » = l'indice voulu : les autres se décalent.
          var rest = ordered().filter(function (w) { return w.id !== id; });
          rest.splice(Math.min(body.position, rest.length), 0, existing);
          applyOrder(rest);
        }
        existing.updatedAt = iso(now);
        return { status: 200, body: { widget: copy(existing) } };
      }
      if ((m = /^\/dashboard\/widgets\/([^/]+)$/.exec(path)) && method === 'DELETE') {
        var idX = parseId(m[1]);
        if (idX === null) return { status: 400, body: { error: 'Identifiant invalide.' } };
        if (!find(idX)) return { status: 404, body: { error: 'Widget introuvable.' } };
        db.widgets = db.widgets.filter(function (w) { return w.id !== idX; });
        applyOrder(ordered());                             // pas de trou dans les positions
        return { status: 204, body: null };
      }
      return { status: 404, body: { error: 'Route inconnue.' } };
    }

    return {
      handle: handle,
      dump: function () { return { nextId: db.nextId, widgets: ordered().map(copy) }; },
      setOutage: function (service, on) { if (on) outages[service] = true; else delete outages[service]; },
      stats: function () { return { requests: stats.requests, hits: stats.hits, misses: stats.misses }; }
    };
  }

  /* ══════════ 6. Tableaux d'exemple ══════════ */

  var BLOG = FEED_EXAMPLES[0];
  var PROFILES = {
    equipe: { label: 'Équipe produit', note: 'Exemple entreprise : le tableau d’une équipe produit fictive, « Atelier Nord ».', widgets: [
      ['github', 'recent_commits', { repository: 'atelier-nord/boutique-web', number: 5 }, 20],
      ['github', 'repo_activity', { repository: 'atelier-nord/boutique-web', branch: 'main' }, 30],
      ['weather', 'city_temperature', { city: 'Cotonou', units: 'metric' }, 30],
      ['gmail', 'inbox_preview', { count: 5 }, 45],
      ['currency', 'exchange_rate', { base: 'EUR', target: 'USD' }, 15],
      ['rss', 'article_list', { link: BLOG, number: 5 }, 60],
      ['hackernews', 'story_search', { keyword: 'AI', number: 10 }, 60],
      ['weather', 'city_forecast', { city: 'Paris', days: 5 }, 120]
    ] },
    veille: { label: 'Veille perso', note: 'Un tableau personnel : actualité, météo et devises.', widgets: [
      ['hackernews', 'top_stories', { number: 10 }, 30],
      ['weather', 'city_temperature', { city: 'Paris', units: 'metric' }, 30],
      ['currency', 'rate_history', { base: 'EUR', target: 'GBP', days: 7 }, 20],
      ['rss', 'feed_search', { link: FEED_EXAMPLES[2], keyword: 'web', number: 5 }, 60],
      ['weather', 'city_temperature', { city: 'Cotonou', units: 'imperial' }, 30]
    ] },
    vide: { label: 'Nouveau compte', note: 'Ce que voit un nouvel utilisateur : seulement l’horloge.', widgets: [] }
  };
  // Version courte pour les petits écrans.
  var PROFILE_LIGHT = { equipe: [0, 2, 4, 3, 5] };

  function profileState(name, now, light) {
    var p = PROFILES[name] || PROFILES.equipe, list = p.widgets;
    if (light && PROFILE_LIGHT[name]) list = PROFILE_LIGHT[name].map(function (i) { return p.widgets[i]; });
    return { nextId: list.length + 1, widgets: list.map(function (w, i) {
      return { id: i + 1, service: w[0], widgetType: w[1], config: JSON.parse(JSON.stringify(w[2])),
        refreshRateSeconds: w[3], position: i, createdAt: iso(now), updatedAt: iso(now) };
    }) };
  }

  return {
    SERVICES: SERVICES, aboutServices: aboutServices, getWidget: getWidget, getService: getService,
    accentFor: accentFor, buildCatalog: buildCatalog, PRESENTATION: PRESENTATION,
    REFRESH_MIN_SECONDS: REFRESH_MIN_SECONDS, REFRESH_MAX_SECONDS: REFRESH_MAX_SECONDS,
    sanitizeDigits: sanitizeDigits, sanitizeInput: sanitizeInput, validateField: validateField,
    validateRefreshRate: validateRefreshRate, validateConfig: validateConfig,
    capitalizeFirst: capitalizeFirst, formatLocalDate: formatLocalDate, formatDateTime: formatDateTime,
    formatRelative: formatRelative, hostnameOf: hostnameOf, shortLabel: shortLabel, formatRate: formatRate,
    formatCount: formatCount, sparklinePoints: sparklinePoints, weatherIconName: weatherIconName, cardTitle: cardTitle,
    swap: swap, positionUpdates: positionUpdates, closestCenter: closestCenter,
    validateParams: validateParams, normalize: normalize, keyOf: keyOf,
    fetchWidgetData: fetchWidgetData, createServer: createServer, currencyList: currencyList,
    PROFILES: PROFILES, profileState: profileState,
    EXAMPLES: { city: CITY_EXAMPLES, repository: REPO_EXAMPLES, link: FEED_EXAMPLES,
      currency: ['EUR', 'USD', 'GBP', 'CHF', 'JPY', 'CAD'], keyword: { hackernews: ['AI', 'Show HN', 'dashboard'], rss: ['produit', 'web', 'tableau'] } }
  };
});
