/*  Frikik Ustası — Pro game.js (Boş ekranı engelleyen sağlam sürüm)
    Uyumlu HTML id'leri:
    canvas#c, #score, #lives, #streak, #level, #resetBtn
*/

(() => {
  // -------------------- Safe boot helpers --------------------
  const $ = (id) => document.getElementById(id);

  const canvas = $("c");
  const scoreEl = $("score");
  const livesEl = $("lives");
  const streakEl = $("streak");
  const levelEl = $("level");
  const resetBtn = $("resetBtn");

  if (!canvas) {
    alert("Hata: canvas#c bulunamadı. index.html içinde <canvas id='c'> olmalı.");
    return;
  }

  const ctx = canvas.getContext("2d", { alpha: false });

  function showFatal(err) {
    console.error(err);
    const msg = (err && err.stack) ? err.stack : String(err);

    // draw red overlay on canvas
    try {
      ctx.save();
      ctx.fillStyle = "#111";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = "#c00";
      ctx.fillRect(0, 0, canvas.width, 80);
      ctx.fillStyle = "#fff";
      ctx.font = "bold 16px Arial";
      ctx.fillText("game.js hata verdi (boş ekran olmaz):", 12, 28);
      ctx.font = "12px Arial";
      wrapText(msg, 12, 54, canvas.width - 24, 14);
      ctx.restore();
    } catch {}
  }

  function wrapText(text, x, y, maxWidth, lineHeight) {
    const words = String(text).split(/\s+/);
    let line = "";
    for (let n = 0; n < words.length; n++) {
      const test = line + words[n] + " ";
      const w = ctx.measureText(test).width;
      if (w > maxWidth && n > 0) {
        ctx.fillText(line, x, y);
        line = words[n] + " ";
        y += lineHeight;
        if (y > canvas.height - 10) return;
      } else {
        line = test;
      }
    }
    ctx.fillText(line, x, y);
  }

  // -------------------- Math utils --------------------
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const rand = (a, b) => a + Math.random() * (b - a);
  const hypot = Math.hypot;

  // -------------------- Game constants --------------------
  const W = canvas.width;
  const H = canvas.height;

  const goal = { x: W / 2, y: 90, w: 290, h: 78 };
  const mouth = { x: goal.x - goal.w / 2, y: goal.y, w: goal.w, h: goal.h };

  const ballStart = { x: W / 2, y: H - 130 };

  // Target zones (for “pro feel” + scoring variety)
  const zones = [
    { name: "Sol Üst",  x: mouth.x + 35,              y: mouth.y + 12, w: 60, h: 40, mult: 2 },
    { name: "Sağ Üst",  x: mouth.x + mouth.w - 95,    y: mouth.y + 12, w: 60, h: 40, mult: 2 },
    { name: "Orta",     x: mouth.x + mouth.w/2 - 35,  y: mouth.y + 18, w: 70, h: 45, mult: 1 },
  ];

  // -------------------- State --------------------
  let score = 0, lives = 5, streak = 0, level = 1;

  const keeper = {
    x: W / 2,
    y: mouth.y + 30,
    w: 78,
    h: 26,
    baseSpeed: 2.4,
    speed: 2.4,
    dir: 1,
    mode: "patrol", // patrol | dive | recover
    diveT: 0,
    diveVX: 0,
  };

  const wall = {
    active: true,
    x: W / 2,
    y: mouth.y + 140,
    cols: 4,
    spacing: 28,
    w: 16,
    h: 50,
    sway: 0,
    swayDir: 1,
  };

  const ball = {
    x: ballStart.x,
    y: ballStart.y,
    r: 16,
    vx: 0,
    vy: 0,
    spin: 0,     // falso
    rot: 0,
    inFlight: false
  };

  const drag = { active: false, sx: 0, sy: 0, cx: 0, cy: 0 };

  const fx = {
    msg: "",
    msgT: 0,
    netShake: 0,
    camShake: 0,
    particles: []
  };

  let tick = 0;
  let freeze = 0;

  // -------------------- HUD --------------------
  function syncHud() {
    if (scoreEl) scoreEl.textContent = String(score);
    if (livesEl) livesEl.textContent = String(lives);
    if (streakEl) streakEl.textContent = String(streak);
    if (levelEl) levelEl.textContent = String(level);
  }

  function say(text) {
    fx.msg = text;
    fx.msgT = 120;
  }

  function updateDifficulty() {
    level = 1 + Math.floor(score / 5);
    keeper.speed = keeper.baseSpeed + Math.min(4.0, level * 0.35);

    // Wall chance: early levels more frequent, later still mixed
    const wallChance = clamp(0.65 + level * 0.02, 0.65, 0.85);
    wall.active = Math.random() < wallChance;
  }

  // -------------------- Reset --------------------
  function resetShot() {
    ball.x = ballStart.x;
    ball.y = ballStart.y;
    ball.vx = 0; ball.vy = 0; ball.spin = 0; ball.rot = 0;
    ball.inFlight = false;
    drag.active = false;

    keeper.x = W/2;
    keeper.mode = "patrol";
    keeper.diveT = 0;
    keeper.diveVX = 0;

    wall.sway = 0; wall.swayDir = 1;

    updateDifficulty();
    syncHud();
  }

  function resetGame() {
    score = 0; lives = 5; streak = 0; level = 1;
    fx.particles.length = 0;
    fx.netShake = 0; fx.camShake = 0;
    fx.msg = ""; fx.msgT = 0;
    resetShot();
  }

  if (resetBtn) resetBtn.addEventListener("click", resetGame);

  // -------------------- Collisions --------------------
  function circleRectHit(cx, cy, cr, rx, ry, rw, rh) {
    const px = clamp(cx, rx, rx + rw);
    const py = clamp(cy, ry, ry + rh);
    const dx = cx - px, dy = cy - py;
    return (dx * dx + dy * dy) <= cr * cr;
  }

  function rectContains(r, x, y) {
    return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
  }

  // -------------------- Particles --------------------
  function spawnParticles(x, y, n = 22) {
    for (let i = 0; i < n; i++) {
      fx.particles.push({
        x, y,
        vx: rand(-3.6, 3.6),
        vy: rand(-3.6, 3.6),
        life: rand(28, 55)
      });
    }
  }

  function stepParticles() {
    for (let i = fx.particles.length - 1; i >= 0; i--) {
      const p = fx.particles[i];
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.07;
      p.vx *= 0.98;
      p.vy *= 0.98;
      p.life -= 1;
      if (p.life <= 0) fx.particles.splice(i, 1);
    }
  }

  // -------------------- Keeper AI --------------------
  function planDive() {
    // Rough predict x at goal line
    let tx = ball.x, ty = ball.y;
    let tvx = ball.vx, tvy = ball.vy, tspin = ball.spin;

    for (let i = 0; i < 46; i++) {
      tvx += tspin * 0.08;
      tspin *= 0.994;
      tvx *= 0.992; tvy *= 0.992;
      tx += tvx; ty += tvy;
      tvy += 0.11;
      if (ty <= mouth.y + mouth.h + 6) break;
    }

    const left = mouth.x + keeper.w / 2;
    const right = mouth.x + mouth.w - keeper.w / 2;
    const targetX = clamp(tx, left, right);

    const likelyIn = (tx > mouth.x - 20 && tx < mouth.x + mouth.w + 20);
    const diveChance = clamp(0.45 + level * 0.06, 0.45, 0.82);

    keeper.mode = "patrol";
    keeper.diveT = 0;
    keeper.diveVX = 0;

    if (likelyIn && Math.random() < diveChance) {
      keeper.mode = "dive";
      keeper.diveT = 22;
      keeper.diveVX = clamp((targetX - keeper.x) * 0.10, -9, 9);
    }
  }

  function stepKeeper() {
    const left = mouth.x + keeper.w / 2;
    const right = mouth.x + mouth.w - keeper.w / 2;

    if (keeper.mode === "dive") {
      keeper.x += keeper.diveVX;
      keeper.diveT--;
      if (keeper.diveT <= 0) {
        keeper.mode = "recover";
        keeper.diveT = 18;
      }
    } else if (keeper.mode === "recover") {
      keeper.x = lerp(keeper.x, W/2, 0.08);
      keeper.diveT--;
      if (keeper.diveT <= 0) keeper.mode = "patrol";
    } else {
      keeper.x += keeper.speed * keeper.dir;
      if (keeper.x < left) { keeper.x = left; keeper.dir = 1; }
      if (keeper.x > right) { keeper.x = right; keeper.dir = -1; }
    }

    keeper.x = clamp(keeper.x, left, right);
  }

  // -------------------- Wall --------------------
  function getWallRects() {
    if (!wall.active) return [];
    wall.sway += 0.02 * wall.swayDir * (1 + level * 0.12);
    if (Math.abs(wall.sway) > 0.35) wall.swayDir *= -1;

    const rects = [];
    const total = (wall.cols - 1) * wall.spacing;
    const startX = wall.x - total / 2;

    for (let i = 0; i < wall.cols; i++) {
      const x = startX + i * wall.spacing + Math.sin(tick * 0.02 + i) * 2;
      const y = wall.y + Math.cos(tick * 0.03 + i) * 1.5;
      rects.push({ x: x - wall.w/2, y: y - wall.h/2, w: wall.w, h: wall.h });
    }
    return rects;
  }

  // -------------------- Shot physics --------------------
  function shoot(dx, dy) {
    const mag = hypot(dx, dy);
    const power = clamp(mag / 9, 3, 16);

    let vx = clamp(-dx / 24, -9.5, 9.5);
    let vy = clamp(-dy / 20, -18, -6);

    vy -= power * 0.32;
    vx *= (0.85 + power * 0.02);

    ball.vx = vx;
    ball.vy = vy;
    ball.spin = clamp(dx / 90, -1.25, 1.25) * (0.7 + power * 0.03);
    ball.inFlight = true;

    planDive();
  }

  function stepBall() {
    if (!ball.inFlight) return;

    // curve
    ball.vx += ball.spin * 0.08;
    ball.spin *= 0.994;

    // drag
    ball.vx *= 0.992;
    ball.vy *= 0.992;

    // move
    ball.x += ball.vx;
    ball.y += ball.vy;

    // rotate visually
    ball.rot += ball.vx * 0.02;

    // gravity
    ball.vy += 0.11;

    // side bounds
    if (ball.x < ball.r) { ball.x = ball.r; ball.vx *= -0.55; ball.spin *= -0.6; }
    if (ball.x > W - ball.r) { ball.x = W - ball.r; ball.vx *= -0.55; ball.spin *= -0.6; }

    // wall collision
    if (wall.active && ball.y < wall.y + 45 && ball.y > wall.y - 70) {
      const rects = getWallRects();
      for (const r of rects) {
        if (circleRectHit(ball.x, ball.y, ball.r, r.x, r.y, r.w, r.h)) {
          ball.vy *= -0.35;
          ball.vx *= 0.65;
          ball.spin *= 0.6;
          fx.camShake = Math.max(fx.camShake, 3.2);
          spawnParticles(ball.x, ball.y, 18);
          wall.swayDir *= -1;
          break;
        }
      }
    }

    // goal-line check
    if (ball.y <= mouth.y + mouth.h + 6) resolveShot();

    // miss if falls too far
    if (ball.y > H + 60) miss("AUT! 😬");
  }

  function resolveShot() {
    if (!ball.inFlight) return;
    ball.inFlight = false;

    const keeperRect = {
      x: keeper.x - keeper.w/2 - 10,
      y: keeper.y - keeper.h/2 - 4,
      w: keeper.w + 20,
      h: keeper.h + 8
    };

    const keeperHit = circleRectHit(ball.x, ball.y, ball.r, keeperRect.x, keeperRect.y, keeperRect.w, keeperRect.h);

    const inGoal =
      ball.x >= mouth.x + 2 &&
      ball.x <= mouth.x + mouth.w - 2 &&
      ball.y <= mouth.y + mouth.h + 6 &&
      ball.y >= mouth.y - 18;

    if (keeperHit) {
      save();
      return;
    }

    if (inGoal) {
      goalScored();
    } else {
      miss("AUT! 😬");
    }
  }

  function goalScored() {
    streak += 1;

    // zone bonus
    let zoneMult = 1;
    for (const z of zones) {
      if (rectContains(z, ball.x, ball.y)) zoneMult = Math.max(zoneMult, z.mult);
    }

    const comboBonus = (streak % 3 === 0) ? 1 : 0;
    const levelBonus = Math.floor(level / 3);

    score += (1 * zoneMult) + comboBonus + levelBonus;

    fx.netShake = 20;
    fx.camShake = Math.max(fx.camShake, 4.0);
    spawnParticles(ball.x, ball.y, 28);

    say(zoneMult >= 2 ? "KÖŞE GOLÜ! ⚡" : (comboBonus ? "GOOOL! +BONUS ⚡" : "GOOOL! ⚽"));
    freeze = 6;

    updateDifficulty();
    syncHud();

    setTimeout(resetShot, 520);
  }

  function save() {
    streak = 0;
    lives -= 1;
    fx.camShake = Math.max(fx.camShake, 2.8);
    spawnParticles(ball.x, ball.y, 16);
    say("KURTARDI! 🧤");
    syncHud();
    endCheck();
    setTimeout(resetShot, 650);
  }

  function miss(text) {
    streak = 0;
    lives -= 1;
    say(text);
    syncHud();
    endCheck();
    setTimeout(resetShot, 650);
  }

  function endCheck() {
    if (lives <= 0) {
      say("MAÇ BİTTİ!");
      setTimeout(() => {
        alert(`Oyun bitti!\nSkor: ${score}\nSeviye: ${level}`);
        resetGame();
      }, 450);
    }
  }

  // -------------------- Drawing --------------------
  function withCamera(drawFn) {
    let sx = 0, sy = 0;
    if (fx.camShake > 0) {
      sx = (Math.random()*2 - 1) * fx.camShake;
      sy = (Math.random()*2 - 1) * fx.camShake;
      fx.camShake *= 0.90;
      if (fx.camShake < 0.2) fx.camShake = 0;
    }
    ctx.save();
    ctx.translate(sx, sy);
    drawFn();
    ctx.restore();
  }

  function drawPitch() {
    // base
    ctx.fillStyle = "#0b7";
    ctx.fillRect(0, 0, W, H);

    // stripes
    ctx.globalAlpha = 0.10;
    for (let i = 0; i < 9; i++) {
      ctx.fillStyle = i % 2 ? "#000" : "#fff";
      ctx.fillRect(0, i * (H / 9), W, 18);
    }
    ctx.globalAlpha = 1;

    // vignette
    const g = ctx.createRadialGradient(W/2, H/2, 60, W/2, H/2, 560);
    g.addColorStop(0, "rgba(0,0,0,0)");
    g.addColorStop(1, "rgba(0,0,0,.25)");
    ctx.fillStyle = g;
    ctx.fillRect(0,0,W,H);

    // penalty arc
    ctx.globalAlpha = 0.25;
    ctx.beginPath();
    ctx.arc(W/2, H-210, 150, Math.PI, 0);
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  function drawGoal() {
    // goal frame
    ctx.lineWidth = 4;
    ctx.strokeStyle = "rgba(255,255,255,.95)";
    ctx.strokeRect(mouth.x, mouth.y, mouth.w, mouth.h);

    // net (shake on goal)
    let nsx = 0, nsy = 0;
    if (fx.netShake > 0) {
      nsx = (Math.random()*2 - 1) * 2.5;
      nsy = (Math.random()*2 - 1) * 2.5;
      fx.netShake--;
    }

    ctx.globalAlpha = 0.22;
    ctx.fillStyle = "#fff";
    for (let x = mouth.x; x <= mouth.x + mouth.w; x += 14) {
      ctx.fillRect(x + nsx, mouth.y + nsy, 2, mouth.h);
    }
    for (let y = mouth.y; y <= mouth.y + mouth.h; y += 14) {
      ctx.fillRect(mouth.x + nsx, y + nsy, mouth.w, 2);
    }
    ctx.globalAlpha = 1;

    // target zones (subtle)
    ctx.globalAlpha = 0.10;
    for (const z of zones) {
      ctx.fillStyle = "#fff";
      ctx.fillRect(z.x, z.y, z.w, z.h);
    }
    ctx.globalAlpha = 1;
  }

  function drawWall() {
    if (!wall.active) return;
    const rects = getWallRects();
    for (const r of rects) {
      // body
      ctx.fillStyle = "rgba(0,0,0,.40)";
      ctx.fillRect(r.x, r.y, r.w, r.h);
      // head
      ctx.beginPath();
      ctx.arc(r.x + r.w/2, r.y - 9, 8, 0, Math.PI*2);
      ctx.fillStyle = "rgba(0,0,0,.35)";
      ctx.fill();
      // highlight
      ctx.globalAlpha = 0.25;
      ctx.fillStyle = "#fff";
      ctx.fillRect(r.x + 2, r.y + 6, r.w - 4, 8);
      ctx.globalAlpha = 1;
    }
  }

  function drawKeeper() {
    ctx.save();
    ctx.translate(keeper.x, keeper.y);
    const bob = Math.sin(tick * 0.06) * 1.2;
    ctx.translate(0, bob);

    // gloves
    ctx.fillStyle = "rgba(255,213,74,.95)";
    ctx.fillRect(-keeper.w/2 - 10, -keeper.h/2, 10, keeper.h);
    ctx.fillRect(keeper.w/2, -keeper.h/2, 10, keeper.h);

    // body
    ctx.fillStyle = "rgba(15,15,15,.95)";
    ctx.fillRect(-keeper.w/2, -keeper.h/2, keeper.w, keeper.h);

    // shine
    ctx.globalAlpha = 0.25;
    ctx.fillStyle = "#fff";
    ctx.fillRect(-keeper.w/2 + 6, -keeper.h/2 + 4, keeper.w - 12, 6);
    ctx.globalAlpha = 1;

    ctx.restore();
  }

  function drawBall() {
    // shadow
    ctx.save();
    const sh = clamp((ball.y - mouth.y) / (H - mouth.y), 0, 1);
    ctx.globalAlpha = 0.22 + sh * 0.22;
    ctx.fillStyle = "#000";
    ctx.beginPath();
    ctx.ellipse(ball.x, ball.y + ball.r + 10, ball.r*0.9, ball.r*0.35, 0, 0, Math.PI*2);
    ctx.fill();
    ctx.restore();

    // ball
    ctx.save();
    ctx.translate(ball.x, ball.y);
    ctx.rotate(ball.rot);
    ctx.beginPath();
    ctx.arc(0, 0, ball.r, 0, Math.PI*2);
    ctx.fillStyle = "#f7f7f7";
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = "rgba(0,0,0,.8)";
    ctx.stroke();

    // panels
    ctx.globalAlpha = 0.22;
    ctx.strokeStyle = "rgba(0,0,0,.9)";
    ctx.lineWidth = 1.5;
    for (let a = 0; a < 6; a++) {
      ctx.beginPath();
      ctx.arc(0, 0, ball.r - 5, a*Math.PI/3, a*Math.PI/3 + 0.8);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  function drawAim() {
    if (!drag.active || ball.inFlight) return;

    const dx = drag.cx - drag.sx;
    const dy = drag.cy - drag.sy;
    const mag = hypot(dx, dy);
    const power = clamp(mag / 9, 0, 16);
    const spin = clamp(dx / 90, -1.2, 1.2);

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
    ctx.fillRect(12, H - 62, 196, 46);
    ctx.fillStyle = "rgba(255,255,255,.95)";
    ctx.font = "bold 14px Arial";
    ctx.fillText("Güç: " + power.toFixed(1), 22, H - 37);
    ctx.fillText("Falso: " + spin.toFixed(2), 22, H - 18);

    ctx.restore();
  }

  function drawParticles() {
    ctx.save();
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = "rgba(255,255,255,.95)";
    for (const p of fx.particles) {
      ctx.fillRect(p.x, p.y, 3, 3);
    }
    ctx.restore();
  }

  function drawOverlay() {
    if (fx.msgT <= 0) return;
    const alpha = Math.min(1, fx.msgT / 24);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = "rgba(0,0,0,.35)";
    ctx.fillRect(0, H/2 - 44, W, 88);
    ctx.fillStyle = "#fff";
    ctx.font = "900 28px Arial";
    ctx.textAlign = "center";
    ctx.fillText(fx.msg, W/2, H/2 + 10);
    ctx.restore();
  }

  // -------------------- Input --------------------
  function getPos(e) {
    const r = canvas.getBoundingClientRect();
    return {
      x: (e.clientX - r.left) * (canvas.width / r.width),
      y: (e.clientY - r.top) * (canvas.height / r.height),
    };
  }

  canvas.addEventListener("pointerdown", (e) => {
    if (ball.inFlight || lives <= 0) return;
    const p = getPos(e);
    const dist = hypot(p.x - ball.x, p.y - ball.y);
    if (dist <= ball.r + 12) {
      drag.active = true;
      drag.sx = p.x; drag.sy = p.y;
      drag.cx = p.x; drag.cy = p.y;
      canvas.setPointerCapture(e.pointerId);
    }
  });

  canvas.addEventListener("pointermove", (e) => {
    if (!drag.active || ball.inFlight) return;
    const p = getPos(e);
    drag.cx = p.x; drag.cy = p.y;
  });

  canvas.addEventListener("pointerup", (e) => {
    if (!drag.active || ball.inFlight) return;
    const dx = drag.cx - drag.sx;
    const dy = drag.cy - drag.sy;
    drag.active = false;
    if (hypot(dx, dy) < 18) return;
    shoot(dx, dy);
  });

  // -------------------- Main loop --------------------
  function frame() {
    tick++;

    // freeze after goal for impact
    if (freeze > 0) freeze--;

    ctx.clearRect(0, 0, W, H);

    withCamera(() => {
      drawPitch();
      drawGoal();
      drawWall();
      drawKeeper();

      if (freeze <= 0) {
        stepKeeper();
        stepBall();
        stepParticles();
      }

      drawParticles();
      drawBall();
      drawAim();

      if (fx.msgT > 0) fx.msgT--;
      drawOverlay();
    });

    requestAnimationFrame(frame);
  }

  // -------------------- Start --------------------
  try {
    resetGame();
    frame();
  } catch (e) {
    showFatal(e);
  }
})();
