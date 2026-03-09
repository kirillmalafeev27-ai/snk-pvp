const canvas = document.getElementById("gameCanvas");
const ctx = canvas.getContext("2d");

const phaseValue = document.getElementById("phaseValue");
const levelValue = document.getElementById("levelValue");
const seqValue = document.getElementById("seqValue");
const speedValue = document.getElementById("speedValue");
const roleValue = document.getElementById("roleValue");
const slotValue = document.getElementById("slotValue");
const statusMessage = document.getElementById("statusMessage");

const pickBlueBtn = document.getElementById("pickBlueBtn");
const pickYellowBtn = document.getElementById("pickYellowBtn");
const speedUpBtn = document.getElementById("speedUp");
const speedDownBtn = document.getElementById("speedDown");
const pauseBtn = document.getElementById("pauseBtn");
const resetSeqBtn = document.getElementById("resetSeqBtn");
const dpadButtons = Array.from(document.querySelectorAll("[data-dir]"));

let socket;
let clientRole = "spectator";
let gameState = null;
let reconnectTimer = null;

const fallbackWorld = {
  width: 1350,
  height: 900,
  panelHeight: 150,
  playfield: { x: 75, y: 76, w: 1200, h: 660 },
};

function sendMessage(payload) {
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(payload));
  }
}

function setStatus(text) {
  statusMessage.textContent = text;
}

function isPlayerRole() {
  return clientRole === "blue" || clientRole === "yellow";
}

function connectWebSocket() {
  const wsProtocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  socket = new WebSocket(`${wsProtocol}//${window.location.host}`);

  socket.addEventListener("open", () => {
    setStatus("Connected. Select Blue or Yellow snake.");
  });

  socket.addEventListener("message", (event) => {
    let payload;
    try {
      payload = JSON.parse(event.data);
    } catch {
      return;
    }

    if (payload.type === "welcome") {
      clientRole = payload.role || "spectator";
      updateRoleUi();
    } else if (payload.type === "role") {
      clientRole = payload.role || "spectator";
      updateRoleUi();
    } else if (payload.type === "state") {
      gameState = payload.state;
      updateHud();
      updateRoleUi();
    } else if (payload.type === "error") {
      setStatus(payload.message || "Server error.");
    } else if (payload.type === "info") {
      setStatus(payload.message || "Server info.");
    }
  });

  socket.addEventListener("close", () => {
    setStatus("Connection lost. Reconnecting...");
    if (reconnectTimer) {
      window.clearTimeout(reconnectTimer);
    }
    reconnectTimer = window.setTimeout(connectWebSocket, 1200);
  });
}

function updateRoleUi() {
  roleValue.textContent = `Your role: ${clientRole}`;

  const state = gameState;
  const blueTaken = Boolean(state?.slots?.blueTaken);
  const yellowTaken = Boolean(state?.slots?.yellowTaken);
  const yellowLockedByOrder = !blueTaken && clientRole !== "yellow";

  pickBlueBtn.disabled = (blueTaken && clientRole !== "blue") || clientRole === "yellow";
  pickYellowBtn.disabled = ((yellowTaken && clientRole !== "yellow") || yellowLockedByOrder) || clientRole === "blue";

  if (!state) {
    slotValue.textContent = "Blue free | Yellow free";
  } else {
    slotValue.textContent = `${blueTaken ? "Blue taken" : "Blue free"} | ${yellowTaken ? "Yellow taken" : "Yellow free"}`;
  }

  const controlsEnabled = isPlayerRole() && state?.phase === "running";
  speedUpBtn.disabled = !controlsEnabled;
  speedDownBtn.disabled = !controlsEnabled;
  pauseBtn.disabled = !isPlayerRole() || !state || state.phase !== "running";
  resetSeqBtn.disabled = !isPlayerRole();
  for (const btn of dpadButtons) {
    btn.disabled = !controlsEnabled;
  }
}

