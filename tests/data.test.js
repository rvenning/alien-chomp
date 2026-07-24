"use strict";
// Data linter for the registries plus the geometry invariants that decide
// whether the game is actually playable.
//
// The spawn patterns are built from numbers spread across zones.js, entities.js
// and game.js — a nudge to the jump height or a robot's size can quietly make a
// rooftop unreachable or a drone impossible to get past, and neither shows up
// as an error. These tests pin the relationships instead of the numbers.

const { test } = require("node:test");
const assert = require("node:assert");
const path = require("node:path");
const { loadScripts } = require("../lib/tools/test-harness.js");

const ROOT = path.join(__dirname, "..");

const X = loadScripts({
  baseDir: ROOT,
  files: ["js/zones.js", "js/entities.js", "js/skins.js"],
  exports: ["ZONES", "ZONE_BY_ID", "zoneAt", "zoneIndexAt", "metresToNextZone",
            "HUMANS", "ROBOTS", "POWERUPS", "BRAIN", "RULES",
            "SKINS", "SKIN_BY_ID", "skinUnlocked", "activeSkin", "nextSkin"],
});
const { ZONES, zoneAt, zoneIndexAt, metresToNextZone,
        HUMANS, ROBOTS, POWERUPS, RULES, SKINS, skinUnlocked, activeSkin, nextSkin } = X;

// The feel constants live in game.js, which needs a browser to load. They are
// small and stable, so the test restates them and asserts the source still
// agrees (see "game.js constants match" below).
const G = { GROUND_Y: 172, P_H: 28, SLIDE_H: 15, JUMP: -400, JUMP2: -352, GRAV: 1250 };
const singleJumpHeight = (G.JUMP * G.JUMP) / (2 * G.GRAV);            // 64px
const doubleJumpHeight = singleJumpHeight + (G.JUMP2 * G.JUMP2) / (2 * G.GRAV);

const isHex = (s) => typeof s === "string" && /^#[0-9a-f]{6}$/i.test(s);

/* ------------------------------------------------------------------ zones */
test("zones are ordered, unique and start at zero", () => {
  assert.ok(ZONES.length >= 3, "an endless runner needs a few zones to walk through");
  assert.equal(ZONES[0].from, 0, "the first zone must cover metre 0");
  const ids = new Set();
  for (let i = 0; i < ZONES.length; i++) {
    const z = ZONES[i];
    assert.ok(!ids.has(z.id), `duplicate zone id ${z.id}`);
    ids.add(z.id);
    if (i > 0) assert.ok(z.from > ZONES[i - 1].from, `${z.id} must start after ${ZONES[i - 1].id}`);
  }
});

test("zone palettes are complete and valid hex", () => {
  for (const z of ZONES) {
    for (const k of ["far", "near", "roof", "wall", "window", "ground", "groundDark", "path", "accent"]) {
      assert.ok(isHex(z[k]), `${z.id}.${k} is not a hex colour: ${z[k]}`);
    }
    assert.equal(z.sky.length, 2, `${z.id}.sky needs two stops`);
    assert.ok(z.sky.every(isHex), `${z.id}.sky has a bad colour`);
    assert.ok(z.name && z.icon && z.blurb, `${z.id} is missing display text`);
  }
});

test("difficulty only ever ramps up, and the fuse stays a readable length", () => {
  for (let i = 1; i < ZONES.length; i++) {
    const a = ZONES[i - 1], b = ZONES[i];
    assert.ok(b.speedMul >= a.speedMul, `${b.id} is slower than ${a.id}`);
    assert.ok(b.drain >= a.drain, `${b.id} drains slower than ${a.id}`);
    assert.ok(b.density <= a.density, `${b.id} is emptier than ${a.id}`);
  }
  // How long a FULL bar lasts if you eat nothing. Too long and hunger is
  // decoration; too short and a single unlucky gap is fatal. Whether the bar
  // can actually be refilled fast enough is measured in bot.test.js against
  // the real spawner.
  for (const z of ZONES) {
    const fuse = RULES.HUNGER_MAX / z.drain;
    assert.ok(fuse >= 11, `${z.id} empties a full bar in ${fuse.toFixed(1)}s — too twitchy`);
    assert.ok(fuse <= 40, `${z.id} takes ${fuse.toFixed(1)}s to starve — hunger stops mattering`);
  }
});

test("every zone leaves an escape from every hazard", () => {
  for (const z of ZONES) {
    assert.ok(z.weights.rest > 0, `${z.id} never gives the player a breather`);
    assert.ok(z.weights.crowd > 0, `${z.id} spawns no food — hunger can only go down`);
    assert.ok(z.weights.pickup > 0, `${z.id} has no power-ups`);
    for (const [k, v] of Object.entries(z.weights)) {
      assert.ok(typeof v === "number" && v >= 0, `${z.id}.weights.${k} = ${v}`);
    }
  }
});

test("zoneAt / zoneIndexAt agree with the table at every boundary", () => {
  assert.equal(zoneIndexAt(-5), 0, "before the start is still zone 0");
  ZONES.forEach((z, i) => {
    assert.equal(zoneIndexAt(z.from), i, `${z.id} should own its own first metre`);
    assert.equal(zoneAt(z.from).id, z.id);
    if (i > 0) assert.equal(zoneIndexAt(z.from - 1), i - 1, `metre before ${z.id} belongs to the previous zone`);
  });
  assert.equal(metresToNextZone(ZONES[ZONES.length - 1].from + 10), null, "the last zone never ends");
  assert.equal(metresToNextZone(0), ZONES[1].from);
});

