# Statistical Football on the NAS

The plan, in this order (the router is opened last):

1. **The game in a container on the NAS, home network only** ← this page, so far
2. Login ✔ (done in the code: invited email + session code)
3. Lock down the NAS: DSM firewall, 2-step sign-in, DSM and the bookkeeping app (8320) not reachable from outside
4. A Synology DDNS name + a Let's Encrypt certificate
5. DSM reverse proxy → the game container
6. Fritz!Box: forward 443 + 80 to the NAS
7. Test from outside, then invite friends

Until step 6, **nothing here can be reached from the internet**: the Fritz!Box doesn't pass anything on to port 8330.

---

## Step 1: the game in a container (home network only)

**What a container is, in two sentences.** A container is a small, sealed box on the NAS with its own copy of Node
and the game inside, started and stopped by Container Manager. The game can't touch anything else on the NAS, and
removing the box leaves the NAS as it was.

**What the files do:**
- `Dockerfile`: the recipe for the box. The NAS builds the game from the project folder, then keeps only the finished
  files (no packages, no build tools) and runs them as an ordinary user, not as administrator.
- `docker-compose.yml`: how the box runs: which port, the address people type (`PUBLIC_URL`).
- `.env`: **your settings** (session code, who's invited). Only on your laptop and the NAS: git ignores it, so it never
  goes to GitHub. `.env.example` (in git) shows what goes in it.
- `.dockerignore`: what isn't copied into the build (installed packages, old builds, `.env`).

The master copy of the project is the git copy, **`C:\DevGit\spf`**: change things there, copy to the NAS from there.

### A. Your settings (on the laptop)

Open `.env` in `C:\DevGit\spf` (if there is none yet, copy `.env.example` to `.env` first) and set two lines:

- `SIGNIN_CODE=change-me` → your session code, e.g. `SIGNIN_CODE=bluefalcon7`. At least 6 characters. The game
  refuses to start while it still says change-me (or when there is no `.env` at all).
- `ALLOWED_EMAILS=…` → your address with ` admin`, then your friends' addresses, separated by commas.

Leave `PUBLIC_URL` in `docker-compose.yml` as it is for now (`http://192.168.178.84:8330`, the NAS at home).

### B. Copy the project to the NAS

Container Manager made a shared folder called **docker** on the NAS.

1. In Windows Explorer, type `\\192.168.178.84\docker` in the address bar and press Enter (sign in with your DSM
   user if it asks).
2. Make a new folder there called **statistical-football**.
3. In PowerShell, go to the master copy and copy the project over, leaving out what the NAS doesn't need (installed
   packages, builds, local data, git's history):

```powershell
cd C:\DevGit\spf
```

```powershell
robocopy . "\\192.168.178.84\docker\statistical-football" /E /XD node_modules dist dist-server .angular "$PWD\data" .git .claude .vscode __pycache__ /XF *.pyc /NFL /NDL
```

   (`"$PWD\data"` leaves out only the project's own `data` folder, the local sign-ins. A bare `data` would also skip
   `src/app/views/data`, the Data page, and the build on the NAS would fail.)

   If robocopy says error 1326 ("Der Benutzername oder das Kennwort ist falsch"), sign the terminal in to the NAS
   first with `net use \\192.168.178.84\docker /user:<your DSM user>` (the DSM user needs Read/Write on the docker
   folder: Control Panel → Shared Folder → docker → Edit → Permissions).

   It ends with a little table; "Failed 0" is what you want. (Robocopy's exit code is 1 when it copied files: that
   is success, not an error.)

### C. Create the project in Container Manager

1. DSM → **Container Manager** → **Project** → **Create**.
2. **Project name:** `statistical-football`.
3. **Path:** choose `docker/statistical-football`.
4. **Source:** "Use existing docker-compose.yml" (it finds the file in that folder).
5. If it offers a **web portal via Web Station**: leave it **off**. The reverse proxy in step 5 does that job.
6. **Next**, then **Done**. Container Manager now builds the game: it downloads Node, installs the packages and builds
   the app. **The first time takes about 5-10 minutes**; the build log scrolls by in the window.

### D. Is it running?

- Container Manager → **Container**: `statistical-football` shows **Running** and, after half a minute, **healthy**.
- Click it → **Log**. You should see:

      Sign-in: invited email + the session code (SIGNIN_CODE).
      Invite list: ALLOWED_EMAILS (… addresses)
      Statistical Football game server on http://localhost:3000

  (Inside the box the game listens on 3000; the NAS passes its port **8330** to it.)

### E. Try it on your home network

1. On the laptop, open **http://192.168.178.84:8330**. You get the sign-in page.
2. Sign in with your address and the session code. You get the game.
3. In a private window (Ctrl+Shift+N), sign in as a second invited address and play a few plays online against
   yourself, as you did on the laptop.

### If something goes wrong

| What you see | What it means |
|---|---|
| Log: `SIGNIN_CODE still says "change-me"` | `.env` is missing on the NAS or still says change-me: set it (A), copy again (B), then apply it (below). Did you copy from `C:\DevGit\spf`? |
| Log: `SIGNIN_CODE is too short` | At least 6 characters. |
| The build stops with an error | Copy the last 30 lines of the build log and send them to me. |
| The page doesn't open | Is the container Running? Is the address `:8330`? Step 3's firewall may also block it later; we'll allow it there. |
| "isn't on the invite list" | The address isn't in `ALLOWED_EMAILS` (a typo? a comma missing?). |

### Changing settings (new session code, a new friend)

1. Change `.env` in `C:\DevGit\spf` on the laptop, save, and run the robocopy line again (from `C:\DevGit\spf`).
   Keep the laptop's `.env` the one you change, so the next copy doesn't bring an old one back.
2. Container Manager → **Project** → `statistical-football` → **Stop**, then **Build** (in the **Action** menu). It
   re-creates the container with the new settings, in seconds this time.

(The exact menu names can differ a little between DSM versions; look for Stop / Build / Start on the project.)

### A new version of the game

Run the robocopy line again (it copies only what changed), then **Build** the project as above. Running games end
(they live in the game server's memory); everyone stays signed in.

### Between test sessions

Container Manager → **Project** → `statistical-football` → **Stop**. Start it again for the next session, with a new
session code.
