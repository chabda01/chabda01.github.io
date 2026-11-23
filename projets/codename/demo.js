/* Codename — interface de la démo.
   L'analyse (recherche de mots-clés) est dans core.js : ce fichier ne fait
   que lire le DOM, appeler core.js, et réécrire le DOM. */
(function () {
'use strict';

var CN = window.CN;
var $ = function (id) { return document.getElementById(id); };

/* ───────── onglets ───────── */
var tabs = document.querySelectorAll('.tabs [role="tab"]');
var panes = { lab: $('p-lab'), quiz: $('p-quiz') };
tabs.forEach(function (btn) {
  btn.addEventListener('click', function () {
    tabs.forEach(function (b) { b.setAttribute('aria-selected', String(b === btn)); });
    Object.keys(panes).forEach(function (k) { panes[k].hidden = (k !== btn.dataset.tab); });
  });
});

/* ───────── laboratoire : choix de la défense ───────── */
var defChips = $('defChips');
var defCustomBtn = $('defCustomBtn');
var defTerm = $('defTerm');
var defMeta = $('defMeta');
var defOwnWrap = $('defOwnWrap');
var defOwnInput = $('defOwnInput');

var state = { defId: '05', custom: false, catId: null };

function currentDefText() {
  if (state.custom) return defOwnInput.value || '';
  var d = CN.trouverDefense(state.defId);
  return d ? d.texte : '';
}

function renderDefense() {
  var buttons = defChips.querySelectorAll('.chip');
  buttons.forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.def === state.defId && !state.custom)); });
  defCustomBtn.setAttribute('aria-pressed', String(state.custom));

  if (state.custom) {
    defTerm.hidden = true;
    defOwnWrap.hidden = false;
    defMeta.textContent = 'Votre texte : l’analyse se met à jour au fil de la frappe.';
  } else {
    var d = CN.trouverDefense(state.defId);
    defOwnWrap.hidden = true;
    defTerm.hidden = false;
    defTerm.textContent = d.texte;
    defMeta.innerHTML = '<b>' + d.resume + '</b> — écrite par ' + d.auteur + '. Source : ' + d.source;
  }
}

defChips.addEventListener('click', function (ev) {
  var btn = ev.target.closest('.chip');
  if (!btn || !btn.dataset.def) return;
  state.defId = btn.dataset.def;
  state.custom = false;
  renderDefense();
  recompute();
});

defCustomBtn.addEventListener('click', function () {
  state.custom = !state.custom;
  renderDefense();
  recompute();
});

var ownTimer = null;
defOwnInput.addEventListener('input', function () {
  clearTimeout(ownTimer);
  ownTimer = setTimeout(recompute, 150);
});

/* ───────── laboratoire : choix de la catégorie d'attaque ───────── */
var catChips = $('catChips');
var catCard = $('catCard');
var catTitle = $('catTitle'), catWhy = $('catWhy'), catTerm = $('catTerm'), catSrc = $('catSrc'), catVerdict = $('catVerdict');

CN.CATEGORIES.forEach(function (cat) {
  var b = document.createElement('button');
  b.className = 'chip';
  b.type = 'button';
  b.dataset.cat = cat.id;
  b.setAttribute('aria-pressed', 'false');
  b.textContent = cat.label;
  catChips.appendChild(b);
});

function renderCategory() {
  var buttons = catChips.querySelectorAll('.chip');
  buttons.forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.cat === state.catId)); });

  if (!state.catId) { catCard.hidden = true; return; }
  var cat = CN.trouverCategorie(state.catId);
  catCard.hidden = false;
  catTitle.textContent = cat.label;
  catWhy.textContent = cat.pourquoi;
  catTerm.textContent = cat.exemple;
  catSrc.textContent = 'Exemple réel : ' + cat.source;
  renderVerdict(cat);
}

function renderVerdict(cat) {
  var r = CN.analyserCategorie(currentDefText(), cat);
  catVerdict.classList.remove('is-ok', 'is-bad');
  if (r.couvert) {
    catVerdict.classList.add('is-ok');
    catVerdict.textContent = 'Couverte explicitement : la défense choisie contient « ' + r.extrait + ' ». Ça ne garantit rien face à un vrai modèle, mais la catégorie est nommée.';
  } else {
    catVerdict.classList.add('is-bad');
    catVerdict.textContent = 'Angle mort possible : aucun mot-clé de cette catégorie ne figure dans le texte de la défense choisie.';
  }
}

