# Working on Minefield

This file applies to the entire repository. See `README.md` for player-facing setup and deployment instructions.

## Stack and source ownership

- The server and game rules are Rust. Axum serves HTTP; Tokio runs the server and background persistence.
- `src/bot.rs` owns basic AI move selection from visible clues and flags. It must not inspect hidden layouts or the human’s board.
- `src/game.rs` owns generation, reveals, flood fill, flags, chording, independent player maps, explosions, wins, and player views.
- The same engine compiles to WebAssembly for browser-local solo play. Do not duplicate game rules in JavaScript.
- `src/wasm.rs` implements the JSON/memory bridge. `public/game.js` loads the module and exposes its bindings.
- `src/server.rs` owns API routes, room synchronization, snapshots, and asset serving. `src/main.rs` owns startup and shutdown.
- `public/app.js` owns browser interaction and incremental rendering. `public/index.html` and `public/style.css` own layout and appearance.
- Node.js is only needed for the optional Playwright smoke test. There is no Node application server or npm build pipeline.

## Build and run

Use Rust 1.90 or later for consistency with the Docker builder. `Cargo.toml` declares the minimum supported compiler.

```sh
rustup target add wasm32-unknown-unknown
./scripts/build.sh
./target/release/minefield
```

The build script compiles the browser engine with `--no-default-features`, copies it to `public/minefield.wasm`, and builds the native server. Keep native-only dependencies behind the `server` feature so the browser target continues to compile. No wasm-pack or wasm-bindgen CLI is required.

The native binary embeds HTML, CSS, and JavaScript with `include_str!`. Rebuild and restart it after interface changes. Rebuild WebAssembly after shared-engine or bridge changes. Editing files alone does not update assets embedded in an already running binary.

