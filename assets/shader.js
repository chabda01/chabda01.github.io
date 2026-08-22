(function(){
  var cv = document.getElementById('sky');
  var gl = cv.getContext('webgl', {antialias:false, alpha:false});
  if(!gl) return;

  var vs = 'attribute vec2 p;void main(){gl_Position=vec4(p,0.0,1.0);}';
  var fs = [
    'precision highp float;',
    'uniform vec2 u_res; uniform float u_t;',
    'float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}',
    'float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);',
    ' return mix(mix(hash(i),hash(i+vec2(1.0,0.0)),f.x),mix(hash(i+vec2(0.0,1.0)),hash(i+vec2(1.0,1.0)),f.x),f.y);}',
    'void main(){',
    ' vec2 uv=gl_FragCoord.xy/u_res;',
    ' vec2 q=(gl_FragCoord.xy-0.5*u_res)/max(u_res.y,1.0);',
    ' vec3 col=mix(vec3(0.055,0.075,0.125),vec3(0.030,0.048,0.098),uv.y);',
    ' float glow=exp(-abs(uv.y-0.16)*6.5);',
    ' col+=vec3(0.58,0.38,0.14)*glow*0.42;',
    ' vec2 sp=gl_FragCoord.xy/max(u_res.y,1.0)*95.0;',
    ' vec2 si=floor(sp); float sh=hash(si);',
    ' float tw=0.55+0.45*sin(u_t*1.3+sh*40.0);',
    ' float d=length(fract(sp)-0.5);',
    ' float star=smoothstep(0.14,0.0,d)*step(0.982,sh)*tw;',
    ' col+=vec3(0.85,0.90,1.0)*star*smoothstep(0.12,0.9,uv.y);',
    ' float w=noise(vec2(q.x*3.2,uv.y*18.0-u_t*0.32));',
    ' float m=smoothstep(0.34,0.0,uv.y);',
    ' col+=vec3(0.10,0.32,0.38)*w*m*0.42;',
    ' col+=vec3(0.55,0.36,0.15)*m*0.10;',
    ' col*=1.0-0.55*length(q*vec2(0.55,0.85));',
    ' gl_FragColor=vec4(col,1.0);',
    '}'
  ].join('\n');

  function sh(type, src){
    var s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
    return gl.getShaderParameter(s, gl.COMPILE_STATUS) ? s : null;
  }
  var v = sh(gl.VERTEX_SHADER, vs), f = sh(gl.FRAGMENT_SHADER, fs);
  if(!v || !f) return;
  var prog = gl.createProgram();
  gl.attachShader(prog, v); gl.attachShader(prog, f); gl.linkProgram(prog);
  if(!gl.getProgramParameter(prog, gl.LINK_STATUS)) return;
  gl.useProgram(prog);

  var buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,3,-1,-1,3]), gl.STATIC_DRAW);
  var loc = gl.getAttribLocation(prog, 'p');
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

  var uRes = gl.getUniformLocation(prog, 'u_res'),
      uT   = gl.getUniformLocation(prog, 'u_t');

  function resize(){
    var dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    var w = Math.round(cv.clientWidth * dpr), h = Math.round(cv.clientHeight * dpr);
    if(cv.width !== w || cv.height !== h){ cv.width = w; cv.height = h; gl.viewport(0,0,w,h); }
    gl.uniform2f(uRes, cv.width, cv.height);
  }

  var still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var start = performance.now(), visible = true;

  if('IntersectionObserver' in window){
    new IntersectionObserver(function(e){ visible = e[0].isIntersecting; }).observe(cv);
  }

  function frame(now){
    resize();
    gl.uniform1f(uT, still ? 8.0 : (now - start) / 1000);
    if(visible) gl.drawArrays(gl.TRIANGLES, 0, 3);
    if(!still) requestAnimationFrame(frame);
  }
  if(still){ frame(start); window.addEventListener('resize', function(){ frame(start); }); }
  else requestAnimationFrame(frame);
})();
