/* ═══════════════════════════════════════════════════════════
   Chabda Gbemetonou — effets de la refonte 2026
   Réseau de particules (hero), bascule 3D des cartes,
   révélation au scroll, fil de progression (storyline).
   Sans bibliothèque, comme le reste du site.
   ═══════════════════════════════════════════════════════════ */
(function(){

function initNetwork(){
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

  var visible = true;
  if('IntersectionObserver' in window){ new IntersectionObserver(function(e){ visible = e[0].isIntersecting; }).observe(cv); }

  function frame(){
    if(visible && w && h){
      ctx.clearRect(0,0,w,h);
      for(var i=0;i<pts.length;i++){
        var p = pts[i];
        p.x += p.vx + mouse.x*0.8*p.z;
        p.y += p.vy + mouse.y*0.8*p.z;
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

initNetwork();
initTilt();
initReveal();
initStoryline();

})();