Environment variables:

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3000` | HTTP port; listens on all interfaces |
| `DATA_DIR` | `.data` | Multiplayer snapshots |
| `PUBLIC_DIR` | `public` | Directory containing the generated WebAssembly module |

Use a separate port and temporary `DATA_DIR` for development checks when a game might already be running:

```sh
PORT=3001 DATA_DIR=/tmp/minefield-qa ./target/release/minefield
```

## Gameplay requirements

### Common controls and starts

- Single player is the default mode.
- Every round starts fully covered. Do not automatically click or reveal an opening.
- Generate each player's map on their actual first unflagged reveal, protecting that square and its neighbors. Flagging does not consume the safe first click.
- Left-click a covered cell to reveal it. Left-click an open number to chord only when adjacent flags equal the clue. Right-click toggles flags; touch users have Flag mode.
- Pressing a revealed number previews its neighbors until release. Mouse/pen chords attempt on press; suppress the following click so the engine runs once. Preserve touch tap/scroll cancellation and keyboard activation. Clear previews on release, cancellation, lost capture, blur, reset, and round completion, and preserve them across polling redraws.
- Flood fill must respect flags and board boundaries.
- Tile text must remain nonselectable when dragged.
- Preserve keyboard controls, responsive layouts, and readable tile numbers.
- Fields must expand to their full height and fit the available width without internal scrolling or clipping. Use the full match area, hide setup during play, and stack boards when needed on narrow screens. Do not just hide scrollbars over clipped content.
- Keep the interface compact and functional: no promotional slogans, hero copy, decorative quotes, or repeated instructions. Put detailed rules in How to play.

### Single player

- Rules run synchronously in Rust WebAssembly without room API requests for moves.
- The timer starts on the first reveal. A mine hit ends a solo game.
- Session state survives a reload of the current tab. Replay produces a fully covered fresh board.

### Multiplayer

- Two players join through a six-character room code or invite link.
- Each player chooses their own preset or custom difficulty before readiness. They have separate settings and independent boards; do not restore the old identical-board design.
- Easy is 9×9/10 mines, medium 16×16/40, and hard 30×16/99. Custom width is 5–40, height 5–30, and mines 1 through `width * height - 9`.
- Both players ready up before the three-second countdown. Each first reveal opens that player's board immediately without waiting for the other player's opening. For multiplayer, set one shared `startedAt == availableAt` deadline when both are ready; the timer starts at the end of the countdown, even if a player has not clicked. Reject moves before that deadline. Solo still starts its timer on the first reveal.
- Progress percentages and totals use each player's own settings.
- The opponent panel mirrors only revealed tiles and placed flags. Mask every unrevealed opponent cell in the server response; do not send the hidden solution and merely hide it with CSS. Keep reset cells hidden after an explosion.
- Keep the viewer's own unrevealed cells masked in API responses. Never expose either player's session token in public views.
- First to clear every safe cell on their own board wins. Leaving an active match forfeits it. Host rematches preserve each player's difficulty and clear round progress and explosion counters.

### AI play testing

- Keep **vs AI** as a clearly labeled multiplayer test mode with a **Test AI** player, not a fake human or a second solo mode.
- AI decisions receive only the bot’s visible clues and flags. Use basic deductions, then guesses when necessary. Do not inspect the human’s board or hidden mine layout.
- The server schedules paced moves independently of browser requests; the current minimum interval is 700 ms. Respect human readiness and the countdown. Do not reveal the human’s opening automatically.
- Use normal multiplayer actions, win conditions, and reshuffle penalties. Stop after completion, forfeit, or expiry. Reset the AI’s board and scheduler for rematches and mark it ready automatically.
- Persist the AI marker and scheduler metadata with room snapshots. Hide unusable invite actions for AI rooms.

### Multiplayer explosion penalty

- A mine hit, including one from an incorrect chord, does not finish multiplayer. The affected player remains able to play.
- Reset a 6×6 region around the struck mine. The current even-sized region extends two cells left/up and three right/down before edge adjustment.
- Shift the region inward near boundaries to retain 6×6 size. If a board dimension is less than six, use that dimension's available size.
- Return revealed cells and flags inside the region to unknown. Preserve revealed cells and flags outside it.
- Reshuffle only mines inside that region, preserving both its mine count and the total board mine count. Mine positions outside the region must not change.
- Make the struck square safe when the region contains a safe square. An entirely mined region cannot change layout while preserving its mine count; handle it without failing or looping.
- Recalculate all clues. Visible numbers outside the blast can change when adjacent mines move; render their new values.
- Do not modify the opponent's board or progress. Repeated hits are allowed, counted, and shown with explosion feedback.

## Responsiveness and reset

- Keep solo moves local and retain existing tile elements; update changed cells instead of replacing the whole board on every action or poll.
- Use server-provided time and request timing to align multiplayer countdowns and timers across clients with different wall clocks. Refresh the lobby/countdown promptly.
- Keep multiplayer moves server-checked. Immediate flag feedback must reconcile with server state.
- Leave / Reset must restore setup immediately, clear the session, timer, flag mode, and invite URL, and abort pending client requests. It must not wait behind an action queue or an unreachable server.
- Send multiplayer forfeits in the background. Ignore late responses belonging to a previous session so they cannot restore a reset game.
- Respect reduced-motion preferences for explosion animation.

## API and persistence

- Keep the existing `/api/rooms` create, join, read, and action routes compatible with the browser. JSON uses camelCase.
- Room changes are synchronized in memory. Do not hold the room mutex across asynchronous I/O.
- Heartbeats update presence without triggering snapshot writes. Batch changed-room snapshots at approximately 150 ms and flush on graceful shutdown.
- Rooms expire after 24 hours. Preserve the Docker data volume and existing snapshots during ordinary development.
- `Player.settings` and `Player.board` hold independent maps. The room-level settings/board fields support older shared-board snapshots; retain migration compatibility when changing serialization.
- Preserve the distinction between private stored state and public player views. Generated solo state lives in browser session storage.

## Verification

For Rust changes:

```sh
cargo test --locked
cargo fmt --check
cargo clippy --locked --all-targets -- -D warnings
```

For shared-engine or bridge changes, also build both targets with `./scripts/build.sh`. A native build alone does not verify WebAssembly compatibility. Keep `Cargo.lock` tracked; do not edit generated WebAssembly or files under `target/`.

Tests live in `tests/game.rs` and `tests/api.rs`. Add meaningful regression coverage for changed behavior, especially mine counts, first-click safety, clue consistency, blast boundaries, unaffected opponents, and API view filtering. Update obsolete assertions when intentionally changing a rule.

For interaction changes, run the existing browser check against a running server when Playwright and Chromium are available:

```sh
TEST_URL=http://localhost:3001 PLAYWRIGHT_PATH=/path/to/playwright node tests/browser-smoke.cjs
```

Omit `PLAYWRIGHT_PATH` if Playwright resolves normally. This check covers local solo play with the API blocked, click latency, persistent tile nodes, first-click safety, independent difficulties, opponent layouts, explosions, nonselectable tiles, instant reset during a stalled request, and mobile layout. For chord-preview changes, also run `tests/chord-preview.cjs` with the same environment; it exercises held highlights and input cancellation. For layout or start-timing changes, also run `tests/layout-start.cjs` (large boards and skewed client clocks). `tests/browser-smoke.cjs` reads private test snapshots to exercise mine hits; set `TEST_DATA_DIR` to the isolated server’s `DATA_DIR` if it differs from `.data`. Never expose a solution endpoint just for tests. For AI changes, also run `tests/ai-browser.cjs` to verify autonomous play, readiness, and rematches. Report any unavailable verification accurately. Stop test servers you started when finished.

## Deployment and repository hygiene

- `docker compose up --build -d` builds and runs the Rust application. The multi-stage Dockerfile builds WebAssembly and the native binary, runs Rust tests, and uses a non-root runtime user.
- Render uses `runtime: docker`, the root `Dockerfile`, and `/health`. Keep its configuration aligned with the Docker image; do not reintroduce npm commands.
- Run one server instance: room state is held in one process. Render free storage is ephemeral; persistent deployments need a volume or disk at the configured data directory.
- A Docker daemon health failure, including HTTP 500 from `docker version`, occurs before the application build. Diagnose the daemon separately from application failures; do not reset Docker globally or delete volumes as a routine fix.
- Do not commit `.data/`, `target/`, `public/minefield.wasm`, local credentials, or `.sites-checkout/`.
- Keep changes focused and update `README.md` when controls, rules, commands, configuration, or deployment behavior changes.
- Commit, push, and deploy when the user requests those actions. Never claim a push or deployment succeeded without a successful result.
