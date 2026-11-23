/* ═══════════════════════════════════════════════════════════
   La bibliothèque — salle 3D construite à partir de la liste
   des projets déjà présente dans la page (.entry).
   CSS 3D pur : pas de WebGL, pas de bibliothèque.
   ═══════════════════════════════════════════════════════════ */
(function(){

var racine = document.getElementById('salle');
var section = document.getElementById('work');
var liste = section && section.querySelector('.liste');
if(!racine || !liste) return;
if(!(window.CSS && CSS.supports && CSS.supports('transform-style','preserve-3d'))) return;

var monde = racine.querySelector('.salle__monde');
var vue = racine.querySelector('.salle__vue');
var nav = racine.querySelector('.salle__rayons');
var fiche = racine.querySelector('.salle__fiche');
var T = racine.dataset;
var calme = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// ── dimensions de la salle (px) : x vers la droite, y vers le bas, z vers le visiteur
var LARG = 900, SOL = 175, PLAFOND = -245, HAUT = SOL - PLAFOND;
var Z_ENTREE = 350, RAYON_L = 620, ECART = 120, AVANT = 560, APRES = 160;
var LONG = AVANT + RAYON_L*2 + ECART + APRES, Z_FOND = Z_ENTREE - LONG;

function el(tag, cls, parent){
  var e = document.createElement(tag);
  if(cls) e.className = cls;
  if(parent) parent.appendChild(e);
  return e;
}
// ech = 2 : la surface est dessinée deux fois plus petite puis agrandie.
// Un grand aplat de bois n'a pas besoin de détail, et son image pèse quatre fois moins en mémoire.
function plan(cls, w, h, x, y, z, rot, ech){
  ech = ech || 1;
  var e = el('div', 'plan ' + cls, monde);
  e.style.width = w/ech + 'px'; e.style.height = h/ech + 'px';
  e.style.transform = 'translate3d(' + x + 'px,' + y + 'px,' + z + 'px) ' + (rot || '') + (ech > 1 ? ' scale(' + ech + ')' : '') + ' translate(-50%,-50%)';
  return e;
}
// hasard reproductible : le décor est le même à chaque visite
var graine = 7;
function hasard(){ graine = (graine*16807) % 2147483647; return graine/2147483647; }

// ── 1. lire les projets dans la page
function texte(n){ return n ? n.textContent.replace(/\s+/g,' ').trim() : ''; }
function slug(s){
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
}
var rayons = [], courant = null;
Array.prototype.forEach.call(liste.children, function(n){
  if(n.classList.contains('group-label')){
    courant = {nom:texte(n), court:n.dataset.court || texte(n), livres:[]};
    rayons.push(courant);
  } else if(n.classList.contains('entry') && courant){
    var h3 = n.querySelector('h3').cloneNode(true);
    var quand = h3.querySelector('.when');
    if(quand) h3.removeChild(quand);
    var code = n.querySelector('.entry__code');
    var demo = n.querySelector('.entry__demo');
    var desc = n.querySelector('.entry__body > p:not(.tech):not(.note)');
    if(!n.id) n.id = 'projet-' + slug(texte(h3));
    courant.livres.push({
      titre:texte(h3), quand:texte(quand),
      code:code ? code.innerHTML.split(/<br\s*\/?>/i).map(function(s){ return s.replace(/<[^>]+>/g,'').trim(); }).join(' · ') : '',
      desc:texte(desc), tech:texte(n.querySelector('.tech')),
      demo:demo ? demo.getAttribute('href') : '', ancre:n
    });
  }
});
if(!rayons.length) return;
var phare = document.querySelector('#flagship .panel');
if(phare){
  rayons[0].livres.unshift({
    titre:texte(phare.querySelector('h2')), quand:'', code:phare.dataset.code || '',
    desc:texte(phare.querySelector('.panel__head p')), tech:phare.dataset.tech || '',
    demo:'', ancre:document.getElementById('flagship'), phare:true
  });
}

// ── 2. bâtir la salle
plan('sol', LARG, LONG, 0, SOL + 2, (Z_ENTREE+Z_FOND)/2, 'rotateX(90deg)', 2).appendChild(el('div','sol__tapis'));
var plafond = plan('plafond', LARG, LONG, 0, PLAFOND - 2, (Z_ENTREE+Z_FOND)/2, 'rotateX(-90deg)', 2);
var murG = plan('mur mur--g', LONG, HAUT, -LARG/2, (SOL+PLAFOND)/2, (Z_ENTREE+Z_FOND)/2, 'rotateY(90deg)');
var murD = plan('mur mur--d', LONG, HAUT, LARG/2, (SOL+PLAFOND)/2, (Z_ENTREE+Z_FOND)/2, 'rotateY(-90deg)');
var murF = plan('mur mur--fond', LARG, HAUT, 0, (SOL+PLAFOND)/2, Z_FOND - 2, '');
plan('mur mur--entree', LARG, HAUT, 0, (SOL+PLAFOND)/2, Z_ENTREE + 2, 'rotateY(180deg)', 2);
[murG, murD, murF].forEach(function(m){ el('div', 'mur__fond', m); });
murG.style.paddingLeft = AVANT + 'px'; murG.style.gap = ECART + 'px';
murD.style.flexDirection = 'row-reverse'; murD.style.paddingRight = AVANT + 'px'; murD.style.gap = ECART + 'px';
el('div', 'oculus', murF);

var TEINTES = ['#6E3B22','#2B4A55','#5A4A2A','#3E3A6B','#33523B','#6B2D3E','#84683A','#2A2620','#4C5560','#7A4A2A'];
function paquet(parent, largeur){
  var p = el('div', 'paquet', parent);
  var h = 92 + Math.round(hasard()*36);
  p.style.width = largeur + 'px'; p.style.height = h + 'px';
  var face = el('div', 'paquet__face', p);
  // tous les dos d'un paquet tiennent dans un seul dégradé : un élément au lieu de six
  var n = Math.max(2, Math.round(largeur/(11 + hasard()*6)));
  var poids = [], total = 0, bandes = [], x = 0, i;
  for(i=0;i<n;i++){ poids.push(0.7 + hasard()*0.9); total += poids[i]; }
  for(i=0;i<n;i++){
    var c = TEINTES[Math.floor(hasard()*TEINTES.length)];
    var x2 = x + poids[i]/total*100;
    bandes.push('rgba(0,0,0,.45) ' + x.toFixed(2) + '% ' + (x + 1.2).toFixed(2) + '%', c + ' ' + (x + 1.2).toFixed(2) + '% ' + x2.toFixed(2) + '%');
    x = x2;
  }
  face.style.backgroundImage =
    'linear-gradient(180deg,transparent 0 12%,rgba(233,168,85,.5) 12% 13.5%,transparent 13.5% 82%,rgba(233,168,85,.35) 82% 83%,transparent 83%),' +
    'linear-gradient(90deg,' + bandes.join(',') + ')';
  el('div', 'paquet__haut', p);
  el('div', 'paquet__cote paquet__cote--g', p);
  el('div', 'paquet__cote paquet__cote--d', p);
}
function cale(parent, largeur){
  var c = el('div', 'cale', parent);
  var reste = largeur - 6;
  while(reste > 34){
    var w = Math.min(reste, 38 + Math.round(hasard()*30));
    if(reste - w < 34) w = reste;
    if(hasard() > 0.14) paquet(c, w);
    reste -= w + 3;
  }
}
function fabriquerLivre(parent, livre, iRayon){
  var a = el(livre.demo ? 'a' : 'button', 'livre r' + (iRayon % 5) + (livre.phare ? ' livre--phare' : ''), parent);
  if(livre.demo) a.href = livre.demo; else a.type = 'button';
  a.setAttribute('aria-label', livre.titre + ' — ' + (livre.demo ? T.tDemo : (livre.phare ? T.tPhare : T.tFiche)));
  el('span', 'livre__dos', a); el('span', 'livre__pages', a); el('span', 'livre__dessus', a);
  var couv = el('span', 'livre__couv', a);
  var titre = el('span', 'livre__titre', couv);
  titre.textContent = livre.titre;
  var long = Math.max.apply(null, livre.titre.split(/\s+/).map(function(m){ return m.length; }));
  if(long > 11) titre.style.fontSize = '27px';
  el('span', 'livre__code', couv).textContent = livre.code;
  if(livre.demo) el('span', 'livre__signet', couv);
  livre.el = a;
  return a;
}
function fabriquerRayon(mur, rayon, i, largeur){
  var r = el('div', 'rayon', mur);
  r.style.width = largeur + 'px'; r.style.height = HAUT + 'px';
  el('div', 'rayon__plaque', r).textContent = rayon.nom;
  var m = el('div', 'meuble', r);
  el('div', 'meuble__fond', m);
  el('div', 'meuble__cote meuble__cote--g', m); el('div', 'meuble__cote meuble__cote--d', m);
  el('div', 'meuble__bord meuble__bord--g', m); el('div', 'meuble__bord meuble__bord--d', m);
  el('div', 'meuble__toit', m);
  var n = rayon.livres.length;
  // le mur du fond n'a qu'une tablette : la fenêtre ronde prend le haut
  var rangs = (n <= 2 || (rayon.mur === 'f' && n <= 3)) ? [n] : [Math.ceil(n/2), Math.floor(n/2)];
  var k = 0, utile = largeur - 32;
  rangs.forEach(function(nb){
    var t = el('div', 'tablette', m);
    el('div', 'tablette__planche', t); el('div', 'tablette__chant', t);
    var vide = (utile - nb*96 - nb*2*10) / (nb + 1);
    cale(t, vide);
    for(var j=0;j<nb;j++){ fabriquerLivre(t, rayon.livres[k++], i); cale(t, vide); }
  });
  el('div', 'meuble__plinthe', m);
  rayon.el = r;
}
// trois murs : deux rayons à gauche, un au fond, le reste à droite
rayons.forEach(function(rayon, i){
  rayon.mur = i < 2 ? 'g' : (i === 2 ? 'f' : 'd');
  fabriquerRayon(rayon.mur === 'g' ? murG : rayon.mur === 'f' ? murF : murD, rayon, i, rayon.mur === 'f' ? 460 : RAYON_L);
});
function decalage(n, jusque){ var x = 0; while(n && n !== jusque){ x += n.offsetLeft; n = n.offsetParent; } return x; }
function situer(){
  rayons.forEach(function(rayon){
    var c = decalage(rayon.el, rayon.el.parentNode) + rayon.el.offsetWidth/2;
    rayon.centre = c;
    rayon.pos = rayon.mur === 'g' ? Z_ENTREE - c : rayon.mur === 'd' ? Z_FOND + c : c - LARG/2;
    rayon.livres.forEach(function(l){
      var lc = decalage(l.el, rayon.el.parentNode) + l.el.offsetWidth/2;
      l.pos = rayon.mur === 'g' ? Z_ENTREE - lc : rayon.mur === 'd' ? Z_FOND + lc : lc - LARG/2;
    });
  });
}
rayons.forEach(function(rayon){
  if(rayon.mur === 'f') return;
  var l = el('div', 'lampe', plafond);
  l.dataset.rayon = '1'; rayon.lampe = l;
});

// ── 3. la caméra
var P = 760, D = 500, DF = 500, COTE = 0;   // COTE : pas de côté pour laisser la place à la fiche
var cam = {x:0, y:0, z:150, lacet:0, tangage:0};
var but = {x:0, y:0, z:150, lacet:0, tangage:0};
var regard = {x:0, y:0};           // léger suivi de la souris
var touches = {};
var enMarche = false, visible = true, iCourant = -1;

function mesurer(){
  var w = racine.clientWidth, h = racine.clientHeight;
  P = Math.max(300, Math.min(760, w*0.62));
  vue.style.perspective = P + 'px';
  var place = w > 900 ? 370 : 0;                      // largeur gardée pour la fiche
  D = 46 + Math.max(RAYON_L*P/((w - place)*0.95), 400*P/(h - 120));
  D = Math.max(330, Math.min(LARG - 110, D));
  COTE = place/2*D/P;
  DF = 46 + Math.max(460*P/((w - place)*0.95), 420*P/(h - 110));
  DF = Math.max(330, Math.min(900, DF));
}
function arret(i){
  if(i < 0) return {x:0, y:0, z:150, lacet:0, tangage:0};
  var r = rayons[i];
  if(r.mur === 'g') return {x:-LARG/2 + D, y:0, z:r.pos - COTE, lacet:-90, tangage:0};
  if(r.mur === 'd') return {x: LARG/2 - D, y:0, z:r.pos + COTE, lacet: 90, tangage:0};
  return {x:r.pos + COTE*DF/D, y:-18, z:Z_FOND + DF, lacet:0, tangage:0};
}
function poser(){
  monde.style.transform = 'translateZ(' + P + 'px) rotateX(' + (cam.tangage + regard.y).toFixed(3) + 'deg) rotateY(' +
    (cam.lacet + regard.x).toFixed(3) + 'deg) translate3d(' + (-cam.x).toFixed(2) + 'px,' + (-cam.y).toFixed(2) + 'px,' + (-cam.z).toFixed(2) + 'px)';
}
function borner(p){
  p.x = Math.max(-LARG/2 + 110, Math.min(LARG/2 - 110, p.x));
  p.z = Math.max(Z_FOND + 200, Math.min(Z_ENTREE - 90, p.z));
  p.tangage = Math.max(-22, Math.min(22, p.tangage));
}
var regardBut = {x:0, y:0};

// ── qualité adaptative : la salle mesure sa propre fluidité pendant qu'on bouge.
// Trop lent → elle retire du décor (niveau 1), puis presque tout le décor (niveau 2).
// Les livres, eux, restent toujours là.
var niveau = 0, dernier = 0, durees = [];
function alleger(n){
  niveau = Math.max(niveau, Math.min(2, n));
  racine.classList.toggle('is-leger', niveau >= 1);
  racine.classList.toggle('is-mini', niveau >= 2);
  if(niveau >= 1){ regardBut.x = regardBut.y = 0; }
  try { sessionStorage.setItem('salle-niveau', String(niveau)); } catch(e){}
}
(function(){
  var n = 0;
  try { n = parseInt(sessionStorage.getItem('salle-niveau'), 10) || 0; } catch(e){}
  // petit appareil annoncé par le navigateur : on part déjà allégé
  if((navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 4) ||
     (navigator.deviceMemory && navigator.deviceMemory <= 4) ||
     window.matchMedia('(pointer: coarse)').matches) n = Math.max(n, 1);
  if(n) alleger(n);
})();
function chronometrer(bouge){
  var t = performance.now();
  if(bouge && dernier){
    var d = t - dernier;
    if(d < 250) durees.push(d);                    // au-delà : l'onglet était en pause
    if(durees.length >= 45){
      durees.sort(function(a, b){ return a - b; });
      var mediane = durees[22];
      durees = [];
      if(mediane > 24 && niveau < 2) alleger(niveau + 1);   // sous ~40 images par seconde
    }
  }
  dernier = bouge ? t : 0;
}
function pas(){
  var bouge = false;
  var av = (touches.haut ? 1 : 0) - (touches.bas ? 1 : 0);
  var cote = (touches.droite ? 1 : 0) - (touches.gauche ? 1 : 0);
  var tourne = (touches.tDroite ? 1 : 0) - (touches.tGauche ? 1 : 0);
  if(av || cote || tourne){
    var a = but.lacet*Math.PI/180;
    but.x += (Math.sin(a)*av + Math.cos(a)*cote)*9;
    but.z += (-Math.cos(a)*av + Math.sin(a)*cote)*9;
    but.lacet += tourne*2.2;
    but.y = 0;
    borner(but); marquer(-2); bouge = true;
  }
  var k = calme ? 1 : 0.11;
  ['x','y','z','lacet','tangage'].forEach(function(c){
    var d = but[c] - cam[c];
    if(Math.abs(d) > 0.02){ cam[c] += d*k; bouge = true; } else cam[c] = but[c];
  });
  ['x','y'].forEach(function(c){
    var d = regardBut[c] - regard[c];
    if(Math.abs(d) > 0.01){ regard[c] += d*(calme ? 1 : 0.08); bouge = true; } else regard[c] = regardBut[c];
  });
  poser();
  chronometrer(bouge && visible);
  if(bouge && visible) requestAnimationFrame(pas); else enMarche = false;
}
function lancer(){ if(!enMarche){ enMarche = true; requestAnimationFrame(pas); } }
function aller(p){
  // tourner par le plus court chemin
  var d = ((p.lacet - but.lacet) % 360 + 540) % 360 - 180;
  but.x = p.x; but.y = p.y; but.z = p.z; but.tangage = p.tangage; but.lacet += d;
  lancer();
}

// ── 4. barre des rayons
var boutons = [];
function marquer(i){
  if(i === iCourant) return;
  iCourant = i;
  boutons.forEach(function(b, j){ b.setAttribute('aria-pressed', String(j - 1 === i)); });
}
function visiter(i){ marquer(i); aller(arret(i)); }
[{court:T.tEntree}].concat(rayons).forEach(function(r, j){
  var b = el('button', '', nav);
  b.type = 'button'; b.textContent = r.court; b.setAttribute('aria-pressed', 'false');
  b.addEventListener('click', function(){ choisir(null); visiter(j - 1); });
  boutons.push(b);
});

// ── 5. la fiche d'un livre
var choisi = null, survole = null;
function ouvrirListe(livre){
  liste.open = true;
  var cible = livre.ancre;
  Array.prototype.forEach.call(liste.querySelectorAll('.is-cible'), function(n){ n.classList.remove('is-cible'); });
  if(cible.classList.contains('entry')) cible.classList.add('is-cible', 'is-visible');
  cible.scrollIntoView({behavior:calme ? 'auto' : 'smooth', block:'start'});
}
function partir(livre){
  if(calme){ location.href = livre.demo; return; }
  var r = rayons[livre.rayon], p = arret(livre.rayon), pres = Math.min(D, 250);
  if(r.mur === 'g'){ p.x = -LARG/2 + pres; p.z = livre.pos; }
  else if(r.mur === 'd'){ p.x = LARG/2 - pres; p.z = livre.pos; }
  else { p.x = livre.pos; p.z = Z_FOND + pres; }
  aller(p);
  racine.classList.add('is-depart');
  setTimeout(function(){ location.href = livre.demo; }, 520);
}
function montrer(livre){
  if(!livre){ fiche.hidden = true; fiche.textContent = ''; return; }
  fiche.textContent = '';
  if(livre.code) el('span', 'mono', fiche).textContent = livre.code;
  el('h3', '', fiche).textContent = livre.titre;
  if(livre.quand) el('span', 'quand', fiche).textContent = livre.quand;
  if(livre.desc) el('p', '', fiche).textContent = livre.desc;
  if(livre.tech) el('p', 'tech', fiche).textContent = livre.tech;
  var actions = el('div', 'fiche__actions', fiche);
  if(livre.demo){
    var go = el('a', 'fiche__go', actions);
    go.href = livre.demo; go.textContent = T.tOuvrir + ' →';
    go.addEventListener('click', function(e){ e.preventDefault(); partir(livre); });
  } else if(!livre.phare){
    el('span', 'fiche__bientot', actions).textContent = T.tBientot;
  }
  var lien = el('button', 'fiche__lien', actions);
  lien.type = 'button'; lien.textContent = livre.phare ? T.tPhare : T.tFiche;
  lien.addEventListener('click', function(){ ouvrirListe(livre); });
  if(livre === choisi){
    var x = el('button', 'fiche__fermer', fiche);
    x.type = 'button'; x.setAttribute('aria-label', T.tFermer); x.textContent = '×';
    x.addEventListener('click', function(){ choisir(null); });
  }
  fiche.hidden = false;
}
function choisir(livre){
  if(choisi) choisi.el.classList.remove('is-choisi');
  choisi = livre;
  if(livre) livre.el.classList.add('is-choisi');
  montrer(livre || survole);
}
var glisse = false;   // vrai si le geste en cours est un glissement, pas un clic
rayons.forEach(function(rayon, i){
  rayon.livres.forEach(function(livre){
    livre.rayon = i;
    var a = livre.el;
    a.addEventListener('mouseenter', function(){ survole = livre; if(!choisi) montrer(livre); });
    a.addEventListener('mouseleave', function(){ if(survole === livre) survole = null; if(!choisi) montrer(null); });
    a.addEventListener('focus', function(){ if(iCourant !== i) visiter(i); if(!choisi) montrer(livre); });
    a.addEventListener('blur', function(){ if(!choisi && survole !== livre) montrer(null); });
    a.addEventListener('click', function(e){
      if(glisse){ e.preventDefault(); return; }
      // au doigt : le premier appui montre la fiche, le bouton de la fiche ouvre la démo
      var auDoigt = dernierPointeur === 'touch';
      if(livre.demo && !auDoigt){ e.preventDefault(); partir(livre); return; }
      e.preventDefault();
      if(iCourant !== i) visiter(i);
      choisir(choisi === livre ? null : livre);
    });
  });
});

// ── 6. regarder et marcher
var dernierPointeur = 'mouse', appui = null;
racine.addEventListener('pointerdown', function(e){
  dernierPointeur = e.pointerType || 'mouse';
  if(e.target.closest('.salle__rayons, .salle__fiche')) return;
  appui = {x:e.clientX, y:e.clientY, lacet:but.lacet, tangage:but.tangage, id:e.pointerId};
  glisse = false;
});
window.addEventListener('pointermove', function(e){
  if(appui && e.pointerId === appui.id){
    var dx = e.clientX - appui.x, dy = e.clientY - appui.y;
    if(!glisse && Math.abs(dx) < 7 && (Math.abs(dy) < 7 || e.pointerType === 'touch')) return;
    if(!glisse){ glisse = true; racine.classList.add('is-drag'); }
    but.lacet = appui.lacet - dx*0.22;
    if(e.pointerType !== 'touch') but.tangage = appui.tangage + dy*0.12;
    borner(but); marquer(-2); lancer();
  } else if(e.pointerType === 'mouse' && !calme && niveau === 0){
    var r = racine.getBoundingClientRect();
    if(e.clientY < r.top || e.clientY > r.bottom){ regardBut.x = regardBut.y = 0; }
    else {
      regardBut.x = ((e.clientX - r.left)/r.width - 0.5)*4;
      regardBut.y = -((e.clientY - r.top)/r.height - 0.5)*2.4;
    }
    lancer();
  }
});
function lacher(e){
  if(!appui || e.pointerId !== appui.id) return;
  appui = null; racine.classList.remove('is-drag');
  setTimeout(function(){ glisse = false; }, 0);
}
window.addEventListener('pointerup', lacher);
window.addEventListener('pointercancel', lacher);

var CLES = {
  ArrowUp:'haut', ArrowDown:'bas', ArrowLeft:'tGauche', ArrowRight:'tDroite',
  z:'haut', w:'haut', s:'bas', q:'gauche', a:'gauche', d:'droite'
};
racine.addEventListener('keydown', function(e){
  if(e.target.closest('.salle__fiche') || e.ctrlKey || e.metaKey || e.altKey) return;
  var c = CLES[e.key] || CLES[e.key.toLowerCase()];
  if(e.key === 'Escape'){ choisir(null); return; }
  if(!c) return;
  if(e.key.indexOf('Arrow') === 0) e.preventDefault();
  touches[c] = true; lancer();
});
window.addEventListener('keyup', function(e){
  var c = CLES[e.key] || CLES[e.key.toLowerCase()];
  if(c) touches[c] = false;
});
window.addEventListener('blur', function(){ touches = {}; });
// le navigateur peut faire défiler un bloc masqué quand un livre prend le focus
[racine, vue].forEach(function(n){
  n.addEventListener('scroll', function(){ n.scrollLeft = 0; n.scrollTop = 0; });
});

// ── 7. mise en route
function placerLampes(){
  rayons.forEach(function(rayon){
    if(!rayon.lampe) return;
    rayon.lampe.style.top = (Z_ENTREE - rayon.pos)/2 + 'px';
    rayon.lampe.style.left = (rayon.mur === 'g' ? 150 : LARG - 150)/2 + 'px';
  });
}
function recaler(){
  mesurer(); situer(); placerLampes();
  if(iCourant >= -1){ var p = arret(iCourant); but.x = p.x; but.y = p.y; but.z = p.z; }
  lancer();
}
racine.hidden = false;
liste.classList.add('est-repliable');
liste.open = false;
recaler();
cam.x = but.x; cam.y = but.y; cam.z = but.z; cam.lacet = but.lacet;
marquer(-1);
poser();
window.addEventListener('resize', recaler);
window.addEventListener('pageshow', function(){ racine.classList.remove('is-depart'); });
if(document.fonts && document.fonts.ready) document.fonts.ready.then(recaler);
if('IntersectionObserver' in window){
  new IntersectionObserver(function(es){
    visible = es[0].isIntersecting;
    if(visible) lancer();
  }).observe(racine);
}
// un lien vers un projet précis (#projet-…) doit ouvrir la liste
function ancre(){
  var cible = location.hash.length > 1 && document.getElementById(location.hash.slice(1));
  if(cible && liste.contains(cible)){ liste.open = true; cible.scrollIntoView(); }
}
window.addEventListener('hashchange', ancre);
ancre();

})();
