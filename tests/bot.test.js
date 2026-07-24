"use strict";
// Headless balance bot.
//
// A runner can look fine and still be broken: too much metal per second, a
// hunger drain nothing can outrun, or — worst for a kid — a game that plays
// itself. None of that shows up in a unit test of any single function, so this
// suite runs the REAL engine with no canvas at all and measures the outcome.
//
// Three things get measured:
//   1. the food economy per zone, straight off the live spawner
//   2. what a competent player and a passive player actually achieve
//   3. that the spawner never lays down something impossible
//
// The economy ratio (income if you ate everything, over the hunger drain) is
// the number to watch. Much above ~2.5 and the bar just sits full — avoided
// damage is thrown away against the cap and skill stops paying. Below ~1.15
// even perfect play starves.
//
// Math.random is seeded (tests/seed.js) so a failure here means a real balance
// change, not a bad roll.

const { test } = require("node:test");
const assert = require("node:assert");
const path = require("node:path");
const { loadScripts } = require("../lib/tools/test-harness.js");

const ROOT = path.join(__dirname, "..");
const DT = 1 / 60;

const X = loadScripts({
  baseDir: ROOT,
  files: [
    "tests/seed.js",
    "lib/gk-util.js", "lib/gk-audio.js",
    "js/zones.js", "js/entities.js", "js/skins.js",
    "js/audio.js", "js/game.js",
  ],
  exports: ["Game", "P", "GROUND_Y", "LW", "PX_PER_M", "ZONES", "HUMANS", "ROBOTS",
            "BRAIN", "RULES", "__reseed"],
  browser: true,
  globals: {
    // gk-util does `window.GK = window.GK || {}`, so a pre-seeded GK survives
    // and lets us stub the screen/toast layer the engine pokes at.
    GK: { UI: { toast() {}, showScreen() {}, openModal() {}, closeModal() {} } },
    document: { addEventListener() {}, getElementById: () => null, querySelector: () => null },
    App: { runOver() {} },
    performance: { now: () => 0 },
    requestAnimationFrame() {},
  },
});
const { Game, ZONES, HUMANS, BRAIN, RULES, __reseed } = X;
const SPD = { base: X.P.SPD_BASE, gain: X.P.SPD_GAIN, ramp: X.P.SPD_RAMP };

// The speed the engine would be running at on a zone's first metre.
const speedIn = (z) => (SPD.base + Math.min(SPD.gain, z.from / SPD.ramp)) * z.speedMul;

/* ===================== 1. the food economy, per zone ====================== */
// Everything the spawner puts down over a long stretch of one zone, with
// nothing eaten, converted to "hunger per second if you ate all of it".
function measureEconomy(zi) {
  const z = ZONES[zi];
  Game.reset();
  Game.zone = z;
  Game.zoneIdx = zi;
  Game.speed = speedIn(z);
  Game.camX = 0;
  Game.nextBeatX = 0;

  let food = 0, robots = 0;
  const DIST = 120000;                         // px of road
  while (Game.camX < DIST) {
    Game.camX += Game.speed * DT;
    Game.spawnAhead();
    for (const e of Game.ents) {
      if (e.kind === "human") food += HUMANS[e.type].food;
      else if (e.kind === "brain") food += BRAIN.food;
      else if (e.kind === "robot") robots++;
    }
    Game.ents.length = 0;                      // yield only; nothing is eaten
    Game.plats.length = 0;
  }
  const seconds = DIST / Game.speed;
  return { income: food / seconds, robotsPerSec: robots / seconds, drain: z.drain, zone: z };
}

test("every zone can be out-eaten, but only just", () => {
  const rows = [];
  const ratios = [];
  for (let i = 0; i < ZONES.length; i++) {
    __reseed(1000 + i);
    const m = measureEconomy(i);
    const ratio = m.income / m.drain;
    ratios.push(ratio);
    rows.push(`${m.zone.id.padEnd(10)} income ${m.income.toFixed(1)}/s  drain ${m.drain.toFixed(1)}/s` +
              `  ratio ${ratio.toFixed(2)}  metal ${m.robotsPerSec.toFixed(2)}/s`);
    assert.ok(ratio > 1.15,
      `${m.zone.id}: even perfect play only earns ${ratio.toFixed(2)}x the drain — unwinnable`);
    assert.ok(ratio < 2.8,
      `${m.zone.id}: perfect play earns ${ratio.toFixed(2)}x the drain — the bar pegs full and skill stops paying`);
  }
  for (let i = 1; i < ratios.length; i++) {
    assert.ok(ratios[i] < ratios[i - 1] + 0.05,
      `${ZONES[i].id} is no tighter than ${ZONES[i - 1].id} (${ratios[i].toFixed(2)} vs ${ratios[i - 1].toFixed(2)})`);
  }
  console.log("\n  economy:\n    " + rows.join("\n    ") + "\n");
});

