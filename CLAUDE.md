# Statistical Football — notes for Claude

A browser version of Statis Pro Football. Read HANDOVER.md (decisions, owner's preferences, pitfalls), then
ROADMAP.md, ONLINE.md and TESTING.md. The code is the truth; these files hold the why.

## Layout

- `src/app/engine/` — pure TypeScript rules engine: no Angular imports, seeded randomness, immutable state, a journal
  of every decision. Shared by the browser app and the game server.
- `src/app/state/` — signal stores around the engine (`game.store.ts` also holds online play: join, SSE, act).
- `src/app/views/`, `components/`, `shell/` — Angular 21 (zoneless, signals) + DevExtreme 25.2 UI, built for 1920×1080.
- `server/` — the online game server, **built-in Node only** (no npm runtime dependencies). `main.ts` holds the games
  and sends each seat a filtered view (`engine/seats.ts`); `auth.ts` is Google sign-in + the invite list.
- `public/cards/` — team cards and the FAC deck (JSON). `public/cards/teams` may hold the owner's own PFR cards:
  never overwrite it, leave it out of complete-project zips.
- `tools/` — Python converters (PDF/PFR → team JSON).

- Online seats: `GameStore.coaches(side)` decides who lines up a side. A coach their own side; the master only
  where that side's seat is free (or in a local game). Otherwise the master's Offense/Defense page is the live,
  read-only "across the line" view, and it never sends a `look`/`defense-look` for a side a coach holds.
- Drafts (PROTOCOL 4): each coach's call as it takes shape (`GameStore.shareDraft`, from the Offense/Defense pages)
  goes to `POST /api/games/:id/draft`; the server keeps it in the room (not the game, journal or saved game), sends
  it to master clients only, and clears it when a play is run. The master's across views show it ("only you see this").

## Commands

- `npm start` — app on http://localhost:4200 (proxies `/api` and `/auth` to port 3000).
- `npm run server` — game server on port 3000 with the **dev sign-in** (type an invited email, no Google).
- `npm test -- --watch=false` — Angular/engine tests (Vitest via `ng test`; 435 at update 06).
- `npm run test:server` — server tests (plain Vitest on `server/*.spec.ts`).
- After any engine change, restart the server (it bundles the engine; a stale one reports an old PROTOCOL).

## Sign-in (server/auth.ts)

- Three modes, chosen at start: `--dev-login` (type an invited email; your own computer only), `SIGNIN_CODE` set
  (invited email + a session code the host says on the call; the owner's choice for the first test sessions; 10
  wrong codes per address → 15 min wait), else Google OpenID Connect (authorization code + PKCE, server-side).
  The session code applies to admins too (deliberately: no code-free account).
- A random session id in an HttpOnly cookie. Only emails in `data/allowed-emails.txt` get in (re-read when the file
  changes; removing someone also ends their sessions on the next request). A line ending in ` admin` may take the
  master seat (hidden in the list for others) and end any online game; a coach may end a game they sit in.
- Config by environment: `SIGNIN_CODE`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `PUBLIC_URL` (e.g.
  `https://name.synology.me`), `DATA_DIR` (default `./data`), `APP_DIR`, `TRUST_PROXY=1` behind the DSM reverse proxy.
- Sign-in comes first for the whole app: the server serves the built app (`APP_DIR`, default `dist/spf/browser`) only
  to signed-in people and redirects everyone else to `/auth/signin`; `AuthService.gate()` (an app initializer) does
  the same on the dev server. With no game server reachable, the app still starts for local games.
- `data/` holds the invite list, sessions and the sign-in log (`sign-ins.log`, JSON lines). It is git-ignored and
  will be a Docker volume.

## Container (step 1)

- `Dockerfile` (two stages on `node:24-alpine`: `npm ci` + `ng build` + esbuild bundle; the runtime image holds only
  `dist-server/main.mjs`, `dist/spf/browser`, `public/cards`, runs as `node`), `docker-compose.yml` (port 8330 → 3000,
  settings as environment, a named volume for `/app/data`, read-only, no capabilities), `.dockerignore`.
- Built on the NAS by Container Manager (no Docker on the laptops). NAS.md is the owner's step-by-step guide.
- The NAS settings: `SIGNIN_CODE` (refused while "change-me"), `ALLOWED_EMAILS` (replaces allowed-emails.txt),
  `PUBLIC_URL`, `TRUST_PROXY`. The first two live in `.env` (git-ignored, also in .dockerignore; `.env.example` is in
  git), which docker compose reads for `${SIGNIN_CODE}` / `${ALLOWED_EMAILS}`: the code and invitees stay off GitHub.
- The master copy is the git repo `C:\DevGit\spf` (GitHub `ScoobyScrappyDoo/spf`), since 18 Nov 2026; the old
  `C:\angular\spf` is retired. Robocopy to the NAS from there; exclude only the top-level data folder (`"$PWD\data"`,
  a bare `data` also skips `src/app/views/data`) and `.git`. The owner commits and pushes themself.
- npm 11 skips packages' install scripts unless approved; the build was checked to work without them.

## Where we are (18 Nov 2026)

- Done in code and tested: sign-in (email + session code, invite list, admin), End game, the master's live view of
  both coaches' calls (PROTOCOL 4), the role-coloured online banner, the container files.
- Step 1 done (18 Nov 2026): the game runs on the NAS at http://192.168.178.84:8330 (home network only), settings
  from .env, and an online game between two invited addresses played well (the FAC carousel fix confirmed too).
  Next: step 3, lock down the NAS (check the guest account first: it has Read Only on the docker share where .env
  lives; the owner's DSM user "Phil" was given Read/Write on that share for robocopy).
  Later ideas: Google sign-in as an option, email codes.

## Hosting plan (owner's order)

1. Container (Dockerfile + docker-compose) 2. Login ✔ 3. NAS lock-down 4. DDNS + Let's Encrypt 5. DSM reverse proxy →
container 6. Fritz!Box forwards 443/80 7. Test from outside, invite friends.
NAS: Synology DS220+, DSM 7.4.1, Container Manager, 192.168.178.84. Port 8320 (bookkeeping) stays LAN-only; Emby
8096/8092 are forwarded and must be left alone.

## Working with the owner

- Software developer, learning Angular, new to ports/Docker: explain plainly, one step at a time, baby steps for
  anything the owner does by hand.
- Test changes yourself before reporting (browser tests against the built app; measure, don't eyeball).
- Updates are numbered (last delivered: 06, the FAC carousel no longer jumps on online updates) and delivered as small zips of changed files.
- Windows dev machines (PowerShell), Node 24; the NAS container will run Node 22+.
