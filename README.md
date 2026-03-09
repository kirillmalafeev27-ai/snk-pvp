# Snake PvP Classroom

This is a separate PvP project with synchronized gameplay over WebSocket.

## What it does

- Game starts in `waiting` mode, snakes do not move.
- First player must select `Blue` snake.
- Second player then selects `Yellow` snake.
- After both are selected, match starts automatically.
- Any extra clients become spectators and see full live game state.
- Learning mechanics are preserved: levels, fruit effects, color sequence task.

## Run

1. Open terminal in `snake_web_pvp`.
2. Install dependency:

```bash
npm install
```

3. Start server:

```bash
npm start
```

4. Open in browser:

```text
http://localhost:8080
```

## Open from phones on same network

1. Find your PC local IP (for example `192.168.0.23`).
2. Keep server running on PC.
3. Open from phone browser:

```text
http://192.168.0.23:8080
```

All devices opening this same URL join the same synchronized game session.
