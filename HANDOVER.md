# Statistical Football: handover for a new chat

Read this first, then ROADMAP.md (what's done and what's next), TESTING.md and ONLINE.md. The code is the truth;
this file holds what the code doesn't say: decisions, preferences, and pitfalls.

## The project

A browser version of Avalon Hill's Statis Pro Football, renamed **Statistical Football**: Angular 21 with signals,
DevExtreme 25.2 (license file), a pure TypeScript engine (`src/app/engine`, no Angular imports, seeded randomness,
immutable state, a journal of every decision). Designed for 1920×1080. Node 24 on the owner's laptops (two of them;
every update goes on both). A Synology NAS (Node 20/22, Tailscale) is planned for hosting.

- `npm start`: the app on localhost:4200. `npm test -- --watch=false`: all tests (431 at update 05).
- `npm run server`: the online game server (`server/main.ts`, built-in Node only, port 3000, proxied from 4200).
- Updates are numbered. The numbering **started again at 01** after update 91 (update 01 builds on update 91); the
  last one delivered is **update 05**. The owner prefers **small zips of the changed files**, each saying which update
  it builds on, and occasionally a complete project. A complete-project zip must
  **leave out `public/cards/teams`** (the owner may have installed the Pro Football Reference cards).

## How the owner likes to work

- He's learning Angular: point out the interesting Angular parts (signals, computed, effects, services).
- Explain in plain words; he likes "baby steps" walkthroughs for anything he has to do himself.
- Test in the browser (Playwright against the built app) and measure rather than eyeball: he notices pixel
  differences, misaligned columns and inconsistent sizes.
- Before claiming a fix, reproduce the problem; say honestly when a test of mine was wrong rather than the code.
- He tests carefully and reports precisely, often with screenshots; take his "cherry picking" points seriously.

## Decisions worth knowing

- **Cards**: one rule for every season, Avalon Hill's card-creation formulas (the write-up's tables, which the
  official 1987-89 cards follow exactly; 1984's official cards used an earlier method, 1991 a flatter revision).
  Interceptions: the worksheet table for every season (0-1 = "48?"). The 1984 season can be built from Pro Football
  Reference data (`tools/pfr_season.py`, thresholds and minimums agreed: QB 30 att, RB 20 car, WR/TE 20 rec, K/P 10,
  others 4 games; minimums QB 2, RB 3, WR 4, TE 2, OL 7, DL 5, LB 5, DB 6, K 1, P 1, filled by usage with at least one
  touch; big plays from the standings, top 12 teams with 9+ wins, Super Bowl teams 4/4). Those cards are a drop-in
  (`1984-pfr-cards.zip`); the official cards stay as engine test data in `src/app/engine/testdata`.
- **Saved games** (.spf version 2): concrete journal entries (no "computer's step"), both teams' cards and the
  finished game inside, so a game always opens exactly as saved.
- **Online**: the server holds the game, checks who may decide (`engine/seats.ts`), and sends each seat a filtered
  view. Both coaches see formations and players live (the offense's and the defense's "look"); never the other's
  call, the deck order, the seed or the journal. A shared PROTOCOL number flags an out-of-date server. After any
  engine change the server must be restarted.
- **Solitaire**: "You play" on the Game tab; `state/solitaire.service.ts` plays the computer's side in the table's
  order (the offense lines up, the defense sets up seeing it, the offense calls its play seeing the defense).
- **The computer coach reads the field** (`engine/reading.ts`): weighted, never fixed; endurance-aware keys (never on
  a back who must rest); a temperament (cautious / normal / bold), only for solitaire (simulations use normal).
  Runs go to backs; if none may carry, it passes. With a lead of more than one score in the last two minutes it
  kneels on 1st-3rd down.
- **Timeouts** are used only if the clock would run (not after incompletions, penalties, out of bounds, the two-minute
  warning, a change of possession); a TIMEOUT event; the drive chart shows a row "X take a timeout, they have n
  remaining" with a stopped-clock icon (dark grey clock, red slash bottom-left to top-right), then a line.
- **Pressures**: every pass rush play is a pressure (sack, scramble, completion or incompletion); credited without
  using the random stream, so no game changes. **YAC** is derived from the pass kind and the gain, deterministically.
- **Stats**: NFL-style tables (shared `shared/box-score.ts`): full names with position on the Stats tab, "T. EASON"
  style in the Game Book; a Team row under a line; a fixed table layout so both teams' columns line up.
