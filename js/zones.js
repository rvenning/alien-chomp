// Zone registry — the run is endless, but it walks through five themed zones
// as the distance climbs. A zone owns its palette, its pacing knobs and the
// weights the spawner picks patterns from. Adding a zone = one entry here.
//
// `from` is in METRES (20 world px = 1 m, see Game.metres).
// The LAST zone never ends — it's where an endless run settles, so its
// numbers have to stay survivable forever.
//
// Pacing knobs:
//   speedMul  multiplies the run speed ramp
//   drain     hunger points lost per second (eat or starve)
//   density   multiplies the gap between spawn beats (<1 = tighter)
//
// The drain is the whole game: a full bar buys roughly 30 seconds in the
// Suburbs and 16 in the Spaceport, so you are always a few missed snacks from
// dying. tests/bot.test.js measures the real income-vs-drain economy against
// the live spawner and fails if either side drifts.
//
// Weights are relative, not percentages — `rest` deliberately stays non-zero
// everywhere so even the hardest zone hands out breathing room.

const ZONES = [
  {
    id: "suburbs", name: "Suburbs", icon: "🏡", from: 0,
    blurb: "Quiet streets. Easy pickings.",
    sky: ["#63c4ea", "#cfeeff"],
    far: "#9dc4d6", near: "#77a2ba",
    roof: "#c86a4e", wall: "#e8dcc4", window: "#ffe9a8",
    ground: "#63954f", groundDark: "#3d6b34", path: "#c9bd97",
    accent: "#ffd93b",
    speedMul: 1.00, drain: 3.80, density: 1.05,
    weights: { rest: 16, crowd: 34, patrol: 14, drone: 0, rooftop: 10, gauntlet: 4, mech: 0, pickup: 8, brains: 12 },
  },
  {
    id: "downtown", name: "Downtown", icon: "🏙️", from: 250,
    blurb: "Crowds everywhere — and security bots.",
    sky: ["#3f8fd0", "#a7d8f2"],
    far: "#6e8ba8", near: "#4d6885",
    roof: "#3c4a5e", wall: "#8fa3b8", window: "#ffdf94",
    ground: "#5b5f66", groundDark: "#3a3e45", path: "#7c828c",
    accent: "#5ad1ff",
    speedMul: 1.05, drain: 5.20, density: 0.96,
    weights: { rest: 13, crowd: 30, patrol: 20, drone: 8, rooftop: 12, gauntlet: 8, mech: 2, pickup: 8, brains: 10 },
  },
  {
    id: "factory", name: "Robot Factory", icon: "🏭", from: 550,
    blurb: "They build them here. Watch the mechs.",
    sky: ["#8a5a3c", "#e8b27a"],
    far: "#6b4a3a", near: "#4a3128",
    roof: "#5a4234", wall: "#7d6350", window: "#ff9f43",
    ground: "#4a4038", groundDark: "#2e2822", path: "#6b5c4c",
    accent: "#ff9f43",
    speedMul: 1.09, drain: 6.00, density: 0.90,
    weights: { rest: 12, crowd: 26, patrol: 20, drone: 14, rooftop: 10, gauntlet: 10, mech: 8, pickup: 8, brains: 8 },
  },
  {
    id: "neon", name: "Neon District", icon: "🌃", from: 800,
    blurb: "Night shift. Everything is faster.",
    sky: ["#1b1040", "#5a2a7a"],
    far: "#3a2260", near: "#26163f",
    roof: "#2a1a45", wall: "#3d2a5e", window: "#ff5ad1",
    ground: "#241a38", groundDark: "#150e22", path: "#4a3468",
    accent: "#ff5ad1",
    speedMul: 1.13, drain: 6.80, density: 0.85,
    weights: { rest: 11, crowd: 24, patrol: 20, drone: 18, rooftop: 10, gauntlet: 12, mech: 9, pickup: 8, brains: 8 },
  },
  {
    id: "spaceport", name: "Spaceport", icon: "🚀", from: 1200,
    blurb: "The last stop. Eat everything.",
    sky: ["#0a0a20", "#2a3a6a"],
    far: "#26355e", near: "#161f3a",
    roof: "#1c2748", wall: "#2c3a63", window: "#8ef0ff",
    ground: "#1c2340", groundDark: "#0e1226", path: "#39456e",
    accent: "#8ef0ff",
    speedMul: 1.18, drain: 7.80, density: 0.82,
    weights: { rest: 11, crowd: 23, patrol: 19, drone: 19, rooftop: 10, gauntlet: 13, mech: 10, pickup: 8, brains: 8 },
  },
];

const ZONE_BY_ID = Object.fromEntries(ZONES.map((z) => [z.id, z]));

// Which zone a distance (in metres) falls in. Zones are ordered by `from`.
function zoneIndexAt(m) {
  let i = 0;
  for (let k = 0; k < ZONES.length; k++) if (m >= ZONES[k].from) i = k;
  return i;
}
function zoneAt(m) { return ZONES[zoneIndexAt(m)]; }

// Metres still to run before the next zone (null once you're in the last one).
function metresToNextZone(m) {
  const i = zoneIndexAt(m);
  return i + 1 < ZONES.length ? ZONES[i + 1].from - m : null;
}
