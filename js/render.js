// Rendering — WHEN and WHERE. What everything looks like lives in js/art.js;
// this file owns the frame: the transform, the draw order, the juice timers,
// the presentation event drain and the HUD. Attached to Game so the loop in
// game.js stays simulation-only and the headless bot can skip this file
// entirely.
//
// Draw space is the fixed 400x225 logical stage. The canvas is usually taller
// or wider than that, so the sky is painted above it and the street below it
// out to the real canvas edges — there are never letterbox bars, just more sky
// on a phone and more road on a laptop.
//
// Two things in here read entity fields the engine does not: `_passed` and
// `_near`, stamped on robots to notice a close shave (see dodges below).
// Nothing in js/game.js or tests/ reads either name — checked by grep — and
// nothing here ever writes a field the simulation consults.

const SKY_STARS = 40;
const POP_CAP = 10;          // ghosts of things just eaten
const DODGE_CAP = 6;
const BANNER_TIME = 2.2;
const DODGE_GAP = 11;        // logical px of clearance that still counts as close

Object.assign(Game, {
  tick: 0,
  pops: [],
  dodges: [],
  banner: 0,
  veil: 0, veilColor: "#000000",
  _zi: 0,

  /* ============================ juice timers ============================= */
  // Everything presentational that has a clock. Called with REAL seconds from
  // the loop, so a pause does not bill it and reduced motion does not stall it.
  juice(dt) {
    this.tick += dt;

    // Arriving in a new zone. Detected here rather than signalled from the
    // engine, because the engine already owns zoneIdx and nothing needs to be
    // added to it for the renderer to notice a change.
    const zi = this.zoneIdx || 0;
    if (zi > this._zi) {
      this.banner = BANNER_TIME;
      this.veil = 0.55;
      this.veilColor = (ZONES[this._zi] || ZONES[0]).sky[1];
    }
    this._zi = zi;

    this.banner = Math.max(0, this.banner - dt);
    this.veil = Math.max(0, this.veil - dt * 1.7);

    for (let i = this.pops.length - 1; i >= 0; i--) {
      const g = this.pops[i];
      g.t += dt; g.et += dt;
      if (g.t >= g.life) this.pops.splice(i, 1);
    }
    for (let i = this.dodges.length - 1; i >= 0; i--) {
      const d = this.dodges[i];
      d.t += dt;
      if (d.t >= d.life) this.dodges.splice(i, 1);
    }
    this.watchDodges();
  },

  // A robot that goes by without touching her. Jumping a patrol bot is the
  // central act of skill in this game and before this pass it produced nothing
  // at all — no sound, no particle, no acknowledgement that anything happened.
  //
  // `_near` is the smallest vertical clearance seen while the two boxes
  // overlapped horizontally; `_passed` latches once it is behind her. Both are
  // render-only fields on an entity the engine is finished deciding about.
  watchDodges() {
    const p = this.p;
    if (!p || !this.running) return;
    const hh = this.hh(p);
    for (const e of this.ents) {
      if (e.kind !== "robot" || e._passed) continue;
      const dx = Math.abs(p.x - e.x), reach = (P.W + e.w) / 2;
      if (e.x > p.x - reach) {
        if (dx < reach) {
          const clear = Math.abs(p.y - e.y) - (hh * 2 + e.h) / 2;
          if (e._near === undefined || clear < e._near) e._near = clear;
        }
        continue;
      }
      e._passed = true;
      if (e.dead || e._near === undefined) continue;
      if (e._near < 0 || e._near > DODGE_GAP) continue;
      this.dodges.push({ x: PLAYER_X, y: p.y, t: 0, life: 0.34 });
      if (this.dodges.length > DODGE_CAP) this.dodges.shift();
      if (typeof Fx !== "undefined") Fx.sparkle(PLAYER_X + 4, p.y, "#ffffff", 3);
    }
  },

  /* ======================== presentation events ========================= */
  // game.js pushes onto Game.q and never reads it back. Each one becomes a
  // ghost: the thing that was just there, redrawn by the painter that drew it,
  // scaling up and fading. A burst of particles says "something happened here";
  // a ghost says "that jogger — the one you were chasing".
  drainEvents() {
    const q = this.q;
    if (!q || !q.length) return;
    const ring = {
      human: "rgba(255,216,150,0.95)",
      brain: "rgba(255,159,216,0.95)",
      robot: "rgba(255,217,59,0.95)",
      orb: "rgba(255,255,255,0.9)",
    };
    for (const ev of q) {
      if (ev.type !== "eat" && ev.type !== "smash") continue;
      this.pops.push({
        kind: ev.kind, type: ev.etype, fleeing: !!ev.fleeing, edible: !!ev.edible,
        x: ev.x, y: ev.y, et: ev.et || 0, t: 0,
        life: ev.type === "smash" ? 0.34 : 0.3,
        ring: ev.kind === "orb" && POWERUPS[ev.etype]
          ? Art.rgba(POWERUPS[ev.etype].color, 0.95) : ring[ev.kind],
      });
      if (this.pops.length > POP_CAP) this.pops.shift();
    }
    q.length = 0;
  },

  /* =============================== the frame ============================= */
  render() {
    const ctx = this.ctx;
    if (!ctx) return;
    const s = this.scale * this.DPR;
    ctx.setTransform(s, 0, 0, s, 0, 0);
    ctx.translate(this.offX, this.offY);

    const z = this.zone || ZONES[0];
    const box = {
      L: -this.offX, T: -this.offY,
      R: LW + this.offX, B: LH + this.offY,
    };
    const cam = this.camX || 0;
    const t = this.tick;

    /* ---- the world ---- */
    Art.paintSky(ctx, z, box, t);
    this.drawStars(ctx, box);
    Art.paintSkyline(ctx, z, cam, box, s);
    Art.paintGround(ctx, z, cam, box, s);

    // Crossing into a new zone washes the outgoing sky over the new one for
    // half a second. A true layer crossfade would mean threading an alpha
    // through every painter in art.js; a veil of the colour you are leaving,
    // under the accent flash the engine already fires, reads the same and
    // cannot break anything.
    if (this.veil > 0) {
      ctx.globalAlpha = Math.min(1, this.veil);
      ctx.fillStyle = this.veilColor;
      ctx.fillRect(box.L, box.T, box.R - box.L, box.B - box.T);
      ctx.globalAlpha = 1;
    }

    // The stage band is only a quarter of a portrait phone; this sinks the
    // overscan so the lit strip reads as the stage. Clipped outside the
    // legibility budget, so it never shades the lane.
    Art.paintDepth(ctx, box);
    Art.paintMotes(ctx, z, box, t);
    // Speed streaks live only in the sky and the road, never in the lane.
    const spd = Math.max(0, Math.min(1, ((this.speed || 0) - 130) / 90));
    Art.paintSpeed(ctx, box, spd, cam);

    if (typeof Fx !== "undefined" && Fx.shake > 0) {
      ctx.save();
      ctx.translate((Math.random() - 0.5) * Fx.shake, (Math.random() - 0.5) * Fx.shake);
    }

    for (const pl of this.plats) {
      const x = pl.x - cam;
      if (x > box.R + 20 || x + pl.w < box.L - 20) continue;
      Art.paintPlatform(ctx, z, pl, x);
    }

    /* ---- the tractor beam goes UNDER the things it is pulling ---- */
    const p = this.p;
    if (p && this.magnetT > 0) Art.paintBeam(ctx, PLAYER_X, p.y, RULES.MAGNET_RANGE, t);

    /* ---- entities ---- */
    const edible = this.frenzyT > 0;
    for (const e of this.ents) {
      if (e.dead) continue;
      const x = e.x - cam;
      if (x < box.L - 46 || x > box.R + 46) continue;
      const feet = e.y + e.h / 2;
      const surf = this.surfaceUnder(e.x, feet);
      // Every single thing in the picture gets a ground shadow. It is the one
      // change that stops the whole cast reading as stickers on the sky, and
      // for a drone the shadow's spread is the only cue to how high it is —
      // which is the difference between one you can slide under and one you
      // cannot.
      Art.shadow(ctx, x, surf, Math.max(e.w, e.h) * 0.34, surf - feet);
      ctx.save();
      ctx.translate(x, e.y);
      if (e.kind === "human") Art.paintHuman(ctx, e.type, e);
      else if (e.kind === "robot") Art.paintRobot(ctx, e.type, { t: e.t, edible });
      else if (e.kind === "brain") Art.paintBrain(ctx, e);
      else if (e.kind === "orb") Art.paintOrb(ctx, e.type, e);
      ctx.restore();
    }

    /* ---- ghosts of whatever was there a moment ago ---- */
    for (const g of this.pops) Art.paintGhost(ctx, g, g.x - cam);

    this.drawAlien(ctx, box);

    for (const d of this.dodges) Art.paintDodge(ctx, d.x, d.y, d.t / d.life);

    if (typeof Fx !== "undefined") {
      Fx.render(ctx);
      if (Fx.shake > 0) ctx.restore();
      if (Fx.flash > 0) {
        ctx.globalAlpha = Math.min(1, Fx.flash);
        ctx.fillStyle = Fx.flashColor;
        ctx.fillRect(box.L, box.T, box.R - box.L, box.B - box.T);
        ctx.globalAlpha = 1;
      }
    }

    /* ---- the clock you are racing, finally visible in the picture ---- */
    if (this.running || this.dead) {
      Art.paintHungerEdge(ctx, box, Math.max(0, this.hunger) / RULES.HUNGER_MAX, t);
    }
    if (this.banner > 0) Art.paintBanner(ctx, box, z, this.banner / BANNER_TIME);
    if (this.hintT > 0) Art.paintHints(ctx, box, Math.min(1, this.hintT / 1.5) * 0.9);
  },

  // Night zones keep their starfield. Tied to the zone index rather than to the
  // palette so it does not pop in and out as the sky changes.
  drawStars(ctx, box) {
    if ((this.zoneIdx || 0) < 3) return;
    const L = box.L, T = box.T, R = box.R;
    ctx.fillStyle = "rgba(255,255,255,0.8)";
    for (let i = 0; i < SKY_STARS; i++) {
      const hx = Math.floor(GK.util.hash2(i, 1) * 997) % 400;
      const hy = Math.floor(GK.util.hash2(i, 2) * 997) % 120;
      const tw = Art.motion ? 0.4 + 0.6 * Math.abs(Math.sin(this.tick * 1.2 + i)) : 0.85;
      const r = 0.55 + (i % 5 === 0 ? 0.5 : 0);
      ctx.globalAlpha = tw * 0.85;
      ctx.beginPath();
      ctx.arc(L + hx * (R - L) / 400, T + hy * 0.9, r, 0, 6.2832);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  },

  // The nearest surface at or below a pair of feet. Used for shadows only.
  surfaceUnder(worldX, feetY) {
    let surf = GROUND_Y;
    for (const pl of this.plats) {
      if (worldX < pl.x || worldX > pl.x + pl.w) continue;
      if (pl.y >= feetY - 2 && pl.y < surf) surf = pl.y;
    }
    return surf;
  },

  /* -------------------------------- alien -------------------------------- */
  drawAlien(ctx, box) {
    const p = this.p;
    if (!p) return;
    const sk = this.skin || SKINS[0];
    const x = PLAYER_X;
    const sliding = p.slide > 0;
    const h = sliding ? P.SLIDE_H : P.H;
    const surf = p.plat ? p.plat.y : GROUND_Y;
    const t = this.tick;

    // The warm pool she stands in, and her shadow. The pool is the one cue
    // that works on grass AND on a near-black spaceport apron, which no hide
    // colour does.
    Art.paintAlienPool(ctx, x, surf, P.W * 0.5);
    Art.shadow(ctx, x, surf, P.W * 0.52, surf - (p.y + h / 2));

    ctx.save();
    // Invulnerability is shown as a ring AROUND her, never as a strobe on her:
    // blinking the player out hides her at the exact moment she most needs to
    // see where she is.
    if (p.iframes > 0) {
      const k = p.iframes / RULES.IFRAMES;
      ctx.globalAlpha = 0.45 + 0.3 * Math.sin(t * 22) * (Art.motion || 0);
      ctx.strokeStyle = "rgba(255,120,120,0.95)";
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.ellipse(x, p.y, P.W * 0.78 + (1 - k) * 5, h * 0.74 + (1 - k) * 5, 0, 0, 6.2832);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    ctx.translate(x, p.y);
    ctx.scale(p.sx, p.sy);
    Art.paintAlien(ctx, sk, {
      w: P.W, h, run: p.runPhase, grounded: p.grounded, sliding,
      vy: p.vy, chomp: p.chompT, hurt: p.hurtT, combo: this.combo,
      frenzy: this.frenzyT > 0, t, mood: "run",
    });
    ctx.restore();

    // A slide throws up a wake. It is the only thing that tells you from the
    // picture alone that she is now low enough to get under a drone.
    if (sliding && Art.motion) {
      ctx.globalAlpha = 0.3;
      for (let i = 0; i < 3; i++) {
        const k = (t * 3 + i * 0.33) % 1;
        Art.softBlob(ctx, x - 10 - k * 22, surf - 3 - k * 4, 7 + k * 7, 3 + k * 3,
          "rgba(255,255,255,0.55)");
      }
      ctx.globalAlpha = 1;
    }

    if (this.shield) Art.paintShield(ctx, x, p.y, P.W * 0.88, t);
  },

  /* --------------------------------- HUD --------------------------------- */
  // Runs every frame, so nothing here may touch innerHTML unless the content
  // has actually changed — a rebuild per frame is wasteful and it also kills
  // every CSS transition on the thing being rebuilt.
  updateHud() {
    const el = (id) => document.getElementById(id);
    const fill = el("hunger-fill");
    if (!fill) return;

    const pct = Math.max(0, this.hunger) / RULES.HUNGER_MAX;
    fill.style.width = (pct * 100).toFixed(1) + "%";
    const cls = "hunger-fill" + (pct < 0.25 ? " low" : pct < 0.5 ? " mid" : "");
    if (fill.className !== cls) fill.className = cls;

    const score = el("hud-score");
    const sv = Math.round(this.score).toLocaleString();
    if (score.dataset.v !== sv) {
      score.dataset.v = sv;
      score.textContent = sv;
      score.classList.remove("pop");
      void score.offsetWidth;          // forces reflow so the animation restarts
      score.classList.add("pop");
    }
    el("hud-dist").textContent = this.metres + "m";

    const c = el("hud-combo");
    const cv = this.combo > 1 ? "x" + this.combo : "";
    if (c.dataset.v !== cv) {
      c.dataset.v = cv;
      c.textContent = cv;
      c.classList.remove("pop");
      void c.offsetWidth;
      c.classList.add("pop");
    }
    const ccls = "hud combo" + (this.combo >= 5 ? " hot" : "") + (cv ? " on" : "");
    if (c.className !== ccls) c.className = ccls;

    // Power pills carry a draining underline, so "how long have I got?" is
    // answerable without counting. The markup is rebuilt only when the SET of
    // live powers changes; the bars update through a custom property.
    const pw = el("hud-powers");
    const live = [];
    if (this.shield) live.push(["shield", 1]);
    if (this.magnetT > 0) live.push(["magnet", this.magnetT / POWERUPS.magnet.dur]);
    if (this.frenzyT > 0) live.push(["frenzy", this.frenzyT / POWERUPS.frenzy.dur]);
    const sig = live.map((l) => l[0]).join(",");
    if (pw.dataset.sig !== sig) {
      pw.dataset.sig = sig;
      pw.innerHTML = live.map(([id]) =>
        `<span class="pw pw-${id}" style="--k:100%">${POWERUPS[id].icon}</span>`).join("");
    }
    const pills = pw.children;
    for (let i = 0; i < pills.length; i++) {
      pills[i].style.setProperty("--k", (live[i][1] * 100).toFixed(0) + "%");
    }
  },
});
