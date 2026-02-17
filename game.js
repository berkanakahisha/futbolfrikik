// Basit Frikik Oyunu (Canvas)
// Kontrol: topu sürükle-bırak. Sürükleme vektörü = güç+yön.

const canvas = document.getElementById("c");
const ctx = canvas.getContext("2d");

const scoreEl = document.getElementById("score");
const livesEl = document.getElementById("lives");
const streakEl = document.getElementById("streak");
document.getElementById("resetBtn").onclick = () => reset(true);

const W = canvas.width, H = canvas.height;

let score = 0, lives = 5, streak = 0;

const goal = { x: W/2, y: 95, w: 260, h: 60 };          // Kale ağzı bölgesi
const goalMouth = { x: goal.x - goal.w/2, y: goal.y, w: goal.w, h: goal.h };

const keeper = { x: W/2, y: goal.y + 22, w: 70, h: 24, vx: 2.2, dir: 1 };

const ballStart = { x: W/2, y: H - 130 };
const ball = { x: ballStart.x, y: ballStart.y, r: 16, vx: 0, vy: 0, inFlight: false };

let drag = { active: false, sx: 0, sy: 0, cx: 0, cy: 0 };
let message = { text: "", t: 0 };

function reset(full=false){
  ball.x = ballStart.x; ball.y = ballStart.y;
  ball.vx = 0; ball.vy = 0; ball.inFlight = false;
  drag.active = false;
  message.text = ""; message.t = 0;
  if(full){
    score = 0; lives = 5; streak = 0;
  }
  syncHud();
}

function syncHud(){
  scoreEl.textContent = score;
  livesEl.textContent = lives;
  streakEl.textContent = streak;
}

function say(txt){
  message.text = txt;
  message.t = 120; // frame
}

function clamp(v, a, b){ return Math.max(a, Math.min(b, v)); }

function drawPitch(){
  // zemin çizgileri
  ctx.clearRect(0,0,W,H);

  // orta çizgiler/hafif desen
  ctx.globalAlpha = 0.18;
  for(let i=0;i<10;i++){
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, i*(H/10), W, 2);
  }
  ctx.globalAlpha = 1;

  // kale direkleri
  ctx.lineWidth = 4;
  ctx.strokeStyle = "#fff";
  ctx.strokeRect(goalMouth.x, goalMouth.y, goalMouth.w, goalMouth.h);

  // file (basit)
  ctx.globalAlpha = 0.25;
  ctx.fillStyle = "#fff";
  for(let x=goalMouth.x; x<=goalMouth.x+goalMouth.w; x+=12){
    ctx.fillRect(x, goalMouth.y, 2, goalMouth.h);
  }
  for(let y=goalMouth.y; y<=goalMouth.y+goalMouth.h; y+=12){
    ctx.fillRect(goalMouth.x, y, goalMouth.w, 2);
  }
  ctx.globalAlpha = 1;

  // penaltı yayı/alanı hissi
  ctx.globalAlpha = 0.25;
  ctx.beginPath();
  ctx.arc(W/2, H-210, 140, Math.PI, 0);
  ctx.strokeStyle = "#fff";
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.globalAlpha = 1;
}

function drawKeeper(){
  ctx.save();
  ctx.translate(keeper.x, keeper.y);
  // gövde
  ctx.fillStyle = "#111";
  ctx.fillRect(-keeper.w/2, -keeper.h/2, keeper.w, keeper.h);
  // eldiven hissi
  ctx.fillStyle = "#ffd54a";
  ctx.fillRect(-keeper.w/2-10, -keeper.h/2, 10, keeper.h);
  ctx.fillRect(keeper.w/2, -keeper.h/2, 10, keeper.h);
  ctx.restore();
}

function drawBall(){
  ctx.beginPath();
  ctx.arc(ball.x, ball.y, ball.r, 0, Math.PI*2);
  ctx.fillStyle = "#f5f5f5";
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = "#111";
  ctx.stroke();

  // küçük desen
  ctx.globalAlpha = 0.35;
  ctx.beginPath();
  ctx.arc(ball.x-5, ball.y-3, 5, 0, Math.PI*2);
  ctx.fillStyle = "#111";
  ctx.fill();
  ctx.globalAlpha = 1;
}

function drawAim(){
  if(!drag.active || ball.inFlight) return;
  const dx = drag.cx - drag.sx;
  const dy = drag.cy - drag.sy;

  // güç göstergesi
  ctx.globalAlpha = 0.85;
  ctx.lineWidth = 4;
  ctx.strokeStyle = "#fff";
  ctx.beginPath();
  ctx.moveTo(ball.x, ball.y);
  ctx.lineTo(ball.x - dx, ball.y - dy);
  ctx.stroke();

  // ok ucu
  const ax = ball.x - dx, ay = ball.y - dy;
  ctx.beginPath();
  ctx.arc(ax, ay, 8, 0, Math.PI*2);
  ctx.fillStyle = "#fff";
  ctx.fill();
  ctx.globalAlpha = 1;

  // güç yazısı
  const power = clamp(Math.hypot(dx,dy)/8, 0, 14);
  ctx.fillStyle = "rgba(0,0,0,.25)";
  ctx.fillRect(12, H-48, 160, 32);
  ctx.fillStyle = "#fff";
  ctx.font = "bold 14px Arial";
  ctx.fillText("Güç: " + power.toFixed(1), 22, H-27);
}