/* ============================ 2. playing bots ============================= */
// Reads the world the way a player does — a short look ahead, no knowledge of
// what hasn't spawned yet — and reacts. Deliberately not frame-perfect.
function smartPolicy(G) {
  const p = G.p, I = G.input;
  const ahead = (e) => e.x - p.x;
  let jump = false, down = false;

  // Mega Chomp turns every robot into a snack, so stop dodging and just run.
  const ignoreMetal = G.frenzyT > 0;

  const threats = ignoreMetal ? [] : G.ents
    .filter((e) => !e.dead && e.kind === "robot" && ahead(e) > -16 && ahead(e) < 150)
    .sort((a, b) => ahead(a) - ahead(b));

  // A drone above head height makes jumping a mistake — note it before deciding.
  let jumpBlocked = false;
  for (const e of threats) {
    if (e.type === "drone" && e.y < 135 && ahead(e) > -16 && ahead(e) < 80) jumpBlocked = true;
  }

  const t = threats[0];
  if (t) {
    const dx = ahead(t);
    if (t.type === "drone") {
      if (t.y >= 135 && dx < 36 && dx > -16) down = true;          // duck the low one
    } else if (t.type === "mech") {
      if (p.grounded && dx < 58 && dx > 0) jump = true;            // only a jump clears it
    } else {                                                       // patrol bot
      if (p.grounded && dx < 46 && dx > 0 && !jumpBlocked) jump = true;
      else if (!p.grounded && !p.slamming && dx < 30 && p.y < t.y - 8) down = true;
    }
  }

  // No threat? Go up for the rooftop snacks and the high power-up orbs.
  if (!jump && !down && p.grounded && !jumpBlocked) {
    for (const pl of G.plats) {
      const d = pl.x - p.x;
      if (d > 18 && d < 52) { jump = true; break; }
    }
    if (!jump) {
      for (const e of G.ents) {
        if (e.dead || e.kind !== "orb" || e.y > 130) continue;
        const d = ahead(e);
        if (d > 20 && d < 56) { jump = true; break; }
      }
    }
  }

  if (jump && !I.jumpHeld) I.jumpPressed = true;
  I.jumpHeld = jump;
  if (down && !I.down) I.downPressed = true;
  I.down = down;
}

function passivePolicy(G) {
  G.input.jumpHeld = false; G.input.down = false;
}

function runBot(policy, { seed = 7, maxFrames = 60 * 900 } = {}) {
  __reseed(seed);
  Game.reset();
  Game.running = true;
  Game.dead = false;
  let frames = 0, hungerSum = 0, minHunger = RULES.HUNGER_MAX;
  while (Game.running && !Game.dead && frames < maxFrames) {
    policy(Game);
    Game.update(DT);
    hungerSum += Game.hunger;
    minHunger = Math.min(minHunger, Game.hunger);
    frames++;
  }
  return {
    metres: Game.metres, score: Math.round(Game.score), eaten: Game.eaten,
    robots: Game.robots, bites: Game.bites, bestCombo: Game.bestCombo, zone: Game.zoneIdx,
    seconds: +(frames / 60).toFixed(1), died: Game.dead,
    avgHunger: hungerSum / Math.max(1, frames), minHunger,
  };
}

const show = (tag, r) =>
  console.log(`  ${tag}: ${r.metres}m  score ${r.score}  ate ${r.eaten}  smashed ${r.robots}  ` +
              `bitten ${r.bites}  x${r.bestCombo}  ${r.seconds}s  ` +
              `${r.died ? "starved" : "still going"}`);

test("a competent player gets deep into the run", () => {
  const runs = [1, 2, 3].map((s) => runBot(smartPolicy, { seed: s }));
  runs.forEach((r, i) => show(`smart seed ${i + 1}`, r));
  const best = Math.max(...runs.map((r) => r.metres));
  const worst = Math.min(...runs.map((r) => r.metres));
  assert.ok(best >= ZONES[3].from,
    `the best bot run only reached ${best}m — the Neon District (${ZONES[3].from}m) is unreachable`);
  assert.ok(worst >= 380, `a bot run ended at ${worst}m — something early is unsurvivable`);
  assert.ok(runs.every((r) => r.eaten > 40), "the bot barely ate — food is too hard to reach");
});

