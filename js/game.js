// The Alien Chomp engine — an endless side-scrolling chomp runner.
//
// The alien runs right forever at a speed that climbs with distance. Hunger
// drains the whole time, so eating humans isn't a bonus, it's the life support.
// Robots are made of metal: biting one costs a big chunk of hunger.
//
// Everything the player meets comes from the registries in entities.js and
// zones.js — the engine reads properties and never branches on a type name.
// Drawing lives in render.js; this file owns simulation only, so the headless
// balance bot in tests/ can run the whole game with no canvas at all.

/* --------------------------------------------------------------- geometry */
// One fixed logical stage for every device, so a phone and a laptop see exactly
// the same amount of track ahead and the family leaderboard stays fair. The
// renderer extends sky above and ground below to fill whatever shape the real
// screen is, so there are never letterbox bars.
const LW = 400;            // logical stage width
const LH = 225;            // logical stage height
const GROUND_Y = 172;      // top surface of the street
const PLAYER_X = 96;       // the alien's fixed x on screen
const PX_PER_M = 20;       // world px per "metre" shown on the HUD

/* ------------------------------------------------------------ alien feel */
const P = {
  W: 20, H: 28, SLIDE_H: 15,
  GRAV: 1250, JUMP: -400, JUMP2: -352, CUT: -130, MAX_FALL: 640,
  SLAM_V: 880, COYOTE: 0.1, BUFFER: 0.13,
  SLIDE_TIME: 0.45,
  SPD_BASE: 125, SPD_GAIN: 85, SPD_RAMP: 30,   // +1 px/s per 30 m, capped at +85
  STAGGER: 0.5, STAGGER_MUL: 0.55,
};

