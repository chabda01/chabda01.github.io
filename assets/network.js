/* ═══════════════════════════════════════════════════════════
   Chabda Gbemetonou — effets de la refonte 2026
   Réseau de particules + constellations jouables (hero),
   lune qu'on peut attraper, bascule 3D des cartes,
   révélation au scroll, fil de progression (storyline).
   Sans bibliothèque, comme le reste du site.
   ═══════════════════════════════════════════════════════════ */
(function(){

// Position courante de la lune, partagée avec le réseau de particules
// pour un léger effet de gravité — clin d'œil à Interstonar.
var moon = {x:0, y:0, has:false};

var mqNarrow = window.matchMedia('(max-width:900px)');

function initMoon(){
  var el = document.getElementById('moon');
  var hero = document.getElementById('top');
  if(!el || !hero || mqNarrow.matches) return;

  var home = {x:0, y:0};
  var pos = {x:0, y:0};
  var dragging = false, grabDx = 0, grabDy = 0, springing = false;

  function heroSize(){
    var r = hero.getBoundingClientRect();
    return {w:r.width, h:r.height};
  }
  function place(x, y){
    var s = heroSize();
    var w = el.offsetWidth, h = el.offsetHeight;
    pos.x = Math.max(0, Math.min(s.w - w, x));
    pos.y = Math.max(0, Math.min(s.h - h, y));
    el.style.left = pos.x + 'px';
    el.style.top = pos.y + 'px';
    moon.x = pos.x + w/2; moon.y = pos.y + h/2; moon.has = true;
  }
  function computeHome(){
    var s = heroSize();
    var w = el.offsetWidth || 100, h = el.offsetHeight || 100;
    home.x = s.w * 0.80 - w/2;
    home.y = s.h * 0.20 - h/2;
  }
  function settle(){
    springing = true;
    (function step(){
      if(!springing) return;
      var dx = home.x - pos.x, dy = home.y - pos.y;
      if(Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5){ place(home.x, home.y); springing = false; return; }
      place(pos.x + dx*0.06, pos.y + dy*0.06);
      requestAnimationFrame(step);
    })();
  }

  el.style.right = 'auto'; el.style.top = '0px'; el.style.left = '0px';
  computeHome();
  place(home.x, home.y);

  el.addEventListener('pointerdown', function(e){
    springing = false;
    dragging = true;
    el.setPointerCapture(e.pointerId);
    var r = hero.getBoundingClientRect();
    grabDx = (e.clientX - r.left) - pos.x;
    grabDy = (e.clientY - r.top) - pos.y;
    e.preventDefault();
  });
  el.addEventListener('pointermove', function(e){
    if(!dragging) return;
    var r = hero.getBoundingClientRect();
    place((e.clientX - r.left) - grabDx, (e.clientY - r.top) - grabDy);
  });
  function release(e){
    if(!dragging) return;
    dragging = false;
    settle();
  }
  el.addEventListener('pointerup', release);
  el.addEventListener('pointercancel', release);
  window.addEventListener('resize', function(){ if(!dragging && !springing){ computeHome(); place(home.x, home.y); } else { computeHome(); } });
}

// Deux petites constellations, qu'on peut attraper par n'importe
// laquelle de leurs étoiles et déplacer d'un bloc.
var CONSTELLATIONS = [
  { // la Casserole — un repère familier
    points: [
      [0.70,0.58],[0.75,0.61],[0.795,0.575],
      [0.84,0.605],[0.84,0.685],[0.775,0.705],[0.735,0.655]
    ],
    edges: [[0,1],[1,2],[2,3],[3,4],[4,5],[5,6],[6,3]]
  },
  { // un petit graphe de réseau — le motif du site
    points: [
      [0.56,0.14],[0.645,0.115],[0.695,0.19],[0.635,0.265],[0.555,0.245],[0.605,0.185]
    ],
    edges: [[0,1],[1,2],[2,3],[3,4],[4,0],[0,5],[2,5],[4,5]]
  }
];

function initSky2D(){
  var cv = document.getElementById('network');
  var hero = document.getElementById('top');
  var heroTitle = document.getElementById('heroTitle');
  if(!cv || !hero) return;
  var ctx = cv.getContext('2d');
  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var COUNT = reduced ? 0 : 42;
  var pts = [];
  var mouse = {x:0, y:0};
  var w = 0, h = 0;

  var groups = CONSTELLATIONS.map(function(c){
    return {points: c.points, edges: c.edges, offset:{x:0,y:0}, target:{x:0,y:0}, dragging:false, grabDx:0, grabDy:0};
  });

  function seed(){
    pts = [];
    for(var i=0;i<COUNT;i++){
      var z = Math.random();
      pts.push({
        x: Math.random()*w, y: Math.random()*h, z: z,
        vx: (Math.random()-0.5)*0.10*(0.4+z), vy: (Math.random()-0.5)*0.10*(0.4+z)
      });
    }
  }
  function resize(){
    var dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    w = cv.clientWidth; h = cv.clientHeight;
    cv.width = Math.round(w*dpr); cv.height = Math.round(h*dpr);
    ctx.setTransform(dpr,0,0,dpr,0,0);
    seed();
  }
  hero.addEventListener('mousemove', function(e){
    var r = hero.getBoundingClientRect();
    mouse.x = (e.clientX - r.left - r.width/2) / r.width;
    mouse.y = (e.clientY - r.top - r.height/2) / r.height;
    if(heroTitle){ heroTitle.style.transform = 'perspective(1200px) rotateX(' + (mouse.y*-2.4) + 'deg) rotateY(' + (mouse.x*2.4) + 'deg)'; }
  });
  hero.addEventListener('mouseleave', function(){ mouse.x = 0; mouse.y = 0; if(heroTitle){ heroTitle.style.transform = ''; } });
  window.addEventListener('resize', resize);

  // interaction : attraper une constellation par une de ses étoiles
  function starAt(px, py){
    if(mqNarrow.matches) return null;
    for(var g=0; g<groups.length; g++){
      var grp = groups[g];
      for(var i=0; i<grp.points.length; i++){
        var sx = grp.points[i][0]*w + grp.offset.x;
        var sy = grp.points[i][1]*h + grp.offset.y;
        var dx = px-sx, dy = py-sy;
        if(dx*dx+dy*dy < 17*17) return grp;
      }
    }
    return null;
  }
  function settleGroup(grp){
    (function step(){
      if(grp.dragging) return;
      var dx = -grp.offset.x, dy = -grp.offset.y;
      if(Math.abs(dx) < 0.4 && Math.abs(dy) < 0.4){ grp.offset.x = 0; grp.offset.y = 0; return; }
      grp.offset.x += dx*0.05; grp.offset.y += dy*0.05;
      requestAnimationFrame(step);
    })();
  }
  cv.addEventListener('pointerdown', function(e){
    var r = cv.getBoundingClientRect();
    var px = e.clientX - r.left, py = e.clientY - r.top;
    var grp = starAt(px, py);
    if(!grp) return;
    grp.dragging = true;
    grp.grabDx = px - grp.offset.x;
    grp.grabDy = py - grp.offset.y;
    cv.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  cv.addEventListener('pointermove', function(e){
    var dragged = groups.filter(function(g){ return g.dragging; })[0];
    if(!dragged) return;
    var r = cv.getBoundingClientRect();
    dragged.offset.x = (e.clientX - r.left) - dragged.grabDx;
    dragged.offset.y = (e.clientY - r.top) - dragged.grabDy;
  });
  function releaseGroups(){
    groups.forEach(function(g){
      if(g.dragging){ g.dragging = false; settleGroup(g); }
    });
  }
  cv.addEventListener('pointerup', releaseGroups);
  cv.addEventListener('pointercancel', releaseGroups);

  var visible = true;
  if('IntersectionObserver' in window){ new IntersectionObserver(function(e){ visible = e[0].isIntersecting; }).observe(cv); }

  function frame(){
    if(visible && w && h){
      ctx.clearRect(0,0,w,h);

      // dérive ambiante + légère attraction vers la lune
      for(var i=0;i<pts.length;i++){
        var p = pts[i];
        p.x += p.vx + mouse.x*0.8*p.z;
        p.y += p.vy + mouse.y*0.8*p.z;
        if(moon.has){
          var mdx = moon.x - p.x, mdy = moon.y - p.y;
          var mdist = Math.sqrt(mdx*mdx+mdy*mdy);
          if(mdist < 170 && mdist > 1){
            var pull = (1 - mdist/170) * 0.05;
            p.x += (mdx/mdist) * pull;
            p.y += (mdy/mdist) * pull;
          }
        }
        if(p.x < -20) p.x = w+20; if(p.x > w+20) p.x = -20;
        if(p.y < -20) p.y = h+20; if(p.y > h+20) p.y = -20;
      }
      ctx.lineWidth = 1;
      for(var a=0;a<pts.length;a++){
        for(var b=a+1;b<pts.length;b++){
          var dx = pts[a].x-pts[b].x, dy = pts[a].y-pts[b].y;
          var d2 = dx*dx+dy*dy;
          if(d2 < 15000){
            var op = (1 - d2/15000) * 0.22 * ((pts[a].z+pts[b].z)/2);
            ctx.strokeStyle = 'rgba(233,168,85,' + op.toFixed(3) + ')';
            ctx.beginPath(); ctx.moveTo(pts[a].x,pts[a].y); ctx.lineTo(pts[b].x,pts[b].y); ctx.stroke();
          }
        }
      }
      for(var j=0;j<pts.length;j++){
        var q = pts[j];
        var r2 = 0.6 + q.z*1.8;
        ctx.beginPath();
        ctx.fillStyle = 'rgba(244,239,230,' + (0.35+q.z*0.5).toFixed(3) + ')';
        ctx.arc(q.x, q.y, r2, 0, Math.PI*2); ctx.fill();
      }

      // constellations (masquées sur petit écran, comme la lune)
      if(!mqNarrow.matches) groups.forEach(function(grp){
        var sx = grp.points.map(function(pt){ return pt[0]*w + grp.offset.x; });
        var sy = grp.points.map(function(pt){ return pt[1]*h + grp.offset.y; });
        ctx.strokeStyle = 'rgba(233,168,85,.5)';
        ctx.lineWidth = 1;
        grp.edges.forEach(function(e){
          ctx.beginPath(); ctx.moveTo(sx[e[0]],sy[e[0]]); ctx.lineTo(sx[e[1]],sy[e[1]]); ctx.stroke();
        });
        for(var k=0;k<sx.length;k++){
          ctx.beginPath();
          ctx.fillStyle = 'rgba(247,242,232,.95)';
          ctx.arc(sx[k], sy[k], 2.6, 0, Math.PI*2); ctx.fill();
          ctx.beginPath();
          ctx.fillStyle = 'rgba(233,168,85,.18)';
          ctx.arc(sx[k], sy[k], 6, 0, Math.PI*2); ctx.fill();
        }
      });
    }
    if(!reduced) requestAnimationFrame(frame);
  }
  resize();
  requestAnimationFrame(frame);
}

function initTilt(){
  var els = document.querySelectorAll('.tilt');
  els.forEach(function(el){
    el.addEventListener('mousemove', function(e){
      var r = el.getBoundingClientRect();
      var px = (e.clientX - r.left)/r.width - 0.5;
      var py = (e.clientY - r.top)/r.height - 0.5;
      el.style.transform = 'perspective(700px) rotateX(' + (py*-5) + 'deg) rotateY(' + (px*7) + 'deg)';
    });
    el.addEventListener('mouseleave', function(){ el.style.transform = ''; });
  });
}

function initReveal(){
  var els = document.querySelectorAll('.reveal');
  if(!('IntersectionObserver' in window)){ els.forEach(function(e){ e.classList.add('is-visible'); }); return; }
  var io = new IntersectionObserver(function(entries){
    entries.forEach(function(en){ if(en.isIntersecting){ en.target.classList.add('is-visible'); io.unobserve(en.target); } });
  }, {threshold:0.12, rootMargin:'0px 0px -8% 0px'});
  els.forEach(function(e){ io.observe(e); });
}

function initStoryline(){
  var main = document.querySelector('main');
  var fill = document.getElementById('storylineFill');
  if(!main || !fill) return;
  var dots = document.querySelectorAll('.storyline__dot');
  function layout(){
    dots.forEach(function(dot){
      var target = document.getElementById(dot.getAttribute('data-target'));
      if(target){ dot.style.top = target.offsetTop + 'px'; }
    });
  }
  function update(){
    var h = main.offsetHeight;
    var progress = (window.scrollY + window.innerHeight*0.5 - main.offsetTop) / h;
    progress = Math.max(0, Math.min(1, progress));
    fill.style.transform = 'scaleY(' + progress.toFixed(4) + ')';
  }
  window.addEventListener('scroll', update, {passive:true});
  window.addEventListener('resize', function(){ layout(); update(); });
  layout(); update();

  var idEls = document.querySelectorAll('main > section[id]');
  if('IntersectionObserver' in window){
    var io = new IntersectionObserver(function(entries){
      entries.forEach(function(en){
        var dot = document.querySelector('.storyline__dot[data-target="' + en.target.id + '"]');
        if(dot){ dot.classList.toggle('is-active', en.isIntersecting); }
      });
    }, {rootMargin:'-45% 0px -45% 0px'});
    idEls.forEach(function(e){ io.observe(e); });
  }
}

initMoon();
initSky2D();
initTilt();
initReveal();
initStoryline();

})();
