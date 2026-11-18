# Update 03 (builds on update 02)

Unzip into the project folder (where package.json is) and let it replace the files.

What's in it: the weather on the field (Game tab), only the look for now.
- Rain: streaks that splash on the grass; heavier rain darkens the field a little.
- Snow: flakes of different sizes drifting down; heavy snow adds a faint white haze.
- Wind: gusts and bits of grass blowing across, and a flag in the corner of the right end zone with the direction and
  the speed (light 6-12 mph, medium 13-21, heavy 22-32; a new wind for each game).
- During a game, a "Weather" row under the scoreboard switches the conditions and the intensity, to try them out.

After unzipping: `npm test -- --watch=false`, 430 tests should pass.

New files: src/app/state/weather.service.ts, src/app/components/weather-layer/weather-layer.ts.
