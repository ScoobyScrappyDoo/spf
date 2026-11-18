# Roadmap

Where the game stands and what's next. Kept with the code so it's the same on every laptop.

## Next up

0. **To do (not started):**
   - **Solitaire mode**: step 1 done. "You play" on the Game tab (both teams, the visitors, or the home team); the
     computer coach (state/solitaire.service.ts) plays the other side in the two-coach order. Step 2 next:
   - **Fixed with step 2**: the computer called designed quarterback runs whenever its backs had to rest (rule 4.6),
     up to a dozen a game; a run now goes to a back, or the call becomes a pass (quarterbacks: the sneak and the odd
     keeper). Quarterbacks now carry about twice a game, half of it kneels.
   - **A computer coach that reads the field**: step 2 done (engine/reading.ts), with a temperament (cautious,
     normal, bold) chosen on the Game tab. Simulations and solitaire both follow the table order: the offense lines
     up, the defense sets up seeing it, the offense calls its play seeing the defense. The original plan: "You play: Visitor / Home / Both" on the Game
     tab; the computer plays its side in the two-coach order (the offense lines up, the defense sets up, the offense
     calls). It reads only what a coach at the table sees: who's on the field and their cards, the score, the clock
     and the game so far, never the other side's call. On defense: run keys only for backs who may carry (endurance;
     a Z card diverts passes, not carries), threats from the cards and this game's usage, the offense's personnel as
     a nudge. On offense: light box or heavy front, coverage matchups, runs towards weaker tacklers. Always weighted,
     never a rule, on top of the situation logic (score, time, down and distance); a temperament setting (cautious,
     normal, bold) for how far the field reading tilts the weights.
   - **Z cards**: done (update 01). Each play's cards, Z cards included, in a carousel on the Offense and Defense pages
     under Last play, so both coaches see them: the last card in focus, the earlier ones to its left; the card whose Z
     line gave the result is marked.
   - **Weather**: the layout and the look are done (update 03: rain, snow and wind drawn over the field on the Game
     tab, with the wind's direction and speed); any conditions for any game for now (domed stadiums could come
     later: in 1984 Detroit, Minnesota, New Orleans, Seattle, Indianapolis and Houston played indoors). Still to do:
     rain, snow or wind, chosen for a game, with a subtle animation on the field. Effects to decide
     (ideas: wind shortens long passes, field goals and punts; rain brings fumbles and lower completion ranges; snow
     slows the running game), changing the odds a little rather than the rules.

0. **Online play, locally**: done (see ONLINE.md). `npm run server` starts the game server (server/main.ts, built-in
   Node only); the Game tab joins games as the home coach, the away coach or the master. The server holds the game,
   accepts each decision only from the coach it belongs to, and streams each coach his own view (seats.ts): the field
   for both, never the other's calls, the deck order, the seed or the journal. Next for hosting: the server on the
   NAS, accounts and the sign-in log, games kept in a database; online simulations, saving and replays.

0. **1984 from Pro Football Reference**: built and checked, not yet in place (a drop-in zip). `tools/pfr_season.py`
   reads the league-wide tables plus each team's roster and starters, applies the agreed rules (full cards for QB 30
   attempts, RB 20 carries, WR/TE 20 catches, K/P 10, others 4 games; starters always; minimums QB 2, RB 3, WR 4,
   TE 2, OL 7, DL 5, LB 5, DB 6, K 1, P 1 filled by usage; returners with or without a card) and the card formulas:
   1,351 cards, 45-53 a team. `tools/compare_cards.py` prints the comparison with the official cards (one page a
   team). Engine fixes found on the way: no range beyond 50 yards for a kicker without a 46-50 range; in a team's own
   formation its starters come first (the 1984 Browns started three tight ends). The engine tests now read fixed test
   cards (src/app/engine/testdata). To decide: standings for the big plays (kept from the official cards for now), and
   whether the season's scoring (about 17 points a team in simulations, against about 21 in 1984) needs calibrating.

0. **Saved games that last** (.spf version 2): the computer's decisions are journaled as they are (the call, the
   lineup, the defense's setup), not as "the computer's step", so a replay doesn't depend on the computer coach; the
   file also carries both teams' cards and the finished game, so it always opens exactly as saved, whatever changes
   in the cards or the engine later. Version 1 files still open, rebuilt with today's cards, and say so if that plays
   out differently.

