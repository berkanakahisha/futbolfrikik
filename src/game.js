// Kargo & Kaçış - minimal roguelite arena shooter (Canvas)
// Kontroller: WASD hareket, Shift dash, Mouse nişan, Sol tık ateş, Space kart seçimi ekranında "devam"
// Kalıcı coin + shop: Başlangıç ekranında tıklayarak kalıcı stat al.

const canvas = document.getElementById("c");
const ctx = canvas.getContext("2d");

function resize() {
  canvas.width = Math.floor(window.innerWidth * devicePixelRatio);
  canvas.height = Math.floor(window.innerHeight * devicePixelRatio);
  canvas.style.width = window.innerWidth + "px";
  canvas.style.height = window.innerHeight + "px";
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.scale(devicePixelRatio, devicePixelRatio);
}
window.addEventListener("resize", resize);
resize();

const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const dist2 = (ax, ay, bx, by) => (ax - bx) ** 2 + (ay - by) ** 2;

const keys = new Set();
window.addEventListener("keydown", (e) => {
  keys.add(e.code);
  if (["ArrowUp","ArrowDown","ArrowLeft","ArrowRight","Space"].includes(e.code)) e.preventDefault();
});
window.addEventListener("keyup", (e) => keys.delete(e.code));

const mouse = { x: 0, y: 0, down: false, clicked: false };
window.addEventListener("mousemove", (e) => { mouse.x = e.clientX; mouse.y = e.clientY; });
window.addEventListener("mousedown", () => { mouse.down = true; mouse.clicked = true; });
window.addEventListener("mouseup", () => { mouse.down = false; });

/* ------------------ Persistent (localStorage) ------------------ */
const SAVE_KEY = "kargo_kacis_save_v1";
function loadSave() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return { coins: 100000, perm: { hp: 0, dmg: 0, spd: 0 } };
    const s = JSON.parse(raw);
    if (!s.perm) s.perm = { hp: 0, dmg: 0, spd: 0 };
    return s;
  } catch {
    return { coins: 100000, perm: { hp: 0, dmg: 0, spd: 0 } };
  }
}
function saveSave() { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); }
let save = loadSave();

/* ------------------ Game State ------------------ */
const STATE = { MENU: "menu", PLAY: "play", UPGRADE: "upgrade", DEAD: "dead" };
let state = STATE.MENU;

let tPrev = performance.now();
let dt = 0;

const world = { w: 2400, h: 1400 }; // arena boyutu (kamera takip ediyor)

function makePlayer() {
  const base = {
    x: world.w / 2, y: world.h / 2,
    r: 14,
    vx: 0, vy: 0,
    hp: 100, maxHp: 100,
    speed: 260,
    dashCd: 0, dashTime: 0,
    invuln: 0,
    fireCd: 0,
    damage: 18,
    fireRate: 7.0, // shots/sec
    bulletSpeed: 650,
    bulletLife: 0.9,
    pierce: 0,
    multishot: 0,
    lifesteal: 0, // 0..0.2
    magnet: 0,    // coin çekim
    // run stats
    coinsRun: 0,
    score: 0
  };

  // Kalıcı upgrade etkileri:
  base.maxHp += save.perm.hp * 10;
  base.hp = base.maxHp;
  base.damage *= (1 + save.perm.dmg * 0.06);
  base.speed *= (1 + save.perm.spd * 0.05);

  return base;
}

let player = makePlayer();
let bullets = [];
let enemies = [];
let coins = [];
let particles = [];

let wave = 0;
let waveClear = false;
let waveTimer = 0;

/* ------------------ Camera ------------------ */
const cam = { x: 0, y: 0 };
function worldToScreen(wx, wy) {
  return { x: wx - cam.x, y: wy - cam.y };
}
function screenToWorld(sx, sy) {
  return { x: sx + cam.x, y: sy + cam.y };
}

