// Entity registry — everything the spawner can put in front of the alien.
// The engine reads properties off these tables and never branches on a type
// name, so a new snack or a new hazard is one entry here plus a draw case in
// render.js.
//
// Sizes are in logical px. `food` is hunger restored, `dmg` is hunger lost.
// World x grows to the right; the alien runs right, so a NEGATIVE vx means the
// thing is walking towards you (and you close on it faster).
//
// Food values are deliberately small next to the drain rates in zones.js: a
// snack buys you a second or two, not a rest. tests/bot.test.js measures the
// real economy by running the spawner, and fails if perfect play stops being
// comfortably ahead of the clock — or if it gets so far ahead that hunger
// stops mattering.

/* ------------------------------------------------------------------ snacks */
const HUMANS = {
  walker: {
    name: "Human", w: 12, h: 22, score: 8, food: 5, vx: -8,
    skin: "#f2c9a0", shirt: "#e2574c", pants: "#39456b",
  },
  runner: {
    // Bolts away once it notices you — the chase is the point, and catching one
    // mid-flight is where the combo usually comes from.
    name: "Jogger", w: 11, h: 21, score: 14, food: 5, vx: -6,
    flee: 78, fleeRange: 150, skin: "#e8b487", shirt: "#3ba7e8", pants: "#2b3350",
  },
  chonk: {
    name: "Big Lunch", w: 19, h: 25, score: 20, food: 12, vx: 5,
    skin: "#f5d0a8", shirt: "#f2a03d", pants: "#5a4634",
  },
  kid: {
    // Rooftop-only: small, still, and the best hunger-per-bite in the game —
    // the reward for taking the high route instead of the safe one.
    name: "Rooftop Snack", w: 9, h: 16, score: 16, food: 9, vx: 0,
    skin: "#f2c9a0", shirt: "#a56fd8", pants: "#3b4a6b",
  },
};

/* ----------------------------------------------------------------- hazards */
const ROBOTS = {
  bot: {
    // Ground patrol. The only robot a dive-slam destroys.
    name: "Patrol Bot", w: 15, h: 24, dmg: 20, slammable: true, slamScore: 15,
    body: "#b9c2cc", trim: "#5b6773", eye: "#ff4d4d",
  },
  drone: {
    // Flies at head height — jump over it or slide under it, never through it.
    name: "Drone", w: 19, h: 13, dmg: 18, slammable: false, fly: true,
    vx: -34, bob: 9, body: "#cfd6de", trim: "#48525e", eye: "#ff4d4d",
  },
  mech: {
    // Tall enough that only a jump clears it, and slamming just hurts your feet.
    name: "Mech", w: 25, h: 43, dmg: 28, slammable: false,
    vx: -10, body: "#8d97a4", trim: "#3a434f", eye: "#ffb02e",
  },
};

/* ---------------------------------------------------------------- pickups */
// `dur` 0 means the effect is instant rather than timed.
const POWERUPS = {
  magnet: {
    id: "magnet", icon: "🌀", name: "Tractor Beam", dur: 6.5, color: "#4fc3f7",
    blurb: "Humans get pulled in",
  },
  shield: {
    id: "shield", icon: "🛡️", name: "Force Bubble", dur: 0, color: "#ffd93b",
    blurb: "Blocks one robot",
  },
  frenzy: {
    id: "frenzy", icon: "⚡", name: "MEGA CHOMP", dur: 6.0, color: "#ff5ad1",
    blurb: "Robots are edible!",
  },
  snack: {
    id: "snack", icon: "🍗", name: "Snack Pack", dur: 0, color: "#7ee081",
    blurb: "+35 hunger",
  },
};
const POWERUP_IDS = Object.keys(POWERUPS);

const BRAIN = { w: 11, h: 10, score: 25, food: 1 };

/* Scoring / feel constants shared by the engine and the tests. */
const RULES = {
  HUNGER_MAX: 100,
  SNACK_REFILL: 30,
  COMBO_WINDOW: 2.6,     // seconds between bites before the multiplier drops
  COMBO_MAX: 8,
  FRENZY_ROBOT_SCORE: 30,
  FRENZY_ROBOT_FOOD: 4,
  METRE_SCORE: 0.5,      // points per metre run
  IFRAMES: 1.1,
  MAGNET_RANGE: 92,
  SLAM_RADIUS: 46,
};
