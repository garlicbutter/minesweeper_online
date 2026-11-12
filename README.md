# Minefield — Rust Minesweeper

Single-player and online 1v1 Minesweeper. The server and all game rules are written in Rust. The same engine compiles to WebAssembly for instant, browser-local solo play. HTML/CSS and a small JavaScript interface handle rendering and input; Node.js is not required to build or run the game.

## Run with Docker (one command)

```sh
docker compose up --build -d
```

Open **http://localhost:3000**. Docker builds the Rust server and browser engine, runs the Rust tests, and starts the application. Multiplayer rooms persist in the `minefield-data` volume. Use one server instance.

```sh
docker compose logs -f
# Stop without deleting room data:
docker compose down
```

For a different host port: `PORT=8080 docker compose up --build -d`.

## Run locally with Rust

Install a Rust toolchain (1.90 or later recommended), then:

```sh
rustup target add wasm32-unknown-unknown
./scripts/build.sh
./target/release/minefield
```

Open **http://localhost:3000**. The build script compiles the browser engine to `public/minefield.wasm` and the native server to `target/release/minefield`. No wasm-pack or wasm-bindgen CLI is needed.

Configuration:

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3000` | Listen port, on all interfaces |
| `DATA_DIR` | `.data` | Multiplayer room snapshots |
| `PUBLIC_DIR` | `public` | Directory containing `minefield.wasm` |

The server binary embeds the HTML/CSS/JS interface. Run it from the checkout, or copy `public/minefield.wasm` alongside it under `public/`.

## Play solo

**Single player** is selected by default. Choose a difficulty and click **Start single player**. Every square stays covered until your actual first click. That click is always safe and starts the timer. All solo moves run locally in Rust WebAssembly without API requests. Reloading resumes the current tab’s saved game.

- Easy: 9 × 9, 10 mines.
- Medium: 16 × 16, 40 mines.
- Hard: 30 × 16, 99 mines.
- Custom: width 5–40, height 5–30, 1 to (width × height − 9) mines.

Left-click to reveal. Right-click to flag. Press and hold a revealed number to highlight its neighbors. With a mouse or pen, matching adjacent flags perform the chord on press; otherwise the board stays unchanged and the highlight clears on release. Touch uses the same preview and chords on a completed tap. Incorrect flags can uncover a mine. Touch users can toggle **Flag mode**. Keyboard: Tab to focus, arrows to move, Enter to reveal/chord, F to flag.

**Play again** creates a fresh, fully covered board. **Leave / Reset** clears the board, timer, flag mode, invite URL, and saved session immediately and restores setup, even while a network request is stalled.

## Challenge a friend

1. Choose **Create room**, enter your name and difficulty, then **Create challenge**.
2. Share the six-character code or **Copy invite** link.
3. Your friend opens the same website, selects **Join room** (or opens the invite link), and chooses their own preset or custom difficulty.
4. Both click **Ready to play**, wait for the three-second countdown, then choose a first square.

Each player has a separate map with their own dimensions and mine count. Difficulty can also be changed in the lobby before clicking Ready. Each map is generated on its player's actual first click, which is safe; you do not wait for the other player's opening. The shared match timer starts on the first opening.

Both players’ completion bars show their own map sizes, mine counts, and cleared percentages. The opponent’s board shows **all numbers and mines**, with cleared cells outlined in green. A board remains blank until its player clicks and generates it. Updates arrive every second. Your own hidden cells stay covered, and session tokens stay private.

**Multiplayer mine hits are a setback, not a loss:** a 6 × 6 region around the mine flashes, its revealed cells and flags return to unknown, and its mines reshuffle. The region keeps exactly the same mine count, and mine positions outside it stay fixed. Clues across the whole board are recalculated, so already visible numbers along the boundary can change. The clicked mine becomes safe if the region has any safe squares. At edges the region shifts inward to retain its size; dimensions smaller than six use the available size (e.g. a 5 × 5 board resets entirely). The opponent’s board is unaffected. Repeated hits are allowed and counted.

First to clear every safe cell on their own board wins. Leaving an active match forfeits it. Solo play retains the classic mine-hit loss. The host can start a rematch, keeping both chosen difficulties.

To test both players on one computer, use separate browser profiles or an incognito window. For the same Wi-Fi, use the host’s LAN address (e.g. `http://192.168.1.20:3000`) on both devices. Run `hostname -I` to find it. Open that address before copying an invite; localhost links only work on the host computer.

