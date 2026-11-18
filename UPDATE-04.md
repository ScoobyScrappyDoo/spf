# Update 04 (builds on update 03)

Unzip into the project folder (where package.json is) and let it replace the files.

What's in it:
- The weather moves even when Windows has "Animation effects" turned off (that kept it still before). A "Moving" tick
  box in the Weather row stops it if you want a still picture.
- The cards of the last play open on the first card dealt, so the play reads from its start.
- A fix: an "Lg" in a runner's N column (only Rick McIvor, 1984 Cardinals, row 12) counted 0 yards; it now flips a card
  for his LG column, on runs and end-arounds.

After unzipping: `npm test -- --watch=false`, 431 tests should pass. If you play online, restart the game server
(the engine changed).
