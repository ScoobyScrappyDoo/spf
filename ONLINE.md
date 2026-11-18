# Playing online, on your own laptop

Two coaches, two browsers, one game, and neither can peek at the other's calls. The game server holds the game
and sends each coach only what he may see.

## What's new

- `server/main.ts`: the game server (built-in Node only, no installs).
- `npm run server`: starts it on http://localhost:3000.
- `proxy.conf.json`: lets the app at localhost:4200 talk to the server.
- `npm run start:lan`: the app for other devices on your home Wi-Fi (step 9).

## Step by step

**1. Open two terminals** in the project folder (where `package.json` is).

**2. Terminal 1, start the game server:**

    npm run server

Wait for: `Statistical Football game server on http://localhost:3000`. Leave it running.

**3. Terminal 2, start the app as usual:**

    npm start

**4. First coach: in Chrome,** open http://localhost:4200 and go to the **Game** tab.
   - Under **Play online**, press **Sign in** and type an email from `data/allowed-emails.txt` (each coach needs
     their own invited address; the second coach signs in the same way in step 5).
   - Choose the two teams, as for a normal game.
   - Under **Play online**, type your name and press **New online game with these teams**.
   - In the list, press **Join** under **Home coach**.
   - A blue banner says which game you're in and which seat you have.

**5. Second coach: in a different browser,** for example Edge (or a second Chrome window, see the note below),
open http://localhost:4200, go to the **Game** tab, type a name, press **Refresh the list**, and **Join** under
**Away coach**.

**6. Play.**
   - Each decision belongs to one coach. The other sees it greyed out, with "Waiting for the other coach to decide".
     The away coach calls the coin toss, the winner chooses, the kicking team kicks off.
   - The team with the ball calls its play on the **Offense** page, the other team sets up on the **Defense** page.
   - Each coach can look across the line at the other's page, as at the board: the other side's formation and
     players, updated the moment they change. Click any of them for his card. The play, ball carrier and strategy, and the
     defense's call, blitzers, coverage and big play, stay hidden until the snap.
   - If the offense changes its formation or players after the defense is set, the defense gets the chance to set up
     again (a note tells it so).
   - The defense sets up and presses **All set!**. The offense sees "the defense is all set" (not its call) and runs
     the play. Both see the result straight away.
   - Game, Stats, Play by play, Data and Rosters are open to both coaches.

**7. Try to peek.** Press F12 in either browser and look around. The other coach's call, the order of the cards and
the random seed aren't there: they never leave the server.

**8. Leave.** **Leave** in the banner takes you back to your own local game, just as you left it.

**9. Optional: a second device** (your phone, or the other laptop) on your home Wi-Fi.
   - In terminal 2, stop the app (Ctrl+C) and start it with `npm run start:lan` instead.
   - Find your laptop's address: run `ipconfig` and look for "IPv4 Address", something like 192.168.1.20.
   - On the other device, open http://192.168.1.20:4200 (with your address). Windows may ask once whether to allow
     Node through the firewall: say yes for private networks.

## Good to know

- **Two tabs in the same browser work too.** Each tab holds its own seat, and an online game isn't kept in the
  browser's storage, so even two tabs can't peek at each other.
- **A reload keeps your seat** in that tab.
- **The master seat** sees everything and can make every decision, for testing or for watching a game. While coaches
  play, the master's Offense and Defense pages follow them live: the line-ups and the whole call as it takes shape
  (play, ball carrier, strategy; defense call, blitzers, coverage, big play, timeouts). Only the master gets this.
- **Not online yet:** the computer coach (simulations), saving and replaying an online game, and the receiving
  team's onside-kick defense. Those still work in local games.
- **Games live in the server's memory:** stopping the server ends them. A database comes with the hosting on the NAS.
- **Invite only:** the server only lets in emails listed in `data/allowed-emails.txt` (created on the first start;
  put one address per line, add ` admin` to the ones who may take the master seat). On your laptop, `npm run server`
  uses a developer sign-in where you just type an invited email; on the NAS everyone types their email and the
  session code you set (`SIGNIN_CODE`) and tell them on the call.
- **Ending a game:** the **End** button in the list. You (admin) can end any game, a coach the game they're in.
  Anyone still in it goes back to the Game tab with a note. Stopping the server ends all games.
  Every sign-in, refused ones too, goes to `data/sign-ins.log`.

## If something goes wrong

- **"Can't reach the game server"**: the server isn't running. Start it in terminal 1 with `npm run server`.
- **"The game server is older than the app"**: after an update the server keeps running its old version until it's
  restarted. Press Ctrl+C in its terminal, then `npm run server` again. (Without that, the other side's formation only
  shows after "All set!", or not at all.)
- **"Port 3000 is in use: is the game server already running?"**: it is, in another terminal. Use that one, or stop
  it with Ctrl+C first.
- **The list doesn't show a new game**: press **Refresh the list**.
