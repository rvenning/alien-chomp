// App shell — splash, profile roster, the hub, the skin locker, results and the
// family leaderboard. Profiles/PINs/sync/install all come from gamekit; this
// file only decides what goes on each screen.

const AVATARS = ["👽", "🛸", "👾", "🦄", "🐙", "🦖", "🐸", "🦊", "🐼", "🐱", "🦉", "⭐"];


/* ---------------------------------------------------------------------------
   Hero canvases.

   The splash, the results screen and every card in the Alien Locker draw their
   alien with js/art.js — the same painter the game uses, at the same moment in
   its animation. That is what stops the menus slowly drifting away from the
   character: there is no second drawing of her anywhere to forget about.

   Each registered canvas is repainted only while it is actually on screen, and
   the sizing is redone whenever its CSS box changes, because a canvas is a
   replaced element and its attribute size is the backing store.
   --------------------------------------------------------------------------- */
const Hero = {
  items: [],
  t: 0,

  add(el, draw) {
    if (!el) return;
    this.items = this.items.filter((it) => it.el !== el && it.el.isConnected);
    this.items.push({ el, draw, w: 0, h: 0 });
  },
  clearKind(selector) {
    this.items = this.items.filter((it) => !it.el.matches(selector));
  },

  // Returns a context already scaled so the caller can work in CSS pixels.
  fit(it) {
    const w = it.el.clientWidth, h = it.el.clientHeight;
    if (!w || !h) return null;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (it.w !== w || it.h !== h || it.dpr !== dpr) {
      it.w = w; it.h = h; it.dpr = dpr;
      it.el.width = Math.round(w * dpr);
      it.el.height = Math.round(h * dpr);
    }
    const ctx = it.el.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    return ctx;
  },

  loop(ms) {
    requestAnimationFrame((n) => Hero.loop(n));
    const dt = Math.min(0.05, (ms - (Hero._last || ms)) / 1000 || 0);
    Hero._last = ms;
    Hero.t += dt;
    for (const it of Hero.items) {
      if (!it.el.isConnected || !it.el.offsetParent) continue;
      const ctx = Hero.fit(it);
      if (ctx) it.draw(ctx, it.w, it.h, Hero.t);
    }
  },

  // The splash cast: the alien, the jogger she is chasing, and the robot that
  // is the reason this is difficult. Authored in a fixed 200x78 logical box and
  // fitted, so it reads the same on a phone and on a monitor.
  cast(ctx, w, h, t, sk) {
    // The box is sized to what the cast actually occupies, not to a round
    // number: a box with empty margins baked in just scales everybody down.
    const BW = 152, BH = 64;
    const s = Math.min(w / BW, h / BH);
    ctx.save();
    ctx.translate((w - BW * s) / 2, (h - BH * s) / 2);
    ctx.scale(s, s);
    const gy = 52;
    // the patch of street they are all standing on
    ctx.globalAlpha = 0.5;
    Art.softBlob(ctx, BW / 2, gy + 3, 74, 8, "rgba(0,0,0,0.5)");
    ctx.globalAlpha = 1;

    // the robot, furthest away and therefore smallest
    ctx.save();
    Art.shadow(ctx, 128, gy, 9, 0);
    ctx.translate(128, gy - ROBOTS.bot.h / 2);
    Art.paintRobot(ctx, "bot", { t: t * 0.8 });
    ctx.restore();

    // the jogger, mid-bolt
    ctx.save();
    Art.shadow(ctx, 92, gy, 8, 0);
    ctx.translate(92, gy - HUMANS.runner.h / 2);
    ctx.scale(1.25, 1.25);
    Art.paintHuman(ctx, "runner", { t: t * 1.1, fleeing: true });
    ctx.restore();

    // and the alien, chomping on a loop
    const chomp = (t * 0.8) % 1 < 0.18 ? 0.16 : 0;
    const H = 40, W = 28;
    Art.paintAlienPool(ctx, 40, gy, W * 0.55);
    Art.shadow(ctx, 40, gy, W * 0.55, 0);
    ctx.save();
    ctx.translate(40, gy - H / 2 + Math.sin(t * 2.2) * 1.2 * Art.motion);
    Art.paintAlien(ctx, sk, {
      w: W, h: H, run: t * 9, grounded: true, sliding: false, vy: 0,
      chomp, hurt: 0, combo: 1, frenzy: false, t, mood: "run",
    });
    ctx.restore();
    ctx.restore();
  },
};

