import { clamp, lerp } from "./utils.js";

// her stage = 5 dalga
export const BIOMES = [
  {
    id:"nebula",
    name:"Nebula Drift",
    bg:["rgba(90,40,130,0.35)","rgba(10,22,45,0.65)","rgba(0,0,0,0.92)"],
    hazard:{ type:"none" },
    enemyMod:{ speedMul:0.98, hpMul:1.0 }
  },
  {
    id:"asteroid",
    name:"Asteroid Belt",
    bg:["rgba(40,90,130,0.30)","rgba(8,16,30,0.70)","rgba(0,0,0,0.92)"],
    hazard:{ type:"rocks" }, // dekor + hafif çarpma hasarı
    enemyMod:{ speedMul:1.03, hpMul:1.05 }
  },
  {
    id:"ionstorm",
    name:"Ion Storm",
    bg:["rgba(20,120,140,0.26)","rgba(8,18,28,0.72)","rgba(0,0,0,0.92)"],
    hazard:{ type:"ion" }, // periyodik elektrik alanı
    enemyMod:{ speedMul:1.05, hpMul:1.0 }
  },
  {
    id:"graveyard",
    name:"Derelict Graveyard",
    bg:["rgba(120,60,20,0.22)","rgba(10,14,18,0.72)","rgba(0,0,0,0.92)"],
    hazard:{ type:"wreck" }, // cover gibi dekor
    enemyMod:{ speedMul:1.00, hpMul:1.10 }
  }
];

export function biomeForWave(wave){
  const stage = Math.floor((wave-1)/5);
  return BIOMES[ stage % BIOMES.length ];
}

export function drawBiomeBG(ctx, w, h, biome){
  const [c0,c1,c2]=biome.bg;
  const g=ctx.createRadialGradient(w*0.55,h*0.45,60,w*0.5,h*0.5,Math.max(w,h)*0.85);
  g.addColorStop(0,c0);
  g.addColorStop(0.45,c1);
  g.addColorStop(1,c2);
  ctx.fillStyle=g;
  ctx.fillRect(0,0,w,h);
}

export function hazardUpdate(state, dt){
  const hz = state.biome.hazard?.type || "none";
  if(hz==="ion"){
    state.hazard.ionT += dt;
    // her ~6 saniyede bir pulse
    if(state.hazard.ionT > 6.0){
      state.hazard.ionT = 0;
      state.hazard.ionPulse = 1.0;
    }
    state.hazard.ionPulse = Math.max(0, state.hazard.ionPulse - dt*1.7);

    // pulse aktifken sahada 2-3 alan
    if(state.hazard.ionPulse>0 && state.hazard.ionFields.length===0){
      const n = 2 + (Math.random()<0.35 ? 1 : 0);
      for(let i=0;i<n;i++){
        state.hazard.ionFields.push({
          x: Math.random()*state.W,
          y: Math.random()*state.H,
          r: 90 + Math.random()*70,
          life: 1.3
        });
      }
    }
    for(const f of state.hazard.ionFields) f.life -= dt;
    state.hazard.ionFields = state.hazard.ionFields.filter(f=>f.life>0);
  }
}

export function hazardPlayerEffect(state, dt){
  const hz = state.biome.hazard?.type || "none";
  if(hz==="ion"){
    for(const f of state.hazard.ionFields){
      const dx=state.player.x-f.x, dy=state.player.y-f.y;
      const d=Math.hypot(dx,dy);
      if(d < f.r){
        // hafif hasar + slow hissi
        state.player.hp -= 8*dt;
        state.player.invuln = Math.max(state.player.invuln, 0.08);
        state.player.ionSlow = Math.min(1, (state.player.ionSlow||0)+dt*1.2);
      }
    }
    state.player.ionSlow = Math.max(0, (state.player.ionSlow||0) - dt*1.5);
  }
}

export function drawHazards(ctx, state){
  const hz = state.biome.hazard?.type || "none";
  if(hz==="ion"){
    for(const f of state.hazard.ionFields){
      const a = clamp(f.life/1.3,0,1);
      ctx.save();
      ctx.globalAlpha = 0.35*a;
      ctx.strokeStyle="rgba(155,231,255,0.95)";
      ctx.lineWidth=4;
      ctx.beginPath(); ctx.arc(f.x,f.y,f.r*(0.75+0.25*Math.sin((1-a)*6)),0,Math.PI*2); ctx.stroke();
      ctx.restore();
    }
  }
}
