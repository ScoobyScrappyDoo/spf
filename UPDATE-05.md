# Update 05 (builds on update 04)

Unzip into the project folder (where package.json is) and let it replace the files.

A fix: the other side's player card ("what you see across the line" on Offense or Defense, e.g. the computer's
offense while you're on defense) was 384 pixels wide instead of 296. It now has the size of every other player card.

After unzipping: `npm test -- --watch=false`, 431 tests should pass.
