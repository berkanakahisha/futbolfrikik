import { createGame } from "./game.js";
import { createUI } from "./ui.js";
import { storageInit } from "./storage.js";
import { audioInit } from "./audio.js";

const canvas = document.getElementById("c");
const hud = document.getElementById("hud");

storageInit();
audioInit();

const game = createGame(canvas);
const ui = createUI(hud, game);

game.setUI(ui);
game.boot();
