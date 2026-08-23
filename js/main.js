// App shell — splash, profile roster, the hub, the skin locker, results and the
// family leaderboard. Profiles/PINs/sync/install all come from gamekit; this
// file only decides what goes on each screen.

const AVATARS = ["👽", "🛸", "👾", "🦄", "🐙", "🦖", "🐸", "🦊", "🐼", "🐱", "🦉", "⭐"];

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

    GK.initPWA({ appName: "Alien Chomp" });
    Game.boot();

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
        <span class="skin-blob" style="background:${got ? s.body : "#4a4a5a"};
              box-shadow: inset -4px -5px 0 ${got ? s.dark : "#33333f"}"></span>
        <span class="skin-name">${got ? GK.util.esc(s.name) : "???"}</span>
        <span class="skin-need">${got ? (on ? "Wearing" : "Tap to wear") : `🍽️ ${s.need} eaten`}</span>
      </button>`;
    }).join("");
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
    this.el("res-emoji").textContent = newBest ? "🏆" : "💀";
    this.el("res-title").textContent = newBest ? "NEW BEST!" : "Starved!";
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