0. **The Official Game Book** (PDF): done. "Game report" on the Game tab opens a print-designed report, A4 pages
   numbered in the footer: the cover (band, final score, line score by quarter, the LED scoreboard, key numbers, game
   leaders), the scoring summary (game-book style, with the drive behind each score) and a drive chart drawn on a
   football field, team statistics, individual statistics, and the play-by-play in two columns. "Save as PDF" prints
   it through the browser, no third-party code.

0. **Rules, batch 3**: done. O1 for defensive backs (a cornerback in a safety box M or N, or a safety in a cornerback
   box K or O, covers one worse; box L and plain "defensive backs" never lose anything. The rule says "subtract 1",
   applied as the penalty it means, since lower pass defense is better), O2 onside-kick defense (an onside kick needs
   PN 1-7, a normal kick is returned 20 yards at most), O3 squib kicks (the return starts 15 yards farther up, its RN
   +1, no touchback), O6 fake punts and field goals (table 6.10; a defense expecting it adds 2, but can't block a real
   kick). The computer uses them all. Next: the PDF game report.

0. **No-huddle at any time** (house rule, `settings.ts` → houseRules.noHuddleAnyTime, on by default): the offense can
   use the fast timing at any time ("No-huddle" next to Run play); after a no-huddle play with the clock running, the
   defense keeps its players and formation unless the offense substitutes (rule 8.7), and can still change its call.
   The computer goes no-huddle when 9 or more behind in the second half. Saved games keep the rules they were played
   with. Next: O1 for defensive backs, O2 onside-kick defense, O3 squib kicks, fake kicks; then the PDF report.

0. **Rosters page**: done. Any season and team (no game needed), or the two teams of the game being played in one
   click; players grouped by position, linemen, linebackers and backs with their values in the row, kickers' and
   punters' numbers in full, the return cards and team card; click a row (or use the arrow keys) for the player's card.

0. **Rules, batch 1**: done. Quarterback endurance (rule 4.5: A plays unless hurt, B only for an injured A, C only for
   an injured B, anyone with a 20+ point lead in the 4th; the engine, the Replace list and the computer coach all follow
   it); delay of game before a punt (rule 8.5.3, asked for by the kicking team, accepted or declined by the receiving
   team); overtime (rule 9.8.1: a new toss, two timeouts, sudden death, "OT" on the scoreboard). 