function drawMessage(){
  if(message.t <= 0) return;
  ctx.save();
  ctx.globalAlpha = Math.min(1, message.t/20);
  ctx.fillStyle = "rgba(0,0,0,.35)";
  ctx.fillRect(0, H/2-40, W, 80);
  ctx.fillStyle = "#fff";
  ctx.font = "bold 26px Arial";
  ctx.textAlign = "center";
  ctx.fillText(message.text, W/2, H/2+10);
  ctx.restore();
}

function stepKeeper(){
  // kale içinde sağ-sol hareket
  keeper.x += keeper.vx * keeper.dir;

  const left = goalMouth.x + keeper.w/2;
  const right = goalMouth.x + goalMouth.w - keeper.w/2;

  if(keeper.x < left){ keeper.x = left; keeper.dir = 1; }
  if(keeper.x > right){ keeper.x = right; keeper.dir = -1; }

  // skor arttıkça hızlansın
  keeper.vx = 2.2 + Math.min(3.5, score*0.12);
}

function shoot(dx, dy){
  // sürükleme yönünün tersiyle şut
  const power = clamp(Math.hypot(dx,dy)/8, 2, 14);

  // daha yukarı atmak için dy etkisini biraz artır
  const vx = clamp(-dx / 22, -8, 8);
  const vy = clamp(-dy / 18, -16, -4);

  ball.vx = vx;
  ball.vy = vy - power*0.15;
  ball.inFlight = true;
}

function ballPhysics(){
  if(!ball.inFlight) return;

  // hafif hava direnci
  ball.vx *= 0.995;
  ball.vy *= 0.995;

  ball.x += ball.vx;
  ball.y += ball.vy;

  // uçuş sırasında "yer çekimi"
  ball.vy += 0.08;

  // yanlardan sekmesin, geri sar
  if(ball.x < ball.r){ ball.x = ball.r; ball.vx *= -0.5; }
  if(ball.x > W-ball.r){ ball.x = W-ball.r; ball.vx *= -0.5; }

  // kaleye vardığında kontrol et
 if(ball.y <= goalMouth.y + goalMouth.h){
    resolveShot();
}
  }

  // aşırı aşağı kaçarsa kaçırmış say
  if(ball.y > H + 40){
    miss();
  }
}

function resolveShot(){
  // Kaleci kurtardı mı?
  const keeperRect = {
    x: keeper.x - keeper.w/2,
    y: keeper.y - keeper.h/2,
    w: keeper.w,
    h: keeper.h
  };

  const inKeeper =
    ball.x + ball.r > keeperRect.x &&
    ball.x - ball.r < keeperRect.x + keeperRect.w &&
    ball.y + ball.r > keeperRect.y &&
    ball.y - ball.r < keeperRect.y + keeperRect.h;

  if(inKeeper){
    save();
    return;
  }

  // Gol mü? (kale ağzı içinde - daha toleranslı)
const inGoal =
  ball.x > goalMouth.x &&
  ball.x < goalMouth.x + goalMouth.w &&
  ball.y <= goalMouth.y + goalMouth.h &&
  ball.y >= goalMouth.y - 10;


  if(inGoal){
    goalScored();
  } else {
    miss();
  }
}

function goalScored(){
  ball.inFlight = false;
  score += 1;
  streak += 1;

  // seri bonus
  if(streak > 0 && streak % 3 === 0){
    score += 1; // bonus puan
    say("GOL! +Bonus ⚡");
  } else {
    say("GOOOL! ⚽");
  }
  syncHud();
  setTimeout(()=>reset(false), 500);
}

function save(){
  ball.inFlight = false;
  streak = 0;
  lives -= 1;
  say("KURTARDI! 🧤");
  syncHud();
  endCheck();
  setTimeout(()=>reset(false), 650);
}

function miss(){
  ball.inFlight = false;
  streak = 0;
  lives -= 1;
  say("AUT! 😬");
  syncHud();
  endCheck();
  setTimeout(()=>reset(false), 650);
}

function endCheck(){
  if(lives <= 0){
    say("MAÇ BİTTİ!");
    // küçük kilitleme
    ball.inFlight = false;
    drag.active = false;
    setTimeout(()=>{
      alert(`Oyun bitti!\nSkor: ${score}`);
      reset(true);
    }, 400);
  }
}

// Input (mouse + touch)
function getPos(e){
  const r = canvas.getBoundingClientRect();
  const x = (e.clientX - r.left) * (canvas.width / r.width);
  const y = (e.clientY - r.top) * (canvas.height / r.height);
  return {x,y};
}

canvas.addEventListener("pointerdown", (e)=>{
  if(ball.inFlight || lives<=0) return;

  const p = getPos(e);
  const dist = Math.hypot(p.x - ball.x, p.y - ball.y);
  if(dist <= ball.r + 10){
    drag.active = true;
    drag.sx = p.x; drag.sy = p.y;
    drag.cx = p.x; drag.cy = p.y;
    canvas.setPointerCapture(e.pointerId);
  }
});

canvas.addEventListener("pointermove", (e)=>{
  if(!drag.active || ball.inFlight) return;
  const p = getPos(e);
  drag.cx = p.x; drag.cy = p.y;
});

canvas.addEventListener("pointerup", (e)=>{
  if(!drag.active || ball.inFlight) return;
  const dx = drag.cx - drag.sx;
  const dy = drag.cy - drag.sy;

  drag.active = false;

  // çok küçük sürükleme ise şut sayma
  if(Math.hypot(dx,dy) < 18) return;
  shoot(dx, dy);
});

function loop(){
  drawPitch();
  stepKeeper();
  drawKeeper();
  ballPhysics();
  drawBall();
  drawAim();
  if(message.t > 0) message.t -= 1;
  drawMessage();
  requestAnimationFrame(loop);
}

reset(true);
loop();
