# Minefield — single player & 1v1

Dependency-free Node.js 22+ Minesweeper with single player, room-code invitations, identical multiplayer boards, live side-by-side progress, custom difficulties, and left-click chording.

## Play single player first

```sh
npm start
```

Open **http://localhost:3000**. No installation or build step is needed.

**Single player** is selected by default. Choose Easy, Medium, Hard, or Custom, then click **Start single player**. The board starts fully covered. Your first click generates the mines around that square and starts the timer; the first click is always safe. **Play again** generates a fresh board after a win or loss. **Leave / Reset** lets you change difficulty or switch to multiplayer.

- Easy: 9 × 9, 10 mines.
- Medium: 16 × 16, 40 mines.
- Hard: 30 × 16, 99 mines.
- Custom: width 5–40, height 5–30, and 1 to (width × height − 9) mines.

Left-click a covered cell to reveal it. Right-click to toggle a flag. Left-click a revealed number to chord when its adjacent flag count matches. Incorrect flags can uncover a mine. Touch users can toggle **Flag mode**. Keyboard: Tab to focus, arrows to move, Enter to reveal/chord, F to flag.

## Challenge a friend

1. Choose **Create room**, enter a name, select a difficulty, and click **Create challenge**.
2. Share the six-character room code or **Copy invite** link.
3. Your friend opens the same website, selects **Join room**, and enters the code. Invite links fill this in automatically.
4. Both click **Ready to play**. A three-second countdown starts the race.

After the countdown, each player chooses their first square. Once both have chosen, the server generates one identical map that protects both first clicks, reveals only each player’s chosen opening, and starts the shared timer. No tiles open automatically before you click.

Your playable board appears beside your opponent’s cleared-cell map. Both completion bars show cleared cells, percentages, and readiness/status. The display updates every second. The opponent’s map shows cleared positions without clue numbers or flag locations. First to clear every safe cell wins; hitting a mine forfeits the round. The host can start a rematch.

For two players on one computer, use two separate browser profiles or an incognito window. A normal reload resumes that browser tab’s session.

## Simplest deployment: Docker Compose

With Docker and Compose installed, run this from the project folder:

```sh
docker compose up --build -d
```

Open **http://localhost:3000**. On a server, share **http://YOUR_SERVER_IP:3000**. Open inbound TCP port 3000 if needed. Rooms are stored in a Docker volume and survive container replacement. Run only one instance.

```sh
docker compose logs -f     # View logs
# Stop the service (keeps saved room data):
docker compose down
```

If port 3000 is in use, run `PORT=8080 docker compose up --build -d` and open port 8080 instead.

## Public HTTPS deployment: Render

The included `render.yaml` defines a single free Node web service, with tests as its build check and `npm start` as its launch command.

1. Push this project to your own GitHub or GitLab repository.
2. In [Render](https://dashboard.render.com/), select **New → Blueprint**, connect the repository, and deploy the included `render.yaml`.
3. Open the `onrender.com` HTTPS URL Render provides. Both players use that same URL.

Review the displayed plan before deploying. Render’s free web services can restart or spin down, and their local files are ephemeral: active and saved rooms can be lost on a restart or redeploy. For casual testing, create a new room. For persistent hosting, use the Docker volume setup on a server, or attach a paid persistent disk to the application’s `.data` directory. Do not scale the Node server above one instance; room state is held in one process.

Official setup and limits: [Render Blueprints](https://render.com/docs/infrastructure-as-code), [free service limits](https://render.com/docs/free).

## Same-Wi-Fi testing

Without Docker, `npm start` listens on all interfaces on port 3000. Run `hostname -I` to find the host’s LAN address, e.g. **http://192.168.1.20:3000**. Open that address on both devices. Allow inbound TCP port 3000 if needed. Open the LAN address before copying an invite: localhost links only work on the host computer.

Keep the server running. Rooms expire after 24 hours. Leaving during an active multiplayer round forfeits it. This is a casual game without accounts or production rate limiting.

## Responsiveness and reset

Solo uses the shared engine directly in your browser: reveals, flood fills, chording, and flags need no API request. Session state is saved in the current browser tab. Multiplayer moves remain server-checked; flags show immediately. Board buttons are kept in place and only changed cells update, so clicks and keyboard focus are not interrupted by periodic polling. Presence updates do not write snapshots; room saves are batched and flushed on a normal server shutdown.

**Leave / Reset** immediately clears the board, timer, flag mode, invite URL, and stored session and restores the setup controls. It works even if a move is waiting for the server. Multiplayer sends a forfeit in the background; if the server is unreachable, the local reset still succeeds, but your friend may need to leave that room too.

## Mine generation

The shared game engine uses cryptographic randomness and unbiased Fisher–Yates shuffling. Mines are placed only after the first click. Solo protects that cell and its eight neighbors. Multiplayer waits for both players to choose an opening, protects both chosen cells, then expands the protected neighborhoods where the configured mine count allows. Both players receive the identical map, with their own chosen opening. Standard random maps may require guessing; there is no no-guess guarantee.

References:

- [Minesweeper.now: algorithms and board generation](https://minesweeper.now/developers/minesweeper-algorithms)
- [Simon Tatham: Mines controls and chording](https://www.chiark.greenend.org.uk/~sgtatham/puzzles/doc/mines.html)

## Verification

```sh
npm test
```

Engine and API tests cover mine counts, clue consistency, safe openings, custom settings, chording, incorrect flags, wins/losses, solo replay, multiplayer readiness, progress privacy, room invitations, forfeits, and host-only rematches.

Optional browser QA (with Playwright and its Chromium installed separately, and the server running):

```sh
node tests/browser-smoke.cjs
```

Set `PLAYWRIGHT_PATH` if Playwright is installed outside this project. The browser check verifies solo with API access blocked, measures click latency, checks persistent tile nodes, confirms fully covered starts/replays and safe openings, plays a two-player match, and resets while a request is deliberately stalled. It also checks live maps and a narrow mobile viewport.

The optional `npm run build` creates a Cloudflare Worker bundle using a D1 `DB` binding; this is separate from the supported Node/Docker/Render deployment above. Prior Sites publication was not completed because the environment could not resolve the publishing Git endpoint.
