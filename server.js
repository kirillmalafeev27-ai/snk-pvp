const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const path = require("path");
const WebSocket = require("ws");

const PORT = process.env.PORT || 8080;
const PUBLIC_DIR = path.join(__dirname, "public");

const WORLD_W = 1350;
const WORLD_H = 900;
const PANEL_H = 150;
const PLAYFIELD = { x: 75, y: 76, w: WORLD_W - 150, h: WORLD_H - 240 };

const snakeSize = 31;
const fruitSize = snakeSize;
const collisionRadius = 45;
const baseSpeed = 3;
const speedMin = 2;
const speedMax = baseSpeed + 10;
const numFruits = 6;

const colors = {
  red: "#ff4242",
  yellow: "#ffe636",
  blue: "#4294ff",
  purple: "#976bff",
  orange: "#ff9d4d",
  pink: "#ff69b4",
  blueSnake: "#3fa8ff",
  yellowSnake: "#ffd84a",
};

const baseFruitTypes = [
  { color: colors.red, effect: "grow", description: "er/es/sie" },
  { color: colors.yellow, effect: "speed_up", description: "spiele" },
  { color: colors.blue, effect: "slow_down", description: "du" },
  { color: colors.purple, effect: "extra_life", description: "telefonierst" },
  { color: colors.orange, effect: "invincible", description: "sammelt" },
  { color: colors.pink, effect: "shrink", description: "ich" },
];

const levels = [
  {
    sequence: [colors.pink, colors.blue, colors.yellow, colors.purple, colors.red, colors.orange],
    snakeSpeed: baseSpeed,
    description: ["und", "sehr", "bist", "sportlich", "stark", "Du"],
  },
  {
    sequence: [colors.orange, colors.red, colors.purple, colors.yellow, colors.blue, colors.pink],
    snakeSpeed: baseSpeed + 4,
    description: ["schicken", "chillt", "sie", "ihr", "wir", "grillen"],
  },
  {
    sequence: [colors.pink, colors.blue, colors.yellow, colors.purple, colors.red, colors.orange],
    snakeSpeed: baseSpeed + 8,
    description: [
      "mit Tomaten",
      "ernaehren moechte",
      "mich frisch und gesund",
      "koche ich Gerichte",
      "und Bohnen",
      "Wenn ich",
    ],
  },
  {
    sequence: [colors.pink, colors.blue, colors.yellow, colors.purple, colors.red, colors.orange],
    snakeSpeed: baseSpeed + 10,
    description: [
      "frische Zutaten und",
      "Pizza backen",
      "zu Hause gemeinsam",
      "verwenden wir immer",
      "vermeiden viel Fett",
      "Wenn wir",
    ],
  },
];

const fruitLimits = {
  grow: 1,
  speed_up: 1,
  slow_down: 1,
  extra_life: 1,
  invincible: 1,
  shrink: 1,
};