/* ------------------ Entities ------------------ */
function spawnEnemy(type, count = 1) {
  for (let i = 0; i < count; i++) {
    // arena kenarına yakın spawn
    const side = Math.floor(rand(0, 4));
    let x, y;
    if (side === 0) { x = rand(40, world.w - 40); y = 40; }
    if (side === 1) { x = rand(40, world.w - 40); y = world.h - 40; }
    if (side === 2) { x = 40; y = rand(40, world.h - 40); }
    if (side === 3) { x = world.w - 40; y = rand(40, world.h - 40); }

    const e = { x, y, vx:0, vy:0, hitCd:0, type };
    if (type === "chaser") {
      e.r = 16; e.hp = 45 + wave * 6; e.speed = 155 + wave * 4;
      e.dmg = 14 + wave * 1.2; e.value = 2;
    } else if (type === "shooter") {
      e.r = 15; e.hp = 35 + wave * 5; e.speed = 120 + wave * 2;
      e.dmg = 10 + wave * 1.0; e.value = 3;
      e.shootCd = rand(0.4, 1.1);
    } else if (type === "tank") {
      e.r = 22; e.hp = 120 + wave * 12; e.speed = 90 + wave * 1.2;
      e.dmg = 22 + wave * 1.6; e.value = 5;
    }
    enemies.push(e);
  }
}

function emit(x, y, n = 8, sp = 140) {
  for (let i = 0; i < n; i++) {
    const a = rand(0, Math.PI * 2);
    const v = rand(sp * 0.4, sp);
    particles.push({ x, y, vx: Math.cos(a)*v, vy: Math.sin(a)*v, life: rand(0.25, 0.6) });
  }
}

function dropCoins(x, y, amount) {
  for (let i = 0; i < amount; i++) {
    coins.push({ x: x + rand(-8, 8), y: y + rand(-8, 8), r: 6, vx: rand(-40,40), vy: rand(-40,40), life: 20 });
  }
}

/* ------------------ Upgrade Cards ------------------ */
const cardPool = [
  { id:"dmg", name:"+%15 Hasar", desc:"Vuruşların daha sert.", apply: p => p.damage *= 1.15 },
  { id:"fir", name:"+%18 Atış Hızı", desc:"Daha sık ateş.", apply: p => p.fireRate *= 1.18 },
  { id:"spd", name:"+%10 Hareket", desc:"Daha çevik.", apply: p => p.speed *= 1.10 },
  { id:"hp",  name:"+25 Max Can", desc:"Daha dayanıklı.", apply: p => { p.maxHp += 25; p.hp += 25; } },
  { id:"bsp", name:"+%15 Mermi Hızı", desc:"Daha hızlı mermi.", apply: p => p.bulletSpeed *= 1.15 },
  { id:"prc", name:"+1 Delme", desc:"Mermi 1 düşmanı deler.", apply: p => p.pierce += 1 },
  { id:"ms",  name:"Çift Atış", desc:"Her atışta 1 mermi daha.", apply: p => p.multishot += 1 },
  { id:"ls",  name:"Can Çalma", desc:"Hasarın %6'sı can olur.", apply: p => p.lifesteal = Math.min(0.2, p.lifesteal + 0.06) },
  { id:"mag", name:"Mıknatıs", desc:"Coin’ler daha uzaktan gelir.", apply: p => p.magnet += 70 },
];

let cards = [];
let selectedCard = -1;
function pickCards() {
  const arr = [...cardPool];
  // shuffle
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  cards = arr.slice(0, 3);
  selectedCard = -1;
}

/* ------------------ Permanent Shop ------------------ */
const shopItems = [
  {
    key: "hp", title: "Kalıcı +10 Max Can",
    cost: lvl => 35 + lvl * 30,
    buy: () => { save.perm.hp++; }
  },
  {
    key: "dmg", title: "Kalıcı +%6 Hasar",
    cost: lvl => 45 + lvl * 40,
    buy: () => { save.perm.dmg++; }
  },
  {
    key: "spd", title: "Kalıcı +%5 Hız",
    cost: lvl => 40 + lvl * 35,
    buy: () => { save.perm.spd++; }
  },
];

function resetRun() {
  player = makePlayer();
  bullets = [];
  enemies = [];
  coins = [];
  particles = [];
  wave = 0;
  waveClear = false;
  waveTimer = 0;
}