/* --------------------------------------------------------------- entities */
test("humans are worth eating and robots are worth avoiding", () => {
  for (const [id, h] of Object.entries(HUMANS)) {
    assert.ok(h.food > 0, `${id} restores no hunger`);
    assert.ok(h.score > 0, `${id} is worth no points`);
    assert.ok(h.w > 0 && h.h > 0, `${id} has no size`);
  }
  const worstBite = Math.max(...Object.values(ROBOTS).map((r) => r.dmg));
  const bestMeal = Math.max(...Object.values(HUMANS).map((h) => h.food));
  assert.ok(worstBite > bestMeal,
    "a robot bite must cost more than the best snack restores, or metal is free");
  assert.ok(worstBite < RULES.HUNGER_MAX / 3,
    "one mistake should never cost more than a third of the bar");
});

test("exactly one robot is slammable, and it is the ground patrol", () => {
  const slammable = Object.entries(ROBOTS).filter(([, r]) => r.slammable);
  assert.equal(slammable.length, 1, "the dive-slam needs one clear target type");
  assert.ok(slammable[0][1].slamScore > 0, "smashing a bot should pay something");
  assert.ok(ROBOTS.mech.h > G.P_H, "the mech must be too tall to be anything but jumped");
});

test("power-ups are all reachable and self-describing", () => {
  for (const [id, p] of Object.entries(POWERUPS)) {
    assert.equal(p.id, id, `${id}.id disagrees with its key`);
    assert.ok(p.icon && p.name && p.blurb, `${id} has no HUD text`);
    assert.ok(isHex(p.color), `${id}.color is not hex`);
    assert.ok(p.dur >= 0);
  }
});

/* --------------------------------------------------------------- geometry */
test("a low drone can be slid under; a high drone can be run under", () => {
  const drone = ROBOTS.drone;
  const standingTop = G.GROUND_Y - G.P_H;      // 144
  const slidingTop = G.GROUND_Y - G.SLIDE_H;   // 157

  // These are the two heights game.js emits (see the "drone" case).
  const LOW = 146, HIGH = 120;
  const lowBottom = LOW + drone.h / 2;
  assert.ok(lowBottom > standingTop, "the low drone would miss a standing player entirely");
  assert.ok(lowBottom < slidingTop, "the low drone cannot be slid under");

  const highBottom = HIGH + drone.h / 2 + drone.bob;   // worst case of the bob
  assert.ok(highBottom < standingTop, "the high drone clips a player who is just running");
});

test("every rooftop is reachable with a single jump", () => {
  // game.js emits platform tops in irand(110, 126).
  const HIGHEST = 110;
  const rise = G.GROUND_Y - HIGHEST;
  assert.ok(rise <= singleJumpHeight,
    `rooftops need a ${rise}px rise but one jump only gives ${singleJumpHeight}px`);
  assert.ok(doubleJumpHeight > rise + 30, "no margin for a mistimed second jump");
});

test("a jump clears every ground hazard", () => {
  const tallest = Math.max(...Object.values(ROBOTS).filter((r) => !r.fly).map((r) => r.h));
  assert.ok(singleJumpHeight > tallest,
    `the tallest ground robot is ${tallest}px but a jump only rises ${singleJumpHeight}px`);
});

test("game.js constants match the ones this file reasons about", () => {
  // The invariants above are only meaningful if they're checking the real
  // numbers, so read them straight out of the source.
  const fs = require("node:fs");
  const src = fs.readFileSync(path.join(ROOT, "js", "game.js"), "utf8");
  const num = (name) => {
    const m = src.match(new RegExp(`${name}:\\s*(-?[0-9.]+)`)) || src.match(new RegExp(`const ${name} = (-?[0-9.]+)`));
    assert.ok(m, `could not find ${name} in game.js`);
    return Number(m[1]);
  };
  assert.equal(num("GROUND_Y"), G.GROUND_Y);
  assert.equal(num("H"), G.P_H);
  assert.equal(num("SLIDE_H"), G.SLIDE_H);
  assert.equal(num("JUMP"), G.JUMP);
  assert.equal(num("JUMP2"), G.JUMP2);
  assert.equal(num("GRAV"), G.GRAV);
});

/* ------------------------------------------------------------------ skins */
test("skins unlock in order and start with a free one", () => {
  assert.equal(SKINS[0].need, 0, "the first alien must be free");
  const ids = new Set();
  for (let i = 0; i < SKINS.length; i++) {
    const s = SKINS[i];
    assert.ok(!ids.has(s.id), `duplicate skin id ${s.id}`);
    ids.add(s.id);
    assert.ok(s.eyes >= 1 && s.legs >= 1, `${s.id} is undrawable`);
    for (const k of ["body", "dark", "belly", "eye"]) assert.ok(isHex(s[k]), `${s.id}.${k}`);
    if (i > 0) assert.ok(s.need > SKINS[i - 1].need, `${s.id} unlocks before the one before it`);
  }
});

test("activeSkin refuses a skin that hasn't been earned", () => {
  const locked = SKINS[SKINS.length - 1];
  assert.equal(activeSkin({ skin: locked.id, eaten: 0 }).id, SKINS[0].id);
  assert.equal(activeSkin({ skin: locked.id, eaten: locked.need }).id, locked.id);
  assert.equal(activeSkin({ skin: "nonsense", eaten: 99999 }).id, SKINS[0].id, "unknown ids fall back");
  assert.equal(activeSkin({}).id, SKINS[0].id, "a blank profile still has something to wear");
  assert.ok(skinUnlocked(SKINS[0], 0));
});

test("nextSkin points at the next thing to chase, then stops", () => {
  assert.equal(nextSkin(0).id, SKINS[1].id);
  assert.equal(nextSkin(SKINS[SKINS.length - 1].need), null, "nothing left to unlock");
});
