# Statis Pro Football (web)

Angular 21 + DevExtreme 25.2 (your license key caps DevExtreme at 25.2; that version needs Angular 19 or newer).

```
npm install        # if npm fails with "Cannot read properties of null (reading 'edgesOut')", use: npm install --legacy-peer-deps
npm start          # http://localhost:4200
npm test           # engine rules tests (Vitest)
```

## Layout

```
src/app/engine/          Pure TypeScript game rules. No Angular imports, so it can also run on a Node server later.
  model/                 Card, team, FAC and formation types
  lineup.ts              Who stands in which slot; formation changes keep your players where possible
  selection.ts           Which plays/strategies are legal (rules 4.6, 7.1, 8.2.6, 8.3.7, 8.3.9, O4)
  deck.ts, random.ts     Seeded FAC deck: same seed = same cards for both players
  engine.spec.ts         Tests for all of the above
src/app/state/           Signal store wrapping the engine for the offense screen
src/app/components/      Board, player card, coach panel
public/data/             fac-deck.json, teams/1984/patriots.json
tools/                   Python scripts that converted the PDFs (pdfplumber)
```

## Data notes from the conversion

- FAC deck: 96 regular + 13 Z cards = 109, matching rule 5.0 (the PDF's title card says 113).
- Cards with run number 11 and pass numbers 41-44 print "SR: D + 1" through "D + 5". The OB versions of the same cards print "D + I", so these were read as "D + I".
- Card 6/29 has "IR: BK vs J" where similar cards have "BK vs I". Kept as printed; worth checking against a physical card.
- Two identical 7/21 cards. Kept: every pass number appears exactly twice in the deck, so both belong.
- Lineup card lists "Raymond Clayborn", the player card says "Ray Clayborn" (matched by surname).
- Kick returner Jon Williams has no player card; he exists only on the return unit.
