/* Alphabrique — cœur de la démo (fonctions pures, aucune ne touche à la page).
   Marche dans le navigateur (window.AlphaCore) et sous node (require).

   IMPORTANT — honnêteté : il n'existe aucune trace du vrai code de ce stage sur
   cette machine (le site appartient au client, Bénin Codeur). Rien ici n'est une
   copie ou une reconstruction fidèle de ce code : c'est une PETITE BOUTIQUE FICTIVE
   (catalogue, panier, numéros de téléphone, montants) qui rejoue le mécanisme
   général d'un paiement Mobile Money branché sur une commande WooCommerce :
   commande créée → demande de paiement envoyée à l'opérateur → notification sur
   le téléphone du client → retour (webhook) → commande marquée payée ou non.
   Les durées sont raccourcies pour la démo ; les montants et produits sont inventés. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.AlphaCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ───────────── catalogue (fictif) ───────────── */

  var CATALOG = [
    { id: 'brique-creuse-10', nom: 'Brique creuse 10', cat: 'Briques', prix: 350 },
    { id: 'brique-creuse-15', nom: 'Brique creuse 15', cat: 'Briques', prix: 450 },
    { id: 'parpaing-plein-20', nom: 'Parpaing plein 20', cat: 'Briques', prix: 600 },
    { id: 'pave-gris-6', nom: 'Pavé autobloquant gris 6 cm', cat: 'Pavés', prix: 400 },
    { id: 'pave-rouge-6', nom: 'Pavé autobloquant rouge 6 cm', cat: 'Pavés', prix: 450 },
    { id: 'bordure-beton', nom: 'Bordure de trottoir béton (1 m)', cat: 'Pavés', prix: 1500 },
    { id: 'hourdis-12', nom: 'Hourdis 12 (dalle de plancher)', cat: 'Briques', prix: 900 }
  ];

  function findProduct(id, catalog) {
    catalog = catalog || CATALOG;
    for (var i = 0; i < catalog.length; i++) if (catalog[i].id === id) return catalog[i];
    return null;
  }

  /* ───────────── argent ───────────── */

  // "12 500 FCFA" — FCFA n'a pas de sous-unité courante, donc pas de décimales.
  function formatFCFA(n) {
    n = Math.round(n || 0);
    return n.toLocaleString('fr-FR') + ' FCFA';
  }

  /* ───────────── panier (fonctions pures : elles renvoient un NOUVEAU panier) ───────────── */

  function cartAdd(cart, id, qty) {
    qty = qty || 1;
    var out = [], found = false, i;
    for (i = 0; i < cart.length; i++) {
      if (cart[i].id === id) { out.push({ id: id, qty: cart[i].qty + qty }); found = true; }
      else out.push({ id: cart[i].id, qty: cart[i].qty });
    }
    if (!found) out.push({ id: id, qty: qty });
    return out;
  }

  function cartSetQty(cart, id, qty) {
    var out = [], i;
    for (i = 0; i < cart.length; i++) {
      if (cart[i].id === id) { if (qty > 0) out.push({ id: id, qty: qty }); }
      else out.push({ id: cart[i].id, qty: cart[i].qty });
    }
    return out;
  }

  function cartRemove(cart, id) {
    return cartSetQty(cart, id, 0);
  }

  function cartLines(cart, catalog) {
    catalog = catalog || CATALOG;
    var lines = [], i, p;
    for (i = 0; i < cart.length; i++) {
      p = findProduct(cart[i].id, catalog);
      if (!p) continue;
      lines.push({ id: p.id, nom: p.nom, prix: p.prix, qty: cart[i].qty, sousTotal: p.prix * cart[i].qty });
    }
    return lines;
  }

  function cartCount(cart) {
    var n = 0, i;
    for (i = 0; i < cart.length; i++) n += cart[i].qty;
    return n;
  }

  function cartTotal(cart, catalog) {
    var lines = cartLines(cart, catalog), total = 0, i;
    for (i = 0; i < lines.length; i++) total += lines[i].sousTotal;
    return total;
  }

  /* ───────────── numéro de téléphone béninois (détection simplifiée, pédagogique) ─────────────
     Depuis le 30 nov. 2024, un numéro béninois a 10 chiffres : "01" + 8 chiffres.
     Les deux chiffres juste après "01" viennent de l'ancien plan à 8 chiffres et ne
     garantissent plus rien officiellement : cette table sert à illustrer comment une
     intégration Mobile Money devine l'opérateur, pas à donner une liste exacte et à jour. */

  var PREFIXES = { MTN: ['61', '62', '66', '67'], MOOV: ['60', '63', '64', '65', '68'] };

  function normalizePhone(raw) {
    var d = String(raw || '').replace(/[^\d]/g, '');
    if (d.indexOf('00229') === 0) d = d.slice(5);
    else if (d.indexOf('229') === 0 && d.length > 10) d = d.slice(3);
    return d;
  }

  function formatPhone(digits) {
    if (digits.length !== 10) return digits;
    return digits.slice(0, 2) + ' ' + digits.slice(2, 4) + ' ' + digits.slice(4, 6) + ' ' +
      digits.slice(6, 8) + ' ' + digits.slice(8, 10);
  }

  function detectOperator(digits) {
    var two = digits.slice(2, 4), op;
    for (op in PREFIXES) if (PREFIXES[op].indexOf(two) !== -1) return op;
    return null;
  }

  // { ok, error, digits, formatted, operator, supported }
  function validatePhone(raw) {
    var d = normalizePhone(raw);
    if (d.length === 8) d = '01' + d;              // saisie à l'ancien format, on complète
    if (d.length !== 10 || d.slice(0, 2) !== '01') {
      return { ok: false, error: "Un numéro béninois a 10 chiffres et commence par 01 (ex. 01 61 00 11 22).", digits: d, operator: null, supported: false };
    }
    var operator = detectOperator(d);
    return {
      ok: true, error: null, digits: d, formatted: formatPhone(d),
      operator: operator, supported: operator !== null
    };
  }

  /* ───────────── commande ───────────── */

  function makeOrder(id, cart, catalog, phoneInfo, createdAt) {
    return {
      id: id, lignes: cartLines(cart, catalog), total: cartTotal(cart, catalog),
      telephone: phoneInfo.formatted, operateur: phoneInfo.operator, creeLe: createdAt || null
    };
  }

  /* ───────────── simulation du paiement Mobile Money ─────────────
     Rejoue, en accéléré, l'échange "request to pay" que fait une vraie intégration :
     boutique → API de l'opérateur → téléphone du client → webhook → boutique.
     Fonction pure : renvoie la liste des étapes avec leur délai (ms), sans minuteur,
     donc testable sous node. C'est demo.js qui rejoue ces délais à l'écran. */

  var SCENARIOS = {
    succes: { label: 'Paiement confirmé' },
    refus: { label: 'Refusé par le client' },
    attente: { label: 'Délai dépassé' }
  };

  function buildPaymentSteps(order, scenario) {
    if (!SCENARIOS[scenario]) throw new Error('scénario inconnu : ' + scenario);
    var op = order.operateur || 'Mobile Money';
    var steps = [
      { delai: 0, acteur: 'boutique', texte: 'Commande #' + order.id + ' créée dans WooCommerce (' + formatFCFA(order.total) + ')' },
      { delai: 700, acteur: 'boutique', texte: 'Appel à l’API ' + op + ' Mobile Money : demande de paiement ("request to pay")' },
      { delai: 1500, acteur: 'operateur', texte: 'Session envoyée au téléphone ' + order.telephone }
    ];
    if (scenario === 'succes') {
      steps.push({ delai: 2600, acteur: 'client', texte: 'Le client valide avec son code secret Mobile Money' });
      steps.push({ delai: 3300, acteur: 'operateur', texte: 'Webhook reçu par la boutique : paiement accepté' });
      steps.push({ delai: 3700, acteur: 'boutique', texte: 'Commande marquée « Payée », e-mail de confirmation envoyé', statut: 'payee' });
    } else if (scenario === 'refus') {
      steps.push({ delai: 2600, acteur: 'client', texte: 'Le client annule la session sur son téléphone' });
      steps.push({ delai: 3100, acteur: 'operateur', texte: 'Webhook reçu par la boutique : paiement refusé' });
      steps.push({ delai: 3400, acteur: 'boutique', texte: 'Commande marquée « Paiement échoué », rien n’est débité', statut: 'echec' });
    } else {
      steps.push({ delai: 2600, acteur: 'client', texte: 'Aucune réponse sur le téléphone' });
      steps.push({ delai: 3600, acteur: 'operateur', texte: 'Délai dépassé (le vrai délai est d’environ 60 s ; raccourci ici pour la démo)' });
      steps.push({ delai: 4000, acteur: 'boutique', texte: 'Commande marquée « En attente », le client peut réessayer', statut: 'attente' });
    }
    return steps;
  }

  // le contenu de l'écran du téléphone pendant la session (purement illustratif).
  function ussdScreen(order) {
    return [
      'ALPHABRIQUE SHOP',
      'Montant : ' + formatFCFA(order.total),
      'Commande #' + order.id,
      '1. Valider avec le code secret',
      '2. Annuler'
    ];
  }

  return {
    CATALOG: CATALOG, SCENARIOS: SCENARIOS, findProduct: findProduct,
    formatFCFA: formatFCFA,
    cartAdd: cartAdd, cartSetQty: cartSetQty, cartRemove: cartRemove,
    cartLines: cartLines, cartCount: cartCount, cartTotal: cartTotal,
    normalizePhone: normalizePhone, formatPhone: formatPhone, detectOperator: detectOperator, validatePhone: validatePhone,
    makeOrder: makeOrder, buildPaymentSteps: buildPaymentSteps, ussdScreen: ussdScreen
  };
});
