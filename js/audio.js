// Sound — gamekit's synth core plus Alien Chomp's own jingles, and a small
// lookahead music scheduler.
//
// The music deliberately does NOT use one setInterval per note: timer drift
// makes that swing, and browsers throttle background tabs to ~1Hz which turns a
// tune into a machine gun on return. Instead a ~110ms pump schedules every note
// up to LOOKAHEAD seconds ahead on the WebAudio clock, which is sample-accurate.

const Sfx = GK.Sfx;

Object.assign(Sfx, {
  // A bite: wet snap + a rising gulp. Pitch climbs with the combo so a long
  // chain audibly builds — the single most satisfying sound in the game.
  chomp(combo = 1) {
    const step = Math.min(combo, RULES.COMBO_MAX) - 1;
    this.noise({ dur: 0.05, vol: 0.16 });
    this.tone({ freq: 190 + step * 26, type: "square", dur: 0.07, vol: 0.16, slide: 110 });
    this.tone({ freq: 380 + step * 44, type: "triangle", dur: 0.11, vol: 0.1, when: 0.05, slide: 130 });
  },
  bigChomp() {
    this.noise({ dur: 0.1, vol: 0.24 });
    this.tone({ freq: 140, type: "sawtooth", dur: 0.2, vol: 0.2, slide: 180 });
    this.tone({ freq: 520, type: "square", dur: 0.14, vol: 0.12, when: 0.08, slide: 220 });
  },
  // Biting metal: nothing about this should sound rewarding.
  clang() {
    this.noise({ dur: 0.22, vol: 0.3 });
    this.tone({ freq: 220, type: "square", dur: 0.16, vol: 0.2, slide: -110 });
    this.tone({ freq: 90, type: "sawtooth", dur: 0.3, vol: 0.22, slide: -40 });
  },
  jump() { this.tone({ freq: 420, type: "triangle", dur: 0.1, vol: 0.14, slide: 260 }); },
  flap() { this.tone({ freq: 560, type: "sine", dur: 0.12, vol: 0.12, slide: 200 });
           this.noise({ dur: 0.06, vol: 0.05 }); },
  slam() { this.tone({ freq: 600, type: "sawtooth", dur: 0.14, vol: 0.14, slide: -420 }); },
  boom() {
    this.noise({ dur: 0.3, vol: 0.3 });
    this.tone({ freq: 120, type: "sawtooth", dur: 0.28, vol: 0.24, slide: -70 });
  },
  slurp() { this.tone({ freq: 300, type: "sine", dur: 0.22, vol: 0.14, slide: 420 }); },
  power(color = 0) {
    [523, 659, 880, 1175].forEach((f, i) =>
      this.tone({ freq: f + color * 20, type: "square", dur: 0.12, vol: 0.13, when: i * 0.055 }));
  },
  shieldPop() {
    this.tone({ freq: 900, type: "sine", dur: 0.18, vol: 0.16, slide: -520 });
    this.noise({ dur: 0.12, vol: 0.12 });
  },
  zoneUp() {
    [392, 523, 659, 784, 1047].forEach((f, i) =>
      this.tone({ freq: f, type: "triangle", dur: 0.22, vol: 0.16, when: i * 0.1 }));
  },
  starve() {
    [330, 294, 247, 196, 147].forEach((f, i) =>
      this.tone({ freq: f, type: "sawtooth", dur: 0.34, vol: 0.2, when: i * 0.15 }));
    this.noise({ dur: 0.6, vol: 0.1, when: 0.3 });
  },
  newBest() {
    [659, 784, 988, 1319, 1568].forEach((f, i) =>
      this.tone({ freq: f, type: "square", dur: 0.2, vol: 0.16, when: i * 0.11 }));
  },
});

/* ------------------------------------------------------------------ music */
// Tracks are semitone offsets from the root; null = rest. One step is an
// eighth note. Bass loops every 16 steps, lead every 32, so the two drift into
// different combinations without needing a longer score.
const TRACKS = {
  chase: {
    root: 55,                      // G1 — bassline pitch class
    bpm: 132,
    bass: [0, null, 0, 7, 0, null, 5, null, 3, null, 3, 10, 3, null, 7, null],
    lead: [12, 15, 19, 15, 12, null, 10, null, 12, 15, 19, 22, 19, 15, 12, null,
           10, 13, 17, 13, 10, null, 8, null, 7, 10, 15, 10, 12, null, null, null],
  },
  frenzy: {
    root: 58,
    bpm: 168,
    bass: [0, 0, 7, 0, 5, 5, 12, 5, 3, 3, 10, 3, 7, 7, 14, 7],
    lead: [24, 22, 19, 22, 24, 26, 27, 26, 24, 22, 19, 15, 12, 15, 19, 22,
           24, 27, 24, 22, 19, 22, 24, 27, 31, 27, 24, 22, 19, 15, 12, null],
  },
};

const midiHz = (n) => 440 * Math.pow(2, (n - 69) / 12);

const Music = {
  enabled: true,
  track: null,
  step: 0,
  nextT: 0,       // next note time, in AudioContext seconds
  timer: null,
  LOOKAHEAD: 0.6,

  start(name) {
    const t = TRACKS[name];
    if (!t || !Sfx.ctx) return;
    if (this.track === t && this.timer) return;   // already playing this one
    this.track = t;
    this.step = 0;
    this.nextT = Sfx.ctx.currentTime + 0.12;
    if (!this.timer) this.timer = setInterval(() => this.pump(), 110);
  },

  stop() {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    this.track = null;
  },

  // Swap tracks without restarting the scheduler, so Mega Chomp can kick the
  // tempo up mid-run and drop back cleanly.
  switchTo(name) {
    const t = TRACKS[name];
    if (!t || t === this.track) return;
    this.track = t;
    this.step = 0;
  },

  toggle() {
    this.enabled = !this.enabled;
    if (!this.enabled) this.stop();
    return this.enabled;
  },

  pump() {
    const t = this.track;
    if (!t || !this.enabled || !Sfx.enabled || !Sfx.ctx) return;
    const now = Sfx.ctx.currentTime;
    const spb = 60 / t.bpm / 2;                   // seconds per eighth note
    // After a hitch (tab hidden, GC pause) skip the missed steps silently
    // rather than firing them all at once.
    if (this.nextT < now - 0.25) { this.nextT = now + 0.05; }
    while (this.nextT < now + this.LOOKAHEAD) {
      const when = this.nextT - now;
      const b = t.bass[this.step % t.bass.length];
      if (b !== null && b !== undefined)
        Sfx.tone({ freq: midiHz(t.root + b), type: "triangle", dur: spb * 0.9, vol: 0.075, when });
      const l = t.lead[this.step % t.lead.length];
      if (l !== null && l !== undefined)
        Sfx.tone({ freq: midiHz(t.root + l), type: "square", dur: spb * 0.55, vol: 0.045, when });
      if (this.step % 4 === 0) Sfx.noise({ dur: 0.03, vol: 0.035, when });   // hat
      this.step++;
      this.nextT += spb;
    }
  },

  // Pausing must push the clock forward, not stop it — otherwise the pump
  // wakes up thousands of steps behind and has to catch up.
  hold(seconds) { this.nextT += seconds; },
};