- **Game Book** (PDF via the browser's print): "Statistical Football", pastel band, "MIAMI at SAN FRANCISCO", no
  season, played-by names under the teams ("AI simulated" / "finished by AI" under FINAL), gold "Score update" lines
  in the play-by-play.
- **Cards on screen**: every big player card is the quarterback's size (296×478 measured) on Offense and Defense, also in
  the "across the line" views of the other side (their column is 18.5rem; it was 20-24rem, cards too wide, fixed in
  update 05); defenders' contents spread down the card. A hidden QB "sizer" card does this.
- **Names**: "played by" fields and online names are 30 characters at most.
- **Weather**: the look is done, not the effects (update 03). Chosen on the Game tab (setup column 2, and a
  "Weather" row under the scoreboard during a game, to try them out), kept in `state/weather.service.ts`: conditions,
  intensity, and a wind (direction and mph, light 6-12, medium 13-21, heavy 22-32) rolled for each game.
  `components/weather-layer` draws it on a canvas over the field, seen from above: rain streaks that splash on the
  grass (heavy rain darkens slightly), snow flakes of different depths (heavy snow a faint white haze), wind gusts and
  bits of grass blowing across, with a direction-and-mph flag in the right end zone's corner. Nothing covers the lines;
  no field colour changes (decided). requestAnimationFrame outside Angular (the app is zoneless); the browser's own
  random numbers, never the game's. It moves even when the computer asks for reduced motion (the owner's Windows has
  animation effects off, and he wants it moving); a "Moving" tick box in the Weather row stops it. Not in the engine, saved games or online yet:
  when the effects come, the weather goes into the game's start and the wind is drawn from the seed. Any conditions for any game (1984 domes, if wanted later: Detroit, Minnesota,
  New Orleans, Seattle, Indianapolis, Houston).

- **The play's cards** (updates 01-02): every card turned over is in the play's log entry (`LogEntry.cards`, from
  `PlayFlips`; Z cards marked "counts" / "ignored", the card whose Z line was read "result", and `step`: the step
  that reads it, the next one written when the card was drawn; no random draws added). `spf-fac-card` draws a card;
  `spf-play-cards` is a small deck on Offense and Defense, column 3 under Last play: the card in focus (a player
  card's size, hidden QB sizer) in front, the one before and after it at 94 % behind, 3.2rem of edge showing with the
  ‹ › buttons; it opens on the first card (the owner's choice: the play reads from its start). Last play shows "FAC 2/3" after each step that read a card (input
  cardLinks): a click turns the deck, the card in focus is highlighted. Both share `state/play-cards.service.ts`
  (the cards and the focus as signals). After a touchdown: the play's cards, then the extra point's. The deck's
  bottom is level with the wide box (Run play / All set!): column 3 has `contain: size`, so it takes the two rows'
  height and never stretches them; Last play gets the space above, steps in two columns there, and scrolls inside if
  it ever needs more. Online PROTOCOL 3. A pass reads three cards (pass card, PN, RN); a field goal or extra point one.

- **Runs, Break and Lg** (confirmed with the owner's question, update 04): a Break on the run card goes straight to
  the LG column with a new card (rule 8.2.5 as built); "Sg" in the N column goes to the SG column. An "Lg" in the N
  column (Rick McIvor, 1984 Cardinals, row 12, the only one) counted 0 yards until update 04; it now flips a card for
  the LG column, on runs and end-arounds alike.

## Next steps (the owner's order)

1. **Weather**: implement the effects (ideas: wind shortens long passes, field goals and punts; rain brings fumbles
   and lower completion ranges; snow slows the running game), changing odds a little rather than rules.
2. Later: hosting on the NAS (accounts, a sign-in log that spots shared logins, a database), online simulations,
   saving and replays; scoring calibration (about 18 points a team in simulations against 21 in 1984).

## Pitfalls I've hit (save yourself the time)

- **Apostrophes inside Angular template expressions** break the build ('can't' inside a quoted string): reword.
- **`ng test` compiles specs like the app**: no `node:fs` in spec files (use JSON imports); `npx vitest run file`
  alone doesn't catch this.
- **Component style budget**: `angular.json` allows 16 kB per component (the Game Book needs it).
- **Python edits with escaped regexes**: check the file afterwards; doubled backslashes have slipped in.
- **`pkill -f` with a pattern that appears in the same command line kills the shell**: stop processes by exact
  command (`ps -eo pid,args | awk ...`).
- **A server process from an earlier test may still run old code**: restart servers before browser tests.
- **Sandbox commands time out after 300 seconds**: run long browser games in the background and read a log.
- The **page header nav** locks Offense/Defense until a game starts; the coin toss and "Receive" must be clicked in
  browser tests.
