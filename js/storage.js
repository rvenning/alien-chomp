// Persistence — gamekit storage configured for Alien Chomp.
// ac_* localStorage keys, "alienchomp" Firestore collection.
//
// Every stat here is monotonic (personal bests, lifetime totals, furthest zone),
// so a field-wise max() merge is always safe across devices. The one exception
// is `skin`, which is a *preference*, not a record — max() is meaningless for
// it, so the more recently written side wins.

const Storage = GK.createStorage({
  prefix: "ac",
  collection: "alienchomp",
  firebaseConfig: window.FIREBASE_CONFIG,
  blankProgress: () => ({
    best: 0,          // best single-run score (leaderboard headline)
    bestDist: 0,      // furthest metres in one run
    eaten: 0,         // LIFETIME humans eaten — drives skin unlocks
    robots: 0,        // lifetime robots smashed (slam / mega chomp)
    runs: 0,
    bestCombo: 0,
    zone: 0,          // furthest zone index reached
    skin: "blob",
    updated: 0,
  }),
  mergeProgress: (a, b) => ({
    // Spread first so a field a newer client added survives an older client's
    // merge, then pin the fields we know how to reconcile.
    ...a, ...b,
    best: Math.max(a.best || 0, b.best || 0),
    bestDist: Math.max(a.bestDist || 0, b.bestDist || 0),
    eaten: Math.max(a.eaten || 0, b.eaten || 0),
    robots: Math.max(a.robots || 0, b.robots || 0),
    runs: Math.max(a.runs || 0, b.runs || 0),
    bestCombo: Math.max(a.bestCombo || 0, b.bestCombo || 0),
    zone: Math.max(a.zone || 0, b.zone || 0),
    skin: ((b.updated || 0) >= (a.updated || 0) ? b.skin : a.skin) || "blob",
  }),
});

Object.assign(Storage, {
  // Fold one finished run into the profile's records. Lifetime counters add up;
  // bests only move up. Returns the saved progress so callers can render it.
  recordRun(profileId, res) {
    const prog = this.getProgress(profileId);
    prog.runs = (prog.runs || 0) + 1;
    prog.eaten = (prog.eaten || 0) + (res.eaten || 0);
    prog.robots = (prog.robots || 0) + (res.robots || 0);
    prog.best = Math.max(prog.best || 0, res.score || 0);
    prog.bestDist = Math.max(prog.bestDist || 0, res.metres || 0);
    prog.bestCombo = Math.max(prog.bestCombo || 0, res.bestCombo || 0);
    prog.zone = Math.max(prog.zone || 0, res.zone || 0);
    this.saveProgress(profileId, prog);
    return prog;
  },

  // Cosmetic choice — refuses a skin the player hasn't earned so a stale sync
  // or a hand-edited save can't dress them in something they haven't unlocked.
  setSkin(profileId, skinId) {
    const prog = this.getProgress(profileId);
    const skin = SKIN_BY_ID[skinId];
    if (!skin || !skinUnlocked(skin, prog.eaten)) return prog;
    prog.skin = skinId;
    this.saveProgress(profileId, prog);
    return prog;
  },

  unlockedSkins(prog) { return SKINS.filter((s) => skinUnlocked(s, prog && prog.eaten)); },
});
