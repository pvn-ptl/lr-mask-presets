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
const W = 1320, H = 820, BAR = 30, PAD = 56;

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

function frame({ theme, padded }) {
  const dark = theme === "dark";
  return `<!doctype html><meta charset="utf-8"><style>
html, body { margin: 0; background: ${padded ? "transparent" : dark ? "#1d1d20" : "#fff"}; }
.win { position: relative; width: ${W}px; height: ${H + BAR}px; margin: ${padded ? PAD : 0}px; overflow: hidden; background: ${dark ? "#1d1d20" : "#fff"};
  ${padded ? `border-radius: 12px; box-shadow: 0 28px 70px rgba(0,0,0,.32), 0 0 0 1px rgba(0,0,0,${dark ? 0.5 : 0.12});` : ""} }
.bar { height: ${BAR}px; display: flex; align-items: center; justify-content: center; font: 600 13px -apple-system, "SF Pro Text", system-ui, sans-serif; color: ${dark ? "#a1a1aa" : "#5f5f69"}; }
.lights { position: absolute; left: 13px; top: ${BAR / 2 - 6}px; display: flex; gap: 8px; }
.lights i { width: 12px; height: 12px; border-radius: 50%; box-shadow: inset 0 0 0 .5px rgba(0,0,0,.2); }
iframe { display: block; border: 0; width: ${W}px; height: ${H}px; }
#cursor { position: absolute; left: 0; top: 0; width: 24px; height: 24px; pointer-events: none; z-index: 10; transform: translate(-200px, -200px); filter: drop-shadow(0 1px 2px rgba(0,0,0,.4)); }
#ripple { position: absolute; width: 34px; height: 34px; margin: -17px 0 0 -17px; border-radius: 50%; background: rgba(77,155,255,.45); pointer-events: none; opacity: 0; z-index: 9; }
</style>
<div class="win">
  <div class="bar"><div class="lights"><i style="background:#ff5f57"></i><i style="background:#febc2e"></i><i style="background:#28c840"></i></div>LR Mask Presets</div>
  <iframe id="app" src="/index.html?theme=${theme}"></iframe>
  <div id="ripple"></div>
  <svg id="cursor" viewBox="0 0 24 24"><path d="M5 2.5v17.2l4.3-4.1 2.8 6.2 2.9-1.3-2.8-6.1h6z" fill="#000" stroke="#fff" stroke-width="1.4" stroke-linejoin="round"/></svg>
</div>`;
}

async function openFrame(page, base, opts) {
  await page.send("Emulation.setDeviceMetricsOverride", {
    width: W + (opts.padded ? PAD * 2 : 0), height: H + BAR + (opts.padded ? PAD * 2 : 0), deviceScaleFactor: opts.scale, mobile: false,
  });
  await page.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: opts.theme }] });
  await page.goto(`${base}frame-${opts.theme}-${opts.padded ? "padded" : "flat"}.html`);
  await page.waitFor("document.querySelector('#app').contentDocument?.documentElement.dataset.ready === '1'");
  await page.eval("document.fonts.ready.then(() => true)");
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
  await page.eval(inApp(`app.show("Moody Teal"); app.setTargets(["background", "sky"]); app.check(["Moody Teal", "Night City", "Faded Film"]);`));
  await sleep(300);
  await shot(page, "screenshot-dark.png");

  await openFrame(page, base, { theme: "light", padded: true, scale: 2 });
  await page.eval(inApp(`app.show("Golden Hour Glow"); app.setTargets(["skin", "hair"]); app.setOption("leftovers", "global");`));
  await sleep(300);
  await shot(page, "screenshot-light.png");

  await openFrame(page, base, { theme: "light", padded: true, scale: 2 });
  await page.eval(inApp(`app.check(["Golden Hour Glow", "Soft Pastel", "Clean & Bright"]); app.setTargets(["background", "sky"]); return app.create();`));
  await sleep(400);
  await shot(page, "done-light.png");

  await page.send("Emulation.setDefaultBackgroundColorOverride", {});
}

async function demo(page, base, work) {
  await openFrame(page, base, { theme: "dark", padded: false, scale: 1 });
  await page.eval(inApp(`app.show("Golden Hour Glow"); app.setTargets(["background"]); doc.querySelector('.create-scroll').scrollTop = 0;`));
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
  const click = async (selector, hold = 700) => {
    const p = await spot(page, selector);
    await move(p);
    await page.eval(`(() => { const r = document.querySelector('#ripple'); r.style.left = '${p.x}px'; r.style.top = '${p.y}px'; r.style.opacity = 1; })()`);
    for (const type of ["mousePressed", "mouseReleased"]) await page.send("Input.dispatchMouseEvent", { type, x: p.x, y: p.y, button: "left", clickCount: 1 });
    await sleep(120);
    await capture(160);
    await page.eval("document.querySelector('#ripple').style.opacity = 0");
    await sleep(120);
    await capture(hold);
  };

  await place(cursor);
  await capture(1600);
  await click('.item[data-id] .name[title="Moody Teal"]', 1500);
  await click('[data-target="sky"]', 600);
  await click('[data-family="people"] > button', 400);
  await click('[data-target="skin"]', 900);
  await click('.segmented button:nth-child(2)', 1500);
  await click('.item:has(.name[title="Moody Teal"]) input', 250);
  await click('.item:has(.name[title="Night City"]) input', 250);
  await click('.item:has(.name[title="Faded Film"]) input', 1100);
  await click("#createButton", 3600);
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
