# Update 02 (builds on update 01)

Unzip into the project folder (where package.json is) and let it replace the files.

What's in it:
- The cards of the last play as a small deck: the card in focus in front, the one before and the one after it a
  little smaller behind it, just their edges showing, with the arrow buttons on them.
- In Last play, "FAC 2/3" after each step that read a card. Click it to see that card; the one in focus is dark.

After unzipping:
1. `npm test -- --watch=false`: 430 tests should pass.
2. If you play online, restart the game server (`npm run server`).

New file: src/app/state/play-cards.service.ts. Games played with update 01 show their cards but no "FAC" links
(update 01 didn't record which step read each card).
