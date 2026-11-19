// Screenshots and the demo GIF for the README, rendered from the real UI in headless Chrome.
// The page runs in "Mac app" mode against a stand-in bridge that serves the bundled sample looks,
// so it looks exactly like the app window without touching anyone's real presets.
//   node scripts/capture-docs.mjs            (the GIF also needs Python with Pillow: PYTHON=/path/to/python)

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { launch } from "./cdp.mjs";
import { serve } from "./serve.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const DOCS = join(ROOT, "docs");
const W = 1320, H = 840, PAD = 64;

// Stand-in for the Swift side (see macos/main.swift, Bridge.handle).
const BRIDGE = `
if (location.pathname === "/index.html") {
  const sample = async () => {
    const names = await (await fetch("samples/index.json")).json();
    return Promise.all(names.map(async (n) => ({ path: n, text: await (await fetch("samples/" + n)).text() })));
  };
  const out = "/Users/you/Pictures/LR Mask Presets";
  const answers = {
    getSettings: () => ({}),
    scan: async () => ({
      sources: [
        { key: "lightroom", label: "Lightroom", kind: "lightroom", path: "/Users/you/Pictures/Lightroom Library.lrlibrary", available: true, defaultEnabled: true, files: await sample() },
        { key: "adobe", label: "Adobe's own presets", kind: "adobe", path: "/Library/Application Support/Adobe/CameraRaw/Settings", available: true, defaultEnabled: false, files: [] },
      ],
      outputFolder: out, apps: { cloud: true, classic: false },
    }),
    save: (m) => ({ folder: out + "/" + m.folderName, zip: out + "/" + m.zipName, count: m.files.length }),
    ready: () => ({ version: "1.0.0" }),
  };
  window.webkit = { messageHandlers: { native: { postMessage: async (m) => (answers[m.cmd] ? answers[m.cmd](m) : true) } } };
}`;

// An abstract desktop picture made for these screenshots (soft colour fields, nothing borrowed).
const WALLPAPER = {
  dark: "radial-gradient(60% 70% at 18% 22%, #3a4f9a 0%, transparent 70%), radial-gradient(55% 60% at 85% 18%, #7a3f8f 0%, transparent 70%), radial-gradient(70% 60% at 60% 95%, #c4683a 0%, transparent 70%), #141826",
  light: "radial-gradient(60% 70% at 18% 22%, #9ec1ff 0%, transparent 70%), radial-gradient(55% 60% at 85% 18%, #e5b8f0 0%, transparent 70%), radial-gradient(70% 60% at 60% 95%, #ffc896 0%, transparent 70%), #eef1f8",
};

// The page leaves its sidebar clear for the window's vibrancy (NSVisualEffectView in main.swift).
// Here a blurred, tinted copy of the desktop stands in for it, and the traffic lights are drawn on top.
function frame({ theme, padded }) {
  const dark = theme === "dark";
  return `<!doctype html><meta charset="utf-8"><style>
html, body { margin: 0; height: 100%; }
body { background: ${padded ? WALLPAPER[theme] : dark ? "#1d1d20" : "#fff"}; }
.win { position: relative; width: ${W}px; height: ${H}px; margin: ${padded ? PAD : 0}px; overflow: hidden; isolation: isolate;
  ${padded ? `border-radius: 16px; box-shadow: 0 30px 80px rgba(0,0,0,${dark ? 0.55 : 0.28}), 0 0 0 1px rgba(${dark ? "255,255,255,.14" : "0,0,0,.12"});` : ""} }
.material { position: absolute; inset: 0; z-index: -1; overflow: hidden; }
.material::before { content: ""; position: absolute; inset: -${padded ? PAD : 120}px; background: ${WALLPAPER[theme]}; filter: blur(48px) saturate(1.5);
  ${padded ? `background-attachment: fixed;` : ""} }
.material::after { content: ""; position: absolute; inset: 0; background: ${dark ? "rgba(30,30,34,.62)" : "rgba(246,246,248,.55)"}; }
.lights { position: absolute; left: 20px; top: 20px; display: flex; gap: 8px; z-index: 2; }
.lights i { width: 12px; height: 12px; border-radius: 50%; box-shadow: inset 0 0 0 .5px rgba(0,0,0,.22); }
:root, iframe { color-scheme: ${theme}; }
iframe { display: block; border: 0; width: ${W}px; height: ${H}px; background: transparent; }
#cursor { position: absolute; left: 0; top: 0; width: 24px; height: 24px; pointer-events: none; z-index: 10; transform: translate(-200px, -200px); filter: drop-shadow(0 1px 2px rgba(0,0,0,.4)); }
#ripple { position: absolute; width: 34px; height: 34px; margin: -17px 0 0 -17px; border-radius: 50%; background: rgba(77,155,255,.45); pointer-events: none; opacity: 0; z-index: 9; transition: opacity .15s; }
</style>
<div class="win">
  <div class="material"></div>
  <div class="lights"><i style="background:#ff5f57"></i><i style="background:#febc2e"></i><i style="background:#28c840"></i></div>
  <iframe id="app" src="/index.html?theme=${theme}" allowtransparency="true"></iframe>
  <div id="ripple"></div>
  <svg id="cursor" viewBox="0 0 24 24"><path d="M5 2.5v17.2l4.3-4.1 2.8 6.2 2.9-1.3-2.8-6.1h6z" fill="#000" stroke="#fff" stroke-width="1.4" stroke-linejoin="round"/></svg>
</div>`;
}