test("hunger is a live threat even when you are playing well", () => {
  const r = runBot(smartPolicy, { seed: 11 });
  // If a good player's bar never leaves the top, the whole premise is cosmetic
  // and every point of damage they avoid is wasted against the cap.
  assert.ok(r.avgHunger < 88,
    `average hunger was ${r.avgHunger.toFixed(0)}/100 — the bar never moves`);
  assert.ok(r.minHunger < 45,
    `hunger never dropped below ${r.minHunger.toFixed(0)} — no close calls`);
});

test("dodging beats tanking, by a lot", () => {
  // The core claim of the design: robots are worth avoiding even though
  // avoiding them means skipping the snack behind them.
  const seeds = [7, 21, 33];
  const smart = seeds.map((s) => runBot(smartPolicy, { seed: s }));
  const passive = seeds.map((s) => runBot(passivePolicy, { seed: s }));
  show("smart  ", smart[0]);
  show("passive", passive[0]);
  const smartAvg = smart.reduce((a, r) => a + r.metres, 0) / seeds.length;
  const passiveAvg = passive.reduce((a, r) => a + r.metres, 0) / seeds.length;
  console.log(`  average distance — smart ${smartAvg.toFixed(0)}m vs passive ${passiveAvg.toFixed(0)}m`);

  assert.ok(passive.every((r) => r.died), "a player who never touches the controls should starve");
  assert.ok(smartAvg > passiveAvg * 2,
    `playing well (${smartAvg.toFixed(0)}m) barely beats doing nothing (${passiveAvg.toFixed(0)}m)`);
  assert.ok(passiveAvg < ZONES[2].from,
    `never jumping still reached the Robot Factory (${passiveAvg.toFixed(0)}m) — the robots are harmless`);
});

test("a run is long enough to be worth starting and short enough to retry", () => {
  const r = runBot(smartPolicy, { seed: 4 });
  assert.ok(r.seconds > 40, `a good run only lasted ${r.seconds}s`);
  assert.ok(r.seconds < 900, `a good run took ${r.seconds}s — too long for one sitting`);
});

/* ===================== 3. what the spawner puts down ====================== */
test("the spawner never stacks two robots on top of each other", () => {
  __reseed(99);
  Game.reset();
  let worst = Infinity, checked = 0;
  for (let i = 0; i < ZONES.length; i++) {
    Game.zone = ZONES[i]; Game.zoneIdx = i;
    Game.speed = speedIn(ZONES[i]);
    Game.camX = 0; Game.nextBeatX = 0; Game.ents.length = 0; Game.plats.length = 0;
    for (let f = 0; f < 6000; f++) {
      Game.camX += Game.speed * DT;
      Game.spawnAhead();
      const bots = Game.ents.filter((e) => e.kind === "robot").sort((a, b) => a.x - b.x);
      for (let k = 1; k < bots.length; k++) {
        // Two robots at the same height with no room between them would be a
        // wall; different heights (a ground bot under a drone) is fine.
        if (Math.abs(bots[k].y - bots[k - 1].y) > 20) continue;
        worst = Math.min(worst, bots[k].x - bots[k - 1].x);
        checked++;
      }
      Game.ents = Game.ents.filter((e) => e.x > Game.camX - 100);
      Game.plats = Game.plats.filter((pl) => pl.x + pl.w > Game.camX - 100);
    }
  }
  assert.ok(checked > 100, "not enough robot pairs seen to trust this check");
  assert.ok(worst >= 40, `two same-height robots spawned ${worst.toFixed(0)}px apart — undodgeable`);
});

test("rooftops always land inside a single jump", () => {
  const single = (X.P.JUMP * X.P.JUMP) / (2 * X.P.GRAV);
  __reseed(123);
  Game.reset();
  for (let i = 0; i < ZONES.length; i++) {
    Game.zone = ZONES[i]; Game.zoneIdx = i;
    Game.speed = 200; Game.camX = 0; Game.nextBeatX = 0;
    Game.ents.length = 0; Game.plats.length = 0;
    for (let f = 0; f < 4000; f++) {
      Game.camX += Game.speed * DT;
      Game.spawnAhead();
      for (const pl of Game.plats) {
        assert.ok(X.GROUND_Y - pl.y <= single,
          `${ZONES[i].id} spawned a rooftop ${(X.GROUND_Y - pl.y).toFixed(0)}px up; a jump reaches ${single}`);
      }
      Game.ents.length = 0;
      Game.plats = Game.plats.filter((pl) => pl.x + pl.w > Game.camX - 100);
    }
  }
});