0. **Rules, batch 2**: done. Choosing blitzers (rows 2 and 3; F and J by default), double and triple coverage (rule
   7.2.2: -7 and -15, the formations it needs, the extra defenders may intercept), big plays (rule 8.4 and table 6.9:
   the team card's count, one per possession). The computer coach blitzes with the solitaire packages, covers the most
   dangerous receiver in view on passing downs, and saves big plays for when they matter. Next: batch 3 (optional rules O1 for backs, O2, O3, O6, the
   no-huddle house rule, "48?").

0. **Saved games and replays**: done. Every decision (yours or the computer's) goes into the game's journal; with the
   seed, that rebuilds a game exactly. "Save game" downloads a .spf file (gzip-compressed behind an "SPF1" header,
   SHA-256 checksum: unreadable by eye, damaged or edited files refused); "Open game…" rebuilds it and checks it ends
   as saved; "Replay" plays it back from the opening toss at any speed. Games from before update 46 can't be saved.
   Later: a database of games on the server.
0. **Simulated games**: done. "Simulate game" on the Game tab (instant, fast, normal or slow; pause, skip to the end,
   take over), and "Let the computer finish" for a game in progress. The computer coach (`coach.ts`) decides every
   call from down, distance, field position, score and clock: 4th-down calls (punt, coffin corner, field goal, go for
   it), the two-minute drill, run or pass, who gets the ball, draws and play action, formations, injuries and rest; on
   defense the formation, call, keys, blitzes, prevent and the all-out punt rush; onside kicks and penalty choices.
   40 complete games run in the test suite every time. Next: the PDF report, then a smarter coach (the no-huddle as a
   house rule at any time, Brady style).

1. **Stats tab**: first version done. Team stats nfl.com style (first downs, 3rd/4th down efficiency, plays, yards,
   rushing, penalties-yards, fumbles-lost, turnovers, kick returns, time of possession) and individual rushing, defense
   (solo, assists, fumble recoveries), kick returns, kicking, fumbles and penalties. Worked out from play events.
   Punting, punt returns, passing and receiving done. Still to come: special-teams tackles,
   stats by quarter, and a scoring summary.
2. **Punts and returns** (rule 8.5): done. Declared out loud, punter card, fair catches, touchbacks (and punts rolling
   in from inside the 6), returns with breakaways and fumbles, row 12 special results, blocked punts, coffin corner,
   all-out rush, category 3 penalties, punting and punt-return stats. Still to come: delay of game on request (8.5.3).
3. **Field goals** (rule 8.6.1): done. Any down from within 38 yards, distance + 17, the kicker's range (over 50 yards
   2 off the 46-50 range per yard, as the rule says; the card's own "over 50" line is not used), misses at the line of
   scrimmage or the 20, blocks returned for a touchdown, category 3 penalties, FG stats. Still to come: fake kicks (O6).
4. **Passing plays** (rule 8.3): done. Quick, short and long passes and screens: the pass card (to the receiver
   called, redirected, or a pass rush), the completion range with the pass defense table (and its inside-the-20
   values), the covering defender (+5 for an empty box), play action and extra blockers; the receiver's pass gain
   column with "Lg" long gains; interceptions from the QB's range (interception table, spot and return) and in
   coverage; the pass rush (rush against block moves the sack range), sacks, scrambles; screens with multipliers and
   run-number modifiers; blitzes as an automatic pass rush on short and long passes; pass interference called on the
   covering defender at the spot of the foul, intentional grounding, holding in the end zone; passing, receiving,
   sack and interception stats. Still to come:
   - **Choosing blitzers**: for now the linebackers in F and J blitz.
   - **Double and triple coverage** (rule 7.2.2).
   - **Quarterback endurance** A/B/C (rule 4.5.1).
   - **Big plays** (rule 8.4).

## Change of possession (your note)

Every change of possession must bump the possession counter (`nextPossession` in `endurance.ts`), which the
"once per possession" play-direction rating uses and the stats will use for drives.

| Change of possession | Status |
|---|---|
| Fumble | Done: Z-card fumbles on runs, return fumbles on kickoffs |
| Interception | Done: from the QB's range and in coverage, returns, touchbacks, returned for a touchdown |
| Touchdown | Done: extra point, then the scoring team kicks off |
| Field goal | Done: good (then a kickoff), missed (the other team's ball), blocked (returned for a TD) |
| Kickoff | Done |
| Kickoff return for a TD | Done in the engine (no 1984 return card is long enough to reach) |
| Punt return for a TD | Done (and blocked punts returned for a TD, and fumbled returns) |
| Turnover on downs, safety and free kick | Done |

## Later

- **Drive tracker**: done, on the Play by play tab ("By drive"). Every drive in order with its result (touchdown,
  field goal, punt, turnover, downs, end of half ...), plays, net yards, time and where it started; finished drives fold
  to a summary line. Each play in broadcast form with its arrow: straight for a run, a raised curve for a pass, green
  for a gain, red for a loss, a bar for no gain, dashed arcs for incompletions and interceptions, a flag for penalties.
  Still to come: the whole drive's arrows on the Game tab's field, and kick returns shown with the drive they set up.

- **Data check** button on the Data tab: runs the card-set checks in the browser and shows the report.
- **Injuries**: option for a starter to walk back into the lineup automatically when his injury is over
  (today he returns to the bench and the coach puts him back).
- **Play clock choice**: let the offense pick 20-45 seconds instead of the random time.
- **Timeouts** (rule 9.2): done. Three per half for each coach, called with a play ("Timeout after this play", on the
  Offense and Defense pages), which then takes 10 seconds (5 in the two-minute offense). The computer coach calls them
  when the clock matters. Still to come: overtime's two timeouts (rule 9.8.1).
- **No-huddle at any time** (a house rule, Brady style): today the two-minute offense is only allowed in the final
  minutes of a half, as rule 9.4.1 says.
- **"48?" interception ratings** (rule 8.3.5.2: an even PN on a new card to make the pick): the 1984 cards print plain
  "48", but the later sets may use it.
- **Game tab extras**: teams switching ends each quarter (the home team always attacks to the right for now); the
  drive tracker's arrows for the whole drive on the field, not just the last play.
- **Solitaire**: the computer coaches one side (toss choice, formation, play or defense, All set) from James C. Gordon's
  solitaire tables, which you have as a PDF. Its tables are mostly about passes and coverage, so it fits now that
  passing is in. (That PDF contains the author's email address: confirm before it's processed.)
- **Optional rules**: O1 out of position is done for the offensive line (any line slot, -1 to run and pass block, a notice
  on the card); still open: O1 for defensive backs (-1 pass defense out of their listed position), whether backs and
  receivers may swap positions, and O2-O6 (onside defense, squib kick, measurements, fake kicks; O4 extra blockers is in).
- **Overtime** (rule 9.8).
- **Card creator** (your own seasons, e.g. 1985), from the official Avalon Hill formulas (AH_Formula.pdf, Lee Harris's
  write-up, used with your permission): team and player season stats in (CSV), cards out in the game's own format,
  checked like the converted sets. The tables give the values per slot (OL starter #1 ... backup #3, and so on); the
  missing piece, who gets which slot, is filled by a ranking you can override: Pro Football Reference's Approximate
  Value (AV) per player-season, a bump for Pro Bowl and All-Pro, games started as a tie-breaker. Sacks and
  interceptions (official from 1982) drive pass rush and intercept ranges directly. Known slips in the write-up (the
  7-yard receiving row, the two different interception tables, "eight" defensive backs) get flagged and settled once.
- **Rules printed on the later cards** (1987 on), to add when those seasons come in: a kicker can always make his
  longest field goal with PN 1; the quarterback's "Long Pass Com Adj" line; team cards with big plays, fumbles lost
  and the defensive fumble adjustment.
- **Card creator, pilot done**: `tools/pfr_to_team.py` made New England AH (1984, 1987, 1989, 1991) from Pro Football
  Reference data and the formulas, compared with the official cards and then removed from the game (update 59). Every player who
  played gets a card; small samples follow the official cards (the spare back's card, a capped long game, a Q column
  only for barely used receivers); quarterback endurance by games started. Receivers, kickers, punters and most quarterbacks
  and linebackers match the official cards closely; defensive backs, defensive line and offensive-line pass block
  differ the most. Next: the official 1987/89/91 reader, per-era calibration, and a card-by-card comparison page.
- **Interception ranges: one rule for every season** (decided): the Avalon Hill worksheet table, 0-1 interceptions
  "48?" (rule 8.3.5.2, now in the game), 2 "48", 3 "47-48" and so on. The official 1984 cards gave one number per
  interception (48 minus the interceptions); `tools/int_ranges_worksheet.py` rewrote them to the table (Eugene Daniel,
  6 interceptions: 44-48). Simulated games now average 1.6 interceptions a team, close to the 1984 NFL. The 1987-1991
  cards already follow the table (21 of 22 Patriots fit).
- **Shutdown corners** (later, for the card creator): an elite corner can have few interceptions because nobody throws
  his way (Christian Gonzalez, 2025 Patriots, 0). Interceptions alone undersell him; for seasons with the numbers,
  passes defended (from 1999) or targets and completions allowed (from 2018) could add to his intercept range or pass
  defense, with Pro Bowl and All-Pro as a check.
- **Card creator, first findings** (Patriots 1984, 1987, 1991 against the official cards): kickers match the formula
  table exactly in 1984 and 1987, but by 1991 per-distance success rates were used; quarterbacks match with Avalon
  Hill's own judgement (quick and short from one row, long from another); the sack range uses sacks / attempts, not
  sacks / (sacks + attempts) as written; the longest gain always goes at #1; the 1984 running-back columns follow a
  different table from the one in the write-up. Replacement players did get cards in 1987.
- **More seasons**: 1987, 1989 and 1991 card sets, which are grouped by position and need a new reader in the converter.
- **Online play from the NAS**: serve the built game from the Synology (Web Station), plus a small Node.js server
  that holds each game and passes moves between the two coaches, running the same engine (`src/app/engine`).
  Each coach sees only his own screen; the defense's call stays secret until the snap. Needs logins for players
  and safe access from outside (HTTPS through Synology's reverse proxy, or Tailscale), the same care as Emby.
- **Game archive on the NAS**: every online game stored in a small database (SQLite on the NAS): the seed, both
  teams, every move with who made it and when, and the final score. Because the engine is seeded and deterministic,
  any game can be replayed move by move (proof that it was played), resumed later, or turned into a PDF
  (box score, drive chart, play-by-play).
- **Admin page** (only you can reach it): the settings now in `src/app/settings.ts` — team names (city only or full),
  the game's name, your own team names — as switches instead of a file to edit. Comes with the logins for online play.
- **Team names**: done. City names by default ("New England"; two teams from one city as "New York (A)" and
  "New York (N)"; divisions as "Conference A – East"); full names as an option. The game's name is in the same settings
  file (currently "Statis Pro Football"; change it there, e.g. to "Statistical Football").
- **Visual polish**, once the remaining parts are in.

## Housekeeping

- Keeping both laptops identical: Git with a USB stick (or a home network folder) as the central copy. Nothing in the
  cloud, and never on the company J: drive.
- `tools/README.md` explains the card converters.
