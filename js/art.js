// The look of Alien Chomp: palettes, the city it runs through, and everything
// that lives in it. js/render.js owns WHEN and WHERE things are drawn; this
// file owns WHAT they look like, so art direction is one file rather than a
// habit scattered through the frame loop.
//
// Two rules hold the whole thing together:
//
//   1. Nothing here may move an entity or change a number the engine reads.
//      Every position comes from js/game.js. Scenery comes from a positional
//      hash, so the city looks hand-placed and still plays identically on
//      every device and in every seeded replay.
//   2. The repeating unit is painted ONCE and blitted. This game scrolls, so
//      that unit is a BUILDING and a length of STREET, not a frame: a skyline
//      of baked sprites costs ~50 drawImage calls a frame and can afford
//      window grids, water towers, aerials and neon, which several hundred
//      live fillRects could not.
//
// THE LEGIBILITY BUDGET. The one question the player answers all game is "is
// that food or metal?", and half a second later "high or low?". The engine
// places entities between y=104 (a high drone at the top of its bob) and
// y=172 (the street), and the alien reaches y~44 at the top of a double jump.
// So:
//
//      NOTHING IS EVER PAINTED OVER y = 40 .. 174.
//
// Decoration lives in the sky above that band and in the street strip below
// it — GROUND_Y..LH is 53 logical px of road with no entities in it, ever.
// The stage is letterboxed on ONE axis only (a wide screen gets extra width
// with offY = 0), so foreground dressing has to fit inside the stage's own
// street strip and can never rely on overscan being there.

const ART_TOP = 40;        // highest the alien ever gets
const ART_FLOOR = 174;     // GROUND_Y plus the alien's foot shadow

/* =========================================================================
   Per-zone art palettes.

   Kept here rather than in zones.js so the gameplay registry the tests lint
   stays untouched. A zone's own table (sky/far/near/roof/wall/window/ground/
   groundDark/path/accent) is the source of truth for hue; these are the extra
   MATERIALS a painter needs and a zone does not logically have. `kerb` is in
   the table because a kerb painted from the suburbs' grass green came out as
   a dark green pill.
   ========================================================================= */
const ZONE_ART = {
  suburbs: {
    skyFeat: "sun", sun: "rgba(255,247,205,0.8)",
    horizon: "rgba(255,248,214,0.5)", cloud: "rgba(255,255,255,0.5)",
    kerb: "#e4dcc0", kerbLip: "#a89a74", glass: "#9ec4d2",
    litter: "#4e7c3e", neon: "#ffd93b",
    street: "suburb", roofTrim: "#9c4f39",
    mote: { color: "rgba(255,252,214,0.7)", n: 12, rise: -5, drift: 16, size: 1.5 },
  },
  downtown: {
    skyFeat: "clouds", sun: "rgba(255,255,255,0.45)",
    horizon: "rgba(206,231,246,0.55)", cloud: "rgba(255,255,255,0.4)",
    kerb: "#9aa3ae", kerbLip: "#5e656e", glass: "#5b7896",
    litter: "#7c828c", neon: "#5ad1ff",
    street: "city", roofTrim: "#28323f",
    mote: { color: "rgba(226,240,255,0.5)", n: 10, rise: -3, drift: 22, size: 1.3 },
  },
  factory: {
    skyFeat: "smog", sun: "rgba(255,206,140,0.75)",
    horizon: "rgba(255,186,120,0.55)", cloud: "rgba(94,66,50,0.45)",
    kerb: "#8a7660", kerbLip: "#4a3c30", glass: "#6a5340",
    litter: "#6b5c4c", neon: "#ff9f43",
    street: "industry", roofTrim: "#3c2c22",
    mote: { color: "rgba(255,186,110,0.55)", n: 16, rise: -9, drift: 14, size: 1.8 },
  },
  neon: {
    skyFeat: "moon", sun: "rgba(214,198,255,0.75)",
    horizon: "rgba(255,90,209,0.3)", cloud: "rgba(90,42,122,0.5)",
    kerb: "#4a3468", kerbLip: "#1b1030", glass: "#2a1c48",
    litter: "#3a2a58", neon: "#ff5ad1",
    street: "neon", roofTrim: "#180f2a",
    mote: { color: "rgba(255,130,224,0.6)", n: 18, rise: -7, drift: 12, size: 1.6 },
  },
  spaceport: {
    skyFeat: "planets", sun: "rgba(142,240,255,0.6)",
    horizon: "rgba(90,150,220,0.32)", cloud: "rgba(30,48,92,0.5)",
    kerb: "#39456e", kerbLip: "#111733", glass: "#1b2444",
    litter: "#2a3358", neon: "#8ef0ff",
    street: "port", roofTrim: "#0e1426",
    mote: { color: "rgba(180,234,255,0.6)", n: 20, rise: -6, drift: 10, size: 1.4 },
  },
};

const Art = {
  // 1 normally, 0 when the player has asked for less movement. Everything
  // that drifts, sways, breathes, pulses, streaks or pops multiplies by this.
  motion: 1,

  _blobs: {}, _blobKeys: [],
  _bld: {}, _bldKeys: [],
  _sky: null, _skyKey: "",
  _street: null, _streetKey: "",

  art(zone) { return ZONE_ART[zone.id] || ZONE_ART.suburbs; },

  /* ============================== colour ================================ */
  rgba(hex, a) {
    const n = parseInt(hex.slice(1), 16);
    return "rgba(" + ((n >> 16) & 255) + "," + ((n >> 8) & 255) + "," + (n & 255) + "," + a + ")";
  },
  shade(hex, amt) { return GK.util.shade(hex, amt); },

  /* ============================== helpers =============================== */
  // Written out rather than using ctx.roundRect: this runs on the family's
  // older iPads too.
  rr(ctx, x, y, w, h, r) { ctx.beginPath(); this.rrPath(ctx, x, y, w, h, r); },
  rrPath(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.arcTo(x + w, y, x + w, y + r, r);
    ctx.lineTo(x + w, y + h - r);
    ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
    ctx.lineTo(x + r, y + h);
    ctx.arcTo(x, y + h, x, y + h - r, r);
    ctx.lineTo(x, y + r);
    ctx.arcTo(x, y, x + r, y, r);
    ctx.closePath();
  },

  // A soft round gradient blob, cached per colour. Ground shadows, glows,
  // sunlight, cloud shadow, the tractor beam core and every shockwave are this
  // one image at different sizes — a feathered edge is the most useful shape
  // in the game, and rebuilding the gradient every frame is not something a
  // phone should be asked to pay for.
  //
  // The colour handed in MUST be a constant: one canvas is kept per colour
  // string for the life of the page, so a per-frame alpha would mint a new one
  // every frame. Vary brightness with ctx.globalAlpha at the call site. The
  // cap is a backstop for whoever forgets.
  blob(color) {
    if (this._blobs[color]) return this._blobs[color];
    if (this._blobKeys.length >= 40) delete this._blobs[this._blobKeys.shift()];
    this._blobKeys.push(color);
    const S = 128;
    const inner = color.slice(color.indexOf("(") + 1, color.lastIndexOf(")"));
    const p = inner.split(",").map(Number);
    const a = p.length > 3 ? p[3] : 1;
    const at = (k) => "rgba(" + p[0] + "," + p[1] + "," + p[2] + "," + (a * k).toFixed(3) + ")";
    const c = document.createElement("canvas");
    c.width = c.height = S;
    const cx = c.getContext("2d");
    const rad = cx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    rad.addColorStop(0, at(1));
    rad.addColorStop(0.45, at(0.6));
    rad.addColorStop(0.75, at(0.19));
    rad.addColorStop(1, at(0));
    cx.fillStyle = rad;
    cx.fillRect(0, 0, S, S);
    this._blobs[color] = c;
    return c;
  },
  softBlob(ctx, x, y, rx, ry, color) {
    ctx.drawImage(this.blob(color), x - rx, y - ry, rx * 2, ry * 2);
  },

  // A vertical gradient band with EXPLICIT endpoints. Counting the arguments
  // matters: a helper that quietly drops its end point renders as a hard seam
  // across the whole screen and is miserable to diagnose from a screenshot.
  vband(ctx, x, y0, w, y1, c0, c1) {
    const g = ctx.createLinearGradient(0, y0, 0, y1);
    g.addColorStop(0, c0); g.addColorStop(1, c1);
    ctx.fillStyle = g;
    ctx.fillRect(x, y0, w, y1 - y0);
  },

  /* =============================== the pen ===============================
     The thing that makes a dozen procedural shapes look like one illustrator
     drew them is not detail, it is ONE edge treatment applied to everything:
     a dark rim, a top highlight, and a line weight that scales with the
     subject. Every human, robot and alien in the game goes through this.
     ====================================================================== */
  pen(ctx, r, body) {
    const line = this.shade(body, -62);
    const hi = this.shade(body, 40);
    const lw = Math.max(0.55, r * 0.085);
    const ell = (x, y, rx, ry, fill, rot, outline) => {
      ctx.beginPath();
      ctx.ellipse(x, y, Math.max(0.3, rx), Math.max(0.3, ry), rot || 0, 0, 6.2832);
      ctx.fillStyle = fill; ctx.fill();
      if (outline !== false) { ctx.strokeStyle = line; ctx.lineWidth = lw; ctx.stroke(); }
    };
    // A limb: the dark rim first as a fatter stroke, the body colour over the
    // top. That is how you outline a stroke, and it is what stops arms and
    // legs looking like a different drawing from the body they hang off.
    const limb = (path, w, fill) => {
      ctx.lineCap = "round"; ctx.lineJoin = "round";
      ctx.beginPath(); path();
      ctx.strokeStyle = line; ctx.lineWidth = w + lw * 2; ctx.stroke();
      ctx.beginPath(); path();
      ctx.strokeStyle = fill; ctx.lineWidth = w; ctx.stroke();
    };
    const poly = (pts, fill, outline) => {
      ctx.beginPath();
      for (let i = 0; i < pts.length; i++) {
        if (i) ctx.lineTo(pts[i][0], pts[i][1]); else ctx.moveTo(pts[i][0], pts[i][1]);
      }
      ctx.closePath();
      ctx.fillStyle = fill; ctx.fill();
      if (outline !== false) {
        ctx.strokeStyle = line; ctx.lineWidth = lw; ctx.lineJoin = "round"; ctx.stroke();
      }
    };
    const box = (x, y, w, h, fill, rad, outline) => {
      this.rr(ctx, x, y, w, h, rad === undefined ? Math.min(w, h) * 0.22 : rad);
      ctx.fillStyle = fill; ctx.fill();
      if (outline !== false) { ctx.strokeStyle = line; ctx.lineWidth = lw; ctx.stroke(); }
    };
    // A tapering ribbon along a quadratic — a tentacle, an arm, an antenna. A
    // round stroke of constant width is what makes procedural limbs read as
    // flippers; the taper is most of the difference between "shapes" and
    // "drawn creature".
    const ribbon = (x0, y0, cx, cy, x1, y1, w0, w1, fill) => {
      const N = 8, a = [], b = [];
      for (let i = 0; i <= N; i++) {
        const t = i / N, mt = 1 - t;
        const x = mt * mt * x0 + 2 * mt * t * cx + t * t * x1;
        const y = mt * mt * y0 + 2 * mt * t * cy + t * t * y1;
        const dx = 2 * mt * (cx - x0) + 2 * t * (x1 - cx);
        const dy = 2 * mt * (cy - y0) + 2 * t * (y1 - cy);
        const len = Math.hypot(dx, dy) || 1;
        const w = w0 + (w1 - w0) * t;
        a.push([x - dy / len * w, y + dx / len * w]);
        b.push([x + dy / len * w, y - dx / len * w]);
      }
      ctx.beginPath();
      ctx.moveTo(a[0][0], a[0][1]);
      for (let i = 1; i <= N; i++) ctx.lineTo(a[i][0], a[i][1]);
      for (let i = N; i >= 0; i--) ctx.lineTo(b[i][0], b[i][1]);
      ctx.closePath();
      ctx.fillStyle = fill; ctx.fill();
      ctx.strokeStyle = line; ctx.lineWidth = lw; ctx.lineJoin = "round"; ctx.stroke();
    };
    // Guarded hard: the smallest snack in the game is 9px wide, and an
    // unguarded radius turns its eye into a dark smudge over its whole face.
    // blink: 1 = shut (a flat line), 2 = happy (an upward arc). Three flat
    // dashes across a three-eyed alien read as a visor slot, not as delight.
    const eye = (x, y, rad, look, blink, iris) => {
      if (blink) {
        ctx.strokeStyle = line; ctx.lineWidth = Math.max(0.7, rad * 0.55); ctx.lineCap = "round";
        ctx.beginPath();
        if (blink === 2) ctx.arc(x, y + rad * 0.45, rad, -Math.PI + 0.5, -0.5);
        else { ctx.moveTo(x - rad, y); ctx.lineTo(x + rad, y); }
        ctx.stroke();
        return;
      }
      ell(x, y, rad, rad, "#fdfcf5", 0, rad > 1.7);
      ell(x + rad * 0.32 * (look || 0), y + rad * 0.06,
        rad * 0.55, rad * 0.62, iris || "#1d2430", 0, false);
      ell(x + rad * 0.32 * (look || 0) - rad * 0.26, y - rad * 0.3,
        Math.max(0.3, rad * 0.22), Math.max(0.3, rad * 0.22), "rgba(255,255,255,0.92)", 0, false);
    };
    return { line, hi, lw, ell, limb, poly, box, ribbon, eye };
  },

  // Soft-edged, never a hard ellipse: a crisp dark oval under a character
  // reads as a hole in the ground rather than a shadow on it. `lift` is how
  // far above the surface the thing is, and for a drone it is the only
  // altitude cue there is — the shadow spreads and fades as it climbs, which
  // is what separates the drone you can slide under from the one you cannot.
  shadow(ctx, x, surfaceY, r, lift) {
    const k = Math.max(0, Math.min(1, (lift || 0) / 60));
    ctx.globalAlpha = 1 - k * 0.45;
    this.softBlob(ctx, x + r * 0.12, surfaceY + 1.5,
      r * (0.95 + k * 0.75), r * (0.32 + k * 0.08), "rgba(10,6,24,0.36)");
    ctx.globalAlpha = 1;
  },
};

