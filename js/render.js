// Rendering — everything is drawn procedurally from the zone palette, so a new
// zone is a colour table and nothing else. Attached to Game so the loop in
// game.js can stay simulation-only (and the headless bot can skip this file).
//
// Draw space is the fixed 400x225 logical stage. The canvas is usually taller
// or wider than that, so the sky is painted above it and the ground below it,
// out to the real canvas edges — that way there are never letterbox bars, just
// more sky on a phone and more street on a laptop.

const SKY_STARS = 40;

Object.assign(Game, {
  render() {
    const ctx = this.ctx;
    if (!ctx) return;
    const s = this.scale * this.DPR;
    ctx.setTransform(s, 0, 0, s, 0, 0);
    ctx.translate(this.offX, this.offY);

    const z = this.zone || ZONES[0];
    const L = -this.offX, T = -this.offY;              // canvas edges, logical
    const R = LW + this.offX, B = LH + this.offY;
    const cam = this.camX || 0;

    this.drawSky(ctx, z, L, T, R, B);
    this.drawSkyline(ctx, z, cam, L, R);
    this.drawGround(ctx, z, cam, L, R, B);

    if (typeof Fx !== "undefined" && Fx.shake > 0) {
      ctx.save();
      ctx.translate((Math.random() - 0.5) * Fx.shake, (Math.random() - 0.5) * Fx.shake);
    }

    for (const pl of this.plats) this.drawPlatform(ctx, z, pl, cam);
    for (const e of this.ents) {
      if (e.dead) continue;
      const x = e.x - cam;
      if (x < L - 40 || x > R + 40) continue;
      if (e.kind === "human") this.drawHuman(ctx, e, x);
      else if (e.kind === "robot") this.drawRobot(ctx, e, x);
      else if (e.kind === "brain") this.drawBrain(ctx, e, x);
      else if (e.kind === "orb") this.drawOrb(ctx, e, x);
    }
    this.drawAlien(ctx);

    if (typeof Fx !== "undefined") {
      Fx.render(ctx);
      if (Fx.shake > 0) ctx.restore();
      if (Fx.flash > 0) {
        ctx.globalAlpha = Math.min(1, Fx.flash);
        ctx.fillStyle = Fx.flashColor;
        ctx.fillRect(L, T, R - L, B - T);
        ctx.globalAlpha = 1;
      }
    }

    this.drawHints(ctx, L, R, B);
  },

  /* -------------------------------- sky ---------------------------------- */
  drawSky(ctx, z, L, T, R, B) {
    const g = ctx.createLinearGradient(0, T, 0, GROUND_Y);
    g.addColorStop(0, z.sky[0]);
    g.addColorStop(1, z.sky[1]);
    ctx.fillStyle = g;
    ctx.fillRect(L, T, R - L, GROUND_Y - T);

    // Night zones get a starfield; it's tied to the zone index so it doesn't
    // pop in and out as the palette crossfades.
    if (this.zoneIdx >= 3) {
      ctx.fillStyle = "rgba(255,255,255,0.75)";
      for (let i = 0; i < SKY_STARS; i++) {
        const hx = Math.floor(GK.util.hash2(i, 1) * 997) % 400;
        const hy = Math.floor(GK.util.hash2(i, 2) * 997) % 120;
        const tw = 0.4 + 0.6 * Math.abs(Math.sin((this.elapsed || 0) * 1.2 + i));
        ctx.globalAlpha = tw * 0.8;
        ctx.fillRect(L + hx * (R - L) / 400, T + hy * 0.9, 1.4, 1.4);
      }
      ctx.globalAlpha = 1;
    }
  },

  // Two parallax bands of procedural buildings. Heights come from hash2 so the
  // skyline is stable as the camera moves (and identical for everyone).
  // NOTE: hash2 returns a FLOAT 0-1 — it has to be scaled before % or every
  // building ends up the same height.
  drawSkyline(ctx, z, cam, L, R) {
    const band = (speed, color, base, minH, maxH, step, seed) => {
      ctx.fillStyle = color;
      const off = cam * speed;
      const first = Math.floor((off + L) / step) - 1;
      const last = Math.ceil((off + R) / step) + 1;
      for (let i = first; i <= last; i++) {
        const h = minH + Math.floor(GK.util.hash2(i, seed) * 997) % (maxH - minH);
        const w = step - 4;
        const x = i * step - off;
        ctx.fillRect(x, base - h, w, h);
        // a couple of lit windows, only on the near band (the far one is haze)
        if (seed === 7) {
          ctx.fillStyle = z.window;
          for (let r = 0; r < Math.min(4, Math.floor(h / 12)); r++) {
            const on = Math.floor(GK.util.hash2(i * 13 + r, 5) * 997) % 3;
            if (on === 0) ctx.fillRect(x + 4, base - h + 6 + r * 11, 5, 5);
            if (on !== 2) ctx.fillRect(x + w - 9, base - h + 6 + r * 11, 5, 5);
          }
          ctx.fillStyle = color;
        }
      }
    };
    band(0.18, z.far, GROUND_Y - 6, 34, 86, 46, 3);
    band(0.42, z.near, GROUND_Y, 26, 70, 38, 7);
  },

  /* ------------------------------- ground -------------------------------- */
  drawGround(ctx, z, cam, L, R, B) {
    ctx.fillStyle = z.ground;
    ctx.fillRect(L, GROUND_Y, R - L, B - GROUND_Y);
    ctx.fillStyle = z.groundDark;
    ctx.fillRect(L, GROUND_Y + 10, R - L, B - GROUND_Y - 10);
    // pavement seams scrolling past sell the speed better than anything else
    ctx.fillStyle = z.path;
    const step = 32, off = cam % step;
    for (let x = L - off; x < R; x += step) ctx.fillRect(x, GROUND_Y + 3, 16, 3);
    ctx.fillStyle = "rgba(0,0,0,0.18)";
    ctx.fillRect(L, GROUND_Y, R - L, 2);
  },

  drawPlatform(ctx, z, pl, cam) {
    const x = pl.x - cam;
    ctx.fillStyle = z.roof;
    ctx.fillRect(x, pl.y, pl.w, 7);
    ctx.fillStyle = z.wall;
    ctx.fillRect(x + 3, pl.y + 7, pl.w - 6, GROUND_Y - pl.y - 7);
    ctx.fillStyle = z.window;
    for (let i = 8; i < pl.w - 12; i += 20) {
      ctx.fillRect(x + i, pl.y + 15, 7, 9);
      ctx.fillRect(x + i, pl.y + 32, 7, 9);
    }
    ctx.fillStyle = "rgba(0,0,0,0.22)";
    ctx.fillRect(x, pl.y + 7, pl.w, 2);
  },

  /* ------------------------------- snacks -------------------------------- */
  drawHuman(ctx, e, x) {
    const spec = HUMANS[e.type];
    const y = e.y - e.h / 2;
    const w = e.w;
    // legs scissor faster when fleeing — a jogger reads as "catch me" instantly
    const rate = e.fleeing ? 16 : 7;
    const sw = Math.sin(e.t * rate) * (e.fleeing ? 3.4 : 1.8);

    ctx.fillStyle = spec.pants;
    ctx.fillRect(x - w / 2 + 1, y + e.h - 8 + Math.abs(sw) * 0.2, 3.5, 8 - Math.abs(sw) * 0.2);
    ctx.fillRect(x + w / 2 - 4.5, y + e.h - 8, 3.5, 8);
    ctx.fillStyle = spec.shirt;
    ctx.fillRect(x - w / 2, y + 6, w, e.h - 13);
    // arms
    ctx.fillRect(x - w / 2 - 2, y + 8 - sw, 2.5, 8);
    ctx.fillRect(x + w / 2 - 0.5, y + 8 + sw, 2.5, 8);
    ctx.fillStyle = spec.skin;
    ctx.beginPath();
    ctx.arc(x, y + 4, 4.6, 0, Math.PI * 2);
    ctx.fill();
    // panic face: always looking back at you
    ctx.fillStyle = "#2a2018";
    ctx.fillRect(x - 2.6, y + 3, 1.4, 1.6);
    ctx.fillRect(x + 0.6, y + 3, 1.4, 1.6);
    if (e.fleeing || e.pulled) {
      ctx.fillStyle = "#fff";
      ctx.font = "bold 9px system-ui, sans-serif";
      ctx.fillText("!", x + 6, y - 1);
    }
  },

  drawBrain(ctx, e, x) {
    ctx.fillStyle = "#ff9fd8";
    ctx.beginPath();
    ctx.arc(x - 2.4, e.y, 4, 0, Math.PI * 2);
    ctx.arc(x + 2.4, e.y, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#d16aa8";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, e.y - 3.4);
    ctx.lineTo(x, e.y + 3.4);
    ctx.stroke();
  },

  drawOrb(ctx, e, x) {
    const spec = POWERUPS[e.type];
    const r = 9 + Math.sin(e.t * 5) * 0.9;
    ctx.globalAlpha = 0.28;
    ctx.fillStyle = spec.color;
    ctx.beginPath(); ctx.arc(x, e.y, r + 5, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;
    ctx.fillStyle = spec.color;
    ctx.beginPath(); ctx.arc(x, e.y, r, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    ctx.beginPath(); ctx.arc(x - r * 0.3, e.y - r * 0.35, r * 0.3, 0, Math.PI * 2); ctx.fill();
    ctx.font = "10px system-ui, sans-serif";
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(spec.icon, x, e.y + 0.5);
    ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
  },

  /* ------------------------------- hazards ------------------------------- */
  drawRobot(ctx, e, x) {
    const spec = ROBOTS[e.type];
    const y = e.y - e.h / 2, w = e.w, h = e.h;
    const edible = this.frenzyT > 0;
    const body = edible ? "#ff8fe0" : spec.body;

    if (spec.fly) {
      // drone: saucer body + a rotor blur + a scanning eye
      ctx.fillStyle = spec.trim;
      ctx.fillRect(x - w / 2 - 2, e.y - 7, w + 4, 2);
      ctx.fillStyle = body;
      ctx.beginPath();
      ctx.ellipse(x, e.y, w / 2, h / 2, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = spec.trim;
      ctx.fillRect(x - w / 2, e.y + 1, w, 2.5);
      ctx.fillStyle = edible ? "#fff" : spec.eye;
      ctx.beginPath();
      ctx.arc(x + Math.sin(e.t * 3) * 3, e.y - 1, 2.4, 0, Math.PI * 2);
      ctx.fill();
      return;
    }

    // walker/mech: boxy chassis, treads, glowing eye band
    const step = Math.sin(e.t * 6) * 1.6;
    ctx.fillStyle = spec.trim;
    ctx.fillRect(x - w / 2, y + h - 5, w, 5);
    ctx.fillStyle = body;
    ctx.fillRect(x - w / 2, y + 4, w, h - 9);
    ctx.fillStyle = spec.trim;
    ctx.fillRect(x - w / 2 - 2.5, y + 8 + step, 2.5, h * 0.4);
    ctx.fillRect(x + w / 2, y + 8 - step, 2.5, h * 0.4);
    ctx.fillStyle = body;
    ctx.fillRect(x - w / 2 + 1, y, w - 2, 6);
    ctx.fillStyle = edible ? "#fff" : spec.eye;
    ctx.fillRect(x - w / 2 + 3, y + 2, w - 6, 2.5);
    if (e.type === "mech") {
      ctx.fillStyle = spec.trim;
      ctx.fillRect(x - w / 2 + 2, y + 12, w - 4, 3);
      ctx.fillRect(x - w / 2 + 2, y + 22, w - 4, 3);
    }
    if (edible) {
      ctx.strokeStyle = "#ff5ad1";
      ctx.lineWidth = 1.4;
      ctx.strokeRect(x - w / 2 - 2, y - 2, w + 4, h + 4);
    }
  },

  /* -------------------------------- alien -------------------------------- */
  drawAlien(ctx) {
    const p = this.p;
    if (!p) return;
    const sk = this.skin || SKINS[0];
    const x = PLAYER_X;
    const sliding = p.slide > 0;
    const h = sliding ? P.SLIDE_H : P.H;
    const y = p.y;

    ctx.save();
    // i-frames blink, so a hit is unmistakable without stopping the run
    if (p.iframes > 0 && Math.floor(p.iframes * 18) % 2 === 0) ctx.globalAlpha = 0.4;

    // shadow on whatever is below
    const surf = p.plat ? p.plat.y : GROUND_Y;
    const fall = Math.max(0, surf - (y + h / 2));
    ctx.fillStyle = "rgba(0,0,0,0.22)";
    ctx.beginPath();
    ctx.ellipse(x, surf + 1, 11 - fall * 0.06, 3, 0, 0, Math.PI * 2);
    ctx.fill();

    if (this.frenzyT > 0) {
      ctx.globalAlpha *= 0.5;
      ctx.fillStyle = "#ff5ad1";
      ctx.beginPath();
      ctx.ellipse(x, y, P.W * 0.85, h * 0.8, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha /= 0.5;
    }

    ctx.translate(x, y);
    ctx.scale(p.sx, p.sy);

    // tentacle legs — they scissor while running, tuck while airborne
    const bw = P.W * (sliding ? 1.15 : 1), bh = h;
    ctx.strokeStyle = sk.dark;
    ctx.lineWidth = 3;
    ctx.lineCap = "round";
    for (let i = 0; i < sk.legs; i++) {
      const t = sk.legs === 1 ? 0.5 : i / (sk.legs - 1);
      const lx = -bw * 0.32 + t * bw * 0.64;
      const swing = p.grounded ? Math.sin(p.runPhase + i * 1.7) * 4 : -2;
      ctx.beginPath();
      ctx.moveTo(lx, bh * 0.24);
      ctx.quadraticCurveTo(lx + swing * 0.5, bh * 0.44, lx + swing, bh * 0.5 + 1);
      ctx.stroke();
    }

    // body
    ctx.fillStyle = p.hurtT > 0 ? "#ff8080" : sk.body;
    ctx.beginPath();
    ctx.ellipse(0, 0, bw / 2, bh / 2, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = sk.belly;
    ctx.beginPath();
    ctx.ellipse(0, bh * 0.12, bw * 0.3, bh * 0.26, 0, 0, Math.PI * 2);
    ctx.fill();

    // antennae
    ctx.strokeStyle = sk.dark;
    ctx.lineWidth = 1.8;
    for (let i = 0; i < sk.antennae; i++) {
      const ax = sk.antennae === 1 ? 0 : (i === 0 ? -4 : 4);
      const wob = Math.sin(p.runPhase * 0.8 + i) * 2;
      ctx.beginPath();
      ctx.moveTo(ax, -bh * 0.42);
      ctx.quadraticCurveTo(ax + wob, -bh * 0.62, ax + wob * 1.4, -bh * 0.74);
      ctx.stroke();
      ctx.fillStyle = sk.eye;
      ctx.beginPath();
      ctx.arc(ax + wob * 1.4, -bh * 0.78, 1.9, 0, Math.PI * 2);
      ctx.fill();
    }

    // eyes
    for (let i = 0; i < sk.eyes; i++) {
      const ex = sk.eyes === 1 ? 1 : (i - (sk.eyes - 1) / 2) * (sk.eyes === 2 ? 6.5 : 5.5) + 1;
      const er = sk.eyes === 1 ? 5.2 : sk.eyes === 2 ? 3.4 : 2.8;
      ctx.fillStyle = "#ffffff";
      ctx.beginPath(); ctx.arc(ex, -bh * 0.14, er, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = sk.eye;
      ctx.beginPath(); ctx.arc(ex + 1.1, -bh * 0.14, er * 0.5, 0, Math.PI * 2); ctx.fill();
    }

    // mouth — snaps wide open for a moment on every bite
    const open = p.chompT > 0 ? 1 : 0.18;
    ctx.fillStyle = "#3a1020";
    ctx.beginPath();
    ctx.ellipse(2, bh * 0.16, 5.5 * (0.6 + open * 0.6), 3.2 * (0.35 + open), 0, 0, Math.PI * 2);
    ctx.fill();
    if (p.chompT > 0) {
      ctx.fillStyle = "#ffffff";
      for (let i = -1; i <= 1; i++) {
        ctx.beginPath();
        ctx.moveTo(2 + i * 3.4 - 1.3, bh * 0.16 - 3);
        ctx.lineTo(2 + i * 3.4 + 1.3, bh * 0.16 - 3);
        ctx.lineTo(2 + i * 3.4, bh * 0.16);
        ctx.fill();
      }
    }
    ctx.restore();

    // force bubble sits outside the squash/stretch transform
    if (this.shield) {
      ctx.strokeStyle = "rgba(255,217,59,0.9)";
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.arc(x, y, P.W * 0.85 + Math.sin(this.elapsed * 6) * 0.8, 0, Math.PI * 2);
      ctx.stroke();
    }
    // tractor beam cone while the magnet is up
    if (this.magnetT > 0) {
      ctx.globalAlpha = 0.16;
      ctx.fillStyle = POWERUPS.magnet.color;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + RULES.MAGNET_RANGE, y - RULES.MAGNET_RANGE * 0.5);
      ctx.lineTo(x + RULES.MAGNET_RANGE, y + RULES.MAGNET_RANGE * 0.5);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  },

  /* -------------------------------- hints -------------------------------- */
  // Fades out after the first few seconds of a run; the controls are two taps
  // and repeating them forever would just be clutter.
  drawHints(ctx, L, R, B) {
    if (!this.hintT || this.hintT <= 0) return;
    ctx.globalAlpha = Math.min(1, this.hintT / 1.5) * 0.55;
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 11px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("TAP LEFT = JUMP", L + (R - L) * 0.25, B - 14);
    ctx.fillText("TAP RIGHT = SLAM", L + (R - L) * 0.75, B - 14);
    ctx.textAlign = "left";
    ctx.globalAlpha = 1;
  },
});