function updateHud() {
  if (!gameState) {
    return;
  }

  phaseValue.textContent = `Phase: ${gameState.phase}${gameState.paused ? " (paused)" : ""}`;
  levelValue.textContent = `Level ${Math.min(gameState.currentLevel + 1, gameState.levelCount)}/${gameState.levelCount}`;
  seqValue.textContent = `Sequence ${gameState.sequence.picked}/${gameState.sequence.total}`;

  let localSpeed = "-";
  if (clientRole === "blue" && gameState.players?.blue) {
    localSpeed = String(gameState.players.blue.speed);
  } else if (clientRole === "yellow" && gameState.players?.yellow) {
    localSpeed = String(gameState.players.yellow.speed);
  }
  speedValue.textContent = localSpeed;

  if (gameState.message) {
    setStatus(gameState.message);
  }
}

function roundRect(context, x, y, width, height, radius, fill, stroke) {
  const r = Math.min(radius, width / 2, height / 2);
  context.beginPath();
  context.moveTo(x + r, y);
  context.lineTo(x + width - r, y);
  context.quadraticCurveTo(x + width, y, x + width, y + r);
  context.lineTo(x + width, y + height - r);
  context.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  context.lineTo(x + r, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - r);
  context.lineTo(x, y + r);
  context.quadraticCurveTo(x, y, x + r, y);
  context.closePath();
  if (fill) context.fill();
  if (stroke) context.stroke();
}

function hexToRgb(hex) {
  const clean = hex.replace("#", "");
  return [
    parseInt(clean.slice(0, 2), 16),
    parseInt(clean.slice(2, 4), 16),
    parseInt(clean.slice(4, 6), 16),
  ];
}

function rgbToHex(r, g, b) {
  const pad = (v) => v.toString(16).padStart(2, "0");
  return `#${pad(r)}${pad(g)}${pad(b)}`;
}

function tintColor(hex, amount) {
  const [r, g, b] = hexToRgb(hex);
  const nr = Math.max(0, Math.min(255, r + amount));
  const ng = Math.max(0, Math.min(255, g + amount));
  const nb = Math.max(0, Math.min(255, b + amount));
  return rgbToHex(nr, ng, nb);
}

function lerpColor(hexA, hexB, t) {
  const a = hexToRgb(hexA);
  const b = hexToRgb(hexB);
  const r = Math.round(a[0] + (b[0] - a[0]) * t);
  const g = Math.round(a[1] + (b[1] - a[1]) * t);
  const c = Math.round(a[2] + (b[2] - a[2]) * t);
  return rgbToHex(r, g, c);
}

function drawGlossyCircle(x, y, radius, color) {
  ctx.fillStyle = "rgba(0, 0, 0, 0.34)";
  ctx.beginPath();
  ctx.arc(x + 3, y + 4, radius, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fill();

  const shine = tintColor(color, 50);
  ctx.fillStyle = shine;
  ctx.beginPath();
  ctx.arc(x - radius / 3, y - radius / 3, Math.max(4, radius / 3), 0, Math.PI * 2);
  ctx.fill();
}

function drawScene(now, world) {
  const bg = ctx.createLinearGradient(0, 0, 0, world.height);
  bg.addColorStop(0, "#1a2456");
  bg.addColorStop(1, "#0b1027");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, world.width, world.height);

  const glowA = ctx.createRadialGradient(180, 130, 30, 180, 130, 280);
  glowA.addColorStop(0, "rgba(255, 148, 76, 0.34)");
  glowA.addColorStop(1, "rgba(255, 148, 76, 0)");
  ctx.fillStyle = glowA;
  ctx.fillRect(0, 0, world.width, world.height);

  const glowB = ctx.createRadialGradient(world.width - 180, 150, 20, world.width - 180, 150, 290);
  glowB.addColorStop(0, "rgba(80, 137, 255, 0.34)");
  glowB.addColorStop(1, "rgba(80, 137, 255, 0)");
  ctx.fillStyle = glowB;
  ctx.fillRect(0, 0, world.width, world.height);

  const panel = ctx.createLinearGradient(0, world.height - world.panelHeight, 0, world.height);
  panel.addColorStop(0, "#ff9f58");
  panel.addColorStop(1, "#d4592f");
  ctx.fillStyle = panel;
  ctx.fillRect(0, world.height - world.panelHeight, world.width, world.panelHeight);

  ctx.fillStyle = "#2f7452";
  roundRect(ctx, world.playfield.x, world.playfield.y + 8, world.playfield.w, world.playfield.h, 34, true, false);
  ctx.fillStyle = "#69d89d";
  roundRect(ctx, world.playfield.x, world.playfield.y, world.playfield.w, world.playfield.h, 30, true, false);

  ctx.strokeStyle = "rgba(139, 229, 182, 0.52)";
  ctx.lineWidth = 1;
  for (let x = world.playfield.x + 40; x < world.playfield.x + world.playfield.w; x += 40) {
    ctx.beginPath();
    ctx.moveTo(x, world.playfield.y + 10);
    ctx.lineTo(x, world.playfield.y + world.playfield.h - 10);
    ctx.stroke();
  }
  for (let y = world.playfield.y + 40; y < world.playfield.y + world.playfield.h; y += 40) {
    ctx.beginPath();
    ctx.moveTo(world.playfield.x + 10, y);
    ctx.lineTo(world.playfield.x + world.playfield.w - 10, y);
    ctx.stroke();
  }

  if (gameState && gameState.message && now < gameState.messageUntil) {
    ctx.fillStyle = "rgba(0, 0, 0, 0.42)";
    roundRect(ctx, world.width / 2 - 220, 32, 440, 56, 14, true, false);
    ctx.fillStyle = "#2341a3";
    roundRect(ctx, world.width / 2 - 224, 28, 440, 56, 14, true, false);
    ctx.fillStyle = "#ffffff";
    ctx.font = "800 34px Manrope";
    ctx.textAlign = "center";
    ctx.fillText(gameState.message, world.width / 2, 65);
    ctx.textAlign = "left";
  }
}

