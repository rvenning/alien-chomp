// Generate icons/ — a grinning green alien over a night skyline.
// Run: node tools/make-icons.js  (from the alien-chomp folder)
const fs = require("fs");
const path = require("path");
const { makeCanvas, downsample, encodePNG } = require("../lib/tools/png.js");

const OUT = path.join(__dirname, "..", "icons");
fs.mkdirSync(OUT, { recursive: true });

function paint(size, pad) {
  const SS = 4, big = size * SS;
  const cv = makeCanvas(big);
  const u = big / 100;               // 1 unit = 1% of the icon

  const VOID = "#0b0820", HAZE = "#2a1a55";
  const LIME = "#7ee081", DARK = "#3f9a4d", BELLY = "#c8f7c0";
  const PINK = "#ff5ad1", INK = "#0d2914";

  // night sky
  cv.fillRect(0, 0, big, big, VOID);
  cv.fillCircle(50 * u, 46 * u, 40 * u, "#1a1140");
  cv.fillCircle(50 * u, 40 * u, 28 * u, HAZE);

  // maskable art stays inside the safe centre (~72%)
  const s = pad ? 0.78 : 1;
  const cx = 50 * u;
  const at = (v) => 50 * u + (v - 50) * u * s;
  const sz = (v) => v * u * s;

  // city skyline along the bottom
  const roofs = [[10, 22, 14], [26, 30, 10], [40, 18, 16], [58, 26, 12], [74, 34, 12]];
  for (const [x, h, w] of roofs) {
    cv.fillRect(at(x), at(84) - sz(h), sz(w), sz(h) + sz(6), "#241a4a");
    for (let r = 0; r < Math.floor(h / 8); r++) {
      cv.fillRect(at(x + 2), at(84) - sz(h) + sz(3 + r * 7), sz(3), sz(3), "#ffe9a8");
      cv.fillRect(at(x + w - 5), at(84) - sz(h) + sz(3 + r * 7), sz(3), sz(3), "#ffe9a8");
    }
  }

  // alien head
  cv.fillCircle(cx, at(46), sz(27), DARK);
  cv.fillCircle(cx, at(44), sz(25), LIME);
  cv.fillCircle(cx, at(52), sz(13), BELLY);

  // antenna with a pink bulb
  cv.fillRect(cx - sz(1.6), at(14), sz(3.2), sz(10), DARK);
  cv.fillCircle(cx, at(13), sz(5), PINK);

  // big eyes
  cv.fillCircle(cx - sz(9), at(40), sz(8), "#ffffff");
  cv.fillCircle(cx + sz(9), at(40), sz(8), "#ffffff");
  cv.fillCircle(cx - sz(7), at(41), sz(4), INK);
  cv.fillCircle(cx + sz(11), at(41), sz(4), INK);

  // wide open mouth, mid-chomp
  cv.fillCircle(cx, at(58), sz(9), "#3a1020");
  // teeth
  cv.fillRect(cx - sz(7), at(51), sz(4), sz(4), "#ffffff");
  cv.fillRect(cx - sz(1), at(51), sz(4), sz(4), "#ffffff");
  cv.fillRect(cx + sz(5), at(51), sz(4), sz(4), "#ffffff");

  return encodePNG(size, size, downsample(cv.px, big, SS));
}

fs.writeFileSync(path.join(OUT, "icon-192.png"), paint(192, false));
fs.writeFileSync(path.join(OUT, "icon-512.png"), paint(512, false));
fs.writeFileSync(path.join(OUT, "maskable-512.png"), paint(512, true));
console.log("icons written to", OUT);