/* ------------------ Combat ------------------ */
function shoot() {
  if (player.fireCd > 0) return;

  const pw = { x: player.x, y: player.y };
  const mw = screenToWorld(mouse.x, mouse.y);
  const ang = Math.atan2(mw.y - pw.y, mw.x - pw.x);

  const shots = 1 + player.multishot;
  const spread = Math.min(0.28, 0.08 + shots * 0.03);

  for (let i = 0; i < shots; i++) {
    const off = (i - (shots - 1) / 2) * spread;
    const a = ang + off;
    bullets.push({
      x: pw.x + Math.cos(a) * (player.r + 4),
      y: pw.y + Math.sin(a) * (player.r + 4),
      vx: Math.cos(a) * player.bulletSpeed,
      vy: Math.sin(a) * player.bulletSpeed,
      r: 4,
      life: player.bulletLife,
      dmg: player.damage,
      pierce: player.pierce
    });
  }

  player.fireCd = 1 / player.fireRate;
}

/* ------------------ Waves ------------------ */
function startNextWave() {
  wave++;
  waveClear = false;
  waveTimer = 0;

  const base = 5 + wave * 2;
  spawnEnemy("chaser", base);
  if (wave >= 2) spawnEnemy("shooter", Math.floor(wave * 1.2));
  if (wave >= 3) spawnEnemy("tank", Math.floor(wave * 0.7));

  // küçük heal bonusu
  player.hp = Math.min(player.maxHp, player.hp + 10);
}