/* =========================================================================
   THE WORLD
   ------------------------------------------------------------------------
   The sky is drawn live: it is a gradient and half a dozen soft blobs, and
   keeping it live is what makes the zone crossfade free — render.js paints the
   outgoing zone, then paints the incoming one over it at a rising alpha.

   The skyline and the street are baked, because their repeating unit is a
   BUILDING and a LENGTH OF ROAD. Each is drawn once at device resolution and
   blitted, which is what pays for window grids, water towers, aerials, neon,
   drains, cables and litter.
   ========================================================================= */
Object.assign(Art, {

  /* ------------------------------- sky ---------------------------------- */
  paintSky(ctx, zone, box, tick) {
    const A = this.art(zone);
    const L = box.L, T = box.T, R = box.R;
    this.vband(ctx, L, T, R - L, GROUND_Y, zone.sky[0], zone.sky[1]);

    // Haze sitting on the horizon. Every zone gets one: it is what makes the
    // far buildings read as distant rather than as a second row of near ones.
    ctx.globalAlpha = 0.85;
    this.softBlob(ctx, (L + R) / 2, GROUND_Y - 4, (R - L) * 0.62, 46, A.horizon);
    ctx.globalAlpha = 1;

    const drift = this.motion ? tick : 0;
    // How high a sky object may sit: up to 150px above the street, but never
    // off the top of a screen that has no room above the stage.
    const up = (d) => Math.max(T + 16, GROUND_Y - d);
    switch (A.skyFeat) {
      case "sun": {
        const sx = L + (R - L) * 0.76, sy = up(140);
        this.softBlob(ctx, sx, sy, 58, 58, A.sun);
        ctx.globalAlpha = 0.9;
        this.softBlob(ctx, sx, sy, 17, 17, "rgba(255,255,245,0.95)");
        ctx.globalAlpha = 1;
        this.clouds(ctx, box, A.cloud, drift, 3, 0.55);
        break;
      }
      case "clouds":
        this.clouds(ctx, box, A.cloud, drift, 5, 0.7);
        break;
      case "smog": {
        // Layered bands rather than puffs: the factory sky should look like it
        // is settling on you.
        for (let i = 0; i < 4; i++) {
          const y = up(146 - i * 17);
          ctx.globalAlpha = 0.3 - i * 0.05;
          this.softBlob(ctx, L + (R - L) * (0.3 + 0.4 * GK.util.hash2(i, 9)) +
            Math.sin(drift * 0.07 + i) * 16 * this.motion, y, (R - L) * 0.46, 16, A.cloud);
        }
        ctx.globalAlpha = 1;
        this.softBlob(ctx, L + (R - L) * 0.2, up(148), 44, 30, A.sun);
        break;
      }
      case "moon": {
        const mx = L + (R - L) * 0.2, my = up(142);
        this.softBlob(ctx, mx, my, 46, 46, A.sun);
        ctx.fillStyle = "#efe6ff";
        ctx.beginPath(); ctx.arc(mx, my, 11, 0, 6.2832); ctx.fill();
        // The bite out of it is the game telling its own joke, and it is cut
        // rather than overpainted so it works on any sky colour.
        ctx.save();
        ctx.globalCompositeOperation = "destination-out";
        ctx.beginPath(); ctx.arc(mx + 6.5, my - 4.5, 7.5, 0, 6.2832); ctx.fill();
        ctx.beginPath(); ctx.arc(mx + 2.5, my + 8, 3.2, 0, 6.2832); ctx.fill();
        ctx.restore();
        this.clouds(ctx, box, A.cloud, drift, 3, 0.5);
        break;
      }
      case "planets": {
        const px = L + (R - L) * 0.82, py = up(144);
        this.softBlob(ctx, px, py, 40, 40, A.sun);
        ctx.fillStyle = "#6f87c8";
        ctx.beginPath(); ctx.arc(px, py, 13, 0, 6.2832); ctx.fill();
        ctx.fillStyle = "rgba(255,255,255,0.18)";
        ctx.beginPath(); ctx.arc(px - 4, py - 4, 8, 0, 6.2832); ctx.fill();
        ctx.strokeStyle = "rgba(190,220,255,0.6)";
        ctx.lineWidth = 1.6;
        ctx.beginPath(); ctx.ellipse(px, py + 1, 22, 5, -0.22, 0, 6.2832); ctx.stroke();
        const qx = L + (R - L) * 0.32, qy = up(118);
        this.softBlob(ctx, qx, qy, 16, 16, A.sun);
        ctx.fillStyle = "#8ea4de";
        ctx.beginPath(); ctx.arc(qx, qy, 5, 0, 6.2832); ctx.fill();
        break;
      }
    }
  },

  // Three or five soft discs drifting slowly. Something crossing overhead is
  // the closest thing a side-scroller gets to a parallax plane that is not
  // made of buildings.
  clouds(ctx, box, color, drift, n, alpha) {
    const L = box.L, T = box.T, R = box.R;
    const span = R - L + 160;
    for (let i = 0; i < n; i++) {
      const sp = 5 + (i % 3) * 3;
      const x = L - 80 + ((GK.util.hash2(i, 21) * span + drift * sp * this.motion) % span);
      const y = Math.max(T + 10, GROUND_Y - 156 + GK.util.hash2(i, 23) * 70);
      const rx = 26 + GK.util.hash2(i, 25) * 30;
      ctx.globalAlpha = alpha * (0.55 + GK.util.hash2(i, 27) * 0.45);
      this.softBlob(ctx, x, y, rx, rx * 0.42, color);
      this.softBlob(ctx, x + rx * 0.5, y + 3, rx * 0.6, rx * 0.3, color);
      ctx.globalAlpha = 1;
    }
  },

  // Pollen, ash, sparks, dust — per zone. A fixed pool, wrapped rather than
  // respawned, and kept in the sky band so it can never be mistaken for
  // something the alien could eat.
  paintMotes(ctx, zone, box, tick) {
    if (!this.motion) return;
    const m = this.art(zone).mote;
    const L = box.L, T = box.T, R = box.R;
    const span = R - L + 40;
    const h = Math.max(20, ART_TOP - 6 - T);
    const top = ART_TOP - 6 - h;
    ctx.fillStyle = m.color;
    for (let i = 0; i < m.n; i++) {
      const sp = m.drift * (0.6 + GK.util.hash2(i, 31) * 0.8);
      const x = L - 20 + ((GK.util.hash2(i, 33) * span + tick * sp) % span);
      const y = top + ((((GK.util.hash2(i, 35) * h) + tick * m.rise) % h) + h) % h;
      const s = m.size * (0.6 + GK.util.hash2(i, 37) * 0.8);
      ctx.globalAlpha = 0.3 + 0.5 * Math.abs(Math.sin(tick * 1.4 + i));
      ctx.beginPath(); ctx.arc(x, y, s, 0, 6.2832); ctx.fill();
    }
    ctx.globalAlpha = 1;
  },

  /* --------------------------- skyline sprites -------------------------- */
  // 8 profiles per band. Heights and silhouettes both vary, because evenly
  // sized buildings read as a fence however much you vary the colour.
  FAR_H: [34, 48, 62, 76, 40, 54, 86, 68],
  NEAR_H: [26, 34, 44, 52, 60, 70, 38, 48],

  buildingSprite(zone, band, v, s) {
    const key = zone.id + "|" + band + "|" + v + "|" + Math.round(s * 8);
    const hit = this._bld[key];
    if (hit) return hit;
    // Two zones' worth can be live at once during a crossfade; 40 covers that
    // with room to spare, and the oldest go first.
    if (this._bldKeys.length >= 40) delete this._bld[this._bldKeys.shift()];
    this._bldKeys.push(key);

    const A = this.art(zone);
    const w = band === 0 ? 42 : 34;
    const h = band === 0 ? this.FAR_H[v] : this.NEAR_H[v];
    const PAD = 18;                        // room for masts, tanks and signs
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.ceil((w + PAD * 2) * s));
    c.height = Math.max(1, Math.ceil((h + PAD) * s));
    const cx = c.getContext("2d");
    cx.setTransform(s, 0, 0, s, 0, 0);
    cx.translate(PAD, PAD);                // (0,0) is now the block's top-left
    if (band === 0) this.paintFarBlock(cx, zone, A, v, w, h);
    else this.paintNearBlock(cx, zone, A, v, w, h);
    const sprite = { c, w, h, ox: PAD, oy: PAD, lw: c.width / s, lh: c.height / s };
    this._bld[key] = sprite;
    return sprite;
  },

  // The far band is atmosphere: one flat silhouette colour, a rooftop profile,
  // and nothing that can be picked out individually.
  paintFarBlock(ctx, z, A, v, w, h) {
    const col = z.far;
    ctx.fillStyle = col;
    ctx.fillRect(0, 0, w, h);
    switch (v) {
      case 1: ctx.fillRect(w * 0.3, -9, w * 0.4, 9); break;
      case 2: ctx.fillRect(w * 0.15, -13, w * 0.7, 13);
              ctx.fillRect(w * 0.38, -21, w * 0.24, 8); break;
      case 4:
        ctx.beginPath();
        ctx.moveTo(-2, 0); ctx.lineTo(w / 2, -13); ctx.lineTo(w + 2, 0);
        ctx.closePath(); ctx.fill(); break;
      case 5:
        ctx.beginPath();
        ctx.ellipse(w / 2, 0, w * 0.42, 13, 0, Math.PI, 0);
        ctx.fill(); break;
      case 6:
        ctx.fillRect(w * 0.42, -22, w * 0.16, 22);
        ctx.beginPath();
        ctx.moveTo(w * 0.42, -22); ctx.lineTo(w / 2, -34); ctx.lineTo(w * 0.58, -22);
        ctx.closePath(); ctx.fill(); break;
      case 7: ctx.fillRect(-4, -7, w + 8, 7); break;
    }
    // A pale edge where the light comes from, and a touch of haze overall.
    ctx.fillStyle = this.rgba(this.shade(col, 22), 0.55);
    ctx.fillRect(w - 3.5, 0, 3.5, h);
    ctx.fillStyle = "rgba(255,255,255,0.05)";
    ctx.fillRect(0, 0, w, 2);
  },

  // The near band is architecture: a wall, a window grid, a capped roof, and
  // one piece of roof furniture so no two blocks read the same.
  paintNearBlock(ctx, z, A, v, w, h) {
    const wall = z.near;
    const P = this.pen(ctx, 14, wall);
    const trim = A.roofTrim;

    ctx.fillStyle = wall;
    ctx.fillRect(0, 0, w, h);
    this.vband(ctx, 0, 0, w * 0.32, h, "rgba(0,0,0,0.17)", "rgba(0,0,0,0.05)");
    ctx.fillStyle = "rgba(255,255,255,0.07)";
    ctx.fillRect(w - 5, 0, 5, h);

    // A window grid is what makes a wall read as a building rather than as a
    // stack of things; a minority are lit so it is a grid and not a pattern.
    const cols = 3, rowH = 11;
    const rows = Math.max(1, Math.floor((h - 10) / rowH));
    const cw = (w - 10) / cols;
    for (let r = 0; r < rows; r++) {
      for (let cc = 0; cc < cols; cc++) {
        const lit = GK.util.hash2(v * 131 + r * 17 + cc, 41) < 0.34;
        const x = 5 + cc * cw, y = 7 + r * rowH;
        ctx.fillStyle = lit ? z.window : A.glass;
        ctx.fillRect(x, y, cw - 3.5, 6.5);
        if (lit) {
          ctx.globalAlpha = 0.3;
          this.softBlob(ctx, x + cw * 0.3, y + 3, 7, 6, this.rgba(z.window, 0.8));
          ctx.globalAlpha = 1;
        }
      }
    }

    ctx.fillStyle = z.roof;
    ctx.fillRect(-2.5, 0, w + 5, 5);
    ctx.fillStyle = "rgba(0,0,0,0.26)";
    ctx.fillRect(-2.5, 5, w + 5, 1.6);
    ctx.fillStyle = this.rgba(this.shade(z.roof, 34), 0.8);
    ctx.fillRect(-2.5, 0, w + 5, 1.2);

    switch (v) {
      case 0: {                                           // shopfront awning
        ctx.fillStyle = A.neon;
        ctx.globalAlpha = 0.85;
        ctx.beginPath();
        ctx.moveTo(2, h - 13); ctx.lineTo(w - 2, h - 13);
        ctx.lineTo(w - 5, h - 7); ctx.lineTo(5, h - 7);
        ctx.closePath(); ctx.fill();
        ctx.globalAlpha = 1;
        break;
      }
      case 1:                                             // air-conditioning
        P.box(4, -6, 9, 6, trim, 1.5);
        P.box(w - 15, -5, 8, 5, trim, 1.5);
        break;
      case 2: {                                           // water tower
        const tx = w * 0.5;
        P.limb(function () { ctx.moveTo(tx - 5, 0); ctx.lineTo(tx - 3.5, -8); }, 1.3, trim);
        P.limb(function () { ctx.moveTo(tx + 5, 0); ctx.lineTo(tx + 3.5, -8); }, 1.3, trim);
        P.box(tx - 6.5, -17, 13, 10, A.kerb, 2);
        P.poly([[tx - 7.5, -17], [tx, -23], [tx + 7.5, -17]], trim);
        break;
      }
      case 3: {                                           // aerial mast
        const mx = w * 0.68;
        P.limb(function () { ctx.moveTo(mx, 0); ctx.lineTo(mx, -15); }, 1.2, trim);
        ctx.strokeStyle = trim; ctx.lineWidth = 0.7;
        for (let i = 1; i <= 3; i++) {
          ctx.beginPath();
          ctx.moveTo(mx - 3, -i * 4); ctx.lineTo(mx + 3, -i * 4);
          ctx.stroke();
        }
        ctx.fillStyle = "#ff5a5a";
        ctx.beginPath(); ctx.arc(mx, -16.5, 1.5, 0, 6.2832); ctx.fill();
        break;
      }
      case 4:                                             // lit sign board
        P.box(3, -13, w - 6, 11, trim, 1.5);
        ctx.globalAlpha = 0.9;
        ctx.fillStyle = A.neon;
        for (let i = 0; i < 3; i++) ctx.fillRect(6, -10.5 + i * 3.2, (w - 12) * (0.9 - i * 0.22), 1.6);
        ctx.globalAlpha = 0.28;
        this.softBlob(ctx, w / 2, -7.5, w * 0.7, 12, this.rgba(A.neon, 0.9));
        ctx.globalAlpha = 1;
        break;
      case 5:                                             // spire
        P.poly([[w * 0.42, 0], [w / 2, -20], [w * 0.58, 0]], trim);
        ctx.fillStyle = A.neon;
        ctx.beginPath(); ctx.arc(w / 2, -20.5, 1.8, 0, 6.2832); ctx.fill();
        break;
      case 6:                                             // pitched house roof
        P.poly([[-4, 1], [w / 2, -12], [w + 4, 1]], z.roof);
        ctx.fillStyle = "rgba(255,255,255,0.12)";
        ctx.beginPath();
        ctx.moveTo(w / 2, -12); ctx.lineTo(w + 4, 1); ctx.lineTo(w / 2, 1);
        ctx.closePath(); ctx.fill();
        break;
      case 7:                                             // stepped parapet
        ctx.fillStyle = z.roof;
        ctx.fillRect(0, -5, w * 0.3, 5);
        ctx.fillRect(w * 0.7, -5, w * 0.3, 5);
        ctx.fillRect(w * 0.4, -9, w * 0.2, 9);
        break;
    }
  },

  // Two parallax bands of baked blocks. Offsets come from the camera and the
  // profile from a positional hash, so the skyline is stable as the camera
  // moves and identical on every device.
  paintSkyline(ctx, zone, cam, box, s) {
    const self = this;
    const band = function (speed, step, bi, alpha) {
      const off = cam * speed;
      const first = Math.floor((off + box.L) / step) - 1;
      const last = Math.ceil((off + box.R) / step) + 1;
      ctx.globalAlpha = alpha;
      for (let i = first; i <= last; i++) {
        const v = Math.floor(GK.util.hash2(i, bi === 0 ? 3 : 7) * 997) % 8;
        const sp = self.buildingSprite(zone, bi, v, s);
        const base = bi === 0 ? GROUND_Y - 5 : GROUND_Y;
        ctx.drawImage(sp.c, i * step - off - sp.ox, base - sp.h - sp.oy, sp.lw, sp.lh);
      }
      ctx.globalAlpha = 1;
    };
    band(0.18, 46, 0, 0.9);
    band(0.42, 38, 1, 1);
  },

  /* ----------------------------- the street ----------------------------- */
  // One length of road, baked at device resolution and blitted along the
  // bottom. The tile is 192 logical px so the seams land exactly where they
  // always did (every 32), and its furniture is hash-placed inside the tile so
  // the repeat does not read as a pattern.
  STREET_TILE: 192,

  streetTile(zone, h, s) {
    const key = zone.id + "|" + Math.round(h) + "|" + Math.round(s * 8);
    if (this._streetKey === key && this._street) return this._street;
    const A = this.art(zone);
    const W = this.STREET_TILE;
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.ceil(W * s));
    c.height = Math.max(1, Math.ceil(h * s));
    const cx = c.getContext("2d");
    cx.setTransform(s, 0, 0, s, 0, 0);
    this.paintStreet(cx, zone, A, W, h);
    this._streetKey = key;
    this._street = c;
    return c;
  },

  // y is measured from GROUND_Y down, so 0 is the kerb line the alien runs on.
  paintStreet(ctx, z, A, W, h) {
    ctx.fillStyle = z.ground;
    ctx.fillRect(0, 0, W, 10);
    this.vband(ctx, 0, 10, W, h, z.groundDark, this.shade(z.groundDark, -22));

    // The kerb is the most important line in the picture, because it is what
    // the alien's feet are on: a bright lip over a dark underside.
    ctx.fillStyle = A.kerb;
    ctx.fillRect(0, 0, W, 2.2);
    ctx.fillStyle = this.rgba(A.kerbLip, 0.9);
    ctx.fillRect(0, 2.2, W, 1.4);
    ctx.fillStyle = "rgba(0,0,0,0.22)";
    ctx.fillRect(0, 10, W, 2);

    // Pavement seams: these scroll at camera speed and sell the pace better
    // than anything else in the frame.
    ctx.fillStyle = z.path;
    for (let x = 0; x < W; x += 32) ctx.fillRect(x, 3.8, 16, 2.6);

    // Road texture at two sizes, because one size reads as either stripes or
    // as grit and never as tarmac.
    for (let i = 0; i < 26; i++) {
      const hx = GK.util.hash2(i, 51) * W, hy = 14 + GK.util.hash2(i, 53) * (h - 18);
      ctx.globalAlpha = 0.1 + GK.util.hash2(i, 55) * 0.14;
      ctx.fillStyle = this.shade(z.groundDark, 26);
      ctx.fillRect(hx, hy, 5 + GK.util.hash2(i, 57) * 12, 1.4);
    }
    for (let i = 0; i < 40; i++) {
      const hx = GK.util.hash2(i, 61) * W, hy = 13 + GK.util.hash2(i, 63) * (h - 16);
      ctx.globalAlpha = 0.12;
      ctx.fillStyle = i % 2 ? "#000000" : this.shade(z.groundDark, 40);
      ctx.fillRect(hx, hy, 2, 1);
    }
    ctx.globalAlpha = 1;

    if (h > 34) {
      ctx.globalAlpha = 0.45;
      ctx.fillStyle = A.kerb;
      for (let x = 6; x < W; x += 40) ctx.fillRect(x, 31, 20, 2);
      ctx.globalAlpha = 1;
    }
    this.streetFurniture(ctx, z, A, W, h);
  },

  // Each zone gets its own objects on the ground, not just its own tint: a
  // recolour is the same place twice, different litter is a different place.
  // Everything here lives BELOW the kerb line, in the 53 logical px the engine
  // never places anything in.
  streetFurniture(ctx, z, A, W, h) {
    const P = this.pen(ctx, 9, A.kerb);
    const at = (i, k) => GK.util.hash2(i * 13 + 7, 71 + k * 9);
    const litter = (n) => {
      ctx.fillStyle = A.litter;
      for (let i = 0; i < n; i++) {
        ctx.globalAlpha = 0.4 + at(i, 1) * 0.3;
        const x = at(i, 2) * W, y = 14 + at(i, 3) * (h - 18);
        const r = 1.4 + at(i, 4) * 2.4;
        ctx.beginPath(); ctx.ellipse(x, y, r, r * 0.45, at(i, 5) * 3, 0, 6.2832); ctx.fill();
      }
      ctx.globalAlpha = 1;
    };

    switch (A.street) {
      case "suburb":
        litter(10);
        ctx.globalAlpha = 0.42;
        ctx.fillStyle = A.kerb;
        for (let x = 4; x < W; x += 11) ctx.fillRect(x, 7.5, 2.2, 5);
        ctx.fillStyle = this.shade(z.ground, -22);
        ctx.fillRect(0, 11.5, W, 1.4);
        ctx.globalAlpha = 1;
        P.box(W * 0.58, 17, 11, 4, this.shade(A.kerbLip, -10), 1);
        ctx.globalAlpha = 0.5;                           // somebody left a ball
        ctx.fillStyle = "#c4513f";
        ctx.beginPath(); ctx.arc(W * 0.24, 27, 2.4, 0, 6.2832); ctx.fill();
        ctx.globalAlpha = 1;
        break;

      case "city":
        litter(12);
        ctx.fillStyle = this.shade(z.groundDark, 22);
        ctx.beginPath(); ctx.ellipse(W * 0.3, 21, 7, 2.8, 0, 0, 6.2832); ctx.fill();
        ctx.strokeStyle = this.shade(z.groundDark, -18); ctx.lineWidth = 0.8;
        ctx.beginPath(); ctx.ellipse(W * 0.3, 21, 5, 1.9, 0, 0, 6.2832); ctx.stroke();
        ctx.fillStyle = this.rgba(A.kerbLip, 0.85);
        for (let i = 0; i < 5; i++) ctx.fillRect(W * 0.66 + i * 2.6, 17, 1.6, 5);
        break;

      case "industry":
        litter(14);
        ctx.fillStyle = this.shade(A.kerb, -16);
        ctx.fillRect(0, 12, W, 3.2);
        ctx.fillStyle = "rgba(0,0,0,0.3)";
        ctx.fillRect(0, 15.2, W, 1);
        ctx.fillStyle = A.kerbLip;
        for (let x = 10; x < W; x += 48) ctx.fillRect(x, 11, 4, 5.4);
        // riveted plates, NOT hazard stripes — see the note above
        ctx.globalAlpha = 0.5;
        ctx.fillStyle = this.shade(z.groundDark, 30);
        for (let x = 0; x < W; x += 26) ctx.fillRect(x, 6, 23, 3.4);
        ctx.globalAlpha = 0.55;
        ctx.fillStyle = this.shade(A.kerbLip, -12);
        for (let x = 6; x < W; x += 26) {
          ctx.beginPath(); ctx.arc(x, 7.7, 0.7, 0, 6.2832); ctx.fill();
          ctx.beginPath(); ctx.arc(x + 12, 7.7, 0.7, 0, 6.2832); ctx.fill();
        }
        ctx.globalAlpha = 0.32;
        ctx.fillStyle = "#0d0a06";
        ctx.beginPath(); ctx.ellipse(W * 0.44, 26, 16, 5, 0, 0, 6.2832); ctx.fill();
        ctx.globalAlpha = 1;
        break;

      case "neon":
        litter(10);
        // Wet asphalt: the neon above smears down it. Capped near the kerb —
        // run full height and on a portrait phone they become 400px of prison
        // bars under the only part of the picture anyone is reading.
        for (let i = 0; i < 7; i++) {
          const x = at(i, 6) * W;
          ctx.globalAlpha = 0.16 + at(i, 7) * 0.12;
          ctx.fillStyle = i % 2 ? A.neon : z.window;
          ctx.fillRect(x, 13, 2.6 + at(i, 8) * 3, Math.min(h - 15, 54));
        }
        ctx.globalAlpha = 1;
        ctx.fillStyle = "rgba(0,0,0,0.3)";
        ctx.beginPath(); ctx.ellipse(W * 0.36, 24, 19, 5.5, 0, 0, 6.2832); ctx.fill();
        ctx.globalAlpha = 0.4;
        this.softBlob(ctx, W * 0.36, 23, 17, 5, this.rgba(A.neon, 0.8));
        ctx.globalAlpha = 1;
        ctx.strokeStyle = "rgba(0,0,0,0.45)"; ctx.lineWidth = 0.9;
        ctx.beginPath(); ctx.moveTo(0, 7); ctx.quadraticCurveTo(W / 2, 11, W, 7); ctx.stroke();
        break;

      case "port":
        litter(8);
        ctx.fillStyle = this.rgba(A.kerb, 0.6);
        for (let x = 0; x < W; x += 64) ctx.fillRect(x, 12, 61, 0.9);
        for (let x = 16; x < W; x += 32) {
          ctx.globalAlpha = 0.85;
          this.softBlob(ctx, x, 19, 7, 4, this.rgba(A.neon, 0.9));
          ctx.fillStyle = A.neon;
          ctx.beginPath(); ctx.arc(x, 19, 1.3, 0, 6.2832); ctx.fill();
          ctx.globalAlpha = 1;
        }
        ctx.strokeStyle = "rgba(255,255,255,0.07)"; ctx.lineWidth = 0.8;
        for (let x = 0; x < W; x += 24) {
          ctx.beginPath(); ctx.moveTo(x, 12); ctx.lineTo(x, Math.min(h, 58)); ctx.stroke();
        }
        break;
    }
  },

  paintGround(ctx, zone, cam, box, s) {
    const h = Math.max(28, box.B - GROUND_Y);
    const tile = this.streetTile(zone, h, s);
    const W = this.STREET_TILE;
    const off = ((cam % W) + W) % W;
    const bleed = 0.5 / s;                     // half a DEVICE pixel, either side
    for (let x = box.L - off - W; x < box.R + W; x += W) {
      ctx.drawImage(tile, x - bleed, GROUND_Y, W + bleed * 2, h);
    }
  },

  /* ------------------------------ rooftops ------------------------------ */
  // A platform is gameplay: running off the end drops you, so its top edge has
  // to be the crispest line in the picture. Bright lip, hard shadow under it,
  // bright end caps so the edge is visible from a long way off, and a face
  // regular enough to read as architecture rather than as a row of things that
  // might be edible.
  paintPlatform(ctx, zone, pl, x) {
    const A = this.art(zone);
    const h = GROUND_Y - pl.y;
    ctx.fillStyle = zone.wall;
    ctx.fillRect(x + 2, pl.y + 6, pl.w - 4, h - 6);
    this.vband(ctx, x + 2, pl.y + 6, pl.w - 4, GROUND_Y,
      "rgba(0,0,0,0.05)", "rgba(0,0,0,0.42)");

    const rows = Math.floor((h - 20) / 17);
    const frame = this.rgba(A.roofTrim, 0.55);
    for (let i = 8; i < pl.w - 12; i += 20) {
      for (let r = 0; r < rows; r++) {
        const lit = GK.util.hash2(Math.round(pl.x) + i * 7 + r * 3, 43) < 0.4;
        const wy = pl.y + 15 + r * 17;
        ctx.fillStyle = frame;
        ctx.fillRect(x + i - 1, wy - 1, 9, 11);
        ctx.fillStyle = lit ? zone.window : A.glass;
        ctx.fillRect(x + i, wy, 7, 9);
        if (lit) {
          ctx.globalAlpha = 0.22;
          this.softBlob(ctx, x + i + 3.5, wy + 4.5, 8, 8, this.rgba(zone.window, 0.9));
          ctx.globalAlpha = 1;
        }
      }
    }

    ctx.fillStyle = zone.roof;
    ctx.fillRect(x - 2, pl.y, pl.w + 4, 7);
    ctx.fillStyle = this.rgba(this.shade(zone.roof, 46), 0.95);
    ctx.fillRect(x - 2, pl.y, pl.w + 4, 1.6);
    ctx.fillStyle = "rgba(0,0,0,0.34)";
    ctx.fillRect(x - 2, pl.y + 7, pl.w + 4, 2.4);
    ctx.fillStyle = this.rgba(A.kerb, 0.55);
    ctx.fillRect(x - 2, pl.y, 2.2, 7);
    ctx.fillRect(x + pl.w - 0.2, pl.y, 2.2, 7);
  },
});

