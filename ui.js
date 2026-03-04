import { loadSave, saveSave, loadSettings, saveSettings, hasRunCache, clearRunCache } from "./storage.js";
import { getDailyCode, getDailySeed, topScores } from "./leaderboard.js";
import { ACH } from "./achievements.js";
import { audioSetSettings } from "./audio.js";

export function createUI(hudEl, game){
  const ui = {
    save: loadSave(),
    settings: loadSettings(),
    toast: null,
    toastT: 0,
    lastUnlocks: [],
    mode: "menu", // menu / settings / hangar / achievements / leaderboard
  };

  audioSetSettings(ui.settings);

  function toast(msg){
    ui.toast = msg;
    ui.toastT = 2.4;
  }

  function btn(x,y,w,h,text, id){
    return {x,y,w,h,text,id};
  }

  function render(){
    hudEl.innerHTML = "";
    const W = game.W(), H = game.H();

    // top tiny toast
    if(ui.toastT>0){
      const d=document.createElement("div");
      d.style.position="fixed";
      d.style.left="50%";
      d.style.top="14px";
      d.style.transform="translateX(-50%)";
      d.style.background="rgba(0,0,0,0.55)";
      d.style.border="1px solid rgba(155,231,255,0.25)";
      d.style.padding="10px 14px";
      d.style.borderRadius="12px";
      d.style.pointerEvents="none";
      d.textContent=ui.toast;
      hudEl.appendChild(d);
    }

    if(game.state()==="menu"){
      renderMenu(W,H);
      return;
    }
    if(game.state()==="upgrade"){
      // upgrade ekranını canvas çiziyor; burada sadece “P” gibi ufak yardımlar yok.
      return;
    }
    if(game.state()==="pause"){
      renderPause(W,H);
      return;
    }
    if(game.state()==="dead"){
      renderDead(W,H);
      return;
    }
  }

  function panel(W,H,title){
    const wrap=document.createElement("div");
    wrap.style.position="fixed";
    wrap.style.left="50%";
    wrap.style.top="50%";
    wrap.style.transform="translate(-50%,-50%)";
    wrap.style.width=Math.min(860, W-30)+"px";
    wrap.style.maxHeight=Math.min(720, H-30)+"px";
    wrap.style.overflow="auto";
    wrap.style.background="rgba(8,10,16,0.92)";
    wrap.style.border="2px solid rgba(155,231,255,0.25)";
    wrap.style.borderRadius="18px";
    wrap.style.padding="18px";
    wrap.style.pointerEvents="auto";
    const h=document.createElement("div");
    h.style.fontSize="22px";
    h.style.fontWeight="700";
    h.style.marginBottom="10px";
    h.textContent=title;
    wrap.appendChild(h);
    return wrap;
  }

  function mkBtn(text, onClick, tone="aqua"){
    const b=document.createElement("button");
    b.textContent=text;
    b.style.cursor="pointer";
    b.style.borderRadius="14px";
    b.style.padding="12px 14px";
    b.style.border = tone==="gold" ? "1px solid rgba(255,209,102,0.55)" : "1px solid rgba(72,202,228,0.45)";
    b.style.background = "rgba(20,28,40,0.85)";
    b.style.color="#e7eef9";
    b.style.fontWeight="650";
    b.onclick=onClick;
    return b;
  }

  function renderMenu(W,H){
    const p=panel(W,H,"VOIDSTORM ARENA — Phase 4");
    const sub=document.createElement("div");
    sub.style.opacity="0.85";
    sub.style.marginBottom="14px";
    sub.textContent="Biome stages • weapon evolution • daily run • achievements • cosmetics";
    p.appendChild(sub);

    const row=document.createElement("div");
    row.style.display="flex";
    row.style.flexWrap="wrap";
    row.style.gap="10px";
    row.style.marginBottom="12px";

    row.appendChild(mkBtn("YENİ RUN (Custom)", ()=>{
      clearRunCache();
      game.startNewRun({ mode:"custom", seed: Date.now()>>>0, code:"C-"+String(Date.now()).slice(-6) });
    }));

    const has = hasRunCache();
    if(has){
      row.appendChild(mkBtn("DEVAM ET", ()=>{
        game.continueRun();
      }, "gold"));
    }

    row.appendChild(mkBtn(`DAILY RUN (${getDailyCode()})`, ()=>{
      clearRunCache();
      game.startNewRun({ mode:"daily", seed:getDailySeed(), code:getDailyCode() });
    }, "gold"));

    p.appendChild(row);

    const row2=document.createElement("div");
    row2.style.display="flex";
    row2.style.flexWrap="wrap";
    row2.style.gap="10px";

    row2.appendChild(mkBtn("HANGAR (Kozmetik)", ()=>{ ui.mode="hangar"; renderOverlay(W,H); }));
    row2.appendChild(mkBtn("ACHIEVEMENTS", ()=>{ ui.mode="achievements"; renderOverlay(W,H); }));
    row2.appendChild(mkBtn("LEADERBOARD", ()=>{ ui.mode="leaderboard"; renderOverlay(W,H); }));
    row2.appendChild(mkBtn("AYARLAR", ()=>{ ui.mode="settings"; renderOverlay(W,H); }));

    p.appendChild(row2);

    const info=document.createElement("div");
    info.style.marginTop="14px";
    info.style.opacity="0.85";
    info.innerHTML = `Kalıcı Coin: <b>${ui.save.coins}</b> • Skin: <b>${ui.save.cosmetics.skin}</b> • Trail: <b>${ui.save.cosmetics.trail}</b> • Crosshair: <b>${ui.save.cosmetics.crosshair}</b>`;
    p.appendChild(info);

    hudEl.appendChild(p);
  }

  function renderOverlay(W,H){
    // overlay pages from menu
    const title = ui.mode==="settings" ? "Ayarlar"
      : ui.mode==="hangar" ? "Hangar"
      : ui.mode==="achievements" ? "Achievements"
      : "Leaderboard";

    const p=panel(W,H,title);

    const topRow=document.createElement("div");
    topRow.style.display="flex";
    topRow.style.gap="10px";
    topRow.style.marginBottom="10px";
    topRow.appendChild(mkBtn("GERİ", ()=>{ ui.mode="menu"; render(); }));
    p.appendChild(topRow);

    if(ui.mode==="settings"){
      const s=ui.settings;

      const mkSlider=(label, value, onChange)=>{
        const wrap=document.createElement("div");
        wrap.style.margin="12px 0";
        const l=document.createElement("div");
        l.textContent=`${label}: ${Math.round(value*100)}%`;
        l.style.opacity="0.9";
        l.style.marginBottom="6px";
        const input=document.createElement("input");
        input.type="range"; input.min="0"; input.max="1"; input.step="0.01"; input.value=String(value);
        input.style.width="100%";
        input.oninput=()=>onChange(Number(input.value));
        wrap.appendChild(l); wrap.appendChild(input);
        return wrap;
      };

      p.appendChild(mkSlider("SFX", s.sfx, (v)=>{
        ui.settings.sfx=v; saveSettings(ui.settings); audioSetSettings(ui.settings);
        renderOverlay(W,H);
      }));
      p.appendChild(mkSlider("Shake", s.shake, (v)=>{
        ui.settings.shake=v; saveSettings(ui.settings);
        renderOverlay(W,H);
      }));
      const hint=document.createElement("div");
      hint.style.opacity="0.8";
      hint.textContent="Not: Ses için oyunda ilk tık gerekli. Shake sadece kamera sarsıntısını etkiler.";
      p.appendChild(hint);
    }

    if(ui.mode==="hangar"){
      const cos=ui.save.cosmetics;
      const unlocked=cos.unlocked;

      const mkList=(kind, options)=>{
        const h=document.createElement("div");
        h.style.marginTop="10px";
        h.style.fontWeight="700";
        h.textContent=kind.toUpperCase();
        p.appendChild(h);

        const grid=document.createElement("div");
        grid.style.display="flex";
        grid.style.flexWrap="wrap";
        grid.style.gap="10px";
        grid.style.margin="10px 0";

        for(const opt of options){
          const ok = !!unlocked[kind]?.[opt];
          const b=mkBtn(ok ? opt : `${opt} (locked)`, ()=>{
            if(!ok) return toast("Locked. Achievement ile aç!");
            cos[kind]=opt;
            saveSave(ui.save);
            toast(`${kind} seçildi: ${opt}`);
            renderOverlay(W,H);
          }, ok ? "gold":"aqua");
          b.style.opacity = ok ? "1" : "0.55";
          grid.appendChild(b);
        }
        p.appendChild(grid);
      };

      mkList("skin", ["aqua","purple","red","gold"]);
      mkList("trail", ["ion","spark","gold"]);
      mkList("crosshair", ["dot","plus","x"]);

      const note=document.createElement("div");
      note.style.opacity="0.8";
      note.textContent="Kozmetikler sadece görsel. Unlock’lar achievements ile geliyor.";
      p.appendChild(note);
    }

    if(ui.mode==="achievements"){
      const box=document.createElement("div");
      box.style.display="grid";
      box.style.gridTemplateColumns="1fr";
      box.style.gap="10px";

      const unlocked = game.getAchUnlocked();
      for(const id of Object.keys(ACH)){
        const a=ACH[id];
        const row=document.createElement("div");
        row.style.border="1px solid rgba(155,231,255,0.22)";
        row.style.borderRadius="14px";
        row.style.padding="12px";
        row.style.background="rgba(20,28,40,0.70)";
        const t=document.createElement("div");
        t.style.fontWeight="750";
        t.textContent = `${a.name} ${unlocked[id] ? "✅" : ""}`;
        const d=document.createElement("div");
        d.style.opacity="0.85";
        d.style.marginTop="4px";
        d.textContent=a.desc;
        row.appendChild(t); row.appendChild(d);
        box.appendChild(row);
      }
      p.appendChild(box);
      const hint=document.createElement("div");
      hint.style.opacity="0.78";
      hint.style.marginTop="10px";
      hint.textContent="Unlock olunca coin + kozmetik ödülü gelir (menüde görünür).";
      p.appendChild(hint);
    }

    if(ui.mode==="leaderboard"){
      const daily=topScores({mode:"daily", code:getDailyCode()});
      const h1=document.createElement("div");
      h1.style.fontWeight="750";
      h1.style.margin="10px 0 6px";
      h1.textContent=`Daily (${getDailyCode()}) — Top 10`;
      p.appendChild(h1);

      const list=(arr)=>{
        const ol=document.createElement("div");
        ol.style.display="grid";
        ol.style.gap="6px";
        for(let i=0;i<Math.max(1,arr.length);i++){
          const it=arr[i];
          const r=document.createElement("div");
          r.style.opacity="0.9";
          r.textContent = it ? `${i+1}. Skor ${it.score} • Dalga ${it.wave}` : "Henüz skor yok.";
          ol.appendChild(r);
        }
        return ol;
      };
      p.appendChild(list(daily));

      const hint=document.createElement("div");
      hint.style.opacity="0.78";
      hint.style.marginTop="10px";
      hint.textContent="Custom run skorları da run code ile kayıt olur (ölünce otomatik submit).";
      p.appendChild(hint);
    }

    hudEl.appendChild(p);
  }

  function renderPause(W,H){
    const p=panel(W,H,"PAUSE");
    const row=document.createElement("div");
    row.style.display="flex";
    row.style.gap="10px";
    row.style.flexWrap="wrap";
    row.appendChild(mkBtn("DEVAM (P)", ()=>game.resumeFromPause(), "gold"));
    row.appendChild(mkBtn("MENÜYE DÖN", ()=>game.backToMenuKeepRun(), "aqua"));
    p.appendChild(row);
    const t=document.createElement("div");
    t.style.opacity="0.85";
    t.style.marginTop="10px";
    t.textContent="Not: Menüye dönersen run session’da kalır. Devam Et’ten dönebilirsin.";
    p.appendChild(t);
    hudEl.appendChild(p);
  }

  function renderDead(W,H){
    const p=panel(W,H,"RUN BİTTİ");
    const r=game.lastRunResult();
    const row=document.createElement("div");
    row.style.opacity="0.9";
    row.style.marginBottom="12px";
    row.innerHTML=`Mod: <b>${r.mode}</b> • Code: <b>${r.code}</b><br/>Skor: <b>${r.score}</b> • Dalga: <b>${r.wave}</b><br/>Kazanç: <b>${r.coins}</b> coin`;
    p.appendChild(row);

    const buttons=document.createElement("div");
    buttons.style.display="flex";
    buttons.style.gap="10px";
    buttons.style.flexWrap="wrap";
    buttons.appendChild(mkBtn("MENÜ", ()=>game.goMenuAfterDead(), "gold"));
    p.appendChild(buttons);

    hudEl.appendChild(p);
  }

  ui.onFrame = (dt)=>{
    ui.toastT=Math.max(0, ui.toastT-dt);
  };

  ui.onUnlock = ({ids, rewardsText})=>{
    if(ids.length){
      toast(`Unlock: ${ids.join(", ")} • ${rewardsText}`);
      // save already updated by game
      ui.save = loadSave();
    }
  };

  ui.getSave = ()=>ui.save;
  ui.setSave = (s)=>{ ui.save=s; saveSave(ui.save); };

  ui.getSettings=()=>ui.settings;
  ui.setSettings=(s)=>{ ui.settings=s; saveSettings(ui.settings); audioSetSettings(ui.settings); };

  ui.render = render;
  ui.toast = toast;

  return ui;
}