/* ------------------ Update Loop ------------------ */
function update(dt) {
  // camera follow
  cam.x = clamp(player.x - window.innerWidth / 2, 0, world.w - window.innerWidth);
  cam.y = clamp(player.y - window.innerHeight / 2, 0, world.h - window.innerHeight);

  // particles
  for (const p of particles) {
    p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt;
    p.vx *= Math.pow(0.01, dt); p.vy *= Math.pow(0.01, dt);
  }
  particles = particles.filter(p => p.life > 0);

  if (state !== STATE.PLAY) return;

  // cooldowns
  player.fireCd = Math.max(0, player.fireCd - dt);
  player.dashCd = Math.max(0, player.dashCd - dt);
  player.dashTime = Math.max(0, player.dashTime - dt);
  player.invuln = Math.max(0, player.invuln - dt);

  // movement
  let ax = 0, ay = 0;
  if (keys.has("KeyW")) ay -= 1;
  if (keys.has("KeyS")) ay += 1;
  if (keys.has("KeyA")) ax -= 1;
  if (keys.has("KeyD")) ax += 1;
  const al = Math.hypot(ax, ay) || 1;
  ax /= al; ay /= al;

  const sp = player.speed * (player.dashTime > 0 ? 2.15 : 1.0);
  player.vx = ax * sp;
  player.vy = ay * sp;

  // dash
  if (keys.has("ShiftLeft") || keys.has("ShiftRight")) {
    if (player.dashCd <= 0 && (ax !== 0 || ay !== 0)) {
      player.dashCd = 1.2;
      player.dashTime = 0.18;
      player.invuln = 0.22;
      emit(player.x, player.y, 12, 220);
    }
  }

  player.x = clamp(player.x + player.vx * dt, player.r, world.w - player.r);
  player.y = clamp(player.y + player.vy * dt, player.r, world.h - player.r);

  // shooting
  if (mouse.down) shoot();

  // bullets
  for (const b of bullets) {
    b.x += b.vx * dt; b.y += b.vy * dt; b.life -= dt;
  }
  bullets = bullets.filter(b => b.life > 0 && b.x > -50 && b.y > -50 && b.x < world.w + 50 && b.y < world.h + 50);

  // enemies AI + collisions
  const px = player.x, py = player.y;
  for (const e of enemies) {
    e.hitCd = Math.max(0, e.hitCd - dt);

    const dx = px - e.x, dy = py - e.y;
    const d = Math.hypot(dx, dy) || 1;
    const nx = dx / d, ny = dy / d;

    if (e.type === "chaser" || e.type === "tank") {
      e.vx = nx * e.speed;
      e.vy = ny * e.speed;
    } else if (e.type === "shooter") {
      // belirli mesafede durup ateş et
      const desired = 340;
      const k = clamp((d - desired) / 220, -1, 1);
      e.vx = nx * e.speed * k;
      e.vy = ny * e.speed * k;

      e.shootCd -= dt;
      if (e.shootCd <= 0) {
        e.shootCd = rand(0.9, 1.6);
        // enemy bullet: hızlı ve küçük
        const a = Math.atan2(py - e.y, px - e.x);
        bullets.push({
          x: e.x + Math.cos(a) * (e.r + 6),
          y: e.y + Math.sin(a) * (e.r + 6),
          vx: Math.cos(a) * 520,
          vy: Math.sin(a) * 520,
          r: 3.5,
          life: 1.4,
          dmg: e.dmg * 0.7,
          pierce: -999, // enemy bullet marker
          enemy: true
        });
      }
    }

    e.x = clamp(e.x + e.vx * dt, e.r, world.w - e.r);
    e.y = clamp(e.y + e.vy * dt, e.r, world.h - e.r);

    // enemy touch dmg
    if (player.invuln <= 0 && dist2(e.x, e.y, px, py) < (e.r + player.r) ** 2) {
      player.hp -= e.dmg;
      player.invuln = 0.45;
      emit(px, py, 16, 260);
    }
  }

  // bullet hits
  for (const b of bullets) {
    if (b.enemy) {
      if (player.invuln <= 0 && dist2(b.x, b.y, player.x, player.y) < (b.r + player.r) ** 2) {
        player.hp -= b.dmg;
        player.invuln = 0.35;
        b.life = -1;
        emit(player.x, player.y, 10, 220);
      }
      continue;
    }

    for (const e of enemies) {
      if (e.hp <= 0) continue;
      if (dist2(b.x, b.y, e.x, e.y) < (b.r + e.r) ** 2) {
        e.hp -= b.dmg;
        e.hitCd = 0.07;
        emit(b.x, b.y, 6, 170);

        // lifesteal
        if (player.lifesteal > 0) {
          player.hp = Math.min(player.maxHp, player.hp + b.dmg * player.lifesteal);
        }

        if (b.pierce > 0) {
          b.pierce--;
          // mermi biraz zayıflasın
          b.dmg *= 0.92;
        } else {
          b.life = -1;
        }

        break;
      }
    }
  }
  bullets = bullets.filter(b => b.life > 0);

  // cleanup dead enemies + rewards
  const alive = [];
  for (const e of enemies) {
    if (e.hp > 0) { alive.push(e); continue; }

    player.score += Math.round(10 + wave * 2);
    const c = e.value;
    player.coinsRun += c;
    dropCoins(e.x, e.y, Math.min(6, c));
    emit(e.x, e.y, 18, 240);
  }
  enemies = alive;

  // coin physics + magnet pickup
  for (const c of coins) {
    c.x += c.vx * dt; c.y += c.vy * dt;
    c.vx *= Math.pow(0.02, dt); c.vy *= Math.pow(0.02, dt);
    c.life -= dt;

    const mrad = 70 + player.magnet;
    const d2 = dist2(c.x, c.y, player.x, player.y);
    if (d2 < mrad * mrad) {
      const d = Math.sqrt(d2) || 1;
      const nx = (player.x - c.x) / d;
      const ny = (player.y - c.y) / d;
      c.vx += nx * (900 * dt);
      c.vy += ny * (900 * dt);
    }

    if (d2 < (c.r + player.r) ** 2) {
      // pickup: run coin zaten düşman ölünce eklendi; burada sadece "parçacık/feedback"
      c.life = -1;
      particles.push({ x: c.x, y: c.y, vx: 0, vy: -40, life: 0.4, text:"+1" });
    }
  }
  coins = coins.filter(c => c.life > 0);

  // wave progression
  if (!waveClear && enemies.length === 0) {
    waveClear = true;
    waveTimer = 0.0;
  }
  if (waveClear) {
    waveTimer += dt;
    if (waveTimer > 0.65) {
      // upgrade screen
      pickCards();
      state = STATE.UPGRADE;
    }
  }

  // death
  if (player.hp <= 0) {
    state = STATE.DEAD;
    // run coin’i kalıcı coin’e ekle
    save.coins += player.coinsRun;
    saveSave();
  }
}

/* ------------------ Rendering ------------------ */
function drawText(s, x, y, size = 16, align = "left", alpha = 1) {
  ctx.globalAlpha = alpha;
  ctx.fillStyle = "#e7eef9";
  ctx.font = `${size}px system-ui, -apple-system, Segoe UI, Roboto, Arial`;
  ctx.textAlign = align;
  ctx.fillText(s, x, y);
  ctx.globalAlpha = 1;
}

