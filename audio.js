import { loadSettings } from "./storage.js";

let ctx=null, ok=false;
let settings = loadSettings();

export function audioInit(){
  ctx = new (window.AudioContext||window.webkitAudioContext)();
  ok=false;
  const unlock = ()=>{ ctx.resume(); ok=true; window.removeEventListener("mousedown", unlock); };
  window.addEventListener("mousedown", unlock);
}

export function audioSetSettings(st){ settings = st; }

export function sfx(freq=440, time=0.05, vol=0.05, type="triangle"){
  if(!ok) return;
  const gVol = vol * (settings?.sfx ?? 0.7);
  if(gVol<=0.0001) return;
  const o=ctx.createOscillator();
  const g=ctx.createGain();
  o.type=type; o.frequency.value=freq;
  g.gain.value=gVol;
  o.connect(g); g.connect(ctx.destination);
  o.start();
  o.stop(ctx.currentTime+time);
}