/* =========================================================================
   CHARACTERS

   The whole game is one question — "food or metal?" — asked at up to 210 px/s
   in five palettes, two of which are nearly black. Colour alone cannot carry
   that, so food and metal are separated THREE ways at once:

     SILHOUETTE  humans are round-headed, soft-limbed and lean forward;
                 robots are flat-topped, hard-edged and symmetrical.
     PATTERN     every robot wears a diagonal hazard chevron. No human ever
                 does. A stripe survives colourblindness and a dim iPad in
                 sunlight in a way that red-versus-yellow does not.
     LIGHT       robots have one glowing eye band, humans have two white eyes
                 looking back at you.

   A fourth cue is reserved for one mechanic: only the Patrol Bot carries a
   bolted CRUSH PLATE on its head, and the crush plate means "this is the one
   the dive-slam destroys". Nothing else in the game has one.
   ========================================================================= */
Object.assign(Art, {

  /* ------------------------------- humans ------------------------------- */
  // Drawn around the entity's centre, with the feet at +h/2. `st` carries only
  // things the engine already tracks: the entity clock, whether it is fleeing,
  // and whether the tractor beam has hold of it.
  paintHuman(ctx, type, st) {
    const spec = HUMANS[type];
    const h = spec.h, w = spec.w;
    const mo = this.motion;
    const t = st.t || 0;
    const panic = st.fleeing || st.pulled;
    const P = this.pen(ctx, h * 0.42, spec.shirt);
    const skinP = this.pen(ctx, h * 0.42, spec.skin);

    // Legs scissor faster when fleeing — a jogger has to read as "catch me"
    // from the far edge of the screen.
    const rate = st.fleeing ? 15 : type === "kid" ? 2.2 : 6.5;
    const amp = (st.fleeing ? 1 : type === "kid" ? 0.35 : 0.6) * mo;
    const sw = Math.sin(t * rate) * amp;
    const bob = Math.abs(Math.sin(t * rate)) * (type === "kid" ? 0.2 : 0.8) * mo;

    ctx.save();
    ctx.translate(0, -bob);
    // Everyone runs away to the right with their head turned back to the left,
    // so the whole body leans. The jogger leans hardest.
    const lean = type === "runner" ? (st.fleeing ? 0.3 : 0.14) : type === "chonk" ? -0.04 : 0.06;
    ctx.rotate(lean * 0.5);

    // Roughly a third head, a third torso, a third leg. The head sits ABOVE
    // the shoulder line rather than inside it, which is what stopped the first
    // version reading as a head at all.
    const hipY = h * 0.1, footY = h * 0.5, shoulderY = -h * 0.17;
    const headR = type === "chonk" ? 4.5 : type === "kid" ? 3.2 : 3.7;
    const headY = -h * 0.5 + headR * 1.02;

    // far leg, then body, then near leg: on a flat side-on character that draw
    // order is the whole of the depth, and getting it wrong is why a runner can
    // look like it has one stubby leg.
    const legW = Math.max(0.9, w * 0.1);
    P.ribbon(-w * 0.09, hipY, -w * 0.09 - sw * 1.4, (hipY + footY) / 2,
      -w * 0.13 - sw * 2.4, footY, legW, legW * 0.78, this.shade(spec.pants, -18));
    // trailing foot
    P.ell(-w * 0.13 - sw * 2.4, footY + 0.5, legW * 1.5, legW * 0.85,
      this.shade(spec.pants, -34), 0, false);

    // torso
    if (type === "chonk") {
      P.ell(0, hipY - h * 0.15, w * 0.46, h * 0.28, spec.shirt);
      P.ell(0, hipY - h * 0.23, w * 0.26, h * 0.09, this.rgba(P.hi, 0.5), 0, false);
    } else {
      P.box(-w * 0.36, shoulderY, w * 0.72, hipY - shoulderY + 2, spec.shirt, w * 0.26);
      P.ell(-w * 0.1, shoulderY + h * 0.09, w * 0.17, h * 0.09, this.rgba(P.hi, 0.45), 0, false);
    }
    // shorts / skirt over the hip join
    P.box(-w * 0.33, hipY - 1, w * 0.66, h * 0.16, spec.pants, w * 0.22);

    // near leg
    P.ribbon(w * 0.11, hipY, w * 0.11 + sw * 1.4, (hipY + footY) / 2,
      w * 0.15 + sw * 2.4, footY, legW, legW * 0.78, spec.pants);
    P.ell(w * 0.15 + sw * 2.4, footY + 0.5, legW * 1.55, legW * 0.9,
      this.shade(spec.pants, -26), 0, false);

    // arms: the far one behind the body, the near one in front and pumping
    const armW = Math.max(0.75, w * 0.07);
    const handL = [-w * 0.4 + sw * 1.6, shoulderY + h * 0.26];
    const handR = [w * 0.42 - sw * 1.6, shoulderY + h * 0.26];
    skinP.ribbon(-w * 0.26, shoulderY + 1, -w * 0.38 + sw, shoulderY + h * 0.14,
      handL[0], handL[1], armW, armW * 0.75, this.shade(spec.skin, -16));
    skinP.ribbon(w * 0.28, shoulderY + 1, w * 0.4 - sw, shoulderY + h * 0.14,
      handR[0], handR[1], armW, armW * 0.78, spec.skin);

    // whatever they were carrying before the alien turned up
    switch (type) {
      case "walker":                                     // a briefcase
        P.box(handL[0] - 2.8, handL[1], 5.6, 4.2, "#6b4a2c", 1);
        ctx.fillStyle = "rgba(255,255,255,0.22)";
        ctx.fillRect(handL[0] - 2.2, handL[1] + 1, 4.4, 0.8);
        break;
      case "chonk":                                      // lunch, obviously
        P.ell(handR[0], handR[1], 3.2, 2.4, "#f0c066");
        ctx.fillStyle = "#b5513c";
        ctx.fillRect(handR[0] - 2.5, handR[1] - 0.4, 5, 1.1);
        ctx.fillStyle = "#7fc06a";
        ctx.fillRect(handR[0] - 2.1, handR[1] + 0.6, 4.2, 0.7);
        break;
      case "kid":                                        // an ice cream
        P.poly([[handR[0] - 1.3, handR[1]], [handR[0] + 1.3, handR[1]],
                [handR[0], handR[1] + 3]], "#d8a45c");
        P.ell(handR[0], handR[1] - 1.2, 1.9, 1.8, "#ffd6ea");
        break;
      case "runner":                                     // a ponytail, trailing
        skinP.ribbon(-headR * 0.75, headY - headR * 0.1, -headR * 1.35 - sw * 0.6,
          headY - headR * 0.35, -headR * 1.7 - sw, headY + headR * 0.45,
          Math.max(0.7, headR * 0.24), 0.35, "#5a3a24");
        break;
    }

    // head
    skinP.ell(0, headY, headR, headR * (type === "chonk" ? 0.98 : 0.94), spec.skin);
    if (type === "chonk") {
      skinP.ell(0, headY + headR * 0.7, headR * 0.62, headR * 0.3,
        this.shade(spec.skin, -10), 0, false);          // a comfortable chin
    }
    // hair / hat, which is most of what tells the four snacks apart at a glance
    const hair = type === "kid" ? "#3f6fbf" : type === "runner" ? "#5a3a24"
               : type === "chonk" ? "#b08a56" : "#3a2a1e";
    if (type === "kid") {                                // a baseball cap
      P.box(-headR, headY - headR * 1.05, headR * 2, headR * 0.82, hair, headR * 0.4);
      ctx.fillStyle = this.shade(hair, -20);
      ctx.fillRect(-headR * 1.9, headY - headR * 0.42, headR * 1.1, 1.3);
    } else if (type === "runner") {                      // a headband
      ctx.fillStyle = "#ff5ad1";
      ctx.fillRect(-headR * 1.02, headY - headR * 0.5, headR * 2.04, 1.7);
      P.ell(headR * 0.14, headY - headR * 0.72, headR * 0.92, headR * 0.48, hair, 0, false);
    } else {
      P.ell(headR * 0.16, headY - headR * 0.4, headR * 0.95, headR * 0.6, hair, 0, false);
      P.ell(headR * 0.72, headY - headR * 0.02, headR * 0.34, headR * 0.5, hair, 0, false);
    }

    // The face always looks BACK at you, which is half the comedy and all of
    // the "this one is food" signal.
    const look = -0.85;
    const eyeR = Math.max(0.9, headR * 0.33);
    P.eye(-headR * 0.45, headY + headR * 0.08, eyeR, look, 0);
    if (headR > 3.4) P.eye(headR * 0.22, headY + headR * 0.06, eyeR * 0.72, look, 0);
    // one brow, raised in alarm, over the eye that is actually facing you
    ctx.strokeStyle = this.shade(hair, -20);
    ctx.lineWidth = Math.max(0.5, headR * 0.18);
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(-headR * 0.88, headY - headR * 0.32 - (panic ? 0.9 : 0));
    ctx.lineTo(-headR * 0.06, headY - headR * 0.46 - (panic ? 1.2 : 0));
    ctx.stroke();
    // mouth: a shout when fleeing, a line otherwise
    if (panic) {
      P.ell(-headR * 0.32, headY + headR * 0.55, headR * 0.26, headR * 0.32, "#3a1020", 0, false);
    } else {
      ctx.strokeStyle = "#8a5a4a";
      ctx.lineWidth = Math.max(0.45, headR * 0.15);
      ctx.beginPath();
      ctx.moveTo(-headR * 0.55, headY + headR * 0.52);
      ctx.lineTo(-headR * 0.05, headY + headR * 0.56);
      ctx.stroke();
    }

    // Warm rim light down the lit side. Every human gets it and no robot does,
    // so "food" has a consistent glow even in the Spaceport.
    ctx.globalAlpha = 0.3;
    this.softBlob(ctx, w * 0.34, (shoulderY + hipY) / 2, w * 0.22, h * 0.2,
      "rgba(255,236,190,0.9)");
    ctx.globalAlpha = 1;
    ctx.restore();

    // The alarm mark, drawn rather than typed: a system font "!" rendered at
    // 9px is a different weight on every platform and cannot be animated.
    if (panic) this.shock(ctx, w * 0.55, -h * 0.62, 1 + Math.sin(t * 12) * 0.12 * mo);
  },

  // A small white "!" in a burst — the one piece of punctuation in the game.
  shock(ctx, x, y, k) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(k, k);
    ctx.globalAlpha = 0.35;
    this.softBlob(ctx, 0, 0, 5, 5, "rgba(255,255,255,0.9)");
    ctx.globalAlpha = 1;
    ctx.fillStyle = "#fff6c8";
    ctx.beginPath();
    ctx.moveTo(-0.95, -3.4); ctx.lineTo(0.95, -3.4);
    ctx.lineTo(0.5, 0.9); ctx.lineTo(-0.5, 0.9);
    ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.arc(0, 2.5, 0.95, 0, 6.2832); ctx.fill();
    ctx.restore();
  },

  /* ------------------------------- robots ------------------------------- */
  // The hazard chevron. Clipped to the chassis it is painted on, so it reads as
  // paint rather than as an overlay, and it is the cue that survives when the
  // Neon District has dropped every colour in the picture by two stops.
  chevrons(ctx, x, y, w, h, light, dark) {
    ctx.save();
    this.rr(ctx, x, y, w, h, 1);
    ctx.clip();
    ctx.fillStyle = dark;
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = light;
    for (let i = -h; i < w + h; i += 4.4) {
      ctx.beginPath();
      ctx.moveTo(x + i, y + h);
      ctx.lineTo(x + i + 2.2, y + h);
      ctx.lineTo(x + i + 2.2 + h, y);
      ctx.lineTo(x + i + h, y);
      ctx.closePath(); ctx.fill();
    }
    ctx.restore();
  },

  paintRobot(ctx, type, st) {
    const spec = ROBOTS[type];
    const edible = !!st.edible;
    const body = edible ? "#ff8fe0" : spec.body;
    const trim = edible ? "#c22a97" : spec.trim;
    const eyeC = edible ? "#ffffff" : spec.eye;
    const t = st.t || 0, mo = this.motion;
    const w = spec.w, h = spec.h;
    const P = this.pen(ctx, h * 0.4, body);

    if (edible) {
      // Mega Chomp is the one time metal is food, so it gets the same warm
      // bloom the snacks have — and it is a bloom, not a stroked rectangle.
      ctx.globalAlpha = 0.5 + 0.25 * Math.sin(t * 9) * mo;
      this.softBlob(ctx, 0, 0, w * 1.1, h * 0.8, "rgba(255,90,209,0.85)");
      ctx.globalAlpha = 1;
    }

    if (spec.fly) {
      // ---- drone: a saucer with a rotor, landing skids and a scan light ----
      const tilt = Math.sin(t * 2.2) * 0.07 * mo;
      ctx.rotate(tilt);
      // rotor blur above, drawn first so the hull sits over it
      ctx.globalAlpha = 0.5;
      ctx.strokeStyle = trim;
      ctx.lineWidth = 1.1;
      const spin = t * 18 * mo;
      for (let i = 0; i < 2; i++) {
        const a = spin + i * 1.57;
        ctx.beginPath();
        ctx.ellipse(0, -h * 0.52, w * 0.52 * Math.abs(Math.cos(a)), 1.1, 0, 0, 6.2832);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      P.limb(function () { ctx.moveTo(0, -h * 0.5); ctx.lineTo(0, -h * 0.18); }, 1.4, trim);
      // hull
      P.ell(0, 0, w * 0.5, h * 0.42, body);
      P.ell(-w * 0.1, -h * 0.14, w * 0.26, h * 0.16, this.rgba(P.hi, 0.6), 0, false);
      // canopy dome with the eye inside it, sweeping
      P.ell(0, -h * 0.22, w * 0.26, h * 0.26, this.shade(body, -12));
      ctx.fillStyle = eyeC;
      ctx.beginPath();
      ctx.arc(Math.sin(t * 3) * w * 0.12, -h * 0.22, Math.max(1, w * 0.1), 0, 6.2832);
      ctx.fill();
      ctx.globalAlpha = 0.5;
      this.softBlob(ctx, Math.sin(t * 3) * w * 0.12, -h * 0.22, 4.5, 4.5, this.rgba(eyeC, 0.9));
      ctx.globalAlpha = 1;
      // hazard band across the belly
      this.chevrons(ctx, -w * 0.38, h * 0.12, w * 0.76, 3, edible ? "#ffd7f2" : "#ffd93b",
        edible ? "#8c1f6a" : "#2a2218");
      // skids
      P.limb(function () { ctx.moveTo(-w * 0.3, h * 0.34); ctx.lineTo(-w * 0.36, h * 0.52); }, 1.1, trim);
      P.limb(function () { ctx.moveTo(w * 0.3, h * 0.34); ctx.lineTo(w * 0.36, h * 0.52); }, 1.1, trim);
      // the scan light under it: the drone is looking for YOU
      ctx.globalAlpha = 0.16 + 0.08 * Math.sin(t * 5) * mo;
      ctx.fillStyle = eyeC;
      ctx.beginPath();
      ctx.moveTo(-w * 0.16, h * 0.4); ctx.lineTo(w * 0.16, h * 0.4);
      ctx.lineTo(w * 0.46, h * 0.4 + 13); ctx.lineTo(-w * 0.46, h * 0.4 + 13);
      ctx.closePath(); ctx.fill();
      ctx.globalAlpha = 1;
      return;
    }

    const tall = type === "mech";
    const step = Math.sin(t * (tall ? 3.4 : 6)) * (tall ? 1.1 : 1.6) * mo;
    const top = -h / 2, bot = h / 2;

    // treads (patrol) or legs (mech)
    if (tall) {
      for (const sgn of [-1, 1]) {
        P.limb(function () {
          ctx.moveTo(sgn * w * 0.22, h * 0.1);
          ctx.quadraticCurveTo(sgn * w * 0.3 + step * sgn, h * 0.3, sgn * w * 0.26, bot - 1.5);
        }, Math.max(2, w * 0.16), trim);
        P.box(sgn * w * 0.26 - 3.2, bot - 2.6, 6.4, 2.8, this.shade(trim, -14), 1);
      }
    } else {
      P.box(-w * 0.52, bot - 5.4, w * 1.04, 5.4, trim, 1.8);
      ctx.fillStyle = this.rgba(this.shade(trim, 40), 0.7);
      for (let i = 0; i < 4; i++) ctx.fillRect(-w * 0.44 + i * w * 0.26, bot - 4.4, w * 0.14, 3.4);
      // the wheels inside the tread, turning
      ctx.fillStyle = this.shade(trim, -26);
      for (const sgn of [-1, 1]) {
        ctx.beginPath();
        ctx.arc(sgn * w * 0.24, bot - 2.7, 1.5, 0, 6.2832); ctx.fill();
      }
    }

    // chassis
    const cyTop = top + (tall ? 7 : 4.5);
    const cyBot = bot - (tall ? h * 0.42 : 5.4);
    P.box(-w / 2, cyTop, w, cyBot - cyTop, body, tall ? 3 : 2.4);
    // lit edge and a panel seam, so it reads as bent metal
    ctx.fillStyle = this.rgba(P.hi, 0.45);
    ctx.fillRect(w / 2 - 2.2, cyTop + 1.4, 1.8, cyBot - cyTop - 3);
    ctx.strokeStyle = this.rgba(this.shade(body, -40), 0.7);
    ctx.lineWidth = 0.6;
    ctx.beginPath();
    ctx.moveTo(-w * 0.4, cyTop + (cyBot - cyTop) * 0.55);
    ctx.lineTo(w * 0.4, cyTop + (cyBot - cyTop) * 0.55);
    ctx.stroke();
    // bolts
    ctx.fillStyle = this.rgba(this.shade(body, -46), 0.8);
    for (const sgn of [-1, 1]) {
      ctx.beginPath(); ctx.arc(sgn * (w / 2 - 2.6), cyTop + 2.6, 0.8, 0, 6.2832); ctx.fill();
    }

    // arms / pistons, swinging out of phase
    if (tall) {
      for (const sgn of [-1, 1]) {
        // a pauldron that overhangs the chassis, then the arm under it
        P.limb(function () {
          ctx.moveTo(sgn * (w / 2 + 1), cyTop + 7);
          ctx.lineTo(sgn * (w / 2 + 2.5), cyTop + 19 + step * sgn);
        }, 2.8, this.shade(body, -16));
        P.poly([[sgn * (w / 2 - 3), cyTop - 1], [sgn * (w / 2 + 4.5), cyTop + 2],
                [sgn * (w / 2 + 3.5), cyTop + 8], [sgn * (w / 2 - 3), cyTop + 7]],
          this.shade(body, 12));
        ctx.fillStyle = this.rgba(trim, 0.8);
        ctx.fillRect(sgn * (w / 2 - 1) - (sgn < 0 ? 3.4 : 0), cyTop + 2.4, 3.4, 1.4);
      }
    } else {
      for (const sgn of [-1, 1]) {
        P.box(sgn * (w / 2 + 0.4) - (sgn < 0 ? 2.6 : 0), cyTop + 3 + step * sgn,
          2.6, h * 0.38, trim, 1);
      }
    }

    // the hazard chevron, the one pattern no snack ever wears
    this.chevrons(ctx, -w * 0.44, cyBot - 4.6, w * 0.88, 3.4,
      edible ? "#ffd7f2" : tall ? "#ffb02e" : "#ffd93b", edible ? "#8c1f6a" : "#2a2218");

    // head + eye band
    const hw = tall ? w * 0.62 : w * 0.84;
    P.box(-hw / 2, top + (tall ? 0.6 : 0), hw, tall ? 7.4 : 5.2, this.shade(body, 8), 1.8);
    ctx.fillStyle = eyeC;
    const ey = top + (tall ? 3.4 : 2.2);
    ctx.fillRect(-hw / 2 + 1.6, ey, hw - 3.2, tall ? 2.4 : 1.9);
    ctx.globalAlpha = 0.4 + 0.25 * Math.sin(t * 4) * mo;
    this.softBlob(ctx, 0, ey + 1, hw * 0.8, 5, this.rgba(eyeC, 0.9));
    ctx.globalAlpha = 1;

    if (tall) {
      // a stack puffing smoke: the mech is the only thing in the game you can
      // hear coming, and it should look like it too
      P.box(-w * 0.42, top - 3.5, 4.4, 5, trim, 1);
      ctx.globalAlpha = 0.22;
      for (let i = 0; i < 3; i++) {
        const k = ((t * 0.5 + i * 0.33) % 1);
        this.softBlob(ctx, -w * 0.36 + k * 4 * mo, top - 5 - k * 14 * mo,
          2.4 + k * 5, 2.4 + k * 5, "rgba(40,30,24,0.9)");
      }
      ctx.globalAlpha = 1;
    } else if (spec.slammable) {
      // THE CRUSH PLATE. Only the slammable robot has one, and the stamped
      // arrow is the whole instruction: land on this.
      P.box(-w * 0.4, top - 2.8, w * 0.8, 3, this.shade(trim, 16), 1);
      ctx.fillStyle = this.rgba("#ffd93b", 0.85);
      ctx.beginPath();
      ctx.moveTo(-2, top - 2.1); ctx.lineTo(2, top - 2.1); ctx.lineTo(0, top - 0.2);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = this.rgba(this.shade(trim, -30), 0.9);
      ctx.beginPath(); ctx.arc(-w * 0.32, top - 1.3, 0.7, 0, 6.2832); ctx.fill();
      ctx.beginPath(); ctx.arc(w * 0.32, top - 1.3, 0.7, 0, 6.2832); ctx.fill();
      // a short antenna, because a silhouette needs something irregular on it
      P.limb(function () {
        ctx.moveTo(w * 0.26, top - 2.8);
        ctx.quadraticCurveTo(w * 0.42, top - 6, w * 0.3, top - 8.5);
      }, 0.9, trim);
      ctx.fillStyle = eyeC;
      ctx.beginPath(); ctx.arc(w * 0.3, top - 9, 1, 0, 6.2832); ctx.fill();
    }
  },

  /* ------------------------- brains and power-ups ----------------------- */
  paintBrain(ctx, st) {
    const t = st.t || 0, mo = this.motion;
    const P = this.pen(ctx, 5, "#ff9fd8");
    ctx.globalAlpha = 0.34 + 0.12 * Math.sin(t * 3) * mo;
    this.softBlob(ctx, 0, 0, 11, 9, "rgba(255,159,216,0.9)");
    ctx.globalAlpha = 1;
    // a brainstem, so it is a brain and not two bubbles
    P.limb(function () { ctx.moveTo(0, 2.6); ctx.lineTo(0.6, 5.4); }, 1.6, "#d98ab8");
    P.ell(-2.4, 0, 4, 3.8, "#ff9fd8");
    P.ell(2.4, 0, 4, 3.8, "#ff9fd8");
    // gyri: two wiggles per lobe is enough to read at 11px
    ctx.strokeStyle = "#d16aa8";
    ctx.lineWidth = 0.7; ctx.lineCap = "round";
    for (const sgn of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(sgn * 1.2, -2.4);
      ctx.quadraticCurveTo(sgn * 4.4, -0.6, sgn * 1.6, 1.8);
      ctx.stroke();
    }
    ctx.fillStyle = "rgba(255,255,255,0.8)";
    ctx.beginPath(); ctx.ellipse(-2.8, -1.8, 1.3, 0.8, -0.4, 0, 6.2832); ctx.fill();
  },

  // A glass sphere with a drawn glyph. The emoji stays in the HUD and the toast
  // where it is family style and instantly readable; here, next to artwork, a
  // system glyph is the one thing on screen that came from somewhere else.
  paintOrb(ctx, type, st) {
    const spec = POWERUPS[type];
    const t = st.t || 0, mo = this.motion;
    const r = 9 + Math.sin(t * 5) * 0.9 * mo;
    ctx.globalAlpha = 0.4 + 0.14 * Math.sin(t * 4) * mo;
    this.softBlob(ctx, 0, 0, r + 9, r + 9, this.rgba(spec.color, 0.85));
    ctx.globalAlpha = 1;

    // a ring tumbling round it, so a power-up is never mistaken for a snack
    ctx.strokeStyle = this.rgba(spec.color, 0.9);
    ctx.lineWidth = 1.1;
    ctx.beginPath();
    ctx.ellipse(0, 0, r + 3, (r + 3) * Math.abs(Math.cos(t * 1.6 * mo)) * 0.8 + 1.4,
      0.3, 0, 6.2832);
    ctx.stroke();

    const P = this.pen(ctx, r, spec.color);
    P.ell(0, 0, r, r, spec.color);
    ctx.globalAlpha = 0.5;
    this.softBlob(ctx, -r * 0.3, -r * 0.35, r * 0.62, r * 0.5, "rgba(255,255,255,0.95)");
    ctx.globalAlpha = 1;

    const ink = this.shade(spec.color, -70);
    ctx.save();
    ctx.fillStyle = ink;
    ctx.strokeStyle = ink;
    ctx.lineWidth = 1.5; ctx.lineCap = "round"; ctx.lineJoin = "round";
    switch (type) {
      case "magnet": {                                   // an inward vortex
        ctx.lineWidth = 1.3;
        for (let i = 0; i < 3; i++) {
          const a0 = t * 2.4 * mo + i * 2.1;
          ctx.beginPath();
          ctx.arc(0, 0, r * 0.36 + i * r * 0.2, a0, a0 + 2.1);
          ctx.stroke();
        }
        break;
      }
      case "shield": {                                   // a shield
        ctx.beginPath();
        ctx.moveTo(0, -r * 0.62);
        ctx.lineTo(r * 0.46, -r * 0.32);
        ctx.quadraticCurveTo(r * 0.46, r * 0.46, 0, r * 0.66);
        ctx.quadraticCurveTo(-r * 0.46, r * 0.46, -r * 0.46, -r * 0.32);
        ctx.closePath();
        ctx.fill();
        break;
      }
      case "frenzy": {                                   // a bolt
        ctx.beginPath();
        ctx.moveTo(r * 0.2, -r * 0.66);
        ctx.lineTo(-r * 0.34, r * 0.08);
        ctx.lineTo(r * 0.02, r * 0.08);
        ctx.lineTo(-r * 0.16, r * 0.66);
        ctx.lineTo(r * 0.4, -r * 0.1);
        ctx.lineTo(r * 0.04, -r * 0.1);
        ctx.closePath();
        ctx.fill();
        break;
      }
      case "snack": {                                    // a drumstick
        // It has to match the toast, which says "🍗 Snack Pack". The two
        // knuckles at the end are the whole difference between a drumstick and
        // a magnifying glass at this size — one round end and a straight bone
        // is an icon for "search".
        ctx.lineWidth = r * 0.2;
        ctx.beginPath();
        ctx.moveTo(-r * 0.1, -r * 0.1); ctx.lineTo(r * 0.42, r * 0.42);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(r * 0.36, r * 0.56, r * 0.17, 0, 6.2832); ctx.fill();
        ctx.beginPath();
        ctx.arc(r * 0.58, r * 0.34, r * 0.17, 0, 6.2832); ctx.fill();
        ctx.beginPath();                                 // the meat
        ctx.moveTo(-r * 0.66, -r * 0.16);
        ctx.quadraticCurveTo(-r * 0.72, -r * 0.72, -r * 0.14, -r * 0.62);
        ctx.quadraticCurveTo(r * 0.3, -r * 0.54, r * 0.06, -r * 0.02);
        ctx.quadraticCurveTo(-r * 0.2, r * 0.3, -r * 0.66, -r * 0.16);
        ctx.closePath();
        ctx.fill();
        break;
      }
    }
    ctx.restore();
  },
});

