# Alien Chomp 👽

An endless side-scrolling chomp runner. You're a starving alien loose in the
city: eat every human you can, and never, ever bite a robot.

**[▶ Play it](https://rvenning.github.io/alien-chomp/)**

## How it works

Your hunger bar drains the whole time you're running, so eating isn't a bonus —
it's life support. A full bar buys about 30 seconds in the Suburbs and 16 in the
Spaceport, and every human you swallow buys a little more.

Robots are made of metal. Biting one costs a big chunk of the bar and resets
your chain. The catch is that the snack is usually *behind* the robot, so
jumping the hazard also means jumping the meal — the run is a long argument
between playing safe and staying fed.

**Controls** — tap the left half of the screen to jump (tap again in mid-air for
a double jump), the right half to slide and dive-slam. On a keyboard:
`Space`/`↑` jump, `↓` slide/slam, `P` pause. Holding jump jumps higher.

## Features

- **Five zones** that arrive as you get further — Suburbs, Downtown, Robot
  Factory, Neon District, Spaceport — each with its own palette, pace and mix of
  hazards. The last one never ends; the hunger drain just keeps climbing.
- **Chomp chains** up to ×8 for eating without pausing, reset by any robot bite.
- **The dive-slam**: drop onto a patrol bot to smash it instead of biting it —
  the only way past one that keeps you low enough to eat what's behind it.
  Mechs are too big; they have to be jumped.
- **Power-ups** — Tractor Beam (pulls humans in), Force Bubble (blocks one
  robot), Snack Pack (instant refill) and Mega Chomp, which briefly makes the
  robots edible.
- **Six alien skins** unlocked by lifetime humans eaten, from Blob to Void
  Muncher.
- **Family profiles + leaderboard**, synced across every device in the house.
- Installs to a home screen and plays offline.

## Built on gamekit

Profiles with PINs, the leaderboard, family sync, the sound engine, the particle
layer and the install button all come from
[gamekit](https://github.com/rvenning/gamekit), vendored into `lib/`. To pull in
a newer kit:

```bash
node "../gamekit/tools/sync-to-game.js" "../alien-chomp"
```

Then re-test and bump the cache version in `sw.js` — devices keep serving the
old build otherwise.

## Local development

No build step; it's plain scripts.

```bash
npx http-server . -p 8103 -c-1
```

Then open <http://localhost:8103>.

## Tests

```bash
node --test
```

- `tests/data.test.js` — lints the zone, entity and skin registries, and pins
  the geometry that decides playability: that a low drone can be slid under, a
  high one can be run under, and every rooftop is inside a single jump's reach.
- `tests/bot.test.js` — a headless balance bot that runs the real engine with no
  canvas. It measures the food economy per zone against the hunger drain, and
  checks that a competent player gets more than twice as far as one who never
  touches the controls. `Math.random` is seeded, so a failure is a real balance
  change rather than a bad roll.

## Storage

Progress lives in `localStorage` under the `ac_*` prefix and syncs to the
`alienchomp` Firestore collection in the shared `wordvoyage-e5a5c` project. The
API key in `js/firebase-config.js` is a client config, not a secret — it's
restricted to the Cloud Firestore API and to the games' own origins.

## PWA

`manifest.json`, `sw.js` (network-first, cache fallback) and `icons/`, generated
by `node tools/make-icons.js`.