const clients = new Map();
let state = createInitialState();
state.fruits = spawnFruits(state);

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function randomInRange(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function buildFruitTypes(levelIndex) {
  const level = levels[levelIndex];
  return baseFruitTypes.map((item, i) => ({
    ...item,
    description: level.description[i],
  }));
}

function createPlayerState(id, renderColor, startPos, startDirection) {
  return {
    id,
    renderColor,
    selected: false,
    connected: false,
    clientId: null,
    snake: [{ x: startPos.x, y: startPos.y }],
    snakeLength: 10,
    direction: startDirection,
    moveX: 0,
    moveY: 0,
    speed: baseSpeed,
    lives: 100,
    invincibleUntil: 0,
    lastMoveAt: Date.now(),
  };
}

function resetPlayerState(player, startPos, startDirection) {
  player.selected = false;
  player.connected = false;
  player.clientId = null;
  player.snake = [{ x: startPos.x, y: startPos.y }];
  player.snakeLength = 10;
  player.direction = startDirection;
  player.moveX = 0;
  player.moveY = 0;
  player.speed = baseSpeed;
  player.lives = 100;
  player.invincibleUntil = 0;
  player.lastMoveAt = Date.now();
}

function createInitialState() {
  const now = Date.now();
  return {
    phase: "waiting",
    paused: false,
    currentLevel: 0,
    correctSequence: [...levels[0].sequence],
    pickedColors: [],
    fruitTypes: buildFruitTypes(0),
    fruits: [],
    message: "Waiting room: first choose Blue, then Yellow.",
    messageUntil: now + 10000,
    startTime: now,
    collisionEnabled: false,
    players: {
      blue: createPlayerState(
        "blue",
        colors.blueSnake,
        { x: PLAYFIELD.x + 220, y: PLAYFIELD.y + PLAYFIELD.h / 2 },
        "RIGHT",
      ),
      yellow: createPlayerState(
        "yellow",
        colors.yellowSnake,
        { x: PLAYFIELD.x + PLAYFIELD.w - 220, y: PLAYFIELD.y + PLAYFIELD.h / 2 },
        "LEFT",
      ),
    },
  };
}

function setStatus(text, durationMs = 1800) {
  state.message = text;
  state.messageUntil = Date.now() + durationMs;
}

function updateVelocity(player) {
  if (state.phase !== "running" || !player.selected || player.lives <= 0) {
    player.moveX = 0;
    player.moveY = 0;
    return;
  }
  if (player.direction === "UP") {
    player.moveX = 0;
    player.moveY = -player.speed;
  } else if (player.direction === "DOWN") {
    player.moveX = 0;
    player.moveY = player.speed;
  } else if (player.direction === "LEFT") {
    player.moveX = -player.speed;
    player.moveY = 0;
  } else {
    player.moveX = player.speed;
    player.moveY = 0;
  }
}

function setDirection(player, newDirection) {
  const opposite = { UP: "DOWN", DOWN: "UP", LEFT: "RIGHT", RIGHT: "LEFT" };
  if (!opposite[newDirection]) {
    return;
  }
  if (opposite[player.direction] !== newDirection) {
    player.direction = newDirection;
    updateVelocity(player);
  }
}

function changeSpeed(player, delta) {
  player.speed = clamp(player.speed + delta, speedMin, speedMax);
  updateVelocity(player);
}

function countFruitTypes(fruits) {
  const count = { grow: 0, speed_up: 0, slow_down: 0, extra_life: 0, invincible: 0, shrink: 0 };
  for (const fruit of fruits) {
    count[fruit.type.effect] += 1;
  }
  return count;
}

function spawnLimitedFruit(gameState, currentFruits) {
  const count = countFruitTypes(currentFruits);
  const available = gameState.fruitTypes.filter((type) => count[type.effect] < fruitLimits[type.effect]);
  if (available.length === 0) {
    return null;
  }
  const type = available[randomInRange(0, available.length - 1)];
  return {
    pos: {
      x: randomInRange(PLAYFIELD.x + 30, PLAYFIELD.x + PLAYFIELD.w - 30),
      y: randomInRange(PLAYFIELD.y + 30, PLAYFIELD.y + PLAYFIELD.h - 30),
    },
    type,
  };
}

function spawnFruits(gameState) {
  const list = [];
  while (list.length < numFruits) {
    const fruit = spawnLimitedFruit(gameState, list);
    if (!fruit) {
      break;
    }
    list.push(fruit);
  }
  return list;
}

function checkSequence() {
  if (state.pickedColors.length !== state.correctSequence.length) {
    return;
  }

  const ok = state.pickedColors.every((color, i) => color === state.correctSequence[i]);
  state.pickedColors = [];
  if (ok) {
    setStatus("Great! Sequence complete.");
    nextLevel();
  } else {
    setStatus("Wrong sequence. Try again.");
  }
}

function nextLevel() {
  state.currentLevel += 1;
  if (state.currentLevel >= levels.length) {
    state.phase = "finished";
    setStatus("All levels complete!", 5000);
    for (const player of Object.values(state.players)) {
      player.moveX = 0;
      player.moveY = 0;
    }
    return;
  }

  state.correctSequence = [...levels[state.currentLevel].sequence];
  state.fruitTypes = buildFruitTypes(state.currentLevel);
  state.fruits = spawnFruits(state);

  for (const player of Object.values(state.players)) {
    if (!player.selected) {
      continue;
    }
    player.speed = clamp(levels[state.currentLevel].snakeSpeed, speedMin, speedMax);
    updateVelocity(player);
  }

  setStatus(`Level ${state.currentLevel + 1}`);
}

function checkWallCollision(head) {
  const minX = PLAYFIELD.x + snakeSize / 2;
  const maxX = PLAYFIELD.x + PLAYFIELD.w - snakeSize / 2;
  const minY = PLAYFIELD.y + snakeSize / 2;
  const maxY = PLAYFIELD.y + PLAYFIELD.h - snakeSize / 2;
  return head.x < minX || head.x > maxX || head.y < minY || head.y > maxY;
}

function findSelfCollisionIndex(player) {
  const head = player.snake[0];
  for (let i = 4; i < player.snake.length; i += 1) {
    if (distance(head, player.snake[i]) < snakeSize * 0.48) {
      return i;
    }
  }
  return -1;
}

function hitOpponentBody(attacker, defender) {
  if (!defender.selected || defender.snake.length < 2) {
    return false;
  }
  const head = attacker.snake[0];
  for (let i = 1; i < defender.snake.length; i += 1) {
    if (distance(head, defender.snake[i]) < snakeSize * 0.48) {
      return true;
    }
  }
  return false;
}

function bouncePlayer(player) {
  if (!player.snake.length) {
    return;
  }
  const head = { ...player.snake[0] };
  const push = 46;
  if (player.direction === "RIGHT") {
    head.x -= push;
  } else if (player.direction === "LEFT") {
    head.x += push;
  } else if (player.direction === "UP") {
    head.y += push;
  } else {
    head.y -= push;
  }

  const wobble = 4 * Math.sin(Date.now() / 85);
  if (player.direction === "LEFT" || player.direction === "RIGHT") {
    head.y += wobble;
  } else {
    head.x += wobble;
  }
  player.snake[0] = head;
}

function canTakeDamage(player, now) {
  return player.lives > 0 && now >= player.invincibleUntil;
}

function applyDamage(player, now) {
  if (!canTakeDamage(player, now)) {
    return;
  }
  player.lives = Math.max(0, player.lives - 1);
  bouncePlayer(player);
  if (player.lives <= 0) {
    player.moveX = 0;
    player.moveY = 0;
  }
}

function checkFruitCollisionForPlayer(player, now) {
  const newFruits = [];
  for (const fruit of state.fruits) {
    if (distance(player.snake[0], fruit.pos) < collisionRadius) {
      state.pickedColors.push(fruit.type.color);
      checkSequence();
      const effect = fruit.type.effect;
      if (effect === "grow") {
        player.snakeLength += 4;
      } else if (effect === "speed_up") {
        changeSpeed(player, 2);
        player.snakeLength += 4;
      } else if (effect === "slow_down") {
        changeSpeed(player, -2);
        player.snakeLength += 4;
      } else if (effect === "extra_life") {
        player.lives += 1;
        player.snakeLength += 4;
      } else if (effect === "invincible") {
        player.invincibleUntil = now + 5000;
        player.snakeLength += 4;
      } else if (effect === "shrink") {
        player.snakeLength = Math.max(player.snakeLength - 2, 5);
      }
    } else {
      newFruits.push(fruit);
    }
  }

  while (newFruits.length < numFruits) {
    const fruit = spawnLimitedFruit(state, newFruits);
    if (!fruit) {
      break;
    }
    newFruits.push(fruit);
  }
  state.fruits = newFruits;
}

function updatePlayer(player, now) {
  if (state.phase !== "running" || state.paused || !player.selected || player.lives <= 0) {
    return;
  }

  const moveInterval = Math.max(45, 210 - player.speed * 14);
  if (now - player.lastMoveAt < moveInterval) {
    return;
  }

  updateVelocity(player);
  if (player.moveX === 0 && player.moveY === 0) {
    return;
  }

  const head = player.snake[0];
  player.snake = [{ x: head.x + player.moveX, y: head.y + player.moveY }, ...player.snake.slice(0, -1)];
  while (player.snake.length < player.snakeLength) {
    player.snake.push({ ...player.snake[player.snake.length - 1] });
  }

  checkFruitCollisionForPlayer(player, now);

  if (checkWallCollision(player.snake[0])) {
    applyDamage(player, now);
  }

  if (state.collisionEnabled) {
    const selfCutIndex = findSelfCollisionIndex(player);
    if (selfCutIndex > 0) {
      player.snake = player.snake.slice(0, selfCutIndex);
      player.snakeLength = player.snake.length;
      applyDamage(player, now);
    }
  }

  player.lastMoveAt = now;
}

function handlePvpCollisions(now) {
  if (!state.collisionEnabled) {
    return;
  }
  const blue = state.players.blue;
  const yellow = state.players.yellow;
  if (!blue.selected || !yellow.selected || blue.lives <= 0 || yellow.lives <= 0) {
    return;
  }

  const blueHitsYellow = hitOpponentBody(blue, yellow);
  const yellowHitsBlue = hitOpponentBody(yellow, blue);
  const headToHead = distance(blue.snake[0], yellow.snake[0]) < snakeSize * 0.62;

  if (blueHitsYellow || headToHead) {
    applyDamage(blue, now);
  }
  if (yellowHitsBlue || headToHead) {
    applyDamage(yellow, now);
  }
}

function startMatchIfReady() {
  if (!state.players.blue.selected || !state.players.yellow.selected || state.phase !== "waiting") {
    return;
  }
  state.phase = "running";
  state.paused = false;
  state.startTime = Date.now();
  state.collisionEnabled = false;
  state.currentLevel = 0;
  state.correctSequence = [...levels[0].sequence];
  state.pickedColors = [];
  state.fruitTypes = buildFruitTypes(0);
  state.fruits = spawnFruits(state);

  for (const player of Object.values(state.players)) {
    player.speed = clamp(levels[0].snakeSpeed, speedMin, speedMax);
    player.lastMoveAt = Date.now();
    updateVelocity(player);
  }
  setStatus("Both players selected. Game started!", 2200);
}

function resetMatch(reason) {
  const now = Date.now();
  state.phase = "waiting";
  state.paused = false;
  state.currentLevel = 0;
  state.correctSequence = [...levels[0].sequence];
  state.pickedColors = [];
  state.fruitTypes = buildFruitTypes(0);
  state.fruits = [];
  state.startTime = now;
  state.collisionEnabled = false;

  resetPlayerState(
    state.players.blue,
    { x: PLAYFIELD.x + 220, y: PLAYFIELD.y + PLAYFIELD.h / 2 },
    "RIGHT",
  );
  resetPlayerState(
    state.players.yellow,
    { x: PLAYFIELD.x + PLAYFIELD.w - 220, y: PLAYFIELD.y + PLAYFIELD.h / 2 },
    "LEFT",
  );

  state.fruits = spawnFruits(state);
  setStatus(reason || "Waiting room: first choose Blue, then Yellow.", 5000);

  for (const client of clients.values()) {
    client.role = "spectator";
    safeSend(client.ws, { type: "role", role: "spectator" });
  }
}

function getRoleForClient(clientId) {
  const client = clients.get(clientId);
  return client ? client.role : "spectator";
}

function assignColor(clientId, color) {
  const client = clients.get(clientId);
  if (!client) {
    return;
  }

  if (color !== "blue" && color !== "yellow") {
    safeSend(client.ws, { type: "error", message: "Unknown color." });
    return;
  }

  if (color === "yellow" && !state.players.blue.selected) {
    safeSend(client.ws, { type: "error", message: "Blue must be selected first." });
    return;
  }

  const target = state.players[color];
  if (target.selected && target.clientId !== clientId) {
    safeSend(client.ws, { type: "error", message: `${color} is already taken.` });
    return;
  }

  if ((client.role === "blue" || client.role === "yellow") && client.role !== color) {
    safeSend(client.ws, {
      type: "error",
      message: "Role already locked for this session. Refresh page to switch role.",
    });
    return;
  }

  target.selected = true;
  target.connected = true;
  target.clientId = clientId;
  client.role = color;
  safeSend(client.ws, { type: "role", role: color });

  if (color === "blue") {
    setStatus("Blue selected. Waiting for Yellow.");
  }
  if (color === "yellow") {
    setStatus("Yellow selected.");
  }

  startMatchIfReady();
}

function serializePlayer(player) {
  return {
    selected: player.selected,
    connected: player.connected,
    color: player.renderColor,
    snake: player.snake.map((part) => ({ x: Math.round(part.x), y: Math.round(part.y) })),
    snakeLength: player.snakeLength,
    direction: player.direction,
    speed: player.speed,
    lives: player.lives,
    invincible: Date.now() < player.invincibleUntil,
  };
}

function buildStatePayload() {
  return {
    type: "state",
    state: {
      world: { width: WORLD_W, height: WORLD_H, panelHeight: PANEL_H, playfield: PLAYFIELD },
      phase: state.phase,
      paused: state.paused,
      currentLevel: state.currentLevel,
      levelCount: levels.length,
      sequence: {
        picked: state.pickedColors.length,
        total: state.correctSequence.length,
        values: [...state.pickedColors],
      },
      message: state.message,
      messageUntil: state.messageUntil,
      now: Date.now(),
      fruitTypes: state.fruitTypes,
      fruits: state.fruits.map((fruit) => ({ pos: fruit.pos, type: fruit.type })),
      players: {
        blue: serializePlayer(state.players.blue),
        yellow: serializePlayer(state.players.yellow),
      },
      slots: {
        blueTaken: state.players.blue.selected,
        yellowTaken: state.players.yellow.selected,
      },
    },
  };
}

function safeSend(ws, payload) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

function broadcastState() {
  const payload = buildStatePayload();
  for (const client of clients.values()) {
    safeSend(client.ws, payload);
  }
}

function handleInput(clientId, data) {
  const role = getRoleForClient(clientId);
  if (role !== "blue" && role !== "yellow") {
    return;
  }
  const player = state.players[role];
  if (!player || player.clientId !== clientId) {
    return;
  }

  if (data.action === "direction" && typeof data.direction === "string") {
    setDirection(player, data.direction);
  } else if (data.action === "speed" && typeof data.delta === "number") {
    changeSpeed(player, clamp(data.delta, -1, 1));
  } else if (data.action === "pause_toggle" && state.phase === "running") {
    state.paused = !state.paused;
    setStatus(state.paused ? "Paused by player." : "Resumed.", 1200);
  } else if (data.action === "reset_sequence") {
    state.pickedColors = [];
    setStatus("Sequence reset.", 1200);
  }
}

function handleDisconnect(clientId) {
  const client = clients.get(clientId);
  if (!client) {
    return;
  }
  const role = client.role;
  clients.delete(clientId);

  if (role === "blue" || role === "yellow") {
    resetMatch("A player disconnected. Select Blue then Yellow again.");
  }
}

function gameTick() {
  const now = Date.now();
  if (state.phase === "running" && !state.paused) {
    if (!state.collisionEnabled && now - state.startTime >= 5000) {
      state.collisionEnabled = true;
    }

    updatePlayer(state.players.blue, now);
    updatePlayer(state.players.yellow, now);
    handlePvpCollisions(now);

    if (state.players.blue.lives <= 0 && state.players.yellow.lives <= 0) {
      state.phase = "finished";
      setStatus("Both snakes are out. Match finished.", 5000);
    }
  }
  broadcastState();
}

function mimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".html") return "text/html; charset=utf-8";
  if (ext === ".css") return "text/css; charset=utf-8";
  if (ext === ".js") return "application/javascript; charset=utf-8";
  if (ext === ".json") return "application/json; charset=utf-8";
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".svg") return "image/svg+xml";
  return "application/octet-stream";
}

