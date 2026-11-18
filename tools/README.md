# Data tools

Python 3 with `pip install pdfplumber`. Run everything from the project folder.

## Adding a season (e.g. 1987)

1. Put the team PDFs in a folder, named like the 1984 ones: `Bears1987.PDF`, `Patriots1987.PDF`, ...
2. `tools/convert_season.sh path/to/folder 1987`
   This converts every team into `public/cards/teams/1987/` and rebuilds `public/cards/teams/index.json`.
   Optional third argument: a folder of old WPF xml files (`patriots.xml` ...) to take jersey numbers from.
3. Read the WARNING lines it prints. Each correction it made is also kept in the team file under `dataNotes`.
4. `python tools/check_team.py public/cards/teams/1987/*.json` lists values that break the usual card patterns.
5. Add the new files to the imports at the top of `src/app/engine/teams.spec.ts` and run `npm test`.
   The test "covers every team in the catalog" fails until you do.

If the 1987 cards use a different layout, `pdf_to_team.py` is where to adapt the reading; `pdf_cells.py` cuts the pages into cards.

## The tools

| File | What it does |
|---|---|
| `pdf_cells.py` | Cuts a team PDF into its cards (5 x 4 per page) |
| `pdf_to_team.py` | Reads one team PDF into the app's JSON; repairs and notes known card slips |
| `xml_to_team.py` | Reads an old WPF team xml file into the same JSON |
| `merge_xml.py` | Adds jersey numbers from the xml; settles PDF/xml disagreements by which value fits its column |
| `check_team.py` | Flags values that break the patterns real cards follow |
| `build_catalog.py` | Rebuilds `index.json` from the team files |
| `convert_season.sh` | Runs the above for a whole season |
| `parse_fac.py`, `build_fac.py` | Converted the Fast Action Card deck (one-off) |

## Making a team from Pro Football Reference data

`tools/pfr_to_team.py` builds a team in the game's format from one team page's CSV exports (passing,
rushing_receiving, defense_fumbles, kicking, punting, kick_punt_returns, team_stats_and_rankings, roster, starters),
using the official Avalon Hill card formulas (Lee Harris's write-up). For example, New England AH:

    python3 tools/pfr_to_team.py "PFR data/1984/patriots" 1984 patriots --suffix AH \
      --id 1984-patriots-ah --name "New England Patriots AH" --city "New England AH" \
      --abbreviation NE --division "AFC East" --coach "Ron Meyer/Raymond Berry" > public/cards/teams/1984/patriots-ah.json

Then add it to `public/cards/teams/index.json` (with its `city`) and to `src/app/engine/teams.spec.ts`. Every
judgement call the write-up leaves open is made with a stated default and listed in the team's `dataNotes`.

Every player who played gets a card. The dials at the top of the script decide how much a small sample can show,
following what the official 1984 cards do: backs with 5 carries or fewer get the standard spare back's card; 6-19
carries give their own N column (from the average without their longest run), SG counting down from the longest and
LG flat at it; receivers with 5 catches or fewer get a Q column only; 6-19 catches give Q and S without the longest
catch and an L column of six rows, then "inc". Quarterback endurance (A/B/C) follows games started.

## One interception rule for every season

`tools/int_ranges_worksheet.py` rewrites a card set's interception ranges to the Avalon Hill worksheet table (0-1
interceptions "48?", 2 "48", 3 "47-48" and so on), the rule the 1987-1991 cards follow and the game now uses for every
season. The 1984 set has been converted: `python3 tools/int_ranges_worksheet.py public/cards/teams/1984` (it does nothing
to a team already converted). `pfr_to_team.py` uses the same table.

## Listed positions for defensive backs

`tools/roles_from_pfr.py` gives backs whose cards have no listed position one from the Pro Football Reference roster
(CB, LCB or RCB a cornerback; S, FS or SS a safety; plain "DB" stays a defensive back), for the Rosters page and rule O1.
The 1984 Patriots are done; the other teams follow once their rosters are exported.
