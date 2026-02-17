/*  Frikik Ustası — PRO (Kaleye kesin giden fizik + FIFA hissi + Replay)
    Uyumlu id'ler:
      canvas#c, #score, #lives, #streak, #level, #resetBtn
*/

(() => {
  // ---------- DOM ----------
  const $ = (id) => document.getElementById(id);
  const canvas = $("c");
  if (!canvas) { alert("canvas id='c' bulunamadı"); return; }
  const ctx = canvas.getContext("2d", { alpha: false });

  const scoreEl = $("score");
  const livesEl = $("lives");
  const streakEl = $("streak");
  const levelEl = $("level");
  const resetBtn = $("resetBtn");

  // ---------- Helpers ----------
  const W = canvas.width, H = canvas.height;
  const clamp = (v,a,b) => Math.max(a, Math.min(b, v));
  const lerp  = (a,b,t) => a + (b-a)*t;
  const hypot = Math.hypot;
  const rand  = (a,b) => a + Math.random()*(b-a);

  function fatal(err){
    console.error(err);
    ctx.fillStyle = "#111"; ctx.fillRect(0,0,W,H);
    ctx.fillStyle = "#b00"; ctx.fillRect(0,0,W,90);
    ctx.fillStyle = "#fff"; ctx.font = "bold 16px Arial";
    ctx.fillText("game.js hata:", 12, 28);
    ctx.font = "12px Arial";
    const msg = (err?.stack || String(err)).slice(0, 600);
    wrap(msg, 12, 50, W-24, 14);
  }
  function wrap(text, x, y, maxW, lh){
    const words = String(text).split(/\s+/);
    let line = "";
    for(let i=0;i<words.length;i++){
      const t = line + words[i] + " ";
      if(ctx.measureText(t).width > maxW && i>0){
        ctx.fillText(line, x, y); line = words[i] + " "; y += lh;
        if(y > H-10) return;
      } else line = t;
    }
    ctx.fillText(line, x, y);
  }

  // ---------- World ----------
  const goal = { x: W/2, y: 92, w: 296, h: 76 };
  const mouth = { x: goal.x-goal.w/2, y: goal.y, w: goal.w, h: goal.h };

  const ballStart = { x: W/2, y: H-130 };

  let score=0, lives=5, streak=0, level=1;

  // “FIFA” hissi: kamera
  const cam = { zoom: 1, targetZoom: 1, shake: 0, sx: 0, sy: 0 };

  // Mesaj/overlay
  const overlay = { text:"", t:0 };

  // Net & particles
  let netShake = 0;
  const particles = [];

  // Replay buffer
  let replayMode = false;
  let replayT = 0;
  let replayFrames = []; // {x,y,rot}
  const REPLAY_MAX = 140; // ~2.3 sn @60fps

  const wall = {
    active: true,
    x: W/2,
    y: mouth.y + 145,
    cols: 4,
    spacing: 28,
    w: 16,
    h: 52,
    sway: 0,
    swayDir: 1
  };

  const keeper = {
    x: W/2,
    y: mouth.y + 30,
    w: 80,
    h: 26,
    baseSpeed: 2.4,
    speed: 2.4,
    dir: 1,
    mode: "patrol", // patrol | dive | recover
    diveT: 0,
    diveVX: 0
  };

  const ball = {
    x: ballStart.x,
    y: ballStart.y,
    r: 16,
    vx: 0,
    vy: 0,
    spin: 0,
    rot: 0,
    inFlight: false
  };

  // Drag aiming
  const drag = { active:false, sx:0, sy:0, cx:0, cy:0 };

  // ---------- HUD ----------
  function syncHud(){
    scoreEl && (scoreEl.textContent = String(score));
    livesEl && (livesEl.textContent = String(lives));
    streakEl && (streakEl.textContent = String(streak));
    levelEl && (levelEl.textContent = String(level));
  }
  function say(t){ overlay.text = t; overlay.t = 120; }

  function updateDifficulty(){
    level = 1 + Math.floor(score/5);
    keeper.speed = keeper.baseSpeed + Math.min(4.0, level*0.35);
    const chance = clamp(0.65 + level*0.02, 0.65, 0.85);
    wall.active = Math.random() < chance;
  }

  // ---------- Reset ----------
  function resetShot(){
    ball.x = ballStart.x; ball.y = ballStart.y;
    ball.vx = 0; ball.vy = 0; ball.spin = 0; ball.rot = 0;
    ball.inFlight = false;

    drag.active = false;

    keeper.x = W/2;
    keeper.mode = "patrol";
    keeper.diveT = 0;
    keeper.diveVX = 0;

    wall.sway = 0; wall.swayDir = 1;

    replayFrames = [];
    replayMode = false;
    replayT = 0;

    updateDifficulty();
    syncHud();
    cam.targetZoom = 1;
  }

  function resetGame(){
    score=0; lives=5; streak=0; level=1;
    particles.length = 0;
    netShake = 0;
    overlay.text=""; overlay.t=0;
    cam.zoom=1; cam.targetZoom=1; cam.shake=0;
    resetShot();
  }
  resetBtn && resetBtn.addEventListener("click", resetGame);

  // ---------- Collisions ----------
  function circleRectHit(cx, cy, cr, rx, ry, rw, rh){
    const px = clamp(cx, rx, rx+rw);
    const py = clamp(cy, ry, ry+rh);
    const dx = cx - px, dy = cy - py;
    return dx*dx + dy*dy <= cr*cr;
  }

  function getWallRects(){
    if(!wall.active) return [];
    wall.sway += 0.02 * wall.swayDir * (1 + level*0.12);
    if(Math.abs(wall.sway) > 0.35) wall.swayDir *= -1;

    const rects = [];
    const total = (wall.cols-1)*wall.spacing;
    const startX = wall.x - total/2;
    for(let i=0;i<wall.cols;i++){
      const x = startX + i*wall.spacing + Math.sin(tick*0.02 + i)*2;
      const y = wall.y + Math.cos(tick*0.03 + i)*1.5;
      rects.push({ x: x-wall.w/2, y: y-wall.h/2, w: wall.w, h: wall.h });
    }
    return rects;
  }

  // ---------- Particles ----------
  function spawnParticles(x,y,n=24){
    for(let i=0;i<n;i++){
      particles.push({
        x,y,
        vx: rand(-3.6,3.6),
        vy: rand(-3.6,3.6),
        life: rand(28,58)
      });
    }
  }
  function stepParticles(){
    for(let i=particles.length-1;i>=0;i--){
      const p = particles[i];
      p.x += p.vx; p.y += p.vy;
      p.vy += 0.07;
      p.vx *= 0.98; p.vy *= 0.98;
      p.life -= 1;
      if(p.life <= 0) particles.splice(i,1);
    }
  }

  // ---------- Keeper AI ----------
  function planDive(){
    // Basit tahmin: topun kale çizgisine yaklaştığı x
    let tx = ball.x, ty = ball.y;
    let tvx = ball.vx, tvy = ball.vy, tsp = ball.spin;

    for(let i=0;i<50;i++){
      tvx += tsp * 0.08;
      tsp *= 0.995;

      // drag (hafif)
      tvx *= 0.996;
      tvy *= 0.996;

      tx += tvx; ty += tvy;

      // gravity (daha düşük -> KALEYE GİDER)
      tvy += 0.075;

      if(ty <= mouth.y + mouth.h + 10) break;
    }

    const left = mouth.x + keeper.w/2;
    const right = mouth.x + mouth.w - keeper.w/2;
    const targetX = clamp(tx, left, right);

    const likelyIn = (tx > mouth.x-25 && tx < mouth.x + mouth.w + 25);
    const diveChance = clamp(0.45 + level*0.06, 0.45, 0.82);

    keeper.mode="patrol";
    keeper.diveT=0;
    keeper.diveVX=0;

    if(likelyIn && Math.random() < diveChance){
      keeper.mode="dive";
      keeper.diveT = 22;
      keeper.diveVX = clamp((targetX - keeper.x) * 0.10, -9.2, 9.2);
    }
  }

  function stepKeeper(){
    const left = mouth.x + keeper.w/2;
    const right = mouth.x + mouth.w - keeper.w/2;

    if(keeper.mode === "dive"){
      keeper.x += keeper.diveVX;
      keeper.diveT--;
      if(keeper.diveT <= 0){
        keeper.mode="recover";
        keeper.diveT=18;
      }
    } else if(keeper.mode === "recover"){
      keeper.x = lerp(keeper.x, W/2, 0.08);
      keeper.diveT--;
      if(keeper.diveT <= 0) keeper.mode="patrol";
    } else {
      keeper.x += keeper.speed * keeper.dir;
      if(keeper.x < left){ keeper.x = left; keeper.dir = 1; }
      if(keeper.x > right){ keeper.x = right; keeper.dir = -1; }
    }

    keeper.x = clamp(keeper.x, left, right);
  }

  // ---------- Shooting (BURASI: kaleye gitmesini garantiliyor) ----------
  function shoot(dx, dy){
    const mag = hypot(dx,dy);

    // Güç: daha agresif, top kesin hız alır
    const power = clamp(mag / 7.5, 6, 22); // <-- kritik

    // Yön: drag'ın tersi
    let vx = clamp(-dx / 16, -12, 12);
    let vy = clamp(-dy / 13, -22, -6);

    // Güç takviyesi (özellikle yukarı)
    vy -= power * 0.55;  // <-- kritik: kaleye taşır
    vx *= (0.92 + power * 0.02);

    // Falso (spin)
    const spin = clamp(dx / 75, -1.4, 1.4) * (0.75 + power * 0.02);

    ball.vx = vx;
    ball.vy = vy;
    ball.spin = spin;
    ball.inFlight = true;

    // Kamera: şut anında hafif zoom
    cam.targetZoom = 1.06;
    cam.shake = Math.max(cam.shake, 1.8);

    planDive();
  }

  function resolveShot(){
    if(!ball.inFlight) return;
    ball.inFlight = false;

    // keeper hitbox
    const kr = {
      x: keeper.x - keeper.w/2 - 10,
      y: keeper.y - keeper.h/2 - 4,
      w: keeper.w + 20,
      h: keeper.h + 8
    };
    const keeperHit = circleRectHit(ball.x, ball.y, ball.r, kr.x, kr.y, kr.w, kr.h);

    // goal bounds (toleranslı)
    const inGoal =
      ball.x >= mouth.x + 2 &&
      ball.x <= mouth.x + mouth.w - 2 &&
      ball.y <= mouth.y + mouth.h + 14 &&
      ball.y >= mouth.y - 26;

    if(keeperHit){
      save();
      return;
    }
    if(inGoal){
      goalScored();
    } else {
      miss("AUT! 😬");
    }
  }

  function stepBall(){
    if(!ball.inFlight) return;

    // Replay record
    replayFrames.push({ x: ball.x, y: ball.y, rot: ball.rot });
    if(replayFrames.length > REPLAY_MAX) replayFrames.shift();

    // curve from spin
    ball.vx += ball.spin * 0.085;
    ball.spin *= 0.995;

    // air drag (çok hafif)
    ball.vx *= 0.996;
    ball.vy *= 0.996;

    // move
    ball.x += ball.vx;
    ball.y += ball.vy;

    // rotate
    ball.rot += ball.vx * 0.02;

    // gravity (DÜŞÜRÜLDÜ -> kaleye gidiyor)
    ball.vy += 0.075;

    // side walls
    if(ball.x < ball.r){ ball.x = ball.r; ball.vx *= -0.55; ball.spin *= -0.6; }
    if(ball.x > W-ball.r){ ball.x = W-ball.r; ball.vx *= -0.55; ball.spin *= -0.6; }

    // wall collision
    if(wall.active && ball.y < wall.y + 55 && ball.y > wall.y - 85){
      const rects = getWallRects();
      for(const r of rects){
        if(circleRectHit(ball.x, ball.y, ball.r, r.x, r.y, r.w, r.h)){
          ball.vy *= -0.28;
          ball.vx *= 0.70;
          ball.spin *= 0.65;
          spawnParticles(ball.x, ball.y, 18);
          cam.shake = Math.max(cam.shake, 2.8);
          wall.swayDir *= -1;
          break;
        }
      }
    }

    // goal line resolve
    if(ball.y <= mouth.y + mouth.h + 16){
      resolveShot();
      return;
    }

    // fell out
    if(ball.y > H + 80){
      miss("AUT! 😬");
    }
  }

  // ---------- Outcomes + Replay ----------
  function startReplay(){
    // 2 saniyelik tekrar
    replayMode = true;
    replayT = Math.min(replayFrames.length, REPLAY_MAX) - 1;
    cam.targetZoom = 1.12;
  }

  function goalScored(){
    streak += 1;
    const combo = (streak % 3 === 0) ? 1 : 0;
    const lvlBonus = Math.floor(level/3);

    score += 1 + combo + lvlBonus;

    say(combo ? "GOOOL! +BONUS ⚡" : "GOOOL! ⚽");
    netShake = 22;
    spawnParticles(ball.x, ball.y, 30);
    cam.shake = Math.max(cam.shake, 4.0);

    updateDifficulty();
    syncHud();

    // Replay
    startReplay();

    setTimeout(() => {
      resetShot();
    }, 1700);
  }

  function save(){
    streak = 0;
    lives -= 1;
    say("KURTARDI! 🧤");
    spawnParticles(ball.x, ball.y, 18);
    cam.shake = Math.max(cam.shake, 3.0);
    syncHud();
    endCheck();

    startReplay();

    setTimeout(() => {
      resetShot();
    }, 1700);
  }

  function miss(text){
    streak = 0;
    lives -= 1;
    say(text);
    syncHud();
    endCheck();
    cam.shake = Math.max(cam.shake, 2.2);

    startReplay();

    setTimeout(() => {
      resetShot();
    }, 1600);
  }

  function endCheck(){
    if(lives <= 0){
      say("MAÇ BİTTİ!");
      setTimeout(() => {
        alert(`Oyun bitti!\nSkor: ${score}\nSeviye: ${level}`);
        resetGame();
      }, 450);
    }
  }

  // ---------- Drawing (Pro look) ----------
  function drawCrowd(){
    // simple stands gradient + dots
    ctx.save();
    const topH = 140;
    const g = ctx.createLinearGradient(0,0,0,topH);
    g.addColorStop(0, "rgba(10,10,10,.55)");
    g.addColorStop(1, "rgba(10,10,10,.10)");
    ctx.fillStyle = g;
    ctx.fillRect(0,0,W,topH);

    ctx.globalAlpha = 0.35;
    for(let i=0;i<220;i++){
      const x = rand(0,W);
      const y = rand(10, topH-10);
      ctx.fillStyle = Math.random() < 0.5 ? "rgba(255,255,255,.8)" : "rgba(255,220,80,.9)";
      ctx.fillRect(x,y,2,2);
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  function drawPitch(){
    // base
    ctx.fillStyle = "#0b7";
    ctx.fillRect(0,0,W,H);

    // stripes
    ctx.globalAlpha = 0.10;
    for(let i=0;i<11;i++){
      ctx.fillStyle = (i%2===0) ? "#000" : "#fff";
      ctx.fillRect(0, i*(H/11), W, 18);
    }
    ctx.globalAlpha = 1;

    // vignette
    const vg = ctx.createRadialGradient(W/2, H/2, 60, W/2, H/2, 580);
    vg.addColorStop(0, "rgba(0,0,0,0)");
    vg.addColorStop(1, "rgba(0,0,0,.28)");
    ctx.fillStyle = vg;
    ctx.fillRect(0,0,W,H);

    // penalty arc
    ctx.globalAlpha = 0.22;
    ctx.beginPath();
    ctx.arc(W/2, H-210, 150, Math.PI, 0);
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  function drawGoal(){
    // posts
    ctx.lineWidth = 4;
    ctx.strokeStyle = "rgba(255,255,255,.95)";
    ctx.strokeRect(mouth.x, mouth.y, mouth.w, mouth.h);

    // net
    let nsx=0, nsy=0;
    if(netShake>0){
      nsx = (Math.random()*2-1)*2.5;
      nsy = (Math.random()*2-1)*2.5;
      netShake--;
    }
    ctx.globalAlpha = 0.22;
    ctx.fillStyle = "#fff";
    for(let x=mouth.x; x<=mouth.x+mouth.w; x+=14) ctx.fillRect(x+nsx, mouth.y+nsy, 2, mouth.h);
    for(let y=mouth.y; y<=mouth.y+mouth.h; y+=14) ctx.fillRect(mouth.x+nsx, y+nsy, mouth.w, 2);
    ctx.globalAlpha = 1;
  }

  function drawWall(){
    if(!wall.active) return;
    const rects = getWallRects();
    for(const r of rects){
      ctx.fillStyle = "rgba(0,0,0,.40)";
      ctx.fillRect(r.x,r.y,r.w,r.h);
      ctx.beginPath();
      ctx.arc(r.x+r.w/2, r.y-9, 8, 0, Math.PI*2);
      ctx.fillStyle = "rgba(0,0,0,.35)";
      ctx.fill();
      ctx.globalAlpha = 0.25;
      ctx.fillStyle = "#fff";
      ctx.fillRect(r.x+2, r.y+6, r.w-4, 8);
      ctx.globalAlpha = 1;
    }
  }

  function drawKeeper(){
    ctx.save();
    ctx.translate(keeper.x, keeper.y);
    const bob = Math.sin(tick*0.06)*1.2;
    ctx.translate(0,bob);

    // gloves
    ctx.fillStyle = "rgba(255,213,74,.95)";
    ctx.fillRect(-keeper.w/2-10, -keeper.h/2, 10, keeper.h);
    ctx.fillRect(keeper.w/2, -keeper.h/2, 10, keeper.h);

    // body
    ctx.fillStyle = "rgba(15,15,15,.95)";
    ctx.fillRect(-keeper.w/2, -keeper.h/2, keeper.w, keeper.h);

    // shine
    ctx.globalAlpha = 0.25;
    ctx.fillStyle = "#fff";
    ctx.fillRect(-keeper.w/2+6, -keeper.h/2+4, keeper.w-12, 6);
    ctx.globalAlpha = 1;

    ctx.restore();
  }

  function drawBallAt(x,y,rot){
    // shadow
    ctx.save();
    const sh = clamp((y - mouth.y) / (H-mouth.y), 0, 1);
    ctx.globalAlpha = 0.20 + sh*0.20;
    ctx.fillStyle = "#000";
    ctx.beginPath();
    ctx.ellipse(x, y + ball.r + 10, ball.r*0.9, ball.r*0.35, 0, 0, Math.PI*2);
    ctx.fill();
    ctx.restore();

    // ball
    ctx.save();
    ctx.translate(x,y);
    ctx.rotate(rot);
    ctx.beginPath();
    ctx.arc(0,0, ball.r, 0, Math.PI*2);
    ctx.fillStyle = "#f7f7f7";
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = "rgba(0,0,0,.8)";
    ctx.stroke();

    ctx.globalAlpha = 0.22;
    ctx.strokeStyle = "rgba(0,0,0,.9)";
    ctx.lineWidth = 1.5;
    for(let a=0;a<6;a++){
      ctx.beginPath();
      ctx.arc(0,0, ball.r-5, a*Math.PI/3, a*Math.PI/3 + 0.8);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  function drawAim(){
    if(!drag.active || ball.inFlight || replayMode) return;

    const dx = drag.cx - drag.sx;
    const dy = drag.cy - drag.sy;
    const mag = hypot(dx,dy);
    const power = clamp(mag/7.5, 0, 22);
    const spin = clamp(dx/75, -1.4, 1.4);

    ctx.save();
    ctx.globalAlpha = 0.9;
    ctx.lineWidth = 4;
    ctx.strokeStyle = "rgba(255,255,255,.95)";
    ctx.beginPath();
    ctx.moveTo(ball.x, ball.y);
    ctx.lineTo(ball.x - dx, ball.y - dy);
    ctx.stroke();

    const ax = ball.x - dx, ay = ball.y - dy;
    ctx.beginPath();
    ctx.arc(ax, ay, 8, 0, Math.PI*2);
    ctx.fillStyle = "rgba(255,255,255,.95)";
    ctx.fill();

    // mini panel
    ctx.globalAlpha = 1;
    ctx.fillStyle = "rgba(0,0,0,.28)";
    ctx.fillRect(12, H-62, 210, 46);
    ctx.fillStyle = "rgba(255,255,255,.95)";
    ctx.font = "bold 14px Arial";
    ctx.fillText("Güç: " + power.toFixed(1), 22, H-37);
    ctx.fillText("Falso: " + spin.toFixed(2), 22, H-18);

    ctx.restore();
  }

  function drawParticles(){
    ctx.save();
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = "rgba(255,255,255,.95)";
    for(const p of particles) ctx.fillRect(p.x, p.y, 3, 3);
    ctx.restore();
  }

  function drawScoreboard(){
    // Canvas üstü pro scoreboard
    ctx.save();
    ctx.globalAlpha = 0.92;
    ctx.fillStyle = "rgba(0,0,0,.35)";
    ctx.fillRect(12, 12, W-24, 38);
    ctx.globalAlpha = 1;
    ctx.font = "bold 14px Arial";
    ctx.fillStyle = "#fff";
    ctx.fillText(`SKOR ${score}   CAN ${lives}   SERİ ${streak}   SEVİYE ${level}`, 22, 37);

    if(replayMode){
      ctx.globalAlpha = 0.9;
      ctx.fillStyle = "rgba(0,0,0,.35)";
      ctx.fillRect(W-118, 56, 106, 28);
      ctx.fillStyle = "#fff";
      ctx.font = "bold 12px Arial";
      ctx.fillText("REPLAY ▶", W-98, 75);
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  }

  function drawOverlay(){
    if(overlay.t<=0) return;
    const a = Math.min(1, overlay.t/24);
    ctx.save();
    ctx.globalAlpha = a;
    ctx.fillStyle = "rgba(0,0,0,.35)";
    ctx.fillRect(0, H/2-44, W, 88);
    ctx.fillStyle = "#fff";
    ctx.font = "900 28px Arial";
    ctx.textAlign = "center";
    ctx.fillText(overlay.text, W/2, H/2+10);
    ctx.restore();
  }

  function applyCamera(drawFn){
    // zoom + shake
    cam.zoom = lerp(cam.zoom, cam.targetZoom, 0.06);

    let sx=0, sy=0;
    if(cam.shake > 0){
      sx = (Math.random()*2-1)*cam.shake;
      sy = (Math.random()*2-1)*cam.shake;
      cam.shake *= 0.90;
      if(cam.shake < 0.2) cam.shake = 0;
    }

    ctx.save();
    // zoom around center
    ctx.translate(W/2 + sx, H/2 + sy);
    ctx.scale(cam.zoom, cam.zoom);
    ctx.translate(-W/2, -H/2);
    drawFn();
    ctx.restore();
  }

  // ---------- Input ----------
  function getPos(e){
    const r = canvas.getBoundingClientRect();
    return {
      x: (e.clientX - r.left) * (canvas.width / r.width),
      y: (e.clientY - r.top) * (canvas.height / r.height)
    };
  }

  canvas.addEventListener("pointerdown", (e) => {
    if(ball.inFlight || lives<=0 || replayMode) return;
    const p = getPos(e);
    const d = hypot(p.x-ball.x, p.y-ball.y);
    if(d <= ball.r + 12){
      drag.active = true;
      drag.sx = p.x; drag.sy = p.y;
      drag.cx = p.x; drag.cy = p.y;
      canvas.setPointerCapture(e.pointerId);
    }
  });

  canvas.addEventListener("pointermove", (e) => {
    if(!drag.active || ball.inFlight || replayMode) return;
    const p = getPos(e);
    drag.cx = p.x; drag.cy = p.y;
  });

  canvas.addEventListener("pointerup", () => {
    if(!drag.active || ball.inFlight || replayMode) return;
    const dx = drag.cx - drag.sx;
    const dy = drag.cy - drag.sy;
    drag.active = false;
    if(hypot(dx,dy) < 18) return;
    shoot(dx,dy);
  });

  // ---------- Loop ----------
  let tick = 0;

  function stepReplay(){
    if(!replayMode) return;
    replayT -= 2; // faster playback
    if(replayT <= 0){
      replayMode = false;
      cam.targetZoom = 1;
    }
  }

  function drawReplayBall(){
    if(!replayMode) return;
    const idx = Math.max(0, Math.min(replayFrames.length-1, Math.floor(replayT)));
    const f = replayFrames[idx];
    if(f) drawBallAt(f.x, f.y, f.rot);
  }

  function frame(){
    tick++;

    if(overlay.t>0) overlay.t--;

    // camera relax when no flight & no replay
    if(!ball.inFlight && !replayMode) cam.targetZoom = 1;

    // physics steps (only if not replay)
    if(!replayMode){
      stepKeeper();
      stepBall();
      stepParticles();
    } else {
      stepReplay();
      stepParticles();
    }

    // --- render ---
    ctx.clearRect(0,0,W,H);

    applyCamera(() => {
      drawPitch();
      drawCrowd();
      drawGoal();
      drawWall();
      drawKeeper();
      drawParticles();

      if(replayMode){
        // show replay ball instead of live ball
        drawReplayBall();
      } else {
        drawBallAt(ball.x, ball.y, ball.rot);
      }

      drawAim();
      drawOverlay();
      drawScoreboard();
    });

    requestAnimationFrame(frame);
  }

  // ---------- Start ----------
  try{
    resetGame();
    frame();
  } catch(e){
    fatal(e);
  }
})();