function serveStatic(req, res) {
  const urlPath = (req.url || "/").split("?")[0];
  const normalizedPath = urlPath === "/" ? "/index.html" : urlPath;
  const unsafePath = path.normalize(normalizedPath).replace(/^([/\\])+/g, "");
  const filePath = path.join(PUBLIC_DIR, unsafePath);

  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (error, fileContent) => {
    if (error) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not found");
      return;
    }
    res.writeHead(200, { "Content-Type": mimeType(filePath) });
    res.end(fileContent);
  });
}

const server = http.createServer(serveStatic);
const wss = new WebSocket.Server({ server });

wss.on("connection", (ws) => {
  const clientId = crypto.randomUUID();
  clients.set(clientId, { ws, role: "spectator" });

  safeSend(ws, { type: "welcome", clientId, role: "spectator" });
  safeSend(ws, { type: "role", role: "spectator" });
  safeSend(ws, {
    type: "info",
    message: "Join as Blue first, then Yellow. Others are spectators.",
  });
  safeSend(ws, buildStatePayload());

  ws.on("message", (raw) => {
    let data;
    try {
      data = JSON.parse(raw.toString());
    } catch {
      safeSend(ws, { type: "error", message: "Invalid JSON message." });
      return;
    }

    if (data.type === "selectColor") {
      assignColor(clientId, data.color);
    } else if (data.type === "input") {
      handleInput(clientId, data);
    }
  });

  ws.on("close", () => {
    handleDisconnect(clientId);
  });
});

setInterval(gameTick, 1000 / 30);

server.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Snake PvP server is running on http://localhost:${PORT}`);
});