catChips.addEventListener('click', function (ev) {
  var btn = ev.target.closest('.chip');
  if (!btn || !btn.dataset.cat) return;
  state.catId = btn.dataset.cat;
  renderCategory();
});

/* ───────── laboratoire : tableau de couverture (panneau latéral) ───────── */
var covSummary = $('covSummary');
var covTable = $('covTable').querySelector('tbody');

function renderCoverage() {
  var r = CN.analyserTexte(currentDefText());
  covSummary.innerHTML = '<b>' + r.count + ' / ' + r.total + '</b> catégories explicitement couvertes';
  covTable.innerHTML = '';
  r.details.forEach(function (d) {
    var tr = document.createElement('tr');
    if (d.couvert) tr.className = 'is-on';
    var td1 = document.createElement('td'); td1.textContent = d.label;
    var td2 = document.createElement('td'); td2.textContent = d.couvert ? 'couverte' : 'angle mort';
    tr.appendChild(td1); tr.appendChild(td2);
    covTable.appendChild(tr);
  });
}

function recompute() {
  renderCoverage();
  if (state.catId) renderVerdict(CN.trouverCategorie(state.catId));
}

/* ───────── quiz ───────── */
var quizProgress = $('quizProgress'), quizQ = $('quizQ'), quizOpts = $('quizOpts');
var quizFeedback = $('quizFeedback'), quizNext = $('quizNext');
var quizBody = $('quizBody'), quizDone = $('quizDone'), quizScoreEl = $('quizScore'), quizMsg = $('quizMsg');
var quizRestart = $('quizRestart');

var quiz = { index: 0, score: 0, answered: false };

function renderQuestion() {
  var q = CN.QUIZ[quiz.index];
  quiz.answered = false;
  quizBody.hidden = false;
  quizDone.hidden = true;
  quizProgress.textContent = 'Question ' + (quiz.index + 1) + ' / ' + CN.QUIZ.length;
  quizQ.textContent = q.q;
  quizFeedback.hidden = true;
  quizFeedback.classList.remove('is-ok', 'is-bad');
  quizNext.hidden = true;

  quizOpts.innerHTML = '';
  q.options.forEach(function (opt, i) {
    var b = document.createElement('button');
    b.className = 'quiz-opt';
    b.type = 'button';
    b.textContent = opt;
    b.addEventListener('click', function () { answerQuestion(i); });
    quizOpts.appendChild(b);
  });
}

function answerQuestion(i) {
  if (quiz.answered) return;
  quiz.answered = true;
  var res = CN.verifierReponse(quiz.index, i);
  var buttons = quizOpts.querySelectorAll('.quiz-opt');
  buttons.forEach(function (b, idx) {
    b.disabled = true;
    if (idx === res.bonneReponse) b.classList.add('is-correct');
    else if (idx === i) b.classList.add('is-wrong');
  });
  if (res.correct) quiz.score++;
  quizFeedback.hidden = false;
  quizFeedback.classList.add(res.correct ? 'is-ok' : 'is-bad');
  quizFeedback.textContent = (res.correct ? 'Exact. ' : 'Pas tout à fait. ') + res.explication;
  quizNext.hidden = false;
  quizNext.textContent = (quiz.index + 1 < CN.QUIZ.length) ? 'Question suivante' : 'Voir mon score';
}

quizNext.addEventListener('click', function () {
  quiz.index++;
  if (quiz.index >= CN.QUIZ.length) {
    quizBody.hidden = true;
    quizDone.hidden = false;
    quizScoreEl.textContent = quiz.score;
    quizMsg.textContent = quiz.score >= 5
      ? 'Vous repérez les angles morts aussi bien que l’analyse de texte.'
      : (quiz.score >= 3
        ? 'Plutôt solide. Relisez les défenses dans le laboratoire pour les catégories manquées.'
        : 'Faites un tour par le laboratoire ci-dessus : chaque défense y est commentée en détail.');
  } else {
    renderQuestion();
  }
});

quizRestart.addEventListener('click', function () {
  quiz.index = 0;
  quiz.score = 0;
  renderQuestion();
});

/* ───────── démarrage ───────── */
renderDefense();
state.catId = CN.CATEGORIES[0].id;
renderCategory();
renderCoverage();
renderQuestion();

})();
