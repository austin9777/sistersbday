/* Riso press simulation.
   Two ink plates print onto the same sheet. They land out of register,
   then respond to the phone: tilt it and the plates slide apart,
   press and hold and they pull into perfect register. */
(function(){
  var cfg = window.SHEET || {};
  var LEAD  = cfg.lead  || "#FF48B0";
  var TRAIL = cfg.trail || "#0078BF";
  var MIRROR = !!cfg.mirror;
  var PAPER = "#EFE7DA";

  var reduce = window.matchMedia &&
               window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* deterministic noise so the plate art is stable across reloads */
  function rng(seed){
    var h = 2166136261;
    for (var i=0;i<seed.length;i++){ h ^= seed.charCodeAt(i); h = Math.imul(h,16777619); }
    return function(){
      h += 0x6D2B79F5; var t = h;
      t = Math.imul(t ^ (t>>>15), t|1);
      t ^= t + Math.imul(t ^ (t>>>7), t|61);
      return ((t ^ (t>>>14))>>>0)/4294967296;
    };
  }

  var canvas = document.getElementById("plate");
  var ctx = canvas.getContext("2d");
  var plateA = document.createElement("canvas");
  var plateB = document.createElement("canvas");
  var W=0, H=0, DPR=1, grain=null;

  function blob(c, color, seed, scale){
    var r = rng(seed);
    var g = c.getContext("2d");
    g.clearRect(0,0,c.width,c.height);
    g.save();
    g.scale(DPR,DPR);
    g.translate(W*0.5, H*0.44);
    g.fillStyle = color;
    var rings = 6;
    for (var k=0;k<rings;k++){
      var base = Math.min(W,H) * scale * (0.20 + k*0.098);
      var a1=r()*2-1, a2=r()*2-1, a3=r()*2-1;
      var p1=r()*6.28, p2=r()*6.28, p3=r()*6.28;
      var spin = r()*6.28;
      g.globalAlpha = 0.13 + (rings-k)*0.018;
      g.beginPath();
      for (var t=0;t<=360;t++){
        var th = t*Math.PI/180;
        var rad = base * (1
          + 0.13*a1*Math.sin(2*th+p1)
          + 0.09*a2*Math.sin(3*th+p2)
          + 0.05*a3*Math.sin(5*th+p3));
        var x = Math.cos(th+spin)*rad;
        var y = Math.sin(th+spin)*rad*0.94;
        if(t===0) g.moveTo(x,y); else g.lineTo(x,y);
      }
      g.closePath();
      g.fill();
    }
    g.restore();
  }

  function makeGrain(){
    var gc = document.createElement("canvas");
    gc.width = gc.height = 140;
    var g = gc.getContext("2d");
    var img = g.createImageData(140,140), d = img.data;
    for(var i=0;i<d.length;i+=4){
      var v = Math.random()*255;
      d[i]=d[i+1]=d[i+2]=v; d[i+3]=16;
    }
    g.putImageData(img,0,0);
    grain = ctx.createPattern(gc,"repeat");
  }

  function size(){
    DPR = Math.min(window.devicePixelRatio||1, 2);
    W = window.innerWidth; H = window.innerHeight;
    [canvas,plateA,plateB].forEach(function(c){
      c.width = Math.round(W*DPR); c.height = Math.round(H*DPR);
      c.style.width = W+"px"; c.style.height = H+"px";
    });
    blob(plateA, LEAD,  "plate-a", 1.02);
    blob(plateB, TRAIL, "plate-b", 0.94);
    makeGrain();
  }

  /* ---- input: tilt + press-and-hold ---------------------------------- */
  var tiltX = 0, tiltY = 0;      /* smoothed device tilt, roughly -1..1 */
  var wantX = 0, wantY = 0;      /* raw target from sensor or pointer    */
  var press = 0, pressing = false;
  var baseBeta = null;

  function onOrient(e){
    if (e.gamma === null || e.beta === null) return;
    if (baseBeta === null) baseBeta = e.beta;
    wantX = Math.max(-1, Math.min(1, e.gamma / 34));
    wantY = Math.max(-1, Math.min(1, (e.beta - baseBeta) / 34));
  }

  var tiltOn = false;
  function enableTilt(){
    if (tiltOn) return;
    var DOE = window.DeviceOrientationEvent;
    if (!DOE) return;
    if (typeof DOE.requestPermission === "function"){
      DOE.requestPermission().then(function(state){
        if (state === "granted"){
          tiltOn = true;
          window.addEventListener("deviceorientation", onOrient);
        }
      }).catch(function(){ /* denied — pointer fallback still works */ });
    } else {
      tiltOn = true;
      window.addEventListener("deviceorientation", onOrient);
    }
  }

  var hint = document.querySelector(".hint");
  var hintLabel = hint && hint.querySelector("span:last-child");
  var hintDot = hint && hint.querySelector(".dot");

  function down(e){
    pressing = true;
    enableTilt();
    /* on non-touch devices, let the cursor drive the plates */
    if (!tiltOn && e && e.pointerType === "mouse") trackMouse(e);
  }
  function up(){ pressing = false; }

  function trackMouse(e){
    wantX = (e.clientX / window.innerWidth  - 0.5) * 2;
    wantY = (e.clientY / window.innerHeight - 0.5) * 2;
  }

  window.addEventListener("pointerdown", down, {passive:true});
  window.addEventListener("pointerup", up, {passive:true});
  window.addEventListener("pointercancel", up, {passive:true});
  window.addEventListener("pointermove", function(e){
    if (!tiltOn && e.pointerType === "mouse") trackMouse(e);
  }, {passive:true});
  /* first tap anywhere also unlocks motion on iOS */
  window.addEventListener("touchstart", enableTilt, {passive:true, once:false});

  /* ---- render -------------------------------------------------------- */
  var start = null;
  function frame(ts){
    if (start === null) start = ts;
    var e = (ts - start) / 1000;

    /* the initial pass of the press: plates land, then settle into place */
    var settle = reduce ? 1 : Math.min(1, e/2.4);
    var ease = 1 - Math.pow(1-settle, 3);

    press += ((pressing ? 1 : 0) - press) * 0.09;
    tiltX += (wantX - tiltX) * 0.07;
    tiltY += (wantY - tiltY) * 0.07;

    /* holding the sheet pulls the plates into register */
    var loose = 1 - press;
    var offx = ((1-ease)*46 + Math.sin(e*0.42)*2.4 + tiltX*30) * loose;
    var offy = ((1-ease)*26 + Math.cos(e*0.33)*2.0 + tiltY*22) * loose;

    ctx.setTransform(1,0,0,1,0,0);
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
    ctx.fillStyle = PAPER;
    ctx.fillRect(0,0,canvas.width,canvas.height);

    ctx.save();
    if (MIRROR){ ctx.translate(canvas.width,0); ctx.scale(-1,1); }
    ctx.globalCompositeOperation = "multiply";
    ctx.drawImage(plateA, 0, 0);
    ctx.drawImage(plateB, offx*DPR, offy*DPR);
    ctx.restore();

    if (grain){
      ctx.globalCompositeOperation = "multiply";
      ctx.fillStyle = grain;
      ctx.fillRect(0,0,canvas.width,canvas.height);
    }

    /* the type misregisters along with the ink */
    var s = document.documentElement.style;
    s.setProperty("--regx", (offx*0.55).toFixed(2)+"px");
    s.setProperty("--regy", (offy*0.55).toFixed(2)+"px");

    if (hint){
      var locked = press > 0.82;
      if (locked !== hint.dataset.locked_){
        hint.dataset.locked_ = locked;
        if (hintLabel) hintLabel.textContent = locked ? "In register" : "Press and hold";
        if (hintDot) hintDot.classList.toggle("lit", locked);
      }
    }

    requestAnimationFrame(frame);
  }

  size();
  window.addEventListener("resize", size);
  requestAnimationFrame(frame);

  /* content registers in after the plates land */
  document.querySelectorAll(".reveal").forEach(function(el,i){
    setTimeout(function(){ el.classList.add("in"); }, reduce ? 0 : 420 + i*240);
  });
})();
