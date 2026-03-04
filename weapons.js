import { clamp } from "./utils.js";

export const BASE_WEAPONS = {
  PULSE:   { name:"Pulse",   shots:1, spread:0.00, speedMul:1.00, dmgMul:1.00, lifeMul:1.00, splash:0, mode:"tap" },
  SCATTER: { name:"Scatter", shots:5, spread:0.12, speedMul:0.92, dmgMul:0.42, lifeMul:0.85, splash:0, mode:"tap" },
  LASER:   { name:"Laser",   shots:1, spread:0.00, speedMul:1.35, dmgMul:0.85, lifeMul:0.70, splash:0, mode:"tap" },
  ROCKET:  { name:"Rocket",  shots:1, spread:0.02, speedMul:0.75, dmgMul:1.35, lifeMul:0.95, splash:90, mode:"tap" },
};

// Mod slots: Barrel / Core / Utility
export const MODS = {
  // BARREL
  B_BARREL_BURST: { slot:"barrel", name:"Burst", desc:"+2 shots, -%10 dmg", apply:(p)=>{p.modBurst=1;} },
  B_BARREL_TIGHT: { slot:"barrel", name:"Tight Choke", desc:"Spread -%35", apply:(p)=>{p.modTight=1;} },

  // CORE
  C_CORE_RAIL: { slot:"core", name:"Rail Core", desc:"Mermi hızı +%25, life -%10", apply:(p)=>{p.modRail=1;} },
  C_CORE_PRISM:{ slot:"core", name:"Prism Core", desc:"Laser → 2 split", apply:(p)=>{p.modPrism=1;} },

  // UTILITY
  U_UTIL_HOMING:{ slot:"utility", name:"Homing", desc:"Rocket hafif takip", apply:(p)=>{p.modHoming=1;} },
  U_UTIL_CLUSTER:{slot:"utility", name:"Cluster", desc:"Rocket impact → mini shrapnel", apply:(p)=>{p.modCluster=1;} },
  U_UTIL_OVERCHARGE:{slot:"utility", name:"Overcharge", desc:"+%12 hasar", apply:(p)=>{p.modOver=1;} },
};

export function makeLoadout(){
  return {
    weapon:"PULSE",
    slots:{ barrel:null, core:null, utility:null },
  };
}

export function applyLoadoutToPlayer(player, loadout){
  // reset mod flags
  player.modBurst=0; player.modTight=0; player.modRail=0; player.modPrism=0;
  player.modHoming=0; player.modCluster=0; player.modOver=0;

  player.weapon = loadout.weapon;
  const slots=loadout.slots;
  for(const k of Object.keys(slots)){
    const id=slots[k];
    if(id && MODS[id]) MODS[id].apply(player);
  }
}

export function computedWeaponStats(player){
  const base = BASE_WEAPONS[player.weapon] || BASE_WEAPONS.PULSE;
  let shots = base.shots + (player.multishot||0);
  let spread = base.spread + Math.min(0.22, (shots-1)*0.025);
  let speedMul = base.speedMul;
  let dmgMul = base.dmgMul;
  let lifeMul = base.lifeMul;
  let splash = base.splash;

  if(player.modBurst){
    shots += 2;
    dmgMul *= 0.90;
  }
  if(player.modTight){
    spread *= 0.65;
  }
  if(player.modRail){
    speedMul *= 1.25;
    lifeMul *= 0.90;
  }
  if(player.modPrism && player.weapon==="LASER"){
    shots = Math.max(shots, 2 + (player.multishot||0));
    spread = Math.max(spread, 0.08);
    dmgMul *= 0.82;
  }
  if(player.modOver){
    dmgMul *= 1.12;
  }

  return { shots, spread, speedMul, dmgMul, lifeMul, splash, mode:base.mode };
}

export function homingAdjust(bullet, target, dt){
  // very light homing
  const turn = 4.0;
  const ax = target.x - bullet.x;
  const ay = target.y - bullet.y;
  const desired = Math.atan2(ay,ax);
  const cur = Math.atan2(bullet.vy, bullet.vx);
  let diff = desired - cur;
  while(diff>Math.PI) diff-=Math.PI*2;
  while(diff<-Math.PI) diff+=Math.PI*2;
  const newAng = cur + clamp(diff, -turn*dt, turn*dt);
  const sp = Math.hypot(bullet.vx, bullet.vy);
  bullet.vx = Math.cos(newAng)*sp;
  bullet.vy = Math.sin(newAng)*sp;
}
