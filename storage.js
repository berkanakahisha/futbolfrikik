const SAVE_KEY="voidstorm_save_v2";
const RUN_KEY="voidstorm_run_cache_v2";
const SETTINGS_KEY="voidstorm_settings_v1";

export function storageInit(){}

export function loadSave(){
  try{
    const raw=localStorage.getItem(SAVE_KEY);
    if(!raw){
      return {
        coins: 100000,
        perm:{hp:0,dmg:0,spd:0,cards:0,revive:0},
        cosmetics:{
          skin:"aqua",
          trail:"ion",
          crosshair:"dot",
          unlocked:{ skin:{aqua:true}, trail:{ion:true}, crosshair:{dot:true} }
        }
      };
    }
    const s=JSON.parse(raw);
    s.perm ||= {hp:0,dmg:0,spd:0,cards:0,revive:0};
    s.coins = typeof s.coins==="number" ? s.coins : 0;
    s.cosmetics ||= {skin:"aqua",trail:"ion",crosshair:"dot",unlocked:{skin:{aqua:true},trail:{ion:true},crosshair:{dot:true}}};
    s.cosmetics.unlocked ||= {skin:{aqua:true},trail:{ion:true},crosshair:{dot:true}};
    return s;
  }catch{
    return {
      coins: 100000,
      perm:{hp:0,dmg:0,spd:0,cards:0,revive:0},
      cosmetics:{skin:"aqua",trail:"ion",crosshair:"dot",unlocked:{skin:{aqua:true},trail:{ion:true},crosshair:{dot:true}}}
    };
  }
}
export function saveSave(save){ localStorage.setItem(SAVE_KEY, JSON.stringify(save)); }

export function loadSettings(){
  try{
    const raw=localStorage.getItem(SETTINGS_KEY);
    if(!raw) return { sfx:0.7, shake:0.7 };
    const s=JSON.parse(raw);
    return { sfx: typeof s.sfx==="number"?s.sfx:0.7, shake: typeof s.shake==="number"?s.shake:0.7 };
  }catch{ return {sfx:0.7, shake:0.7}; }
}
export function saveSettings(st){ localStorage.setItem(SETTINGS_KEY, JSON.stringify(st)); }

// session run cache
export function saveRunCache(obj){
  try{ sessionStorage.setItem(RUN_KEY, JSON.stringify(obj)); }catch{}
}
export function loadRunCache(){
  try{
    const raw=sessionStorage.getItem(RUN_KEY);
    if(!raw) return null;
    return JSON.parse(raw);
  }catch{ return null; }
}
export function clearRunCache(){
  try{ sessionStorage.removeItem(RUN_KEY); }catch{}
}
export function hasRunCache(){
  try{ return !!sessionStorage.getItem(RUN_KEY); }catch{ return false; }
}