function drawSnake(player) {
  if (!player || !player.selected || !player.snake || player.snake.length === 0) {
    return;
  }

  const base = player.color || "#ffe636";
  const dark = tintColor(base, -70);

  for (let i = 0; i < player.snake.length - 1; i += 1) {
    const part = player.snake[i];
    const next = player.snake[i + 1];
    const t = i / Math.max(1, player.snake.length - 1);
    const color = lerpColor(base, dark, t);
    ctx.strokeStyle = color;
    ctx.lineWidth = 31;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(part.x, part.y);
    ctx.lineTo(next.x, next.y);
    ctx.stroke();
    drawGlossyCircle(part.x, part.y, 15, color);
  }

  const head = player.snake[0];
  drawGlossyCircle(head.x, head.y, 15, base);

  ctx.fillStyle = "#111114";
  if (player.direction === "LEFT" || player.direction === "RIGHT") {
    ctx.beginPath();
    ctx.arc(head.x, head.y - 7, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(head.x, head.y + 7, 3, 0, Math.PI * 2);
    ctx.fill();
  } else {
    ctx.beginPath();
    ctx.arc(head.x - 7, head.y, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(head.x + 7, head.y, 3, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawFruits(state) {
  if (!state.fruits) {
    return;
  }
  for (const fruit of state.fruits) {
    drawGlossyCircle(fruit.pos.x, fruit.pos.y, 15, fruit.type.color);
  }
}

function drawBottomPanel(state, world) {
  if (!state.fruitTypes) {
    return;
  }

  ctx.fillStyle = "#ffffff";
  ctx.font = "700 27px Manrope";
  let y = world.height - world.panelHeight + 34;
  for (const fruitType of state.fruitTypes) {
    ctx.fillStyle = fruitType.color;
    ctx.beginPath();
    ctx.arc(42, y - 8, 12, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#ffffff";
    ctx.fillText(fruitType.description, 68, y);
    y += 23;
  }

  const blue = state.players.blue;
  const yellow = state.players.yellow;

  ctx.fillStyle = "#ffffff";
  ctx.font = "800 23px Manrope";
  ctx.fillText(
    `Blue: lives ${blue.lives} speed ${blue.speed}${blue.invincible ? " INV" : ""}`,
    world.width / 2 - 140,
    world.height - world.panelHeight + 34,
  );
  ctx.fillText(
    `Yellow: lives ${yellow.lives} speed ${yellow.speed}${yellow.invincible ? " INV" : ""}`,
    world.width / 2 - 140,
    world.height - world.panelHeight + 64,
  );
  ctx.fillText(
    `Sequence ${state.sequence.picked}/${state.sequence.total}`,
    world.width / 2 - 95,
    world.height - world.panelHeight + 94,
  );
}

function drawOverlayText(world, text, subText) {
  ctx.fillStyle = "rgba(0, 0, 0, 0.38)";
  ctx.fillRect(0, 0, world.width, world.height);
  ctx.fillStyle = "#ffffff";
  ctx.font = "800 64px Russo One";
  ctx.textAlign = "center";
  ctx.fillText(text, world.width / 2, world.height / 2 - 10);
  if (subText) {
    ctx.font = "700 28px Manrope";
    ctx.fillText(subText, world.width / 2, world.height / 2 + 34);
  }
  ctx.textAlign = "left";
}

function render() {
  const state = gameState;
  const world = state?.world || fallbackWorld;
  const now = Date.now();

  drawScene(now, world);
  if (!state) {
    drawOverlayText(world, "CONNECTING", "Please wait for server state.");
    return;
  }

  drawFruits(state);
  drawSnake(state.players.blue);
  drawSnake(state.players.yellow);
  drawBottomPanel(state, world);

  if (state.phase === "waiting") {
    const needText = !state.slots.blueTaken
      ? "Waiting for Blue selection"
      : !state.slots.yellowTaken
        ? "Waiting for Yellow selection"
        : "Waiting to start";
    drawOverlayText(world, "WAITING ROOM", needText);
  } else if (state.phase === "finished") {
    drawOverlayText(world, "MATCH FINISHED", "Refresh page to start new class round.");
  } else if (state.paused) {
    drawOverlayText(world, "PAUSE", "Game paused by player");
  }
}

function animate() {
  render();
  window.requestAnimationFrame(animate);
}

function bindControls() {
  pickBlueBtn.addEventListener("click", () => {
    sendMessage({ type: "selectColor", color: "blue" });
  });

  pickYellowBtn.addEventListener("click", () => {
    sendMessage({ type: "selectColor", color: "yellow" });
  });

  speedUpBtn.addEventListener("click", () => {
    sendMessage({ type: "input", action: "speed", delta: 1 });
  });

  speedDownBtn.addEventListener("click", () => {
    sendMessage({ type: "input", action: "speed", delta: -1 });
  });

  pauseBtn.addEventListener("click", () => {
    sendMessage({ type: "input", action: "pause_toggle" });
  });

  resetSeqBtn.addEventListener("click", () => {
    sendMessage({ type: "input", action: "reset_sequence" });
  });

  dpadButtons.forEach((button) => {
    button.addEventListener("pointerdown", () => {
      sendMessage({ type: "input", action: "direction", direction: button.dataset.dir });
    });
  });

  window.addEventListener("keydown", (event) => {
    if (event.key === "ArrowUp" || event.key === "w" || event.key === "W") {
      sendMessage({ type: "input", action: "direction", direction: "UP" });
    } else if (event.key === "ArrowDown" || event.key === "s" || event.key === "S") {
      sendMessage({ type: "input", action: "direction", direction: "DOWN" });
    } else if (event.key === "ArrowLeft" || event.key === "a" || event.key === "A") {
      sendMessage({ type: "input", action: "direction", direction: "LEFT" });
    } else if (event.key === "ArrowRight" || event.key === "d" || event.key === "D") {
      sendMessage({ type: "input", action: "direction", direction: "RIGHT" });
    } else if (event.key === "+" || event.key === "=") {
      sendMessage({ type: "input", action: "speed", delta: 1 });
    } else if (event.key === "-" || event.key === "_") {
      sendMessage({ type: "input", action: "speed", delta: -1 });
    } else if (event.key === "p" || event.key === "P") {
      sendMessage({ type: "input", action: "pause_toggle" });
    } else if (event.key === "z" || event.key === "Z") {
      sendMessage({ type: "input", action: "reset_sequence" });
    }
  });
}

bindControls();
connectWebSocket();
updateRoleUi();
updateHud();
window.requestAnimationFrame(animate);
