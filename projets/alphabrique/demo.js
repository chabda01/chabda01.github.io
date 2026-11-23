/* Alphabrique — la page. Le calcul (panier, téléphone, étapes du paiement) est dans core.js.
   Rappel : boutique et données entièrement fictives, voir le bandeau en haut de la page. */
(function () {
  'use strict';
  var C = window.AlphaCore;
  var $ = function (id) { return document.getElementById(id); };

  var st = {
    cart: [],              // [{id, qty}]
    scenario: 'succes',
    runs: 0,
    seq: 1041,              // numéro de commande, incrémenté à chaque paiement testé
    token: 0,               // "le dernier gagne" : annule les étapes d'un paiement précédent
    timers: [],
    busy: false
  };

  function el(tag, attrs, html) {
    var n = document.createElement(tag);
    if (attrs) for (var k in attrs) n.setAttribute(k, attrs[k]);
    if (html !== undefined) n.innerHTML = html;
    return n;
  }
  function qtyOf(id) {
    for (var i = 0; i < st.cart.length; i++) if (st.cart[i].id === id) return st.cart[i].qty;
    return 0;
  }

  /* ───────────── catalogue ───────────── */

  function renderCatalog() {
    var grid = $('ab-catalog');
    grid.innerHTML = '';
    C.CATALOG.forEach(function (p) {
      var q = qtyOf(p.id);
      var card = el('div', { class: 'ab-card' });
      card.appendChild(el('span', { class: 'ab-card__cat' }, p.cat));
      card.appendChild(el('span', { class: 'ab-card__nom' }, p.nom));
      card.appendChild(el('span', { class: 'ab-card__prix' }, C.formatFCFA(p.prix)));
      var row = el('div', { class: 'ab-qty' });
      var minus = el('button', { type: 'button', 'aria-label': 'Retirer un ' + p.nom }, '–');
      var count = el('span', {}, String(q));
      var plus = el('button', { type: 'button', 'aria-label': 'Ajouter un ' + p.nom }, '+');
      minus.disabled = q === 0;
      minus.addEventListener('click', function () { st.cart = C.cartSetQty(st.cart, p.id, qtyOf(p.id) - 1); renderAll(); });
      plus.addEventListener('click', function () { st.cart = C.cartAdd(st.cart, p.id, 1); renderAll(); });
      row.appendChild(minus); row.appendChild(count); row.appendChild(plus);
      card.appendChild(row);
      grid.appendChild(card);
    });
  }

  /* ───────────── panier ───────────── */

  function renderCart() {
    var box = $('ab-cart');
    var lines = C.cartLines(st.cart, C.CATALOG);
    box.innerHTML = '';
    if (lines.length === 0) {
      box.appendChild(el('p', { class: 'ab-empty' }, 'Le panier est vide pour l’instant.'));
      return;
    }
    lines.forEach(function (l) {
      var row = el('div', { class: 'ab-cart__row' });
      var nom = el('span', { class: 'ab-cart__nom' });
      nom.textContent = l.nom + ' × ' + l.qty;
      var sous = el('b', {}, null); sous.textContent = C.formatFCFA(l.sousTotal);
      var rm = el('button', { type: 'button' }, 'retirer');
      rm.addEventListener('click', function () { st.cart = C.cartRemove(st.cart, l.id); renderAll(); });
      row.appendChild(nom); row.appendChild(sous); row.appendChild(rm);
      box.appendChild(row);
    });
    var total = el('div', { class: 'ab-total' });
    total.appendChild(el('span', {}, 'Total'));
    var b = el('b', {}, null); b.textContent = C.formatFCFA(C.cartTotal(st.cart, C.CATALOG));
    total.appendChild(b);
    box.appendChild(total);
  }

  /* ───────────── téléphone / opérateur ───────────── */

  function phoneInfo() { return C.validatePhone($('ab-phone').value); }

  function renderOpChip() {
    var chip = $('ab-opchip'), raw = $('ab-phone').value.trim();
    chip.className = 'ab-opchip';
    if (!raw) { chip.classList.add('ab-opchip--vide'); chip.textContent = 'Entrez un numéro pour détecter l’opérateur'; return; }
    var r = phoneInfo();
    if (!r.ok) { chip.classList.add('ab-opchip--non'); chip.innerHTML = '<b>Numéro invalide</b> — ' + r.error; return; }
    if (!r.supported) { chip.classList.add('ab-opchip--non'); chip.innerHTML = '<b>Opérateur non pris en charge</b> ici (seuls MTN et Moov sont branchés)'; return; }
    if (r.operator === 'MTN') { chip.classList.add('ab-opchip--mtn'); chip.innerHTML = 'Opérateur détecté — <b>MTN Mobile Money</b>'; return; }
    chip.classList.add('ab-opchip--moov'); chip.innerHTML = 'Opérateur détecté — <b>Moov Money</b>';
  }

  function canPay() {
    if (st.busy || st.cart.length === 0) return false;
    var r = phoneInfo();
    return r.ok && r.supported;
  }

  function renderStatusAndStats() {
    var n = C.cartCount(st.cart), total = C.cartTotal(st.cart, C.CATALOG);
    $('ab-status').textContent = n === 0 ? 'Panier vide' : n + ' article(s) · ' + C.formatFCFA(total);
    $('ab-stat-count').textContent = String(n);
    $('ab-stat-total').textContent = C.formatFCFA(total);
    $('ab-stat-runs').textContent = String(st.runs);
    $('ab-pay-btn').disabled = !canPay();
  }

  function renderAll() {
    renderCatalog();
    renderCart();
    renderOpChip();
    renderStatusAndStats();
  }

  /* ───────────── scénario ───────────── */

  function wireScenarios() {
    var wrap = $('ab-scenarios');
    wrap.addEventListener('click', function (ev) {
      var btn = ev.target.closest ? ev.target.closest('.chip') : null;
      if (!btn || !wrap.contains(btn)) return;
      st.scenario = btn.getAttribute('data-sc');
      var chips = wrap.querySelectorAll('.chip');
      for (var i = 0; i < chips.length; i++) chips[i].setAttribute('aria-pressed', String(chips[i] === btn));
    });
  }

  /* ───────────── journal + téléphone simulé ───────────── */

  function logLine(text, cls) {
    var log = $('ab-log');
    var line = document.createElement('div');
    if (cls) line.className = cls;
    line.textContent = text;
    log.appendChild(line);
    log.scrollTop = log.scrollHeight;
  }

  function setPhoneScreen(lines, ledClass) {
    var screen = $('ab-screen');
    screen.textContent = '';
    (lines || []).forEach(function (t, i) {
      if (i > 0) screen.appendChild(document.createElement('br'));
      screen.appendChild(document.createTextNode(t));
    });
    var led = $('ab-led');
    led.className = 'ab-phone__led' + (ledClass ? ' ' + ledClass : '');
  }

  function classForStep(step) {
    if (step.statut === 'payee') return 't-ok';
    if (step.statut === 'echec') return 't-err';
    if (step.statut === 'attente') return 't-dim';
    if (step.acteur === 'boutique') return 't-in';
    if (step.acteur === 'client') return 't-ok';
    return 't-dim';
  }

  function clearTimers() {
    st.timers.forEach(function (t) { clearTimeout(t); });
    st.timers = [];
  }

  function startPayment() {
    if (!canPay()) return;
    var r = phoneInfo();
    var order = C.makeOrder(st.seq, st.cart, C.CATALOG, r, Date.now());
    var steps = C.buildPaymentSteps(order, st.scenario);

    clearTimers();
    st.token++;
    var myToken = st.token;
    st.busy = true;
    st.runs++;
    st.seq++;

    $('ab-flow').hidden = false;
    $('ab-log').innerHTML = '';
    setPhoneScreen(['Écran éteint'], null);
    renderStatusAndStats();
    $('ab-pay-btn').disabled = true;

    steps.forEach(function (step) {
      var timer = setTimeout(function () {
        if (myToken !== st.token) return; // un autre paiement a été lancé depuis : on abandonne celui-ci
        logLine(step.texte, classForStep(step));
        if (step.acteur === 'operateur' && !step.statut) setPhoneScreen(C.ussdScreen(order), 'is-wait');
        if (step.statut === 'payee') setPhoneScreen(['Paiement accepté ✓', C.formatFCFA(order.total)], 'is-ok');
        if (step.statut === 'echec') setPhoneScreen(['Paiement annulé'], 'is-bad');
        if (step.statut === 'attente') setPhoneScreen(['Pas de réponse', '(délai dépassé)'], null);
        if (step.statut) {
          st.busy = false;
          renderStatusAndStats();
        }
      }, step.delai);
      st.timers.push(timer);
    });
  }

  /* ───────────── réglages rapides ───────────── */

  function fillSample() {
    st.cart = C.cartAdd(C.cartAdd(C.cartAdd([], 'pave-gris-6', 2), 'brique-creuse-10', 3), 'bordure-beton', 1);
    renderAll();
  }
  function clearCart() {
    st.cart = [];
    renderAll();
  }

  /* ───────────── câblage ───────────── */

  function init() {
    renderAll();
    wireScenarios();
    $('ab-fill').addEventListener('click', fillSample);
    $('ab-clear').addEventListener('click', clearCart);
    $('ab-phone').addEventListener('input', function () { renderOpChip(); renderStatusAndStats(); });
    $('ab-payform').addEventListener('submit', function (ev) { ev.preventDefault(); startPayment(); });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