function draw() {
  // clear
  ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);

  // background grid
  ctx.save();
  ctx.translate(-cam.x % 64, -cam.y % 64);
  ctx.globalAlpha = 0.18;
  ctx.strokeStyle = "#2a3550";
  for (let x = 0; x < window.innerWidth + 64; x += 64) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, window.innerHeight + 64); ctx.stroke();
  }
  for (let y = 0; y < window.innerHeight + 64; y += 64) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(window.innerWidth + 64, y); ctx.stroke();
  }
  ctx.restore();
  ctx.globalAlpha = 1;

  // arena border
  const tl = worldToScreen(0, 0);
  ctx.strokeStyle = "#3a486b";
  ctx.lineWidth = 3;
  ctx.strokeRect(tl.x, tl.y, world.w, world.h);

  // entities (world->screen)
  // coins
  for (const c of coins) {
    const s = worldToScreen(c.x, c.y);
    ctx.fillStyle = "#ffd166";
    ctx.beginPath(); ctx.arc(s.x, s.y, c.r, 0, Math.PI * 2); ctx.fill();
  }

  // bullets
  for (const b of bullets) {
    const s = worldToScreen(b.x, b.y);
    ctx.fillStyle = b.enemy ? "#ff4d6d" : "#9be7ff";
    ctx.beginPath(); ctx.arc(s.x, s.y, b.r, 0, Math.PI * 2); ctx.fill();
  }

  // enemies
  for (const e of enemies) {
    const s = worldToScreen(e.x, e.y);
    let col = "#a7c957";
    if (e.type === "shooter") col = "#b392f0";
    if (e.type === "tank") col = "#ffafcc";
    if (e.hitCd > 0) col = "#ffffff";
    ctx.fillStyle = col;
    ctx.beginPath(); ctx.arc(s.x, s.y, e.r, 0, Math.PI * 2); ctx.fill();

    // tiny hp bar
    const w = e.r * 2;
    const hp = clamp(e.hp / (e.type === "tank" ? (120 + wave * 12) : (e.type === "chaser" ? (45 + wave * 6) : (35 + wave * 5))), 0, 1);
    ctx.globalAlpha = 0.85;
    ctx.fillStyle = "#0b0f14";
    ctx.fillRect(s.x - w/2, s.y - e.r - 12, w, 6);
    ctx.fillStyle = "#e7eef9";
    ctx.fillRect(s.x - w/2, s.y - e.r - 12, w * hp, 6);
    ctx.globalAlpha = 1;
  }

  // player
  {
    const s = worldToScreen(player.x, player.y);
    ctx.fillStyle = player.invuln > 0 ? "#6c757d" : "#48cae4";
    ctx.beginPath(); ctx.arc(s.x, s.y, player.r, 0, Math.PI * 2); ctx.fill();

    // aim line
    const mw = screenToWorld(mouse.x, mouse.y);
    const ang = Math.atan2(mw.y - player.y, mw.x - player.x);
    ctx.strokeStyle = "#9be7ff";
    ctx.globalAlpha = 0.25;
    ctx.beginPath();
    ctx.moveTo(s.x, s.y);
    ctx.lineTo(s.x + Math.cos(ang) * 70, s.y + Math.sin(ang) * 70);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  // particles
  for (const p of particles) {
    const s = worldToScreen(p.x, p.y);
    if (p.text) {
      drawText(p.text, s.x, s.y, 14, "center", p.life / 0.4);
    } else {
      ctx.globalAlpha = clamp(p.life / 0.6, 0, 1);
      ctx.fillStyle = "#e7eef9";
      ctx.beginPath(); ctx.arc(s.x, s.y, 2.2, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;
    }
  }

  // HUD
  const pad = 16;
  // hp bar
  const bw = 280, bh = 18;
  ctx.fillStyle = "#0b0f14";
  ctx.globalAlpha = 0.7;
  ctx.fillRect(pad, pad, bw, bh);
  ctx.globalAlpha = 1;
  ctx.fillStyle = "#e7eef9";
  ctx.fillRect(pad, pad, bw * clamp(player.hp / player.maxHp, 0, 1), bh);
  drawText(`CAN: ${Math.ceil(player.hp)}/${player.maxHp}`, pad + 8, pad + 14, 13);

  drawText(`DALGA: ${wave}`, pad, pad + 46, 15);
  drawText(`SKOR: ${player.score}`, pad, pad + 68, 15);
  drawText(`RUN COIN: ${player.coinsRun}`, pad, pad + 90, 15);
  drawText(`KALICI COIN: ${save.coins}`, pad, pad + 112, 13, "left", 0.9);

  // state overlays
  if (state === STATE.MENU) drawMenu();
  if (state === STATE.UPGRADE) drawUpgrade();
  if (state === STATE.DEAD) drawDead();
}

function drawPanel(x, y, w, h, alpha = 0.86) {
  ctx.globalAlpha = alpha;
  ctx.fillStyle = "#0b0f14";
  ctx.fillRect(x, y, w, h);
  ctx.globalAlpha = 1;
  ctx.strokeStyle = "#3a486b";
  ctx.lineWidth = 2;
  ctx.strokeRect(x, y, w, h);
}

let menuButtons = []; // for click detection
function drawMenu() {
  const w = Math.min(720, window.innerWidth - 40);
  const h = 420;
  const x = (window.innerWidth - w) / 2;
  const y = (window.innerHeight - h) / 2;

  drawPanel(x, y, w, h);
  drawText("KARGO & KAÇIŞ", x + w/2, y + 46, 34, "center");
  drawText("Basit roguelite arena shooter • GitHub Pages uyumlu", x + w/2, y + 76, 14, "center", 0.85);

  // Start button
  const bx = x + 26, by = y + 110, bw = w - 52, bh = 54;
  ctx.fillStyle = "#141c28";
  ctx.fillRect(bx, by, bw, bh);
  ctx.strokeStyle = "#48cae4";
  ctx.strokeRect(bx, by, bw, bh);
  drawText("OYUNA BAŞLA", bx + bw/2, by + 36, 20, "center");

  menuButtons = [{ id:"start", x:bx, y:by, w:bw, h:bh }];

  // Shop
  drawText("Kalıcı Upgrade Shop (coin harca)", x + 26, y + 196, 16, "left", 0.9);

  const rowY = y + 214;
  const rowH = 54;
  for (let i = 0; i < shopItems.length; i++) {
    const it = shopItems[i];
    const lvl = save.perm[it.key] ?? 0;
    const cost = it.cost(lvl);
    const ry = rowY + i * (rowH + 12);
    const rx = x + 26;
    const rw = w - 52;

    const affordable = save.coins >= cost;
    ctx.fillStyle = affordable ? "#141c28" : "#101622";
    ctx.fillRect(rx, ry, rw, rowH);
    ctx.strokeStyle = affordable ? "#ffd166" : "#3a486b";
    ctx.strokeRect(rx, ry, rw, rowH);

    drawText(`${it.title}`, rx + 14, ry + 22, 16);
    drawText(`Seviye: ${lvl}  •  Ücret: ${cost} coin`, rx + 14, ry + 44, 13, "left", 0.85);
    drawText(affordable ? "SATIN AL" : "YETERSİZ COIN", rx + rw - 14, ry + 36, 14, "right", affordable ? 1 : 0.6);

    menuButtons.push({ id:`buy_${it.key}`, x:rx, y:ry, w:rw, h:rowH });
  }

  drawText("Kontroller: WASD, Shift(dash), Sol tık(ateş)", x + w/2, y + h - 22, 13, "center", 0.85);
}

function drawUpgrade() {
  const w = Math.min(860, window.innerWidth - 40);
  const h = 360;
  const x = (window.innerWidth - w) / 2;
  const y = (window.innerHeight - h) / 2;

  drawPanel(x, y, w, h);
  drawText(`DALGA ${wave} TEMİZLENDİ`, x + w/2, y + 46, 26, "center");
  drawText("1 kart seç: (Kartın üstüne tıkla)", x + w/2, y + 76, 14, "center", 0.85);

  const cardW = (w - 60) / 3;
  const cardH = 200;
  const cy = y + 110;

  menuButtons = [];

  for (let i = 0; i < 3; i++) {
    const c = cards[i];
    const cx = x + 20 + i * (cardW + 10);

    ctx.fillStyle = i === selectedCard ? "#172235" : "#111826";
    ctx.fillRect(cx, cy, cardW, cardH);
    ctx.strokeStyle = i === selectedCard ? "#ffd166" : "#3a486b";
    ctx.strokeRect(cx, cy, cardW, cardH);

    drawText(c.name, cx + cardW/2, cy + 40, 18, "center");
    drawText(c.desc, cx + cardW/2, cy + 74, 13, "center", 0.85);

    // küçük "preview"
    const preview = {
      dmg: `Hasar → ${Math.round(player.damage)} → ${Math.round(player.damage * 1.15)}`,
      fir: `Atış/sn → ${player.fireRate.toFixed(1)} → ${(player.fireRate*1.18).toFixed(1)}`,
      spd: `Hız → ${Math.round(player.speed)} → ${Math.round(player.speed*1.10)}`,
      hp:  `Can → ${player.maxHp} → ${player.maxHp + 25}`,
      bsp: `Mermi hızı → ${Math.round(player.bulletSpeed)} → ${Math.round(player.bulletSpeed*1.15)}`,
      prc: `Delme → ${player.pierce} → ${player.pierce + 1}`,
      ms:  `Ek mermi → ${player.multishot} → ${player.multishot + 1}`,
      ls:  `Can çalma → %${Math.round(player.lifesteal*100)} → %${Math.round(Math.min(0.2, player.lifesteal+0.06)*100)}`,
      mag: `Mıknatıs → ${Math.round(player.magnet)} → ${Math.round(player.magnet+70)}`
    }[c.id] ?? "";

    drawText(preview, cx + cardW/2, cy + 126, 13, "center", 0.9);

    drawText("SEÇ", cx + cardW/2, cy + 172, 14, "center", 0.75);

    menuButtons.push({ id:`card_${i}`, x:cx, y:cy, w:cardW, h:cardH });
  }

  // continue hint
  drawText("Seçince otomatik devam eder", x + w/2, y + h - 26, 13, "center", 0.85);
}

function drawDead() {
  const w = Math.min(680, window.innerWidth - 40);
  const h = 300;
  const x = (window.innerWidth - w) / 2;
  const y = (window.innerHeight - h) / 2;

  drawPanel(x, y, w, h);
  drawText("RUN BİTTİ", x + w/2, y + 56, 34, "center");
  drawText(`Dalga: ${wave}  •  Skor: ${player.score}`, x + w/2, y + 98, 16, "center", 0.9);
  drawText(`Kazandığın coin: ${player.coinsRun}  •  Kalıcı coin: ${save.coins}`, x + w/2, y + 128, 15, "center", 0.9);

  const bx = x + 26, by = y + 170, bw = w - 52, bh = 54;
  ctx.fillStyle = "#141c28";
  ctx.fillRect(bx, by, bw, bh);
  ctx.strokeStyle = "#48cae4";
  ctx.strokeRect(bx, by, bw, bh);
  drawText("MENÜYE DÖN", bx + bw/2, by + 36, 20, "center");

  menuButtons = [{ id:"back", x:bx, y:by, w:bw, h:bh }];
}

/* ------------------ Input (Click) ------------------ */
function handleClick() {
  if (!mouse.clicked) return;
  mouse.clicked = false;

  const mx = mouse.x, my = mouse.y;
  const hit = menuButtons.find(b => mx >= b.x && mx <= b.x + b.w && my >= b.y && my <= b.y + b.h);
  if (!hit) return;

  if (state === STATE.MENU) {
    if (hit.id === "start") {
      resetRun();
      state = STATE.PLAY;
      startNextWave();
      return;
    }
    if (hit.id.startsWith("buy_")) {
      const key = hit.id.replace("buy_", "");
      const it = shopItems.find(s => s.key === key);
      if (!it) return;
      const lvl = save.perm[key] ?? 0;
      const cost = it.cost(lvl);
      if (save.coins >= cost) {
        save.coins -= cost;
        it.buy();
        saveSave();
      }
      return;
    }
  }

  if (state === STATE.UPGRADE) {
    if (hit.id.startsWith("card_")) {
      const idx = Number(hit.id.replace("card_", ""));
      selectedCard = idx;
      const c = cards[idx];
      c.apply(player);
      // bir sonraki dalga
      state = STATE.PLAY;
      startNextWave();
      return;
    }
  }

  if (state === STATE.DEAD) {
    if (hit.id === "back") {
      state = STATE.MENU;
      return;
    }
  }
}

/* ------------------ Main Loop ------------------ */
function loop(now) {
  dt = Math.min(0.033, (now - tPrev) / 1000);
  tPrev = now;

  handleClick();
  update(dt);
  draw();

  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
