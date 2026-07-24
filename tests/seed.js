// Test-only: make the sandboxed game deterministic.
//
// The engine leans on Math.random for every spawn, so an unseeded run makes the
// balance bot's numbers wobble between CI runs and turns a real regression into
// "probably just variance". This replaces Math.random inside the vm sandbox
// (each vm context gets its own intrinsics, so the host's Math is untouched).
//
// Loaded first by the suites that need reproducible spawns; never shipped.

let __rngState = 1;

function __reseed(n) {
  __rngState = (n >>> 0) || 1;
}

Math.random = function () {
  // Numerical Recipes LCG — short period, but plenty for spawn selection.
  __rngState = (Math.imul(__rngState, 1664525) + 1013904223) >>> 0;
  return __rngState / 4294967296;
};