/* =========================================================================
   THE ALIEN

   She is on screen every frame of every run and she is the thing the player
   IS, so she gets her own painter rather than a share of the generic one. The
   same function draws her in the game, on the splash, on the results screen
   and on every card in the Alien Locker — which is what stops the menus ever
   drifting away from the game.

   The six skins differ in BODY PLAN, not only in colour: skins.js already
   carries an eye count, a leg count and an antenna count, and the painter adds
   a per-skin silhouette on top (a mantle, a crest, a crown, a starfield), so a
   recoloured blob never passes for a different alien.

   `st` is built entirely from state the engine already keeps:
     w, h        the current hitbox (h shrinks when sliding)
     run         runPhase — the scissor clock
     grounded, sliding, vy
     chomp       chompT, which is also the "eyes shut, mouth open" signal
     hurt        hurtT
     combo       worn on her back as one pip per link in the chain
     frenzy      Mega Chomp is up
     t           wall clock, for breathing and blinking only
     mood        "run" | "happy" | "sad" | "hungry" — menus only
   ========================================================================= */
Object.assign(Art, {

  // The warm pool she stands in. This is the single most useful thing in the
  // whole pass: no hide colour reads on grass AND on a near-black spaceport
  // apron, but a light pool reads on both, and it is how a four-year-old finds
  // herself again after looking away.
  paintAlienPool(ctx, x, surfaceY, r) {
    ctx.globalAlpha = 0.5;
    this.softBlob(ctx, x, surfaceY - 3, r * 2.1, r * 0.85, "rgba(255,240,190,0.34)");
    ctx.globalAlpha = 1;
  },

  paintAlien(ctx, sk, st) {
    const mo = this.motion;
    const t = st.t || 0;
    const w = st.w, h = st.h;
    const sliding = !!st.sliding;
    const airborne = !st.grounded && !sliding;
    const chomp = Math.max(0, Math.min(1, (st.chomp || 0) / 0.16));
    const hurt = Math.max(0, Math.min(1, (st.hurt || 0) / 0.4));
    const mood = st.mood || "run";
    const bw = w * (sliding ? 1.2 : 1), bh = h;
    const body = sk.body;
    const P = this.pen(ctx, bh * 0.5, body);

    // breathing, and a small settle as she lands
    ctx.save();
    ctx.translate(0, Math.sin(t * 2.1) * bh * 0.022 * mo);

    if (st.frenzy) {
      // Mega Chomp: three flickering blobs, not a flat ellipse at half alpha.
      for (let i = 0; i < 3; i++) {
        const k = 0.8 + 0.25 * Math.sin(t * (9 + i * 3) + i) * mo;
        ctx.globalAlpha = 0.26;
        this.softBlob(ctx, Math.sin(t * 7 + i * 2) * 2 * mo, -bh * 0.1 - i * 2,
          bw * 0.8 * k, bh * 0.66 * k, "rgba(255,90,209,0.95)");
      }
      ctx.globalAlpha = 1;
    }

    /* ---- tentacle legs: tapered, scissoring, tucked in the air ---------- */
    const legW = Math.max(1, bw * 0.082);
    const legs = sk.legs;
    for (let i = 0; i < legs; i++) {
      const u = legs === 1 ? 0.5 : i / (legs - 1);
      const lx = -bw * 0.34 + u * bw * 0.68;
      const far = u < 0.5;
      const swing = airborne ? -bh * 0.1
        : sliding ? -bh * 0.05 - i * 0.6
        : Math.sin(st.run + i * 1.7) * bh * 0.16 * mo;
      // The body ellipse stops at ~0.32*bh below centre (see below), so a leg
      // has to reach past that or it is drawn entirely inside the body and
      // never appears — which is exactly what the first version did.
      const reach = sliding ? bh * 0.4 : airborne ? bh * 0.36 : bh * 0.52;
      const col = far ? this.shade(body, -22) : sk.dark;
      P.ribbon(lx, bh * 0.12, lx + swing * 1.3, bh * 0.34,
        lx + swing * 0.6 + (sliding ? -bw * 0.34 : 0), reach, legW, legW * 0.34, col);
    }

    /* ---- body ---------------------------------------------------------- */
    // A per-skin mantle behind the body: a silhouette change, which a
    // recolour can never be.
    if (sk.id === "squid" || sk.id === "slime") {
      const hood = this.shade(body, -18);
      P.ell(0, -bh * 0.22, bw * 0.58, bh * 0.3, hood);
      for (let i = -2; i <= 2; i++) {
        P.ell(i * bw * 0.21, bh * 0.01, bw * 0.11, bh * 0.055, hood, 0, false);
      }
    }
    P.ell(0, -bh * 0.06, bw / 2, bh * 0.4, body);
    // volume: one top highlight on the main mass, the same on every character
    P.ell(-bw * 0.1, -bh * 0.24, bw * 0.26, bh * 0.14, this.rgba(P.hi, 0.5), 0, false);
    // belly plate. It keeps a faint rim: several skins pick a belly only a
    // shade off their body, and without an edge the plate simply vanishes.
    P.ell(bw * 0.03, bh * 0.12, bw * 0.29, bh * 0.19, sk.belly, 0, false);
    ctx.globalAlpha = 0.22;
    P.ell(bw * 0.03, bh * 0.12, bw * 0.29, bh * 0.19, "rgba(0,0,0,0)", 0, true);
    ctx.globalAlpha = 1;
    // taking a bite of metal: a wash over her own colour, never instead of it
    if (hurt > 0) {
      ctx.globalAlpha = hurt * 0.55;
      P.ell(0, -bh * 0.06, bw / 2, bh * 0.4, "#ff4040", 0, false);
      ctx.globalAlpha = 1;
    }
    if (sk.id === "void") {
      // the Void Muncher has a sky inside her
      ctx.save();
      ctx.beginPath();
      ctx.ellipse(bw * 0.03, bh * 0.12, bw * 0.29, bh * 0.19, 0, 0, 6.2832);
      ctx.clip();
      ctx.fillStyle = "#d8e8ff";
      for (let i = 0; i < 7; i++) {
        const a = 0.4 + 0.6 * Math.abs(Math.sin(t * 1.6 + i * 1.9));
        ctx.globalAlpha = a;
        ctx.beginPath();
        ctx.arc(bw * (GK.util.hash2(i, 81) - 0.5) * 0.55 + bw * 0.03,
          bh * 0.12 + bh * (GK.util.hash2(i, 83) - 0.5) * 0.32, 0.55, 0, 6.2832);
        ctx.fill();
      }
      ctx.restore();
      ctx.globalAlpha = 1;
    }
    if (sk.id === "overlord") {                       // a crown ridge
      for (let i = -1; i <= 1; i++) {
        P.poly([[i * bw * 0.18 - bw * 0.07, -bh * 0.4],
                [i * bw * 0.18, -bh * 0.56],
                [i * bw * 0.18 + bw * 0.07, -bh * 0.4]], sk.dark);
      }
    }

    /* ---- the chain, worn on her back ----------------------------------- */
    // One glowing pip per link. The HUD already says "x5"; this says it on the
    // character, which is where the player is actually looking.
    const combo = Math.max(0, Math.min(8, (st.combo || 1) - 1));
    if (combo > 0) {
      // Spread around the back rim rather than stacked in a column: eight
      // glows in a 14px line is one pink smear, not a chain of eight.
      for (let i = 0; i < combo; i++) {
        const a = 2.5 + (i / 7) * 2.3;                    // back, from top to tail
        const px = Math.cos(a) * bw * 0.4;
        const py = Math.sin(a) * bh * 0.3 - bh * 0.06;
        ctx.globalAlpha = 0.4 + 0.3 * Math.sin(t * 7 + i) * mo;
        this.softBlob(ctx, px, py, 1.9, 1.9,
          combo >= 4 ? "rgba(255,90,209,0.95)" : "rgba(255,217,59,0.95)");
        ctx.globalAlpha = 1;
        P.ell(px, py, 0.8, 0.8, combo >= 4 ? "#ff5ad1" : "#ffd93b", 0, false);
      }
    }

    /* ---- antennae ------------------------------------------------------ */
    for (let i = 0; i < sk.antennae; i++) {
      const ax = sk.antennae === 1 ? 0 : (i === 0 ? -bw * 0.2 : bw * 0.2);
      // swept back in the air, wobbling on the ground
      const wob = airborne ? -bw * 0.18 : Math.sin(st.run * 0.8 + i) * bw * 0.1 * mo;
      // A stalk that goes straight up is a stem. The lean back and the sideways
      // control point are what make it read as an antenna on a creature that is
      // running forwards.
      const tipX = ax - bw * 0.1 + wob * 1.4, tipY = -bh * 0.76;
      P.ribbon(ax, -bh * 0.42, ax + wob + bw * 0.12, -bh * 0.62, tipX, tipY,
        Math.max(0.8, bw * 0.045), Math.max(0.5, bw * 0.03), sk.dark);
      ctx.globalAlpha = 0.55;
      this.softBlob(ctx, tipX, tipY - 1, 3.6, 3.6, this.rgba(sk.belly, 0.9));
      ctx.globalAlpha = 1;
      P.ell(tipX, tipY - 1, Math.max(0.9, bw * 0.095), Math.max(0.9, bw * 0.095),
        sk.belly, 0, false);
    }

    /* ---- face ---------------------------------------------------------- */
    // Blinking is free personality; the eyes also shut on every bite, which is
    // what makes a chomp read as a chomp and not as a mouth opening.
    const blink = mood === "happy" ? 2 : chomp > 0.3 ? 1 : ((t * 0.31) % 1 > 0.962 ? 1 : 0);
    const sad = mood === "sad" ? 1 : 0;
    // She looks where she is going: forward while running, down on a slam,
    // back over her shoulder when she has just eaten metal.
    const look = mood === "sad" ? -0.3 : hurt > 0 ? -0.9 : st.vy > 300 ? 0.2 : 0.7;
    const eyeY = -bh * 0.14;
    for (let i = 0; i < sk.eyes; i++) {
      const spread = sk.eyes === 2 ? bw * 0.17 : bw * 0.14;
      const ex = (sk.eyes === 1 ? 0 : (i - (sk.eyes - 1) / 2) * spread) + bw * 0.06;
      const er = (sk.eyes === 1 ? bw * 0.26 : sk.eyes === 2 ? bw * 0.17 : bw * 0.14);
      const ey = sk.eyes === 3 && i === 1 ? eyeY - bh * 0.09 : eyeY;
      P.eye(ex, ey, Math.max(1.1, er), look, blink, sk.eye);
      // brow: flat normally, dropped and angled when she has been hurt
      ctx.strokeStyle = sk.dark;
      ctx.lineWidth = Math.max(0.6, er * 0.32);
      ctx.lineCap = "round";
      const worry = Math.max(hurt, sad);
      const drop = worry * er * 0.5;
      ctx.beginPath();
      ctx.moveTo(ex - er * 0.95, ey - er * 1.15 + drop + worry * er * 0.45);
      ctx.lineTo(ex + er * 0.95, ey - er * 1.25 + drop - worry * er * 0.45);
      ctx.stroke();
    }

    /* ---- mouth --------------------------------------------------------- */
    const open = 0.18 + chomp * 0.82;
    const mx = bw * 0.1, my = bh * 0.15;
    const mw = bw * 0.22 * (0.7 + open * 0.45), mh = bh * 0.09 * (0.4 + open * 1.15);
    const curve = mood === "happy" || sad;
    if (!curve) P.ell(mx, my, mw, mh, "#3a1020");
    if (open > 0.5) {
      // a tongue, which is most of what makes a big open mouth look hungry
      ctx.save();
      ctx.beginPath();
      ctx.ellipse(mx, my, mw, mh, 0, 0, 6.2832);
      ctx.clip();
      ctx.fillStyle = "#e0627f";
      ctx.beginPath();
      ctx.ellipse(mx - mw * 0.1, my + mh * 0.62, mw * 0.62, mh * 0.55, 0, 0, 6.2832);
      ctx.fill();
      ctx.restore();
      // teeth, top and bottom
      ctx.fillStyle = "#fffdf2";
      for (let i = -1; i <= 1; i++) {
        const tx = mx + i * mw * 0.52;
        ctx.beginPath();
        ctx.moveTo(tx - mw * 0.2, my - mh * 0.95);
        ctx.lineTo(tx + mw * 0.2, my - mh * 0.95);
        ctx.lineTo(tx, my - mh * 0.2);
        ctx.closePath(); ctx.fill();
      }
      for (let i = -1; i <= 1; i += 2) {
        const tx = mx + i * mw * 0.3;
        ctx.beginPath();
        ctx.moveTo(tx - mw * 0.17, my + mh * 0.95);
        ctx.lineTo(tx + mw * 0.17, my + mh * 0.95);
        ctx.lineTo(tx, my + mh * 0.25);
        ctx.closePath(); ctx.fill();
      }
    } else if (sad) {
      ctx.strokeStyle = "#3a1020";
      ctx.lineWidth = Math.max(0.8, bw * 0.06);
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.arc(mx, my + mw * 1.1, mw * 1.1, -Math.PI + 0.5, -0.5);
      ctx.stroke();
    } else if (mood === "happy") {
      ctx.strokeStyle = "#3a1020";
      ctx.lineWidth = Math.max(0.8, bw * 0.065);
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.arc(mx, my - mw * 0.5, mw * 1.15, 0.45, Math.PI - 0.45);
      ctx.stroke();
      // a tongue out of one corner, because winning deserves it
      P.ell(mx - mw * 0.5, my + mw * 0.5, mw * 0.3, mw * 0.24, "#e0627f", 0, false);
    }

    // metal tastes of metal
    if (hurt > 0.2) {
      ctx.globalAlpha = hurt;
      ctx.fillStyle = "#9fb0c0";
      for (let i = 0; i < 3; i++) {
        const a = t * 9 + i * 2.1;
        ctx.beginPath();
        ctx.arc(mx + Math.cos(a) * mw * 1.5, my + Math.sin(a) * mh * 2.2, 0.8, 0, 6.2832);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  },


  /* ---------------------------- the powers ------------------------------ */
  // The Force Bubble. The old bare stroked circle read as a debug overlay; a
  // bubble needs a body, a specular highlight and facets to look like glass.
  paintShield(ctx, x, y, r, t) {
    const mo = this.motion;
    const pulse = 1 + Math.sin(t * 6) * 0.03 * mo;
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(pulse, pulse);
    ctx.globalAlpha = 0.16;
    this.softBlob(ctx, 0, 0, r * 1.15, r * 1.15, "rgba(255,217,59,0.95)");
    ctx.globalAlpha = 1;
    // facets, so it reads as a shell rather than a haze
    ctx.strokeStyle = "rgba(255,217,59,0.28)";
    ctx.lineWidth = 0.7;
    for (let i = 0; i < 6; i++) {
      const a = i * 1.047 + t * 0.5 * mo;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * r, Math.sin(a) * r * 0.94);
      ctx.lineTo(Math.cos(a + 2.1) * r, Math.sin(a + 2.1) * r * 0.94);
      ctx.stroke();
    }
    ctx.strokeStyle = "rgba(255,228,120,0.85)";
    ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.ellipse(0, 0, r, r * 0.94, 0, 0, 6.2832); ctx.stroke();
    ctx.globalAlpha = 0.7;
    ctx.strokeStyle = "rgba(255,255,255,0.9)";
    ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.ellipse(0, 0, r * 0.92, r * 0.86, 0, -2.5, -1.5); ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.restore();
  },

  // The Tractor Beam. The old version was a flat 0.16-alpha triangle, which is
  // exactly what a debug cone looks like. This is a funnel of arcs sweeping
  // outward, so it reads as something happening TO the humans in it.
  paintBeam(ctx, x, y, range, t) {
    const mo = this.motion;
    ctx.save();
    ctx.translate(x, y);
    const spread = 0.46;
    ctx.globalAlpha = 0.12;
    ctx.fillStyle = POWERUPS.magnet.color;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(range, -range * spread);
    ctx.quadraticCurveTo(range * 1.05, 0, range, range * spread);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = this.rgba(POWERUPS.magnet.color, 0.75);
    ctx.lineWidth = 1.1;
    for (let i = 0; i < 4; i++) {
      // each arc runs outward then wraps, so the funnel is always pulling
      const k = ((t * 0.9 * mo + i * 0.25) % 1);
      const d = 14 + k * (range - 14);
      ctx.globalAlpha = 0.7 * (1 - k) * (0.4 + 0.6 * mo);
      ctx.beginPath();
      ctx.ellipse(d, 0, 3 + k * 6, d * spread, 0, -1.5, 1.5);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    this.softBlob(ctx, 10, 0, 11, 9, this.rgba(POWERUPS.magnet.color, 0.55));
    ctx.restore();
  },

  /* --------------------------- menus and cards -------------------------- */
  // One entry point for every screen that is not the game: the splash hero, the
  // results portrait and all six cards in the Alien Locker. They all go through
  // paintAlien, so a change to the character cannot leave the menus behind.
  paintAlienCard(ctx, sk, cx, cy, size, mood, t) {
    const w = size * 0.72, h = size;
    ctx.save();
    ctx.translate(cx, cy);
    // the light pool she stands in, at card scale
    ctx.globalAlpha = 0.5;
    this.softBlob(ctx, 0, h * 0.56, w * 1.1, h * 0.17, "rgba(255,240,190,0.4)");
    ctx.globalAlpha = 1;
    this.shadow(ctx, 0, h * 0.52, w * 0.5, 0);
    const bob = mood === "sad" ? 0 : Math.sin(t * 2) * h * 0.02 * this.motion;
    ctx.translate(0, bob + (mood === "sad" ? h * 0.05 : 0));
    this.paintAlien(ctx, sk, {
      w, h, run: t * 2, grounded: true, sliding: false, vy: 0,
      chomp: 0, hurt: 0, combo: 1,
      frenzy: false, t, mood,
    });
    ctx.restore();
  },
});

/* =========================================================================
   OVERLAYS

   Everything here is read-only feedback painted over the frame. The important
   one is the hunger edge: before this pass the canvas said NOTHING about
   hunger, which is the game's entire clock — the only way to know you were
   four seconds from starving was to look away from the road at a bar in the
   DOM. Now the world itself closes in.

   All of it obeys the legibility budget: it lives in the sky band, the street
   band, or hard against the canvas edge. Nothing shades the lane the player is
   reading, and nothing at all is painted over the right-hand edge, because
   that is where everything arrives from.
   ========================================================================= */
Object.assign(Art, {

  // Darkens the overscan so the stage band reads as the lit stage. Draws
  // nothing on a 16:9 screen, where box.T is 0 and box.B is LH.
  paintDepth(ctx, box) {
    const L = box.L, T = box.T, R = box.R, B = box.B;
    const topH = 30 - T;                       // sky above the lane
    if (topH > 24) {
      this.vband(ctx, L, T, R - L, T + Math.min(topH, 220),
        "rgba(6,4,18,0.5)", "rgba(6,4,18,0)");
    }
    const botY = Math.max(ART_FLOOR + 6, B - 240);
    if (B - botY > 24) {
      this.vband(ctx, L, botY, R - L, B, "rgba(6,4,18,0)", "rgba(6,4,18,0.62)");
    }
    // and the left/right, but only where there IS surround — on a phone there
    // is none, and on a laptop it is the part of the road nobody reads
    const side = Math.max(0, -L);
    if (side > 20) {
      const w = Math.min(side + 30, 120);
      const g1 = ctx.createLinearGradient(L, 0, L + w, 0);
      g1.addColorStop(0, "rgba(6,4,18,0.55)"); g1.addColorStop(1, "rgba(6,4,18,0)");
      ctx.fillStyle = g1; ctx.fillRect(L, T, w, B - T);
      const g2 = ctx.createLinearGradient(R, 0, R - w, 0);
      g2.addColorStop(0, "rgba(6,4,18,0.55)"); g2.addColorStop(1, "rgba(6,4,18,0)");
      ctx.fillStyle = g2; ctx.fillRect(R - w, T, w, B - T);
    }
  },

  // pct is hunger 0..1. Below 0.5 the frame starts to close; below 0.25 it
  // breathes. The player's own body is never dimmed or strobed — she needs to
  // see exactly where she is at the moment she is most likely to die, and a
  // strobe is a nasty thing to put in a small child's game.
  paintHungerEdge(ctx, box, pct, t) {
    const k = Math.max(0, Math.min(1, (0.55 - pct) / 0.55));
    if (k <= 0.01) return;
    const L = box.L, T = box.T, R = box.R, B = box.B;
    const panic = pct < 0.25 ? (0.72 + 0.28 * Math.sin(t * 7) * this.motion) : 1;
    const a = k * panic;

    // top and bottom veils, kept clear of y = 40..174
    const topH = Math.max(0, ART_TOP - T);
    if (topH > 8) {
      ctx.globalAlpha = a * 0.72;
      this.vband(ctx, L, T, R - L, T + topH, "rgba(52,6,10,0.95)", "rgba(52,6,10,0)");
      ctx.globalAlpha = 1;
    }
    const botY = Math.max(ART_FLOOR, B - 70);
    if (B - botY > 8) {
      ctx.globalAlpha = a * 0.6;
      this.vband(ctx, L, botY, R - L, B, "rgba(52,6,10,0)", "rgba(52,6,10,0.95)");
      ctx.globalAlpha = 1;
    }
    // a rim of light around the whole frame: it cannot occlude anything,
    // because it has no inside.
    ctx.globalAlpha = a * 0.85;
    ctx.strokeStyle = "rgba(255,64,64,0.9)";
    ctx.lineWidth = 3 + a * 4;
    ctx.strokeRect(L + ctx.lineWidth / 2, T + ctx.lineWidth / 2,
      R - L - ctx.lineWidth, B - T - ctx.lineWidth);
    ctx.globalAlpha = 1;

    // the last warning: a heartbeat at the two corners the player is not
    // reading, on the left only, so the road ahead stays clean
    if (pct < 0.25) {
      ctx.globalAlpha = 0.5 * panic;
      this.softBlob(ctx, L, T + (B - T) * 0.5, 52, (B - T) * 0.6, "rgba(220,30,40,0.8)");
      ctx.globalAlpha = 1;
    }
  },

  // Streaks that intensify with the run speed. They live strictly in the sky
  // and street bands — a streak across the lane would be the one decoration in
  // the game that makes the core question harder.
  paintSpeed(ctx, box, k, scroll) {
    if (k <= 0.02 || !this.motion) return;
    const L = box.L, T = box.T, R = box.R, B = box.B;
    const span = R - L + 120;
    ctx.strokeStyle = "rgba(255,255,255,0.55)";
    for (let i = 0; i < 14; i++) {
      const sky = i % 2 === 0;
      const lane = sky ? T + 4 + GK.util.hash2(i, 91) * Math.max(6, ART_TOP - T - 10)
                       : Math.max(ART_FLOOR + 4, B - 56) + GK.util.hash2(i, 93) * 48;
      if (sky && ART_TOP - T < 14) continue;
      if (!sky && B - ART_FLOOR < 14) continue;
      const sp = 260 + GK.util.hash2(i, 95) * 420;
      const x = L - 60 + ((GK.util.hash2(i, 97) * span - scroll * sp / 100) % span + span) % span;
      const len = 14 + GK.util.hash2(i, 99) * 34;
      ctx.globalAlpha = k * (0.1 + GK.util.hash2(i, 101) * 0.2);
      ctx.lineWidth = 0.8 + GK.util.hash2(i, 103) * 1.2;
      ctx.beginPath();
      ctx.moveTo(x, lane); ctx.lineTo(x - len, lane);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  },

  // Arriving in a new zone. A DOM toast reads as browser chrome sliding over
  // the game; a ribbon drawn into the picture reads as the game saying it.
  // `k` runs 1 -> 0 over the life of the banner.
  paintBanner(ctx, box, zone, k) {
    const e = k > 0.82 ? (1 - k) / 0.18 : k < 0.18 ? k / 0.18 : 1;   // in, hold, out
    if (e <= 0) return;
    const cx = (box.L + box.R) / 2;
    const y = Math.max(box.T + 12, 22);
    const w = 196, h = 26;
    ctx.save();
    ctx.globalAlpha = e;
    ctx.translate(cx, y);
    ctx.scale(0.88 + e * 0.12, 0.88 + e * 0.12);
    ctx.globalAlpha = e * 0.5;
    this.softBlob(ctx, 0, 0, w * 0.62, h * 1.3, this.rgba(zone.accent, 0.8));
    ctx.globalAlpha = e;
    // the ribbon, with notched ends
    ctx.fillStyle = "rgba(10,6,24,0.86)";
    ctx.beginPath();
    ctx.moveTo(-w / 2, -h / 2); ctx.lineTo(w / 2, -h / 2);
    ctx.lineTo(w / 2 - 7, 0); ctx.lineTo(w / 2, h / 2);
    ctx.lineTo(-w / 2, h / 2); ctx.lineTo(-w / 2 + 7, 0);
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = this.rgba(zone.accent, 0.9);
    ctx.lineWidth = 1.4; ctx.stroke();
    ctx.fillStyle = zone.accent;
    ctx.font = "800 13px 'Baloo 2', system-ui, sans-serif";
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(zone.name.toUpperCase(), 0, 0.5);
    ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
    ctx.restore();
    ctx.globalAlpha = 1;
  },

  // A GHOST of the thing that was just eaten, redrawn with the very painter
  // that drew it, scaling up and fading. A generic particle burst says "an
  // event happened here"; a ghost says "that jogger, the one you were chasing".
  paintGhost(ctx, g, sx) {
    const k = Math.max(0, Math.min(1, g.t / g.life));
    const scale = 1 + k * 0.7;
    ctx.save();
    ctx.globalAlpha = (1 - k) * 0.8;
    ctx.translate(sx, g.y);
    ctx.scale(scale, scale);
    if (g.kind === "human") this.paintHuman(ctx, g.type, { t: g.et, fleeing: g.fleeing });
    else if (g.kind === "robot") this.paintRobot(ctx, g.type, { t: g.et, edible: g.edible });
    else if (g.kind === "brain") this.paintBrain(ctx, { t: g.et });
    else if (g.kind === "orb") this.paintOrb(ctx, g.type, { t: g.et });
    ctx.restore();
    // the ring that came off it
    ctx.globalAlpha = (1 - k) * 0.5;
    ctx.strokeStyle = g.ring || "rgba(255,255,255,0.9)";
    ctx.lineWidth = 2 * (1 - k) + 0.4;
    ctx.beginPath();
    ctx.ellipse(sx, g.y, 7 + k * 26, (7 + k * 26) * 0.72, 0, 0, 6.2832);
    ctx.stroke();
    ctx.globalAlpha = 1;
  },

  // A close shave: two arcs swept off the alien's shoulder as a robot goes by
  // without touching her. Jumping a patrol bot is the central act of skill in
  // the game and before this pass it produced nothing at all.
  paintDodge(ctx, x, y, k) {
    const e = 1 - k;
    ctx.save();
    ctx.globalAlpha = e * 0.8;
    ctx.strokeStyle = "rgba(255,255,255,0.95)";
    ctx.lineCap = "round";
    for (let i = 0; i < 2; i++) {
      ctx.lineWidth = 2.2 - i * 0.8;
      const r = 12 + k * 16 + i * 6;
      ctx.beginPath();
      ctx.arc(x - k * 12, y, r, -0.9 + i * 0.2, 0.5 - i * 0.2);
      ctx.stroke();
    }
    ctx.restore();
    ctx.globalAlpha = 1;
  },

  // The control hints. Pills with a drawn arrow rather than bare white text:
  // the youngest player in the house reads the arrow, not the words.
  paintHints(ctx, box, alpha) {
    const y = Math.min(box.B - 17, LH + 24);
    const pill = (cx, up, label) => {
      const w = 104, h = 22;
      this.rr(ctx, cx - w / 2, y - h / 2, w, h, 11);
      ctx.fillStyle = "rgba(10,6,24,0.55)";
      ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,0.2)";
      ctx.lineWidth = 1; ctx.stroke();
      ctx.fillStyle = "#fff";
      const ax = cx - w / 2 + 15;
      ctx.beginPath();
      if (up) { ctx.moveTo(ax - 4, y + 2.5); ctx.lineTo(ax + 4, y + 2.5); ctx.lineTo(ax, y - 4); }
      else { ctx.moveTo(ax - 4, y - 2.5); ctx.lineTo(ax + 4, y - 2.5); ctx.lineTo(ax, y + 4); }
      ctx.closePath(); ctx.fill();
      ctx.font = "800 10.5px 'Baloo 2', system-ui, sans-serif";
      ctx.textAlign = "left"; ctx.textBaseline = "middle";
      ctx.fillText(label, ax + 10, y + 0.5);
      ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
    };
    ctx.globalAlpha = alpha;
    pill(box.L + (box.R - box.L) * 0.28, true, "TAP = JUMP");
    pill(box.L + (box.R - box.L) * 0.72, false, "TAP = SLAM");
    ctx.globalAlpha = 1;
  },
});
