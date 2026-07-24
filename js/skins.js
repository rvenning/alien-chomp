// Alien skins — unlocked by LIFETIME humans eaten, so they keep paying off
// across runs instead of only inside one. Purely cosmetic: every skin has the
// same hitbox and handling, only the procedural drawing in render.js changes.
//
// `need` is checked against progress.eaten, which merges with max() across
// devices — an unlock can never be lost by syncing.

const SKINS = [
  { id: "blob",     name: "Blob",         need: 0,    eyes: 1, legs: 2, antennae: 1,
    body: "#7ee081", dark: "#4fae5c", belly: "#c8f7c0", eye: "#1b3a22" },
  { id: "squid",    name: "Squidling",    need: 60,   eyes: 2, legs: 4, antennae: 0,
    body: "#8b7bff", dark: "#5a4bd6", belly: "#d3ccff", eye: "#1a1440" },
  { id: "cyclops",  name: "Big Eye",      need: 180,  eyes: 1, legs: 2, antennae: 2,
    body: "#ff9f43", dark: "#d1701a", belly: "#ffd9a8", eye: "#3a1c00" },
  { id: "slime",    name: "Goo",          need: 400,  eyes: 3, legs: 3, antennae: 1,
    body: "#4fd8e8", dark: "#2196a8", belly: "#c3f4fa", eye: "#06303a" },
  { id: "overlord", name: "Overlord",     need: 800,  eyes: 2, legs: 4, antennae: 2,
    body: "#ff5ad1", dark: "#c22a97", belly: "#ffc8ef", eye: "#3d0030" },
  { id: "void",     name: "Void Muncher",  need: 1600, eyes: 3, legs: 4, antennae: 2,
    body: "#2b2350", dark: "#151030", belly: "#6a5ac9", eye: "#8ef0ff" },
];

const SKIN_BY_ID = Object.fromEntries(SKINS.map((s) => [s.id, s]));

function skinUnlocked(skin, eaten) { return (eaten || 0) >= skin.need; }

// The skin a profile is actually wearing — falls back to Blob if the saved id
// is unknown (an old save, or a skin removed from the table) or not yet earned.
function activeSkin(prog) {
  const s = SKIN_BY_ID[prog && prog.skin] || SKINS[0];
  return skinUnlocked(s, prog && prog.eaten) ? s : SKINS[0];
}

// The next locked skin, for the "12 more snacks!" nudge on the results screen.
function nextSkin(eaten) {
  return SKINS.find((s) => !skinUnlocked(s, eaten)) || null;
}