async function openFrame(page, base, opts) {
  await page.send("Emulation.setDeviceMetricsOverride", {
    width: W + (opts.padded ? PAD * 2 : 0), height: H + (opts.padded ? PAD * 2 : 0), deviceScaleFactor: opts.scale, mobile: false,
  });
  await page.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: opts.theme }] });
  await page.goto(`${base}frame-${opts.theme}-${opts.padded ? "padded" : "flat"}.html`);
  await page.waitFor("document.querySelector('#app').contentDocument?.documentElement.dataset.ready === '1'");
  await page.eval("document.fonts.ready.then(() => true)");
  await sleep(700); // let the first animations settle
}

const inApp = (js) => `(() => { const app = document.querySelector('#app').contentWindow.app; const doc = document.querySelector('#app').contentDocument; ${js} })()`;

/** Center of an element inside the app, in page coordinates. */
async function spot(page, selector) {
  const box = await page.eval(`(() => {
    const frame = document.querySelector('#app'), f = frame.getBoundingClientRect();
    const el = frame.contentDocument.querySelector(${JSON.stringify(selector)});
    if (!el) return null;
    el.scrollIntoView({ block: "nearest" });
    const r = el.getBoundingClientRect();
    return { x: f.x + r.x + Math.min(r.width / 2, 60), y: f.y + r.y + r.height / 2 };
  })()`);
  if (!box) throw new Error(`Not found: ${selector}`);
  return box;
}

async function shot(page, name) {
  writeFileSync(join(DOCS, name), await page.screenshot());
  console.log(`docs/${name}`);
}

async function stills(page, base) {
  await page.send("Emulation.setDefaultBackgroundColorOverride", { color: { r: 0, g: 0, b: 0, a: 0 } });

  await openFrame(page, base, { theme: "dark", padded: true, scale: 2 });
  await page.eval(inApp(`app.setTargets(["background", "sky", "water"]); app.check(["Moody Teal", "Night City", "Faded Film"]); app.show("Moody Teal");`));
  await sleep(1200);
  await shot(page, "screenshot-dark.png");

  await openFrame(page, base, { theme: "light", padded: true, scale: 2 });
  await page.eval(inApp(`app.setView("list"); app.setTargets(["skin", "hair"]); app.setOption("leftovers", "global"); app.show("Golden Hour Glow");`));
  await sleep(1200);
  await shot(page, "screenshot-light.png");

  await openFrame(page, base, { theme: "dark", padded: true, scale: 2 });
  await page.eval(inApp(`app.setTargets(["background", "sky", "skin"]); app.check(["Golden Hour Glow", "Soft Pastel"]); app.show("Golden Hour Glow"); app.openMasks();`));
  await sleep(1200);
  await shot(page, "masks-dark.png");

  await openFrame(page, base, { theme: "light", padded: true, scale: 2 });
  await page.eval(inApp(`app.check(["Golden Hour Glow", "Soft Pastel", "Clean & Bright"]); app.setTargets(["background", "sky"]); return app.create();`));
  await sleep(1400);
  await shot(page, "done-light.png");

  await page.send("Emulation.setDefaultBackgroundColorOverride", {});
}