const Game = {
  canvas: null, ctx: null, DPR: 1, scale: 1, viewLW: LW, viewLH: LH, offX: 0, offY: 0,
  active: false, running: false, paused: false, dead: false,
  input: { jumpPressed: false, jumpHeld: false, down: false, downPressed: false },
  _last: 0,

  /* ============================ boot / canvas ============================ */
  boot() {
    this.canvas = document.getElementById("cv");
    this.ctx = this.canvas.getContext("2d");
    this.resize();
    const re = () => this.resize();
    window.addEventListener("resize", re);
    // iOS settles its viewport lazily (toolbars, rotation, standalone launch),
    // so measure again well after the event as well as on it.
    window.addEventListener("orientationchange", () => setTimeout(re, 350));
    if (window.visualViewport) window.visualViewport.addEventListener("resize", re);
    document.addEventListener("visibilitychange", () => { if (document.hidden && this.running) this.pause(); });
    this.bindInput();
    this._last = performance.now();
    requestAnimationFrame((t) => this.loop(t));
  },

  resize() {
    const wrap = this.canvas.parentElement;
    const w = wrap.clientWidth, h = wrap.clientHeight;
    // The game screen is display:none until it's shown, which measures 0x0 —
    // retry rather than caching a broken layout.
    if (!w || !h) { setTimeout(() => this.resize(), 200); return; }
    this.DPR = Math.min(window.devicePixelRatio || 1, 2);
    // A canvas is a replaced element: the width/height ATTRIBUTES are the
    // backing store, and without an explicit CSS size it would render at that
    // size and overflow every retina screen. css/style.css pins it to 100%/100%.
    this.canvas.style.width = w + "px";
    this.canvas.style.height = h + "px";
    this.canvas.width = Math.round(w * this.DPR);
    this.canvas.height = Math.round(h * this.DPR);
    this.scale = Math.min(w / LW, h / LH);
    this.viewLW = w / this.scale;         // full canvas in logical px
    this.viewLH = h / this.scale;
    this.offX = (this.viewLW - LW) / 2;   // where the 400x225 stage sits inside it
    this.offY = (this.viewLH - LH) / 2;
  },

  /* ================================ input ================================ */
  // Tap the left half of the stage to jump, the right half to slam/slide.
  // Halves beat gesture detection here: a runner needs the jump on pointerdown,
  // and waiting to see whether a tap becomes a swipe costs ~150ms of latency.
  bindInput() {
    const I = this.input;
    const press = (what) => {
      GK.Sfx.init();
      if (what === "jump") { if (!I.jumpHeld) I.jumpPressed = true; I.jumpHeld = true; }
      else { if (!I.down) I.downPressed = true; I.down = true; }
    };
    const release = (what) => { if (what === "jump") I.jumpHeld = false; else I.down = false; };

    window.addEventListener("keydown", (e) => {
      if (!this.active) return;
      if (e.code === "Escape" || e.code === "KeyP") { e.preventDefault(); this.togglePause(); return; }
      if (["Space", "ArrowUp", "KeyW", "KeyZ"].includes(e.code)) { e.preventDefault(); press("jump"); }
      if (["ArrowDown", "KeyS", "KeyX"].includes(e.code)) { e.preventDefault(); press("down"); }
    });
    window.addEventListener("keyup", (e) => {
      if (["Space", "ArrowUp", "KeyW", "KeyZ"].includes(e.code)) release("jump");
      if (["ArrowDown", "KeyS", "KeyX"].includes(e.code)) release("down");
    });

    const stage = document.querySelector(".game-stage");
    const side = (e) => {
      const r = stage.getBoundingClientRect();
      return (e.clientX - r.left) < r.width / 2 ? "jump" : "down";
    };
    // Track which side each finger owns so a two-thumb player can hold jump on
    // the left while tapping slam on the right.
    const fingers = new Map();
    stage.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      const s = side(e);
      fingers.set(e.pointerId, s);
      press(s);
    });
    const end = (e) => {
      const s = fingers.get(e.pointerId);
      if (s) { release(s); fingers.delete(e.pointerId); }
    };
    stage.addEventListener("pointerup", end);
    stage.addEventListener("pointercancel", end);
    stage.addEventListener("pointerleave", end);
    stage.addEventListener("contextmenu", (e) => e.preventDefault());
    // iOS ignores user-scalable=no for pinch; block the gesture at the source.
    document.addEventListener("gesturestart", (e) => e.preventDefault());
    document.addEventListener("gesturechange", (e) => e.preventDefault());
  },

  /* ============================== lifecycle ============================== */
  start(profile) {
    this.profile = profile;
    this.progress = Storage.getProgress(profile.id);
    this.skin = activeSkin(this.progress);
    this.reset();
    this.running = true; this.paused = false; this.dead = false;
    GK.UI.showScreen("game");
    this.resize();               // the stage only has a size once it's visible
    if (this.updateHud) this.updateHud();
    if (Music.enabled) Music.start("chase");
  },

  // Full simulation reset. Kept separate from start() so the headless bot can
  // drive a run without a profile, a canvas or the DOM.
  reset() {
    this.p = {
      x: 0, y: GROUND_Y - P.H / 2, vy: 0,
      grounded: true, plat: null, coyote: P.COYOTE, buffer: 0, jumps: 0,
      slide: 0, slamming: false, iframes: 0, stagger: 0,
      runPhase: 0, chompT: 0, hurtT: 0, sx: 1, sy: 1,
    };
    this.ents = [];
    this.plats = [];
    this.hunger = RULES.HUNGER_MAX;
    this.score = 0;
    this.combo = 1;
    this.comboT = 0;
    this.bestCombo = 1;
    this.eaten = 0;
    this.robots = 0;
    this.bites = 0;      // times metal was actually swallowed
    this.elapsed = 0;
    this.metres = 0;
    this.zoneIdx = 0;
    this.zone = ZONES[0];
    this.nextBeatX = LW * 0.9;   // a beat of empty road before the first snack
    this.shield = false;
    this.magnetT = 0;
    this.frenzyT = 0;
    this.hintT = 6;
    this.result = null;
    this.q = [];
    if (typeof Fx !== "undefined") { Fx.reset(); Tween.clear(); }
  },

  // Presentation-only event queue. render.js drains it each frame and turns
  // each entry into a ghost of the thing that was there; NOTHING in this file
  // or in tests/ ever reads it back, so a new event type can never change the
  // simulation. Capped here rather than at the drain, so a headless run with
  // no renderer attached cannot grow it without bound.
  fx(type, x, y, extra) {
    if (!this.q) this.q = [];
    if (this.q.length > 48) this.q.shift();
    this.q.push(Object.assign({ type, x, y }, extra));
  },

  pause() {
    if (!this.running || this.paused) return;
    this.paused = true;
    Music.stop();
    GK.UI.openModal("modal-pause");
  },
  resume() {
    GK.UI.closeModal("modal-pause");
    this.paused = false;
    this._last = performance.now();   // don't bill the pause to the next frame
    if (Music.enabled) Music.start(this.frenzyT > 0 ? "frenzy" : "chase");
    Sfx.click();
  },
  togglePause() { this.paused ? this.resume() : this.pause(); },

  quit() {
    GK.UI.closeModal("modal-pause");
    this.running = false;
    Music.stop();
    App.runOver(this.buildResult(), true);
  },

  /* ================================ loop ================================= */
  loop(t) {
    requestAnimationFrame((tt) => this.loop(tt));
    const real = Math.min(0.05, (t - this._last) / 1000 || 0);
    this._last = t;
    if (!this.active) return;
    if (this.running && !this.paused) this.update(real);
    if (typeof Fx !== "undefined") Fx.update(real);
    // Presentation only, and guarded: render.js owns all three, and the
    // headless bot never loads it.
    if (this.juice) this.juice(real);
    if (this.drainEvents) this.drainEvents();
    this.render();
  },

  /* =============================== update ================================ */
  update(dt) {
    // The loop already gates on this, but the guard makes the engine safe to
    // step from a bot or a console — without it, driving update() past a death
    // keeps simulating a dead run and quietly refills the hunger bar.
    if (!this.running || this.paused) return;
    const p = this.p;
    this.elapsed += dt;

    /* ---- run speed: ramps with distance, then by zone ---- */
    const ramp = Math.min(P.SPD_GAIN, this.metres / P.SPD_RAMP);
    this.speed = (P.SPD_BASE + ramp) * this.zone.speedMul;
    p.stagger = Math.max(0, p.stagger - dt);
    const moveSpeed = this.speed * (p.stagger > 0 ? P.STAGGER_MUL : 1);
    p.x += moveSpeed * dt;
    this.camX = p.x - PLAYER_X;
    this.metres = Math.floor(p.x / PX_PER_M);

    /* ---- zone advance ---- */
    const zi = zoneIndexAt(this.metres);
    if (zi !== this.zoneIdx) {
      this.zoneIdx = zi;
      this.zone = ZONES[zi];
      Sfx.zoneUp();
      if (typeof Fx !== "undefined") { Fx.flash = 0.5; Fx.flashColor = this.zone.accent; }
      GK.UI.toast(`${this.zone.icon} ${this.zone.name} — ${this.zone.blurb}`);
    }

    this.updatePlayer(dt);
    this.spawnAhead();
    this.updateEntities(dt);
    this.collide();

    /* ---- timers ---- */
    if (this.magnetT > 0) this.magnetT = Math.max(0, this.magnetT - dt);
    if (this.frenzyT > 0) {
      this.frenzyT = Math.max(0, this.frenzyT - dt);
      if (this.frenzyT === 0 && Music.enabled) Music.switchTo("chase");
    }
    this.comboT = Math.max(0, this.comboT - dt);
    if (this.comboT === 0 && this.combo > 1) this.combo = 1;
    this.hintT = Math.max(0, this.hintT - dt);

    /* ---- hunger: the clock you're always racing ---- */
    // Past the last zone there is nothing left to unlock, so the drain itself
    // keeps escalating — that's what eventually ends an endless run.
    const overrun = Math.max(0, this.metres - ZONES[ZONES.length - 1].from);
    const drain = this.zone.drain + overrun / 1400 * 0.6;
    this.hunger -= drain * dt;
    this.score += RULES.METRE_SCORE * (moveSpeed * dt) / PX_PER_M;

    if (this.hunger <= 0) { this.hunger = 0; this.die(); return; }
    if (this.hunger > RULES.HUNGER_MAX) this.hunger = RULES.HUNGER_MAX;

    this.cull();
    // The HUD lives in render.js now, which the headless bot never loads.
    if (this.updateHud) this.updateHud();
  },

  /* ------------------------------ the alien ------------------------------ */
  hh(p) { return (p.slide > 0 ? P.SLIDE_H : P.H) / 2; },

  updatePlayer(dt) {
    const p = this.p, I = this.input;
    p.iframes = Math.max(0, p.iframes - dt);
    p.chompT = Math.max(0, p.chompT - dt);
    p.hurtT = Math.max(0, p.hurtT - dt);
    p.runPhase += dt * (6 + this.speed / 40);

    if (I.jumpPressed) { p.buffer = P.BUFFER; I.jumpPressed = false; }
    else p.buffer = Math.max(0, p.buffer - dt);

    /* ---- slide / dive-slam ---- */
    if (I.downPressed) {
      I.downPressed = false;
      if (p.grounded) this.startSlide();
      else if (!p.slamming) {
        p.slamming = true; p.vy = P.SLAM_V;
        Sfx.slam();
      }
    }
    if (p.slide > 0) {
      p.slide -= dt;
      // Holding down keeps the slide alive; letting go ends it early.
      if (!I.down && p.slide > 0.12) p.slide = 0.12;
      if (p.slide <= 0) this.endSlide();
    }

    /* ---- jump (double, with coyote time and buffering) ---- */
    p.coyote = p.grounded ? P.COYOTE : Math.max(0, p.coyote - dt);
    if (p.buffer > 0) {
      if (p.grounded || p.coyote > 0) {
        p.buffer = 0; p.coyote = 0; p.grounded = false; p.plat = null;
        p.jumps = 1; p.vy = P.JUMP; p.slamming = false;
        if (p.slide > 0) this.endSlide();
        p.sx = 0.76; p.sy = 1.28;
        Sfx.jump();
        if (typeof Fx !== "undefined") Fx.dust(p.x - this.camX, GROUND_YOf(p), 5);
      } else if (p.jumps < 2) {
        p.buffer = 0; p.jumps = 2; p.vy = P.JUMP2; p.slamming = false;
        p.sx = 0.8; p.sy = 1.24;
        Sfx.flap();
        if (typeof Fx !== "undefined") Fx.burst(p.x - this.camX, p.y, "#b6f2b8", 8, 90, 0.35, 2);
      }
    }
    if (!I.jumpHeld && p.vy < P.CUT) p.vy = P.CUT;   // variable jump height

    /* ---- gravity + one-way landings ---- */
    if (!p.grounded) {
      p.vy = Math.min(p.vy + P.GRAV * dt, P.MAX_FALL);
      const hh = this.hh(p);
      const feetPrev = p.y + hh;
      p.y += p.vy * dt;
      const feet = p.y + hh;
      if (p.vy >= 0) {
        let landY = null, landPlat = null;
        if (feet >= GROUND_Y) landY = GROUND_Y;
        for (const pl of this.plats) {
          if (p.x + P.W / 2 < pl.x || p.x - P.W / 2 > pl.x + pl.w) continue;
          if (feetPrev <= pl.y + 1 && feet >= pl.y && (landY === null || pl.y < landY)) {
            landY = pl.y; landPlat = pl;
          }
        }
        if (landY !== null) this.land(landY, landPlat);
      }
    } else {
      // Run off the end of a rooftop and you start falling (with coyote grace).
      const pl = p.plat;
      if (pl && (p.x + P.W / 2 < pl.x || p.x - P.W / 2 > pl.x + pl.w)) {
        p.grounded = false; p.plat = null;
      }
    }

    // squash & stretch recovery
    p.sx += (1 - p.sx) * Math.min(1, dt * 12);
    p.sy += (1 - p.sy) * Math.min(1, dt * 12);
  },

  land(y, plat) {
    const p = this.p;
    const hard = p.slamming || p.vy > 420;
    p.y = y - this.hh(p);
    p.vy = 0; p.grounded = true; p.plat = plat; p.jumps = 0;
    if (p.slamming) { p.slamming = false; this.shockwave(y); }
    if (hard) { p.sx = 1.3; p.sy = 0.74; }
    if (typeof Fx !== "undefined") Fx.dust(p.x - this.camX, y, hard ? 9 : 4);
  },

  startSlide() {
    const p = this.p;
    if (p.slide > 0) return;
    p.slide = P.SLIDE_TIME;
    p.y += (P.H - P.SLIDE_H) / 2;    // keep the feet planted while shrinking
    Sfx.slam();
    if (typeof Fx !== "undefined") Fx.dust(p.x - this.camX, p.y + P.SLIDE_H / 2, 6);
  },
  endSlide() {
    const p = this.p;
    if (p.slide === 0) return;
    p.slide = 0;
    p.y -= (P.H - P.SLIDE_H) / 2;
  },

  // A dive-slam landing smashes every slammable robot nearby. It's the only way
  // to get rid of a patrol bot without biting it, and the main skill move.
  shockwave(y) {
    Sfx.boom();
    if (typeof Fx !== "undefined") {
      Fx.addShake(6);
      Fx.burst(this.p.x - this.camX, y, "#ffd93b", 20, 200, 0.45, 3);
    }
    for (const e of this.ents) {
      if (e.dead || e.kind !== "robot") continue;
      const spec = ROBOTS[e.type];
      if (!spec.slammable) continue;
      if (Math.abs(e.x - this.p.x) > RULES.SLAM_RADIUS) continue;
      if (Math.abs((e.y + e.h / 2) - y) > 30) continue;
      e.dead = true;
      this.robots++;
      this.score += spec.slamScore || 10;
      this.fx("smash", e.x, e.y, { kind: "robot", etype: e.type, et: e.t });
      if (typeof Fx !== "undefined") {
        Fx.burst(e.x - this.camX, e.y, spec.body, 14, 150, 0.5, 2.6);
        Fx.text(e.x - this.camX, e.y - 10, `+${spec.slamScore}`, { color: "#ffd93b" });
      }
    }
  },

  /* ------------------------------ spawning ------------------------------- */
  // Beats are spaced in TIME, not distance: the gap is a number of seconds
  // multiplied by the current speed. Without that, the pacing would collapse as
  // the run gets faster and the last zone would be unplayable.
  spawnAhead() {
    const edge = this.camX + LW + 80;
    let guard = 0;
    while (this.nextBeatX < edge && guard++ < 40) {
      const pat = this.pickPattern();
      const width = this.emit(pat, this.nextBeatX);
      const gap = GK.util.rand(0.52, 0.88) * this.zone.density * this.speed;
      this.nextBeatX += width + gap;
    }
  },

  pickPattern() {
    const w = this.zone.weights;
    let total = 0;
    for (const k in w) total += w[k];
    let r = Math.random() * total;
    for (const k in w) { r -= w[k]; if (r <= 0) return k; }
    return "rest";
  },

  addEnt(kind, type, x, y, extra) {
    const spec = kind === "human" ? HUMANS[type]
               : kind === "robot" ? ROBOTS[type]
               : kind === "brain" ? BRAIN : POWERUPS[type];
    const e = {
      kind, type, x, y, dead: false, t: Math.random() * 6,
      w: spec.w || 14, h: spec.h || 14,
      vx: spec.vx || 0, y0: y,
      ...extra,
    };
    this.ents.push(e);
    return e;
  },

  // Each emitter returns the pattern's own width in px so the gap that follows
  // is measured from the END of the pattern, not its start.
  emit(pat, x) {
    const z = this.zone;
    switch (pat) {
      case "rest":
        return 0;

      case "crowd": {
        const n = GK.util.irand(2, 4);
        for (let i = 0; i < n; i++) {
          const t = Math.random() < 0.22 ? "chonk" : Math.random() < 0.45 ? "runner" : "walker";
          const s = HUMANS[t];
          this.addEnt("human", t, x + i * 27, GROUND_Y - s.h / 2);
        }
        return (n - 1) * 27;
      }

      case "patrol": {
        const s = ROBOTS.bot;
        this.addEnt("robot", "bot", x, GROUND_Y - s.h / 2);
        // A snack just past the bot: the reward for slamming instead of dodging.
        const hs = HUMANS.walker;
        this.addEnt("human", "walker", x + 42, GROUND_Y - hs.h / 2);
        return 42;
      }

      case "drone": {
        const n = GK.util.irand(1, 2);
        for (let i = 0; i < n; i++) {
          // 146 = slide under it or jump it; 120 = only a jump gets punished.
          const y = Math.random() < 0.55 ? 146 : 120;
          this.addEnt("robot", "drone", x + i * 58, y);
        }
        return (n - 1) * 58;
      }

      case "rooftop": {
        const w = GK.util.irand(74, 112);
        // Kept inside a SINGLE jump's reach (64px) so a player who hasn't
        // mastered the double jump can still get up there. tests/data.test.js
        // pins this against the jump maths.
        const y = GK.util.irand(110, 126);
        this.plats.push({ x, y, w, zone: z.id });
        const n = GK.util.irand(2, 3);
        for (let i = 0; i < n; i++) {
          const s = HUMANS.kid;
          this.addEnt("human", "kid", x + 16 + i * 26, y - s.h / 2);
        }
        // Something on the street too, so skipping the roof isn't free food.
        const gs = HUMANS.walker;
        this.addEnt("human", "walker", x + w * 0.5, GROUND_Y - gs.h / 2);
        return w;
      }

      case "gauntlet": {
        const bs = ROBOTS.bot, hs = HUMANS.runner;
        this.addEnt("robot", "bot", x, GROUND_Y - bs.h / 2);
        this.addEnt("human", "runner", x + 46, GROUND_Y - hs.h / 2);
        this.addEnt("robot", "bot", x + 92, GROUND_Y - bs.h / 2);
        // A high drone would close the jump line over the second bot, so it is
        // deliberately offset past it — there is always a way through.
        if (Math.random() < 0.4) this.addEnt("robot", "drone", x + 150, 120);
        return Math.random() < 0.4 ? 150 : 92;
      }

      case "mech": {
        const ms = ROBOTS.mech;
        this.addEnt("robot", "mech", x, GROUND_Y - ms.h / 2);
        for (let i = 0; i < 2; i++) {
          const s = HUMANS.walker;
          this.addEnt("human", "walker", x + 60 + i * 26, GROUND_Y - s.h / 2);
        }
        return 86;
      }

      case "pickup": {
        const t = GK.util.pick(POWERUP_IDS);
        this.addEnt("orb", t, x, Math.random() < 0.5 ? 140 : 116, { w: 18, h: 18 });
        return 0;
      }

      case "brains": {
        // An arc of brains along a jump path — following it is the tutorial for
        // how far a double jump actually goes.
        const n = 5;
        for (let i = 0; i < n; i++) {
          const k = (i + 0.5) / n;
          this.addEnt("brain", "brain", x + i * 24,
            GROUND_Y - 22 - 38 * Math.sin(Math.PI * k));
        }
        return (n - 1) * 24;
      }

      default:
        return 0;
    }
  },

  /* ----------------------------- entity update --------------------------- */
  updateEntities(dt) {
    const p = this.p;
    for (const e of this.ents) {
      if (e.dead) continue;
      e.t += dt;
      if (e.kind === "human") {
        const spec = HUMANS[e.type];
        let vx = e.vx;
        // Joggers bolt once the alien is close enough to notice.
        if (spec.flee && p.x > e.x - spec.fleeRange) { vx = spec.flee; e.fleeing = true; }
        e.x += vx * dt;
        if (this.magnetT > 0) {
          const dx = p.x - e.x, dy = p.y - e.y;
          const d = Math.hypot(dx, dy);
          if (d < RULES.MAGNET_RANGE && d > 1) {
            const pull = 210 * (1 - d / RULES.MAGNET_RANGE) * dt;
            e.x += dx / d * pull; e.y += dy / d * pull;
            e.pulled = true;
          }
        }
      } else if (e.kind === "robot") {
        const spec = ROBOTS[e.type];
        e.x += (spec.vx || 0) * dt;
        if (spec.fly) e.y = e.y0 + Math.sin(e.t * 2.6) * spec.bob;
      } else if (e.kind === "orb") {
        e.y = e.y0 + Math.sin(e.t * 3) * 5;
      } else if (e.kind === "brain") {
        e.y = e.y0 + Math.sin(e.t * 4) * 2;
      }
    }
  },

  /* ------------------------------ collisions ----------------------------- */
  hits(e) {
    const p = this.p, hh = this.hh(p);
    return Math.abs(p.x - e.x) < (P.W + e.w) / 2 &&
           Math.abs(p.y - e.y) < (hh * 2 + e.h) / 2;
  },

  collide() {
    for (const e of this.ents) {
      if (e.dead || !this.hits(e)) continue;
      if (e.kind === "human") this.eatHuman(e);
      else if (e.kind === "brain") this.eatBrain(e);
      else if (e.kind === "orb") this.takeOrb(e);
      else if (e.kind === "robot") this.hitRobot(e);
    }
  },

  eatHuman(e) {
    const spec = HUMANS[e.type];
    e.dead = true;
    this.eaten++;
    this.combo = Math.min(RULES.COMBO_MAX, this.combo + 1);
    this.bestCombo = Math.max(this.bestCombo, this.combo);
    this.comboT = RULES.COMBO_WINDOW;
    const gain = spec.score * this.combo;
    this.score += gain;
    this.hunger = Math.min(RULES.HUNGER_MAX, this.hunger + spec.food);
    this.p.chompT = 0.16;
    this.p.sx = 1.22; this.p.sy = 0.84;
    if (spec.food >= 20) Sfx.bigChomp(); else Sfx.chomp(this.combo);
    this.fx("eat", e.x, e.y, { kind: "human", etype: e.type, et: e.t, fleeing: !!e.fleeing });
    if (typeof Fx !== "undefined") {
      Fx.burst(e.x - this.camX, e.y, spec.shirt, 12, 140, 0.45, 2.4);
      Fx.burst(e.x - this.camX, e.y, "#ff6b81", 6, 90, 0.4, 2);
      Fx.text(e.x - this.camX, e.y - 8, `+${gain}${this.combo > 1 ? ` x${this.combo}` : ""}`,
        { color: this.combo >= 5 ? "#ffd93b" : "#ffffff" });
      if (this.combo >= 5) Fx.addShake(2);
    }
  },

  eatBrain(e) {
    e.dead = true;
    this.score += BRAIN.score;
    this.hunger = Math.min(RULES.HUNGER_MAX, this.hunger + BRAIN.food);
    Sfx.coin();
    this.fx("eat", e.x, e.y, { kind: "brain", et: e.t });
    if (typeof Fx !== "undefined") {
      Fx.sparkle(e.x - this.camX, e.y, "#ff9fd8");
      Fx.text(e.x - this.camX, e.y - 6, `+${BRAIN.score}`, { color: "#ff9fd8", size: 11 });
    }
  },

  takeOrb(e) {
    const spec = POWERUPS[e.type];
    e.dead = true;
    Sfx.power(POWERUP_IDS.indexOf(e.type));
    this.fx("eat", e.x, e.y, { kind: "orb", etype: e.type, et: e.t });
    if (e.type === "shield") this.shield = true;
    else if (e.type === "magnet") this.magnetT = spec.dur;
    else if (e.type === "snack") this.hunger = Math.min(RULES.HUNGER_MAX, this.hunger + RULES.SNACK_REFILL);
    else if (e.type === "frenzy") {
      this.frenzyT = spec.dur;
      if (Music.enabled) Music.switchTo("frenzy");
    }
    if (typeof Fx !== "undefined") {
      Fx.burst(e.x - this.camX, e.y, spec.color, 22, 190, 0.6, 3);
      Fx.flash = 0.35; Fx.flashColor = spec.color;
      Fx.text(e.x - this.camX, e.y - 12, spec.name, { color: spec.color, size: 13 });
    }
    GK.UI.toast(`${spec.icon} ${spec.name} — ${spec.blurb}`);
  },

  hitRobot(e) {
    const spec = ROBOTS[e.type];
    const p = this.p;

    // Mega Chomp turns the hazard into the meal — the one time metal is food.
    if (this.frenzyT > 0) {
      e.dead = true;
      this.robots++;
      this.score += RULES.FRENZY_ROBOT_SCORE * this.combo;
      this.hunger = Math.min(RULES.HUNGER_MAX, this.hunger + RULES.FRENZY_ROBOT_FOOD);
      this.combo = Math.min(RULES.COMBO_MAX, this.combo + 1);
      this.bestCombo = Math.max(this.bestCombo, this.combo);
      this.comboT = RULES.COMBO_WINDOW;
      p.chompT = 0.16;
      Sfx.bigChomp();
      this.fx("eat", e.x, e.y, { kind: "robot", etype: e.type, et: e.t, edible: true });
      if (typeof Fx !== "undefined") {
        Fx.burst(e.x - this.camX, e.y, spec.body, 18, 180, 0.5, 3);
        Fx.text(e.x - this.camX, e.y - 10, `+${RULES.FRENZY_ROBOT_SCORE * this.combo}`, { color: "#ff5ad1" });
        Fx.addShake(3);
      }
      return;
    }

    // Dive-slamming ONTO a bot smashes it. Landing near one does too (see
    // shockwave), but contact has to work as well or the move only pays off
    // with frame-perfect timing — which is not a fair ask of an 8-year-old.
    if (p.slamming && spec.slammable) {
      e.dead = true;
      this.robots++;
      this.score += spec.slamScore || 10;
      Sfx.boom();
      this.fx("smash", e.x, e.y, { kind: "robot", etype: e.type, et: e.t });
      if (typeof Fx !== "undefined") {
        Fx.addShake(5);
        Fx.burst(e.x - this.camX, e.y, spec.body, 16, 170, 0.5, 2.8);
        Fx.text(e.x - this.camX, e.y - 10, `+${spec.slamScore}`, { color: "#ffd93b" });
      }
      return;
    }

    if (p.iframes > 0) return;

    if (this.shield) {
      this.shield = false;
      p.iframes = RULES.IFRAMES;
      Sfx.shieldPop();
      if (typeof Fx !== "undefined") {
        Fx.burst(p.x - this.camX, p.y, "#ffd93b", 20, 170, 0.5, 3);
        Fx.text(p.x - this.camX, p.y - 24, "BLOCKED!", { color: "#ffd93b", size: 13 });
      }
      return;
    }

    // Ate metal. This is the whole point of the game's title.
    this.bites++;
    this.hunger -= spec.dmg;
    this.combo = 1;
    this.comboT = 0;
    p.iframes = RULES.IFRAMES;
    p.stagger = P.STAGGER;
    p.hurtT = 0.4;
    Sfx.clang();
    if (typeof Fx !== "undefined") {
      Fx.addShake(8);
      Fx.flash = 0.45; Fx.flashColor = "#ff3b3b";
      Fx.burst(p.x - this.camX, p.y, "#9fb0c0", 16, 170, 0.5, 2.6);
      Fx.text(p.x - this.camX, p.y - 26, `-${spec.dmg} YUCK!`, { color: "#ff6b6b", size: 13 });
    }
  },

  /* -------------------------------- cull --------------------------------- */
  cull() {
    const left = this.camX - 90;
    this.ents = this.ents.filter((e) => !e.dead && e.x > left);
    this.plats = this.plats.filter((pl) => pl.x + pl.w > left);
  },

  /* -------------------------------- death -------------------------------- */
  die() {
    if (this.dead) return;
    this.dead = true;
    this.running = false;
    Music.stop();
    Sfx.starve();
    if (typeof Fx !== "undefined") {
      Fx.addShake(10);
      Fx.flash = 0.6; Fx.flashColor = "#000000";
      Fx.burst(this.p.x - this.camX, this.p.y, this.skin ? this.skin.body : "#7ee081", 30, 220, 0.9, 3.4);
    }
    const res = this.buildResult();
    setTimeout(() => App.runOver(res, false), 850);
  },

  buildResult() {
    return {
      score: Math.round(this.score),
      metres: this.metres,
      eaten: this.eaten,
      robots: this.robots,
      bites: this.bites,
      bestCombo: this.bestCombo,
      zone: this.zoneIdx,
      time: Math.round(this.elapsed),
    };
  },

};

// The y of whatever the alien is standing on — used for landing dust.
function GROUND_YOf(p) { return p.plat ? p.plat.y : GROUND_Y; }