const App = {
  profile: null,

  el(id) { return document.getElementById(id); },

  init() {
    const settings = Storage.getSettings();
    Sfx.enabled = settings.sound !== false;
    Music.enabled = settings.music !== false;

    GK.UI.onScreenChange = (name) => {
      Game.active = name === "game";
      if (name !== "game") Music.stop();
      if (name === "splash") this.refreshSplash();
    };
    GK.UI.bindSoundToggle(Storage);
    // Every menu button clicks; buttons that make their own sound keep it.
    GK.UI.bindMenuClicks();

    GK.Profiles.init({
      storage: Storage,
      avatars: AVATARS,
      meta: (p, prog) =>
        `🏆 ${(prog.best || 0).toLocaleString()} · 📏 ${prog.bestDist || 0}m · 🍽️ ${prog.eaten || 0}`,
      onEnter: (p) => { this.profile = p; this.showHome(); },
      addLabel: "New Alien",
    });

    // One flag for the canvas half of reduced motion: every sway, drift,
    // pulse, streak, shake and squash in art.js multiplies by Art.motion, so
    // "does reduced motion work" is answerable by setting it to 0 in a console.
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const applyMotion = () => {
      Art.motion = mq.matches ? 0 : 1;
      document.body.classList.toggle("reduced-motion", mq.matches);
    };
    applyMotion();
    if (mq.addEventListener) mq.addEventListener("change", applyMotion);
    else if (mq.addListener) mq.addListener(applyMotion);

    GK.initPWA({ appName: "Alien Chomp" });
    Game.boot();
    requestAnimationFrame((t) => Hero.loop(t));

    this.showScreen("splash");
    Storage.initFirebase().then((ok) => {
      this.el("sync-badge").textContent = ok ? "☁️ family sync on" : "📴 offline";
      if (ok && GK.UI.screen === "profiles") GK.Profiles.renderList();
      if (ok && GK.UI.screen === "splash") this.refreshSplash();
      if (ok && GK.UI.screen === "home") this.showHome();
      if (ok && GK.UI.screen === "leaderboard") this.showLeaderboard(true);
    });
  },

  showScreen(name) { GK.UI.showScreen(name); },

  toggleMusic() {
    const on = Music.toggle();
    this.el("btn-music").textContent = on ? "🎵 Music: On" : "🔇 Music: Off";
    const s = Storage.getSettings();
    s.music = on;
    Storage.saveSettings(s);
    if (on && Game.running && !Game.paused) Music.start("chase");
    Sfx.click();
  },

  /* ------------------------------- splash -------------------------------- */
  refreshSplash() {
    const last = GK.Profiles.lastProfile();
    // The alien on the splash is the one this player last wore, so the game
    // greets her with her own character rather than with the starter blob.
    const sk = last ? activeSkin(Storage.getProgress(last.id)) : SKINS[0];
    Hero.add(this.el("hero-cv"), (ctx, w, h, t) => Hero.cast(ctx, w, h, t, sk));
    const cont = this.el("btn-continue-as"), start = this.el("btn-start");
    if (last) {
      cont.style.display = "";
      cont.textContent = `👽 Continue as ${last.avatar} ${last.name}`;
      cont.onclick = () => { Sfx.init(); GK.Profiles.select(last); };
      start.className = "btn ghost";
      start.textContent = "👥 Switch Alien";
    } else {
      cont.style.display = "none";
      start.className = "btn big green";
      start.textContent = "👽 Start Chomping";
    }
  },

  play() {
    Sfx.init(); Sfx.click();
    GK.Profiles.renderList();
    this.showScreen("profiles");
  },

  /* --------------------------------- hub --------------------------------- */
  showHome() {
    if (!this.profile) return this.play();
    const prog = Storage.getProgress(this.profile.id);
    const sk = activeSkin(prog);
    this.el("home-player").innerHTML = `${this.profile.avatar} <b>${GK.util.esc(this.profile.name)}</b>`;
    this.el("home-skin").textContent = `${sk.name}`;
    this.el("stat-best").textContent = (prog.best || 0).toLocaleString();
    this.el("stat-dist").textContent = (prog.bestDist || 0) + "m";
    this.el("stat-eaten").textContent = (prog.eaten || 0).toLocaleString();
    this.el("stat-combo").textContent = "x" + (prog.bestCombo || 1);
    const z = ZONES[Math.min(prog.zone || 0, ZONES.length - 1)];
    this.el("stat-zone").textContent = `${z.icon} ${z.name}`;

    const next = nextSkin(prog.eaten);
    this.el("skin-nudge").textContent = next
      ? `${next.need - (prog.eaten || 0)} more snacks → ${next.name}`
      : "Every alien unlocked! 👑";
    this.showScreen("home");
  },

  startRun() {
    Sfx.init(); Sfx.click();
    Game.start(this.profile);
  },

  /* ------------------------------- skins --------------------------------- */
  showSkins() {
    Sfx.click();
    const prog = Storage.getProgress(this.profile.id);
    const wearing = activeSkin(prog).id;
    this.el("skin-list").innerHTML = SKINS.map((s) => {
      const got = skinUnlocked(s, prog.eaten);
      const on = got && s.id === wearing;
      return `<button class="skin-card${got ? "" : " locked"}${on ? " on" : ""}"
        ${got ? `onclick="App.wearSkin('${s.id}')"` : "disabled"}>
        <canvas class="skin-cv" data-skin="${s.id}"></canvas>
        <span class="skin-name">${got ? GK.util.esc(s.name) : "???"}</span>
        <span class="skin-need">${got ? (on ? "Wearing" : "Tap to wear") : `🍽️ ${s.need} eaten`}</span>
      </button>`;
    }).join("");
    // Re-registered after every rebuild: the old canvases are gone from the DOM.
    Hero.clearKind(".skin-cv");
    this.el("skin-list").querySelectorAll(".skin-cv").forEach((cv) => {
      const sk = SKIN_BY_ID[cv.dataset.skin];
      const on = sk.id === wearing;
      Hero.add(cv, (ctx, w, h, t) =>
        Art.paintAlienCard(ctx, sk, w / 2, h * 0.52, h * 0.72, on ? "happy" : "run",
          t + sk.need * 0.0013));
    });
    this.showScreen("skins");
  },

  wearSkin(id) {
    Sfx.power();
    Storage.setSkin(this.profile.id, id);
    this.showSkins();
  },

  /* ------------------------------- results ------------------------------- */
  runOver(res, quit) {
    const prog = Storage.getProgress(this.profile.id);
    const prevBest = prog.best || 0;
    const prevEaten = prog.eaten || 0;
    const saved = Storage.recordRun(this.profile.id, res);
    if (quit) { this.showHome(); return; }

    const newBest = res.score > prevBest;
    // Same painter as the run, so the results screen is unmistakably about the
    // alien the player just lost.
    const sk = activeSkin(saved);
    const mood = newBest ? "happy" : "sad";
    Hero.add(this.el("res-cv"), (ctx, w, h, t) =>
      Art.paintAlienCard(ctx, sk, w / 2, h * 0.52, h * 0.66, mood, t));
    this.el("res-title").textContent = newBest ? "🏆 NEW BEST!" : "Starved!";
    this.el("res-score").textContent = res.score.toLocaleString();
    this.el("res-sub").textContent = newBest
      ? `Beat your old best of ${prevBest.toLocaleString()}`
      : `Best: ${(saved.best || 0).toLocaleString()}`;
    const z = ZONES[Math.min(res.zone, ZONES.length - 1)];
    this.el("res-stats").innerHTML = [
      `📏 ${res.metres}m`,
      `🍽️ ${res.eaten} eaten`,
      `🤖 ${res.robots} smashed`,
      `🔥 best chain x${res.bestCombo}`,
      `${z.icon} ${GK.util.esc(z.name)}`,
    ].map((b) => `<div>${b}</div>`).join("");

    // Skin unlocks are the between-run hook — call one out the moment it lands.
    const justUnlocked = SKINS.find((s) => s.need > prevEaten && s.need <= (saved.eaten || 0));
    const next = nextSkin(saved.eaten);
    const note = this.el("res-note");
    if (justUnlocked) {
      note.className = "res-note unlocked";
      note.textContent = `🎉 New alien unlocked: ${justUnlocked.name}!`;
    } else if (next) {
      note.className = "res-note";
      note.textContent = `${next.need - (saved.eaten || 0)} more snacks → ${next.name}`;
    } else {
      note.className = "res-note";
      note.textContent = "";
    }

    if (newBest) setTimeout(() => Sfx.newBest(), 300);
    this.showScreen("results");
  },

  /* ----------------------------- leaderboard ----------------------------- */
  showLeaderboard(silent) {
    if (!silent) Sfx.click();
    GK.Profiles.renderLeaderboard("lb-rows", {
      cols: (r) => `<span class="lb-stat">📏 ${r.progress.bestDist || 0}m</span>
        <span class="lb-stat">🍽️ ${r.progress.eaten || 0}</span>
        <span class="lb-stat">🏆 ${(r.progress.best || 0).toLocaleString()}</span>`,
      sort: (a, b) => (b.progress.best || 0) - (a.progress.best || 0),
      meId: this.profile?.id,
      empty: "No aliens yet — tap Play!",
    });
    this.showScreen("leaderboard");
  },
};

window.addEventListener("DOMContentLoaded", () => App.init());