async function demo(page, base, work) {
  await openFrame(page, base, { theme: "dark", padded: false, scale: 1 });
  await page.eval(inApp(`app.setView("grid"); app.setTargets(["background"]); app.show("Golden Hour Glow");`));
  await sleep(900);
  const frames = [];
  let cursor = { x: W * 0.55, y: H * 0.7 };
  const capture = async (ms) => {
    const file = join(work, `f${String(frames.length).padStart(3, "0")}.png`);
    writeFileSync(file, await page.screenshot());
    frames.push({ file, ms });
  };
  const place = (p) => page.eval(`document.querySelector('#cursor').style.transform = 'translate(${p.x - 5}px, ${p.y - 3}px)'`);
  const move = async (to, steps = 7) => {
    const from = cursor;
    for (let i = 1; i <= steps; i++) {
      const t = i / steps, e = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
      await place({ x: from.x + (to.x - from.x) * e, y: from.y + (to.y - from.y) * e });
      await capture(40);
    }
    cursor = to;
  };
  const click = async (selector, hold = 700, { settle = 0, during = 0 } = {}) => {
    const p = await spot(page, selector);
    await move(p);
    await page.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: p.x, y: p.y });
    await page.eval(`(() => { const r = document.querySelector('#ripple'); r.style.left = '${p.x}px'; r.style.top = '${p.y}px'; r.style.opacity = 1; })()`);
    for (const type of ["mousePressed", "mouseReleased"]) await page.send("Input.dispatchMouseEvent", { type, x: p.x, y: p.y, button: "left", clickCount: 1 });
    // Frames while the click animates (popovers springing open, the grid morphing into the list).
    for (let i = 0; i < during; i++) await capture(50);
    await sleep(120);
    await page.eval("document.querySelector('#ripple').style.opacity = 0");
    await sleep(settle);
    await capture(160);
    await capture(hold);
  };

  await place(cursor);
  await capture(1400);
  await click('.tile .name[title="Moody Teal"]', 1300, { during: 6 });
  await click("#masksButton", 500, { during: 6 });
  await click('[data-target="sky"]', 350);
  await click('[data-target="skin"]', 600);
  await click('[data-leftovers="global"]', 1100);
  await click("#pickerDone", 500, { during: 3 });
  await click('.tile:has(.name[title="Night City"]) .check', 250, { during: 3 });
  await click('.tile:has(.name[title="Faded Film"]) .check', 1200, { during: 3 });
  await click("#viewList", 1600, { during: 10 });
  await click("#createButton", 3600, { during: 8 });
  return frames;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const routes = {};
for (const theme of ["dark", "light"]) for (const padded of [true, false]) routes[`/frame-${theme}-${padded ? "padded" : "flat"}.html`] = frame({ theme, padded });
const server = await serve(0, routes);
const base = `http://127.0.0.1:${server.address().port}/`;
const page = await launch({ width: W, height: H, scale: 2 });
await page.send("Page.addScriptToEvaluateOnNewDocument", { source: BRIDGE });
const work = mkdtempSync(join(tmpdir(), "lrmask-docs-"));
try {
  await stills(page, base);
  const frames = await demo(page, base, work);
  writeFileSync(join(work, "frames.json"), JSON.stringify(frames));
  const python = process.env.PYTHON || "python3";
  execFileSync(python, [join(ROOT, "scripts/make-gif.py"), join(work, "frames.json"), join(DOCS, "demo.gif")], { stdio: "inherit" });
  if (page.errors.length) console.warn("Page errors:", page.errors);
} finally {
  await page.close();
  server.close();
  rmSync(work, { recursive: true, force: true });
}
