# Update 01 (builds on update 91)

The numbering starts again at 01. Unzip into the project folder (where package.json is) and let it replace the files.

What's in it:
- Each play's cards, Z cards included, in a carousel on the Offense and Defense pages, under Last play.
- A Fast Action Card drawn in full, the same size as a player card. A Z card says whether it counted; the card whose
  Z line gave the result has that line marked.
- The weather intensity slider in white.

After unzipping:
1. `npm test -- --watch=false`: 430 tests should pass.
2. If you play online: stop the game server (Ctrl+C) and start it again with `npm run server` (protocol 3).

New files: src/app/components/fac-card/fac-card.ts, src/app/components/play-cards/play-cards.ts,
src/app/engine/dealt-cards.spec.ts. Games saved before this update open as before, just without cards to show.
