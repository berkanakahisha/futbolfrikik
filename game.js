import { clamp, rand, hypot, mulberry32 } from "./utils.js";
import { loadSave, saveSave, loadSettings, saveRunCache, loadRunCache, clearRunCache } from "./storage.js";
import { sfx } from "./audio.js";
import { biomeForWave, drawBiomeBG, hazardUpdate, hazardPlayerEffect, drawHazards } from "./biomes.js";
import { makeAchState, achOnEvent, achCheckUnlocks, ACH } from "./achievements.js";
import { makeLoadout, applyLoadoutToPlayer, computedWeaponStats, homingAdjust } from "./weapons.js";
import { submitScore } from "./leaderboard.js";

export function createGame(canvas){
  const ctx = canvas.getContext("2d");
  let ui=null;

  const state = {
    W: innerWidth, H: innerHeight,
    modeState:"menu", // menu / play / pause / upgrade / dead
    run:{ mode:"custom", seed:0, code:"C-000000" },
    rng: Math.random,
    save: loadSave(),
    settings: loadSettings(),

    // feel
    shake:0, shakeT:0, hitStop:0,

    // world
    player:null,
    bullets:[],
    enemies:[],
    particles:[],
    rings:[],
    hazard:{ ionT:0, ionPulse:0, ionFields:[] },

    // progression
    wave:1,
    waveState:"fight", // fight/boss
    waveBudget:0,
    waveSpawned:0,
    spawnT:0,
    clearT:0,

    boss:null,
    bossNoHit:true,

    // cards
    cards:[],
    selected:-1,

    // achievements
    ach: makeAchState(),

    // loadout
    loadout: makeLoadout(),

    // cosmetics
    cosmetics: null,

    // last result
    last:{mode:"",code:"",score:0,wave:0,coins:0},
  };

  function resize(){
    state.W=canvas.width=innerWidth;
    state.H=canvas.height=innerHeight;
  }
  addEventListener("resize", resize);

  // Input
  const keys={};
  const mouse={x:0,y:0,down:false,clicked:false};
  addEventListener("keydown", (e)=>{
    keys[e.code]=true;
    if(["Space","ArrowUp","ArrowDown","ArrowLeft","ArrowRight"].includes(e.code)) e.preventDefault();

    if(e.code==="KeyP"){
      if(state.modeState==="play"){ pause(); }
      else if(state.modeState==="pause"){ resume(); }
    }
  });
  addEventListener("keyup",(e)=>keys[e.code]=false);
  addEventListener("mousemove",(e)=>{ mouse.x=e.clientX; mouse.y=e.clientY; });
  addEventListener("mousedown",()=>{ mouse.down=true; mouse.clicked=true; });
  addEventListener("mouseup",()=>mouse.down=false);

  function setUI(u){ ui=u; }
  function W(){ return state.W; }
  function H(){ return state.H; }
  function mode(){ return state.modeState; }

  function addShake(p=6,t=0.08){
    const mul = state.settings?.shake ?? 0.7;
    p*=mul; t*=mul;
    state.shake=Math.max(state.shake,p);
    state.shakeT=Math.max(state.shakeT,t);
  }
  function addHitStop(t=0.03){ state.hitStop=Math.max(state.hitStop,t); }

  // player
  function makePlayer(){
    const p={
      x: state.W/2, y: state.H/2,
      r:14,
      hp:120, maxHp:120,
      speed:320,
      invuln:0,
      fireCd:0,
      dashCd:0, dashT:0,
      ultCd:0,

      dmg:22,
      fireRate:8.0,
      bulletSpeed:760,
      bulletLife:1.05,
      multishot:0,
      pierce:0,
      ric:0,
      crit:0.05,
      critMul:1.6,
      lifesteal:0,

      shield:20,
      shieldMax:20,
      shieldRegen:1,

      ionSlow:0,

      score:0,
      runCoins:0,
      revives: state.save.perm.revive || 0,

      combo:0, comboT:0, dmgBonus:0,
    };

    // perm
    p.maxHp += (state.save.perm.hp||0)*10;
    p.hp = p.maxHp;
    p.dmg *= (1 + (state.save.perm.dmg||0)*0.06);
    p.speed *= (1 + (state.save.perm.spd||0)*0.05);

    // apply loadout
    applyLoadoutToPlayer(p, state.loadout);

    return p;
  }

  // enemies
  function spawnEnemy(type="chaser", elite=false){
    const side=Math.floor(state.rng()*4);
    let x,y;
    if(side===0){x=state.rng()*state.W; y=-60;}
    if(side===1){x=state.W+60; y=state.rng()*state.H;}
    if(side===2){x=state.rng()*state.W; y=state.H+60;}
    if(side===3){x=-60; y=state.rng()*state.H;}

    const biome = state.biome;
    const mod = biome.enemyMod;

    const e={x,y,hitT:0,type,elite:false,mod:null,cloakT:0,slowT:0,shootCd:0,shield:0,shieldMax:0};

    if(type==="chaser"){
      e.r=14;
      e.maxHp=(44 + state.wave*5.4)*mod.hpMul;
      e.hp=e.maxHp;
      e.speed=(135 + state.wave*4.6)*mod.speedMul;
      e.dmg=13 + state.wave*1.05;
      e.col="rgba(255,77,109,0.95)"; e.glow="rgba(255,77,109,0.9)";
      e.value=10;
    } else if(type==="shooter"){
      e.r=13;
      e.maxHp=(34 + state.wave*4.6)*mod.hpMul;
      e.hp=e.maxHp;
      e.speed=(105 + state.wave*2.6)*mod.speedMul;
      e.dmg=10 + state.wave*0.85;
      e.col="rgba(179,146,240,0.95)"; e.glow="rgba(179,146,240,0.9)";
      e.value=14;
      e.shootCd=0.9 + state.rng()*0.7;
    } else {
      e.r=20;
      e.maxHp=(120 + state.wave*12)*mod.hpMul;
      e.hp=e.maxHp;
      e.speed=(78 + state.wave*1.2)*mod.speedMul;
      e.dmg=22 + state.wave*1.4;
      e.col="rgba(255,175,204,0.95)"; e.glow="rgba(255,175,204,0.9)";
      e.value=22;
    }

    // elite (more readable, not too punishing)
    const eliteChance = clamp(0.10 + state.wave*0.004, 0.10, 0.18);
    if(elite || state.rng()<eliteChance){
      e.elite=true;
      const mods=["shielded","berserk","splitter","cloaked"];
      e.mod = mods[Math.floor(state.rng()*mods.length)];
      e.maxHp*=1.25; e.hp=e.maxHp;
      e.value=Math.round(e.value*1.8);

      if(e.mod==="berserk"){
        e.speed*=1.35; e.dmg*=1.12; e.glow="rgba(255,209,102,0.95)";
      } else if(e.mod==="shielded"){
        e.shieldMax = Math.round(30 + state.wave*6);
        e.shield = e.shieldMax;
        e.glow="rgba(155,231,255,0.95)";
      } else if(e.mod==="cloaked"){
        e.glow="rgba(80,220,255,0.9)";
        e.cloakT=0.9;
      } else {
        e.glow="rgba(255,209,102,0.95)";
      }
    }

    state.enemies.push(e);
  }

  // boss
  function spawnBoss(){
    state.boss={
      x: state.W/2, y:-160,
      r:64,
      hp:1100 + state.wave*120,
      maxHp:1100 + state.wave*120,
      phase:1,
      shootT:0.6,
      patT:0,
      hitT:0,
      dronesT:2.2,
    };
    state.bossNoHit = true;
    achOnEvent(state.ach, {type:"boss_start"});
  }

  function startWave(w){
    state.wave=w;
    state.biome = biomeForWave(w);

    state.waveState = (w%5===0) ? "boss" : "fight";
    state.enemies.length=0;
    state.bullets.length=0;
    state.rings.length=0;

    state.spawnT=0;
    state.clearT=0;
    state.hazard.ionFields.length=0;

    if(state.waveState==="boss"){
      state.waveBudget=0; state.waveSpawned=0;
      state.boss=null;
      spawnBoss();
      sfx(110,0.12,0.08,"sawtooth");
      addShake(10,0.18);
    } else {
      state.boss=null;

      // arcade-relaxed wave length
      state.waveBudget = Math.floor(7 + w*2.1);
      state.waveSpawned = 0;

      const first = Math.min(5, state.waveBudget);
      for(let i=0;i<first;i++){ spawnEnemy("chaser"); state.waveSpawned++; }
    }
  }

  // cards: big-phase4 (weapon + mod slot + stats)
  function buildCardPool(){
    const pool = [
      { id:"dmg", name:"+%15 Hasar", desc:"Daha sert vuruş.", apply:()=>state.player.dmg*=1.15 },
      { id:"fir", name:"+%18 Atış Hızı", desc:"Daha sık ateş.", apply:()=>state.player.fireRate*=1.18 },
      { id:"spd", name:"+%10 Hız", desc:"Daha çevik.", apply:()=>state.player.speed*=1.10 },
      { id:"hp",  name:"+25 Max Can", desc:"Daha dayanıklı.", apply:()=>{state.player.maxHp+=25; state.player.hp+=25;} },
      { id:"ms",  name:"Multishot +1", desc:"Her atış +1 mermi.", apply:()=>state.player.multishot+=1 },
      { id:"prc", name:"+1 Delme", desc:"Mermi 1 hedef deler.", apply:()=>state.player.pierce+=1 },
      { id:"ric", name:"+1 Sekme", desc:"Duvara çarpınca seker.", apply:()=>state.player.ric+=1 },
      { id:"crt", name:"+%8 Kritik", desc:"Kritik şansı artar.", apply:()=>state.player.crit=Math.min(0.6,state.player.crit+0.08) },
      { id:"crm", name:"Kritik Çarpanı +0.4", desc:"Kritik daha güçlü.", apply:()=>state.player.critMul+=0.4 },
      { id:"ls",  name:"Can Çalma", desc:"Hasarın %6'sı can.", apply:()=>state.player.lifesteal=Math.min(0.22,state.player.lifesteal+0.06) },

      // weapon pick
      { id:"wp_p", name:"Weapon: Pulse", desc:"Stabil, dengeli.", apply:()=>{state.loadout.weapon="PULSE";} },
      { id:"wp_s", name:"Weapon: Scatter", desc:"Yakın dövüş, saçma.", apply:()=>{state.loadout.weapon="SCATTER";} },
      { id:"wp_l", name:"Weapon: Laser", desc:"Hızlı ve düz.", apply:()=>{state.loadout.weapon="LASER";} },
      { id:"wp_r", name:"Weapon: Rocket", desc:"Patlayıcı ve yavaş.", apply:()=>{state.loadout.weapon="ROCKET";} },

      // mod slot installs (fixed choices)
      { id:"m_burst", name:"Mod(Barrel): Burst", desc:"+2 shot, -%10 dmg", apply:()=>{ state.loadout.slots.barrel="B_BARREL_BURST"; } },
      { id:"m_tight", name:"Mod(Barrel): Tight Choke", desc:"Spread -%35", apply:()=>{ state.loadout.slots.barrel="B_BARREL_TIGHT"; } },
      { id:"m_rail",  name:"Mod(Core): Rail Core", desc:"Speed +%25, life -%10", apply:()=>{ state.loadout.slots.core="C_CORE_RAIL"; } },
      { id:"m_prism", name:"Mod(Core): Prism Core", desc:"Laser split", apply:()=>{ state.loadout.slots.core="C_CORE_PRISM"; } },
      { id:"m_home",  name:"Mod(Utility): Homing", desc:"Rocket hafif takip", apply:()=>{ state.loadout.slots.utility="U_UTIL_HOMING"; } },
      { id:"m_clu",   name:"Mod(Utility): Cluster", desc:"Impact shrapnel", apply:()=>{ state.loadout.slots.utility="U_UTIL_CLUSTER"; } },
      { id:"m_over",  name:"Mod(Utility): Overcharge", desc:"+%12 dmg", apply:()=>{ state.loadout.slots.utility="U_UTIL_OVERCHARGE"; } },
    ];
    return pool;
  }

  function pickCards(){
    const extra = state.save.perm.cards || 0;
    const count = 3 + Math.min(2, extra);
    const pool = buildCardPool();

    // shuffle with run rng (seeded)
    for(let i=pool.length-1;i>0;i--){
      const j = Math.floor(state.rng()*(i+1));
      [pool[i],pool[j]]=[pool[j],pool[i]];
    }
    state.cards = pool.slice(0,count);
    state.selected = -1;
  }

  function applyCard(i){
    const c=state.cards[i]; if(!c) return;
    c.apply();
    // apply loadout to player after changes
    applyLoadoutToPlayer(state.player, state.loadout);
    sfx(520,0.03,0.03,"triangle");
  }

  // bullets
  function shootPlayer(){
    if(state.player.fireCd>0) return;

    const p=state.player;
    const ang=Math.atan2(mouse.y-p.y, mouse.x-p.x);
    const w = computedWeaponStats(p);

    const shots = w.shots;
    const spread = w.spread;
    for(let i=0;i<shots;i++){
      const off = (i-(shots-1)/2)*spread;
      const a = ang + off;

      const dmg = (p.dmg * w.dmgMul) * (1 + p.dmgBonus);
      const sp = p.bulletSpeed*w.speedMul;

      state.bullets.push({
        x: p.x + Math.cos(a)*(p.r+10),
        y: p.y + Math.sin(a)*(p.r+10),
        vx: Math.cos(a)*sp,
        vy: Math.sin(a)*sp,
        r: (p.weapon==="ROCKET") ? 5.2 : 4.2,
        life: p.bulletLife*w.lifeMul,
        dmg,
        enemy:false,
        pierce:p.pierce,
        ric:p.ric,
        hitSet:new Set(),
        splash:w.splash||0,
        weapon:p.weapon,
        homing: !!p.modHoming && p.weapon==="ROCKET",
        cluster: !!p.modCluster && p.weapon==="ROCKET",
        trail:[]
      });
    }
    p.fireCd = 1/p.fireRate;

    if(Math.random()<0.65) sfx(520+(state.rng()*80-40),0.03,0.03,"triangle");
  }

  function enemyShoot(x,y, ang, dmg, sp=480){
    state.bullets.push({
      x,y,
      vx:Math.cos(ang)*sp,
      vy:Math.sin(ang)*sp,
      r:3.4,
      life:1.6,
      dmg,
      enemy:true,
      trail:[]
    });
    if(Math.random()<0.55) sfx(210,0.03,0.02,"square");
  }

  function burst(x,y, col="rgba(255,255,255,0.9)", n=14, sp=260, size=3, life=0.45, glow=12){
    for(let i=0;i<n;i++){
      const a=state.rng()*Math.PI*2;
      const v=(0.35+state.rng()*0.65)*sp;
      state.particles.push({x,y,vx:Math.cos(a)*v,vy:Math.sin(a)*v,life:(0.6+state.rng()*0.4)*life,size:(0.6+state.rng()*0.8)*size,col,glow});
    }
  }

  function onKill(e, weapon){
    const p=state.player;
    p.combo++; p.comboT=2.8;
    p.dmgBonus = clamp(p.combo*0.012, 0, 0.22);
    p.runCoins += e.elite ? 4 : 2;

    achOnEvent(state.ach, {type:"kill", elite:!!e.elite, weapon});
    if(e.elite) addHitStop(0.045);

    if(e.elite){
      burst(e.x,e.y,"rgba(255,209,102,0.95)", 30, 620, 3.6, 0.60, 20);
    } else {
      burst(e.x,e.y,"rgba(255,77,109,0.85)", 18, 480, 3.2, 0.50, 16);
    }
  }

  function hurtPlayer(d){
    const p=state.player;
    if(p.shield>0){
      const take=Math.min(p.shield,d);
      p.shield-=take; d-=take;
      if(d<=0) return;
    }
    if(p.invuln>0) return;
    p.hp -= d;
    p.invuln = 0.45;
    addShake(10,0.10);
    addHitStop(0.03);
    burst(p.x,p.y,"rgba(255,77,109,0.9)", 18, 360, 3.2, 0.45, 14);
    sfx(170,0.06,0.05,"square");

    state.bossNoHit = false;
    achOnEvent(state.ach, {type:"player_hit"});
    p.combo=0; p.comboT=0; p.dmgBonus=0;
  }

  function explodeRocket(b){
    const R=b.splash||0;
    if(R<=0) return;
    for(const e2 of state.enemies){
      const dd=hypot(e2.x-b.x, e2.y-b.y);
      if(dd<R){
        e2.hp -= b.dmg*0.35*(1-dd/R);
        e2.hitT=0.05;
      }
    }
    if(state.boss){
      const dd=hypot(state.boss.x-b.x, state.boss.y-b.y);
      if(dd<R+40) state.boss.hp -= b.dmg*0.18;
    }
    burst(b.x,b.y,"rgba(255,209,102,0.9)", 16, 520, 3.0, 0.45, 18);
    addShake(6,0.08);

    if(b.cluster){
      // shrapnel
      for(let i=0;i<6;i++){
        const a = state.rng()*Math.PI*2;
        const sp=680;
        state.bullets.push({
          x:b.x, y:b.y,
          vx:Math.cos(a)*sp,
          vy:Math.sin(a)*sp,
          r:3.4, life:0.55,
          dmg:b.dmg*0.20,
          enemy:false,
          pierce:0, ric:0,
          hitSet:new Set(),
          splash:0,
          weapon:"ROCKET",
          trail:[]
        });
      }
    }
  }

  // draw helpers
  function drawText(text,x,y,size=14,align="left",a=1){
    ctx.globalAlpha=a;
    ctx.fillStyle="#e7eef9";
    ctx.font=`${size}px system-ui,-apple-system,Segoe UI,Roboto,Arial`;
    ctx.textAlign=align;
    ctx.fillText(text,x,y);
    ctx.globalAlpha=1;
  }

  function drawShip(x,y,ang,scale,body,glow,wing="rgba(10,22,45,0.85)", flame=true, flash=false){
    ctx.save();
    ctx.translate(x,y);
    ctx.rotate(ang);
    ctx.shadowBlur=18*scale;
    ctx.shadowColor=glow;

    ctx.fillStyle = flash ? "rgba(255,255,255,0.95)" : body;
    ctx.beginPath();
    ctx.moveTo(22*scale,0);
    ctx.lineTo(-12*scale,10*scale);
    ctx.lineTo(-6*scale,0);
    ctx.lineTo(-12*scale,-10*scale);
    ctx.closePath();
    ctx.fill();

    ctx.shadowBlur=12*scale;
    ctx.shadowColor=glow;
    ctx.fillStyle=wing;
    ctx.beginPath();
    ctx.moveTo(6*scale,0); ctx.lineTo(-10*scale,16*scale); ctx.lineTo(-6*scale,8*scale);
    ctx.closePath(); ctx.fill();
    ctx.beginPath();
    ctx.moveTo(6*scale,0); ctx.lineTo(-10*scale,-16*scale); ctx.lineTo(-6*scale,-8*scale);
    ctx.closePath(); ctx.fill();

    ctx.shadowBlur=22*scale;
    ctx.shadowColor="rgba(255,255,255,0.6)";
    ctx.fillStyle="rgba(20,28,40,0.95)";
    ctx.beginPath(); ctx.ellipse(6*scale,0,6*scale,4*scale,0,0,Math.PI*2); ctx.fill();

    if(flame){
      ctx.shadowBlur=24*scale;
      ctx.shadowColor="rgba(255,140,0,0.9)";
      ctx.fillStyle="rgba(255,120,0,0.85)";
      ctx.beginPath();
      ctx.moveTo(-14*scale,0);
      ctx.lineTo(-28*scale,7*scale);
      ctx.lineTo(-20*scale,0);
      ctx.lineTo(-28*scale,-7*scale);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }

  function drawCrosshair(){
    const c = state.save.cosmetics.crosshair;
    const x=mouse.x, y=mouse.y;
    ctx.save();
    ctx.globalAlpha=0.75;
    ctx.strokeStyle="rgba(155,231,255,0.9)";
    ctx.lineWidth=2;
    if(c==="dot"){
      ctx.beginPath(); ctx.arc(x,y,3,0,Math.PI*2); ctx.stroke();
    } else if(c==="plus"){
      ctx.beginPath(); ctx.moveTo(x-8,y); ctx.lineTo(x+8,y); ctx.moveTo(x,y-8); ctx.lineTo(x,y+8); ctx.stroke();
    } else {
      ctx.beginPath(); ctx.moveTo(x-7,y-7); ctx.lineTo(x+7,y+7); ctx.moveTo(x+7,y-7); ctx.lineTo(x-7,y+7); ctx.stroke();
    }
    ctx.restore();
  }

  function drawTrail(b){
    const t = state.save.cosmetics.trail;
    if(!b.trail || b.trail.length<2) return;
    const baseA = b.enemy ? 0.20 : 0.34;
    const col = b.enemy ? "rgba(255,77,109,0.8)" :
      (t==="gold" ? "rgba(255,209,102,0.85)" :
       t==="spark" ? "rgba(179,146,240,0.85)" :
       "rgba(155,231,255,0.85)");

    ctx.save();
    ctx.globalAlpha=1;
    ctx.shadowBlur = b.enemy ? 10 : 16;
    ctx.shadowColor = col;
    ctx.strokeStyle = col;
    ctx.lineWidth = b.enemy ? 3 : 3.5;
    ctx.beginPath();
    for(let i=0;i<b.trail.length;i++){
      const p=b.trail[i];
      if(i===0) ctx.moveTo(p.x,p.y); else ctx.lineTo(p.x,p.y);
    }
    ctx.stroke();
    ctx.restore();
  }

  // core loop
  let last=performance.now();
  let autosaveT=0;

  function update(dt){
    // feel
    state.shakeT=Math.max(0,state.shakeT-dt);
    if(state.shakeT<=0) state.shake=0;

    // UI toast timer
    ui?.onFrame?.(dt);

    if(state.modeState!=="play") return;

    // hazards
    hazardUpdate(state, dt);
    hazardPlayerEffect(state, dt);

    const p=state.player;

    // timers
    p.invuln=Math.max(0,p.invuln-dt);
    p.fireCd=Math.max(0,p.fireCd-dt);
    p.dashCd=Math.max(0,p.dashCd-dt);
    p.dashT=Math.max(0,p.dashT-dt);
    p.ultCd=Math.max(0,p.ultCd-dt);

    // combo
    p.comboT=Math.max(0,p.comboT-dt);
    if(p.comboT<=0){ p.combo=0; p.dmgBonus=0; }

    // shield regen
    if(p.shieldRegen>0 && p.shieldMax>0){
      p.shield = Math.min(p.shieldMax, p.shield + p.shieldRegen*dt*0.6);
    }

    // movement
    let dx=0,dy=0;
    if(keys["KeyW"]) dy-=1;
    if(keys["KeyS"]) dy+=1;
    if(keys["KeyA"]) dx-=1;
    if(keys["KeyD"]) dx+=1;
    const L=hypot(dx,dy)||1; dx/=L; dy/=L;

    const dash = keys["ShiftLeft"]||keys["ShiftRight"];
    if(dash && p.dashCd<=0 && (dx||dy)){
      p.dashCd=1.15; p.dashT=0.18;
      p.invuln=Math.max(p.invuln,0.22);
      addShake(6,0.06);
      sfx(520,0.04,0.035,"triangle");
    }

    const slowMul = 1 - (p.ionSlow||0)*0.35;
    const sp = p.speed * (p.dashT>0?2.1:1) * slowMul;

    p.x = clamp(p.x + dx*sp*dt, 24, state.W-24);
    p.y = clamp(p.y + dy*sp*dt, 24, state.H-24);

    if(mouse.down) shootPlayer();

    // bullets
    for(const b of state.bullets){
      b.trail.push({x:b.x,y:b.y,life:0.18});
      if(b.trail.length>18) b.trail.shift();
      for(const q of b.trail) q.life -= dt;
      b.trail = b.trail.filter(q=>q.life>0);

      // homing rockets
      if(b.homing && !b.enemy){
        // find closest target
        let tgt=null, best=1e18;
        for(const e of state.enemies){
          const dd=(e.x-b.x)**2+(e.y-b.y)**2;
          if(dd<best){best=dd; tgt=e;}
        }
        if(!tgt && state.boss) tgt=state.boss;
        if(tgt) homingAdjust(b, tgt, dt);
      }

      b.x += b.vx*dt; b.y += b.vy*dt;
      b.life -= dt;

      // ricochet
      if(!b.enemy && b.ric>0){
        let bounced=false;
        if(b.x<10){ b.x=10; b.vx=Math.abs(b.vx); bounced=true; }
        if(b.x>state.W-10){ b.x=state.W-10; b.vx=-Math.abs(b.vx); bounced=true; }
        if(b.y<10){ b.y=10; b.vy=Math.abs(b.vy); bounced=true; }
        if(b.y>state.H-10){ b.y=state.H-10; b.vy=-Math.abs(b.vy); bounced=true; }
        if(bounced){ b.ric--; b.dmg*=0.92; }
      }
    }
    state.bullets = state.bullets.filter(b=>b.life>0 && b.x>-200 && b.y>-200 && b.x<state.W+200 && b.y<state.H+200);

    // enemies AI
    for(const e of state.enemies){
      e.hitT=Math.max(0,(e.hitT||0)-dt);

      if(e.mod==="cloaked"){
        const d=hypot(p.x-e.x,p.y-e.y);
        if(d<240) e.cloakT=Math.max(0,(e.cloakT||0)-dt*2.0);
        else e.cloakT=Math.min(1,(e.cloakT||0)+dt*0.6);
      }
      if(e.slowT) e.slowT=Math.max(0,e.slowT-dt);

      const ang=Math.atan2(p.y-e.y,p.x-e.x);
      const slow= e.slowT ? (1 - clamp(e.slowT,0,0.6)) : 1;

      if(e.type==="chaser" || e.type==="tank"){
        e.x += Math.cos(ang)*e.speed*slow*dt;
        e.y += Math.sin(ang)*e.speed*slow*dt;
      } else {
        const d=hypot(p.x-e.x,p.y-e.y);
        const desired=350;
        const k=clamp((d-desired)/260,-1,1);
        e.x += Math.cos(ang)*e.speed*k*slow*dt;
        e.y += Math.sin(ang)*e.speed*k*slow*dt;

        e.shootCd -= dt;
        if(e.shootCd<=0){
          e.shootCd = 0.95 + state.rng()*0.65;
          if(!(e.mod==="cloaked" && e.cloakT>0.4)){
            enemyShoot(e.x,e.y,ang,e.dmg*0.75,480);
          }
        }
      }

      if(p.invuln<=0){
        const d=hypot(p.x-e.x,p.y-e.y);
        if(d < p.r + e.r){
          hurtPlayer(e.dmg);
        }
      }
    }

    // boss AI
    if(state.boss){
      const b=state.boss;
      b.hitT=Math.max(0,(b.hitT||0)-dt);
      b.patT += dt;
      if(b.y<160) b.y += 160*dt;

      const ratio=b.hp/b.maxHp;
      const newPhase = ratio>0.66?1:(ratio>0.33?2:3);
      if(newPhase!==b.phase){
        b.phase=newPhase;
        addShake(12,0.16); addHitStop(0.05);
        sfx(90,0.12,0.08,"sawtooth");
      }

      // movement
      const tx=state.W/2 + Math.cos(b.patT*0.55)*260;
      const ty=190 + Math.sin(b.patT*0.7)*70;
      b.x += (tx-b.x)*(0.8*dt);
      b.y += (ty-b.y)*(0.8*dt);

      b.shootT -= dt;
      b.dronesT -= dt;

      if(b.dronesT<=0 && b.phase>=2){
        b.dronesT = (b.phase===2) ? 3.2 : 2.6;
        for(let i=0;i<2;i++){
          spawnEnemy("chaser", true);
          const e=state.enemies[state.enemies.length-1];
          e.x=b.x + (state.rng()*240-120);
          e.y=b.y + (state.rng()*80+40);
        }
        addShake(7,0.08);
      }

      if(b.shootT<=0){
        if(b.phase===1){
          b.shootT=0.62;
          const a=Math.atan2(p.y-b.y,p.x-b.x);
          enemyShoot(b.x,b.y,a-0.14,15+state.wave*0.85,480);
          enemyShoot(b.x,b.y,a,     15+state.wave*0.85,480);
          enemyShoot(b.x,b.y,a+0.14,15+state.wave*0.85,480);
        } else if(b.phase===2){
          b.shootT=0.48;
          const n=12; const base=b.patT*0.6;
          for(let i=0;i<n;i++) enemyShoot(b.x,b.y,base+i*(Math.PI*2/n),13+state.wave*0.75,470);
        } else {
          b.shootT=0.40;
          const n=14; const base=b.patT*1.4;
          for(let i=0;i<n;i++) enemyShoot(b.x,b.y,base+i*(Math.PI*2/n),12+state.wave*0.70,490);
          const a2=Math.atan2(p.y-b.y,p.x-b.x);
          enemyShoot(b.x,b.y,a2,18+state.wave*0.95,560);
        }
        addShake(5,0.06);
      }

      if(p.invuln<=0){
        const d=hypot(p.x-b.x,p.y-b.y);
        if(d < p.r + b.r*0.75){
          hurtPlayer(26+state.wave*1.1);
        }
      }
    }

    // collisions
    for(const b of state.bullets){
      if(b.enemy){
        if(p.invuln<=0){
          const d=hypot(p.x-b.x,p.y-b.y);
          if(d < p.r + b.r){
            b.life=0;
            hurtPlayer(b.dmg);
          }
        }
        continue;
      }

      // vs enemies
      for(const e of state.enemies){
        if(e.mod==="cloaked" && e.cloakT>0.55) continue;
        const d=hypot(e.x-b.x,e.y-b.y);
        if(d < e.r + b.r){
          if(b.hitSet && b.hitSet.has(e)) continue;
          if(b.hitSet) b.hitSet.add(e);

          let dmg=b.dmg;
          let crit=false;
          if(state.rng()<p.crit){ crit=true; dmg*=p.critMul; }

          if(e.shield && e.shield>0){
            const take=Math.min(e.shield,dmg);
            e.shield-=take; dmg-=take;
            if(dmg<=0){ if(b.pierce>0){b.pierce--; b.dmg*=0.92;} else b.life=0; break; }
          }

          e.hp -= dmg;
          e.hitT=0.07;

          if(p.lifesteal>0) p.hp = Math.min(p.maxHp, p.hp + dmg*p.lifesteal);

          // rocket splash & cluster on impact
          if(b.weapon==="ROCKET"){
            explodeRocket(b);
          }

          if(b.pierce>0){ b.pierce--; b.dmg*=0.92; }
          else b.life=0;

          addShake(3,0.05);
          addHitStop(0.02);

          // kill check happens later
          break;
        }
      }

      // vs boss
      if(state.boss && b.life>0){
        const d=hypot(state.boss.x-b.x, state.boss.y-b.y);
        if(d < state.boss.r + b.r){
          let dmg=b.dmg;
          if(state.rng()<p.crit) dmg*=p.critMul;
          state.boss.hp -= dmg;
          state.boss.hitT=0.08;

          if(p.lifesteal>0) p.hp = Math.min(p.maxHp, p.hp + dmg*p.lifesteal*0.35);
          if(b.weapon==="ROCKET") explodeRocket(b);

          b.life=0;
          addShake(5.5,0.07);
          addHitStop(0.02);
        }
      }
    }

    // cleanup enemies (and splitter)
    const keep=[];
    for(const e of state.enemies){
      if(e.hp>0){ keep.push(e); continue; }

      p.score += e.value;
      onKill(e, p.weapon);

      // splitter
      if(e.mod==="splitter"){
        for(let i=0;i<2;i++){
          const m={
            x:e.x+(state.rng()*24-12),
            y:e.y+(state.rng()*24-12),
            hitT:0, type:"chaser",
            r:10,
            maxHp:Math.max(18,e.maxHp*0.34),
            hp:Math.max(18,e.maxHp*0.34),
            speed:e.speed*1.25,
            dmg:e.dmg*0.8,
            col:"rgba(255,77,109,0.95)",
            glow:"rgba(255,209,102,0.95)",
            value:Math.round(e.value*0.45),
            elite:false, mod:null, cloakT:0, slowT:0, shootCd:0, shield:0, shieldMax:0
          };
          keep.push(m);
        }
      }
    }
    state.enemies = keep;

    // boss death
    if(state.boss && state.boss.hp<=0){
      addShake(16,0.18); addHitStop(0.08);
      state.player.score += 400 + state.wave*50;
      state.player.runCoins += 30;
      state.boss = null;

      achOnEvent(state.ach, {type:"boss_kill"});
      // no-hit boss achievement is checked by achCheckUnlocks via bossNoHit and state flags
      if(state.bossNoHit) state.ach.stats.lastBossNoHit = true;

      sfx(70,0.12,0.08,"sawtooth");
    }

    // particles
    for(const q of state.particles){
      q.x += q.vx*dt; q.y += q.vy*dt; q.life -= dt;
      q.vx *= Math.pow(0.02,dt);
      q.vy *= Math.pow(0.02,dt);
    }
    state.particles = state.particles.filter(q=>q.life>0);

    // wave progression
    const waveDone = (state.waveState==="boss") ? (!state.boss) : (state.enemies.length===0 && state.waveSpawned>=state.waveBudget);
    if(waveDone){
      state.clearT += dt;
      if(state.clearT>0.65){
        state.clearT=0;
        pickCards();
        state.modeState="upgrade";
        sfx(520,0.04,0.03,"triangle");
        saveRun();
      }
    } else {
      state.clearT=0;
      if(state.waveState==="fight" && state.waveSpawned<state.waveBudget){
        state.spawnT += dt;
        const interval = Math.max(0.44, 0.86 - state.wave*0.008);
        if(state.spawnT>interval){
          state.spawnT=0;
          const r=state.rng();
          if(state.wave>=4 && r<0.18) spawnEnemy("tank");
          else if(state.wave>=2 && r<0.48) spawnEnemy("shooter");
          else spawnEnemy("chaser");
          state.waveSpawned++;
        }
      }
    }

    // death
    if(p.hp<=0){
      if(p.revives>0){
        p.revives--;
        p.hp = Math.max(1, Math.round(p.maxHp*0.45));
        p.shield = Math.max(p.shield, 25);
        p.invuln = 1.2;
        addShake(10,0.12);
        sfx(320,0.07,0.05,"triangle");
      } else {
        endRun();
      }
    }

    // achievements unlock check + apply rewards
    const newly = achCheckUnlocks(state.ach);
    if(newly.length){
      applyAchievementRewards(newly);
    }

    // autosave
    autosaveT += dt;
    if(autosaveT>1.0){
      autosaveT=0;
      saveRun();
    }
  }

  function applyAchievementRewards(ids){
    let coins=0;
    const cosUnlocks=[];
    for(const id of ids){
      const a=ACH[id];
      if(!a) continue;
      if(a.reward?.coins) coins += a.reward.coins;
      if(a.reward?.cosmetic){
        for(const k of Object.keys(a.reward.cosmetic)){
          cosUnlocks.push({kind:k, val:a.reward.cosmetic[k]});
        }
      }
    }
    if(coins){
      state.save.coins += coins;
    }
    for(const u of cosUnlocks){
      state.save.cosmetics.unlocked[u.kind] ||= {};
      state.save.cosmetics.unlocked[u.kind][u.val] = true;
    }
    saveSave(state.save);
    ui?.onUnlock?.({ ids, rewardsText: `+${coins} coin` });
  }

  function draw(dt){
    // bg
    drawBiomeBG(ctx, state.W, state.H, state.biome);

    // shake
    let sx=0,sy=0;
    if(state.shakeT>0){
      sx=(Math.random()*2-1)*state.shake;
      sy=(Math.random()*2-1)*state.shake;
    }
    ctx.save();
    ctx.translate(sx,sy);

    drawHazards(ctx, state);

    // bullet trails & bullets
    for(const b of state.bullets) drawTrail(b);
    for(const b of state.bullets){
      ctx.shadowBlur = b.enemy ? 10 : 16;
      ctx.shadowColor = b.enemy ? "rgba(255,77,109,0.95)" : "rgba(155,231,255,0.95)";
      ctx.fillStyle   = b.enemy ? "rgba(255,77,109,0.95)" : "rgba(155,231,255,0.95)";
      ctx.beginPath(); ctx.arc(b.x,b.y,b.r,0,Math.PI*2); ctx.fill();
    }

    // enemies
    for(const e of state.enemies){
      const alpha = (e.mod==="cloaked" && e.cloakT>0) ? 0.18 : 1;
      ctx.globalAlpha=alpha;
      const ang=Math.atan2(state.player.y-e.y, state.player.x-e.x);
      const scale=e.r/14;
      drawShip(e.x,e.y,ang,scale,e.col,e.glow, e.elite?"rgba(255,209,102,0.18)":"rgba(10,22,45,0.85)", false, e.hitT>0);
      ctx.globalAlpha=1;

      if(e.shield>0){
        const s=clamp(e.shield/e.shieldMax,0,1);
        ctx.shadowBlur=16; ctx.shadowColor="rgba(155,231,255,0.9)";
        ctx.strokeStyle=`rgba(155,231,255,${0.25+0.35*s})`;
        ctx.lineWidth=3;
        ctx.beginPath(); ctx.arc(e.x,e.y,e.r+7,0,Math.PI*2); ctx.stroke();
      }
    }

    // boss
    if(state.boss){
      const b=state.boss;
      const a=b.hitT>0?1:0.92;
      ctx.shadowBlur=24; ctx.shadowColor="rgba(255,209,102,0.95)";
      ctx.fillStyle=`rgba(255,209,102,${a})`;
      ctx.save();
      ctx.translate(b.x,b.y);
      ctx.beginPath();
      ctx.moveTo(90,0); ctx.lineTo(30,44); ctx.lineTo(-60,36); ctx.lineTo(-92,0);
      ctx.lineTo(-60,-36); ctx.lineTo(30,-44);
      ctx.closePath();
      ctx.fill();
      ctx.restore();

      // boss hp bar
      const bw=Math.min(560, state.W*0.75);
      const bx=(state.W-bw)/2, by=18;
      ctx.shadowBlur=0;
      ctx.fillStyle="rgba(0,0,0,0.45)";
      ctx.fillRect(bx,by,bw,14);
      ctx.fillStyle="rgba(255,209,102,0.95)";
      ctx.fillRect(bx,by,bw*clamp(b.hp/b.maxHp,0,1),14);
      ctx.strokeStyle="rgba(155,231,255,0.35)";
      ctx.strokeRect(bx,by,bw,14);
    }

    // player
    const p=state.player;
    const skin=state.save.cosmetics.skin;
    const body = skin==="gold" ? "rgba(255,209,102,0.95)" : skin==="red" ? "rgba(255,77,109,0.95)" : skin==="purple" ? "rgba(179,146,240,0.95)" : "rgba(72,202,228,0.95)";
    const glow = skin==="gold" ? "rgba(255,209,102,0.95)" : skin==="red" ? "rgba(255,77,109,0.95)" : skin==="purple" ? "rgba(179,146,240,0.95)" : "rgba(72,202,228,0.95)";
    const ang=Math.atan2(mouse.y-p.y, mouse.x-p.x);
    drawShip(p.x,p.y,ang,1.0, (p.invuln>0?"rgba(108,117,125,0.9)":body), glow, "rgba(10,22,45,0.85)", true, false);

    if(p.shieldMax>0 && p.shield>0){
      const s=clamp(p.shield/p.shieldMax,0,1);
      ctx.shadowBlur=18; ctx.shadowColor="rgba(155,231,255,0.9)";
      ctx.strokeStyle=`rgba(155,231,255,${0.18+0.35*s})`;
      ctx.lineWidth=3;
      ctx.beginPath(); ctx.arc(p.x,p.y,p.r+9,0,Math.PI*2); ctx.stroke();
    }

    // particles
    ctx.shadowBlur=0;
    for(const q of state.particles){
      const a=clamp(q.life/0.7,0,1);
      ctx.globalAlpha=a;
      if(q.glow){ ctx.shadowBlur=q.glow; ctx.shadowColor=q.col; }
      ctx.fillStyle=q.col;
      ctx.fillRect(q.x,q.y,q.size,q.size);
      ctx.shadowBlur=0;
      ctx.globalAlpha=1;
    }

    ctx.restore();

    // HUD
    const pad=16;
    // hp bar
    ctx.fillStyle="rgba(0,0,0,0.55)"; ctx.fillRect(pad,pad,260,16);
    ctx.fillStyle="rgba(72,202,228,0.95)"; ctx.fillRect(pad,pad,260*clamp(p.hp/p.maxHp,0,1),16);
    ctx.strokeStyle="rgba(72,202,228,0.35)"; ctx.strokeRect(pad,pad,260,16);

    // biome/wave
    drawText(`${state.biome.name} • Dalga ${state.wave} • Skor ${p.score}`, pad, pad+44, 14, "left", 0.92);
    drawText(`Silah: ${p.weapon} • Mods: ${state.loadout.slots.barrel||"-"} | ${state.loadout.slots.core||"-"} | ${state.loadout.slots.utility||"-"}`, pad, pad+64, 12, "left", 0.75);

    // crosshair
    drawCrosshair();

    // controls hint
    ctx.fillStyle="rgba(231,238,249,0.68)";
    ctx.font="12px system-ui,-apple-system,Segoe UI,Roboto,Arial";
    ctx.textAlign="left";
    ctx.fillText("WASD • Shift(dash) • Mouse(ateş) • P(pause)", pad, state.H-18);

    // upgrade overlay text
    if(state.modeState==="upgrade"){
      drawUpgradeScreen();
    }
  }

  function drawUpgradeScreen(){
    // simple canvas upgrade UI (click or 1-5)
    const W=state.W,H=state.H;
    const w=Math.min(920,W-40), h=360;
    const x=(W-w)/2, y=(H-h)/2;

    ctx.save();
    ctx.fillStyle="rgba(8,10,16,0.92)";
    ctx.fillRect(x,y,w,h);
    ctx.strokeStyle="rgba(155,231,255,0.25)";
    ctx.lineWidth=2;
    ctx.strokeRect(x,y,w,h);

    ctx.fillStyle="#e7eef9";
    ctx.font="700 22px system-ui";
    ctx.textAlign="center";
    ctx.fillText(`DALGA ${state.wave} TAMAMLANDI`, x+w/2, y+42);
    ctx.font="14px system-ui";
    ctx.globalAlpha=0.85;
    ctx.fillText("Kart seç (tıkla veya 1-5). Seçimden sonra sonraki dalga başlar.", x+w/2, y+66);
    ctx.globalAlpha=1;

    const cols=state.cards.length;
    const gap=10;
    const cardW=(w-40-(cols-1)*gap)/cols;
    const cardH=210;
    const cy=y+92;

    for(let i=0;i<cols;i++){
      const c=state.cards[i];
      const cx=x+20+i*(cardW+gap);
      const hover = mouse.x>=cx && mouse.x<=cx+cardW && mouse.y>=cy && mouse.y<=cy+cardH;
      ctx.fillStyle = hover ? "rgba(20,30,48,0.95)" : "rgba(17,24,38,0.92)";
      ctx.fillRect(cx,cy,cardW,cardH);
      ctx.strokeStyle = hover ? "rgba(155,231,255,0.55)" : "rgba(155,231,255,0.22)";
      ctx.strokeRect(cx,cy,cardW,cardH);

      ctx.font="700 16px system-ui"; ctx.textAlign="center";
      ctx.fillStyle="#e7eef9";
      ctx.fillText(c.name, cx+cardW/2, cy+44);
      ctx.font="13px system-ui"; ctx.globalAlpha=0.85;
      ctx.fillText(c.desc, cx+cardW/2, cy+74);
      ctx.globalAlpha=0.75;
      ctx.fillText(`Seç: ${i+1}`, cx+cardW/2, cy+cardH-18);
      ctx.globalAlpha=1;
    }
    ctx.restore();
  }

  function handleUpgradeInput(){
    if(state.modeState!=="upgrade") return;

    if(mouse.clicked){
      mouse.clicked=false;
      const W=state.W,H=state.H;
      const w=Math.min(920,W-40), h=360;
      const x=(W-w)/2, y=(H-h)/2;
      const cols=state.cards.length;
      const gap=10;
      const cardW=(w-40-(cols-1)*gap)/cols;
      const cardH=210;
      const cy=y+92;

      for(let i=0;i<cols;i++){
        const cx=x+20+i*(cardW+gap);
        const hit = mouse.x>=cx && mouse.x<=cx+cardW && mouse.y>=cy && mouse.y<=cy+cardH;
        if(hit){
          applyCard(i);
          state.modeState="play";
          startWave(state.wave+1);
          saveRun();
          break;
        }
      }
    }
  }

  addEventListener("keydown", (e)=>{
    if(state.modeState!=="upgrade") return;
    if(e.code.startsWith("Digit")){
      const idx = Number(e.code.replace("Digit",""))-1;
      if(idx>=0 && idx<state.cards.length){
        applyCard(idx);
        state.modeState="play";
        startWave(state.wave+1);
        saveRun();
      }
    }
  });

  function endRun(){
    // submit score + coin payout
    state.save.coins += state.player.runCoins;
    saveSave(state.save);

    // leaderboard
    submitScore({
      mode: state.run.mode,
      code: state.run.code,
      score: state.player.score,
      wave: state.wave
    });

    state.last = { mode: state.run.mode, code: state.run.code, score: state.player.score, wave: state.wave, coins: state.player.runCoins };

    clearRunCache();
    state.modeState="dead";
    addShake(16,0.20); addHitStop(0.10);
    sfx(60,0.14,0.08,"sawtooth");
    ui?.render?.();
  }

  // save/load run cache
  function packRun(){
    // minimal serializable
    return {
      v:1,
      modeState: state.modeState,
      run: state.run,
      wave: state.wave,
      waveState: state.waveState,
      waveBudget: state.waveBudget,
      waveSpawned: state.waveSpawned,
      spawnT: state.spawnT,
      clearT: state.clearT,
      biomeId: state.biome?.id,
      player: state.player,
      bullets: state.bullets.map(b=>({
        x:b.x,y:b.y,vx:b.vx,vy:b.vy,r:b.r,life:b.life,dmg:b.dmg,enemy:b.enemy,
        pierce:b.pierce||0,ric:b.ric||0,splash:b.splash||0,weapon:b.weapon||"",
        homing:!!b.homing, cluster:!!b.cluster,
        trail:(b.trail||[]).map(t=>({x:t.x,y:t.y,life:t.life}))
      })),
      enemies: state.enemies,
      boss: state.boss,
      cards: state.cards,
      loadout: state.loadout,
      ach: state.ach,
      hazard: state.hazard,
      bossNoHit: state.bossNoHit,
    };
  }

  function saveRun(){
    if(state.modeState!=="play" && state.modeState!=="pause" && state.modeState!=="upgrade") return;
    saveRunCache(packRun());
  }

  function restoreRun(d){
    state.modeState = d.modeState || "play";
    state.run = d.run || state.run;

    state.wave = d.wave || 1;
    state.biome = biomeForWave(state.wave);

    state.waveState = d.waveState || "fight";
    state.waveBudget = d.waveBudget || 0;
    state.waveSpawned = d.waveSpawned || 0;
    state.spawnT = d.spawnT || 0;
    state.clearT = d.clearT || 0;

    state.player = d.player;
    state.loadout = d.loadout || makeLoadout();
    applyLoadoutToPlayer(state.player, state.loadout);

    state.bullets = (d.bullets||[]).map(b=>({ ...b, hitSet:new Set(), trail:b.trail||[] }));
    state.enemies = d.enemies || [];
    state.boss = d.boss || null;

    state.cards = d.cards || [];
    state.ach = d.ach || makeAchState();
    state.hazard = d.hazard || {ionT:0,ionPulse:0,ionFields:[]};
    state.bossNoHit = (d.bossNoHit ?? true);

    // re-seed rng
    state.rng = mulberry32(state.run.seed>>>0);
  }

  function startNewRun({mode, seed, code}){
    state.save = loadSave();
    state.settings = loadSettings();

    state.run = { mode, seed: seed>>>0, code };
    state.rng = mulberry32(state.run.seed);

    state.ach = makeAchState();
    state.loadout = makeLoadout();
    applyLoadoutToPlayerFlags();

    state.player = makePlayer();
    state.bullets.length=0; state.enemies.length=0; state.particles.length=0; state.rings.length=0;
    state.hazard = { ionT:0, ionPulse:0, ionFields:[] };

    startWave(1);

    state.modeState="play";
    saveRun();
    ui?.render?.();
  }

  function applyLoadoutToPlayerFlags(){
    // placeholder; actual apply happens in makePlayer() too
  }

  function continueRun(){
    const d=loadRunCache();
    if(!d){ startNewRun({mode:"custom", seed:Date.now()>>>0, code:"C-"+String(Date.now()).slice(-6)}); return; }
    restoreRun(d);
    ui?.render?.();
  }

  function pause(){
    if(state.modeState!=="play") return;
    state.modeState="pause";
    saveRun();
    ui?.render?.();
  }
  function resume(){
    if(state.modeState!=="pause") return;
    state.modeState="play";
    ui?.render?.();
  }

  function backToMenuKeepRun(){
    // run stays in session; menu can continue
    state.modeState="menu";
    saveRun();
    ui?.render?.();
  }

  function goMenuAfterDead(){
    state.modeState="menu";
    ui?.render?.();
  }

  function resumeFromPause(){ resume(); }

  function lastRunResult(){ return state.last; }
  function getAchUnlocked(){ return state.ach.unlocked || {}; }

  function boot(){
    resize();
    // default menu state
    state.modeState="menu";
    state.biome = biomeForWave(1);
    state.player = makePlayer();

    // visibility save
    addEventListener("visibilitychange", ()=>{
      if(document.visibilityState==="hidden") saveRun();
    });
    addEventListener("beforeunload", ()=>saveRun());

    // main loop
    function frame(now){
      let dt=(now-last)/1000; last=now;
      dt=Math.min(dt,0.033);

      if(state.hitStop>0){
        state.hitStop-=dt;
        dt*=0.15;
      }

      if(state.modeState==="upgrade") handleUpgradeInput();
      update(dt);
      draw(dt);

      // UI render only on state changes; but keep toast timer visible
      // (menu/pause/dead screens are DOM; keep them synced)
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);

    ui?.render?.();
  }

  return {
    setUI,
    boot,
    W, H,
    state: ()=>state.modeState,

    startNewRun,
    continueRun,
    resumeFromPause,
    backToMenuKeepRun,
    goMenuAfterDead,

    lastRunResult,
    getAchUnlocked,
  };
}