## Deploy on Render

The included `render.yaml` now uses **Docker**, replacing the previous Node runtime.

1. Push this commit to GitHub.
2. In [Render](https://dashboard.render.com/), create or sync a Blueprint from the repository using `render.yaml`. It builds the root `Dockerfile` and runs the compiled Rust binary.
3. Open the service’s HTTPS URL. Both players use that same URL.

**Existing Node service:** change its runtime to Docker and remove any `npm` build/start overrides before redeploying. If your dashboard does not offer that change, create a new Docker service from this repository instead. Merely deploying a new commit with the old Node commands will fail.

Dockerfile path: `./Dockerfile`. Health check: `/health`. Docker command: leave blank to use the image’s `CMD`. The image includes the Rust WebAssembly engine; it needs no Node installation at runtime.

Render free instances have ephemeral storage and can restart or sleep. Rooms can be lost on a restart/redeploy. For persistent hosting, use a server with the Docker volume, or a persistent disk mounted at `/app/.data`. Do not scale beyond one instance.

Official guidance: [Docker on Render](https://render.com/docs/docker), [native runtime changes](https://render.com/docs/native-runtimes), [free service limits](https://render.com/docs/free).

## Architecture and storage

- `src/game.rs`: shared Rust rules, random mine generation, flood fill, flags, chording, wins/losses, independent maps, explosion penalties, and player views.
- `src/wasm.rs`: a small JSON/memory bridge to the same Rust rules in the browser.
- `public/game.js`: WebAssembly loading and JavaScript bindings; it contains no mine-generation or gameplay implementation.
- `src/server.rs`: Axum HTTP API, embedded interface assets, room locking, and durable snapshots.
- `src/main.rs`: Tokio server, background persistence, and graceful shutdown.
- `public/app.js`: browser input/rendering, incremental tile updates, and immediate reset.

Room operations are serialized in memory. Presence pings do not trigger disk writes. Changed rooms are saved together every 150 ms; a normal shutdown flushes pending changes. `rooms.json` retains the previous Node server’s JSON schema, so existing unexpired snapshots can be loaded. Rooms expire after 24 hours. Solo state stays in browser session storage. This is a casual game without accounts or production rate limiting.

Mine placement uses unbiased Fisher–Yates shuffling. On the server, randomness comes from Rust’s securely seeded random generator; in WebAssembly it comes from browser Web Crypto. Each player’s first cell and its eight neighbors are protected at generation. Multiplayer maps are independent, allowing different difficulties and local reshuffles. Standard random maps may require guessing.

References: [board generation](https://minesweeper.now/developers/minesweeper-algorithms), [chording rules](https://www.chiark.greenend.org.uk/~sgtatham/puzzles/doc/mines.html).

## Verify

```sh
cargo test --locked
cargo fmt --check
cargo clippy --locked --all-targets -- -D warnings
```

Rust tests cover generation invariants, custom input validation, safe first clicks, chording, independent preset/custom maps, full opponent views, 6 × 6 blast geometry, mine-count preservation, clue consistency after reshuffling, edge and small-board explosions, unaffected opponents, room APIs, persistence, expiration, forfeit, and rematches.

Optional end-to-end browser check (requires Playwright/Chromium installed separately; Node is used only by this developer test):

```sh
# Start the Rust server first, then:
PLAYWRIGHT_PATH=/path/to/playwright node tests/browser-smoke.cjs
PLAYWRIGHT_PATH=/path/to/playwright node tests/chord-preview.cjs
```

It checks browser-local solo play with API access blocked, click latency, persistent DOM tiles, covered starts/replays, two-player play with different difficulties, safe openings, all opponent numbers/mines, continued play after explosions, nonselectable tile text, reset during a stalled request, and the mobile layout. Set `TEST_URL` to use a different address.

The focused chord check covers held neighbor highlighting, mismatched flags, matching chords on press, release without duplicate actions, redraws, edge bounds, keyboard activation, blur/reset cleanup, and touch cancellation/tapping.
