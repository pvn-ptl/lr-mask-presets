// Fit and finish in headless Chrome: icons centred, every sheet and popover inside the window at the smallest size,
// the appearance switch, the inspector's mask preview, the done sheet's fan and Reduce Motion. Skipped without Chrome.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { findChrome, launch } from "../scripts/cdp.mjs";
import { serve } from "../scripts/serve.mjs";
import { regionsOf, REGIONS } from "../web/swatch.js";
import { TARGETS } from "../web/core/targets.js";

const skip = findChrome() ? false : "Chrome not installed";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let server, page, base;

before(async () => {
  if (skip) return;
  server = await serve();
  base = `http://127.0.0.1:${server.address().port}/`;
  page = await launch({ width: 1280, height: 820, scale: 1 });
});

after(async () => {
  await page?.close();
  server?.close();
});

async function open(query = "demo") {
  page.errors.length = 0;
  await page.goto(`${base}?${query}`);
  await page.waitFor("document.documentElement.dataset.ready === '1'");
}

// Where an icon's ink is (stroke included), in screen pixels.
const INK = `(svg) => {
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  for (const s of svg.querySelectorAll("path, circle, rect, ellipse, line, polyline")) {
    const b = s.getBBox(), m = s.getScreenCTM();
    const w = s.getAttribute("stroke") === "none" ? 0 : Number(s.closest("[stroke-width]").getAttribute("stroke-width")) / 2;
    for (const [x, y] of [[b.x - w, b.y - w], [b.x + b.width + w, b.y + b.height + w]]) {
      const p = new DOMPoint(x, y).matrixTransform(m);
      x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y);
    }
  }
  return { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, w: x1 - x0, h: y1 - y0 };
}`;

test("every icon's ink is centred in its grid", { skip }, async () => {
  await open();
  const off = await page.eval(`(async () => {
    const { icon, ICON_NAMES } = await import("/icons.js");
    const ink = ${INK};
    const out = [];
    for (const name of ICON_NAMES) {
      const el = icon(name, 240); document.body.append(el);
      const box = el.querySelector("svg").getBoundingClientRect(), i = ink(el.querySelector("svg"));
      const dx = (i.cx - box.left - box.width / 2) / 10, dy = (i.cy - box.top - box.height / 2) / 10; // in grid units
      if (Math.abs(dx) > 0.4 || Math.abs(dy) > 0.4) out.push(name + " " + dx.toFixed(2) + "," + dy.toFixed(2));
      if (i.w / 10 > 21.5 && i.h / 10 > 21.5) out.push(name + " fills the whole grid");
      el.remove();
    }
    return out;
  })()`);
  assert.deepEqual(off, []);
});

test("icon-only controls hold their icon dead centre", { skip }, async () => {
  await open("demo&theme=dark");
  await page.eval("app.setTargets(['sky', 'water'])");
  await sleep(500);
  const off = await page.eval(`(() => {
    const ink = ${INK};
    const out = [];
    const seen = (el) => { for (let a = el; a; a = a.parentElement) if (Number(getComputedStyle(a).opacity) < 0.5) return false; return true; };
    for (const b of document.querySelectorAll("button")) {
      const svg = [...b.querySelectorAll(".icon svg")].find(seen);
      if (!svg || !b.getClientRects().length || b.textContent.trim()) continue;
      const r = b.getBoundingClientRect(), i = ink(svg);
      const dx = i.cx - (r.left + r.width / 2), dy = i.cy - (r.top + r.height / 2);
      if (Math.abs(dx) > 0.6 || Math.abs(dy) > 0.6) out.push((b.id || b.className) + " " + dx.toFixed(2) + "," + dy.toFixed(2));
    }
    return out;
  })()`);
  assert.deepEqual(off, []);
});

// Is the open sheet or popover inside the window, without anything inside it wider than it?
const FITS = `(() => {
  const out = [], vw = innerWidth, vh = innerHeight;
  for (const el of document.querySelectorAll("dialog[open], .popover:not(.closing)")) {
    const r = el.getBoundingClientRect();
    if (r.left < -0.5 || r.top < -0.5 || r.right > vw + 0.5 || r.bottom > vh + 0.5) out.push(el.id || el.tagName, "outside the window", JSON.stringify([r.left, r.top, r.right, r.bottom].map(Math.round)));
    for (const box of el.querySelectorAll("*")) {
      const b = box.getBoundingClientRect();
      if (!b.width || box.closest(".deal")) continue; // the fan's cards are rotated on purpose
      if (["auto", "scroll"].includes(getComputedStyle(box).overflowX) && box.scrollWidth > box.clientWidth + 1) out.push((box.className || box.tagName) + " scrolls sideways");
      if (b.right > r.right + 0.5 || b.left < r.left - 0.5) out.push((box.className || box.tagName) + " sticks out of " + (el.id || el.tagName));
    }
  }
  return out;
})()`;

test("every sheet and popover fits the smallest window", { skip }, async () => {
  await page.send("Browser.setDownloadBehavior", { behavior: "deny" }).catch(() => {});
  const surfaces = {
    "settings: sources": "app.showSettings('sources')",
    "settings: output": "app.showSettings('output')",
    "settings: about": "app.showSettings('about')",
    "done sheet": "app.check(app.state.entries.slice(0, 5).map((e) => e.preset.name)); app.setTargets(['sky', 'water']); app.create()",
    "mask picker": "app.openMasks()",
    "combine masks": "app.openMasks(); setTimeout(() => document.querySelector('#combineButton').click(), 300)",
    "add menu": "document.querySelector('#addButton').click()",
  };
  for (const [width, height] of [[980, 620], [2560, 1440]]) {
    await page.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
    for (const [name, js] of Object.entries(surfaces)) {
      await open("demo&theme=dark");
      await page.eval(js);
      await sleep(900);
      assert.deepEqual(await page.eval(FITS), [], `${name} at ${width}×${height}`);
    }
  }
  await page.send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 820, deviceScaleFactor: 1, mobile: false });
  assert.deepEqual(page.errors, []);
});

test("the appearance switch flips the scheme, says what it will do, and is remembered", { skip }, async () => {
  await open("demo");
  await page.eval("localStorage.clear()");
  await open("demo");
  const before = await page.eval("document.documentElement.dataset.scheme");
  await page.click("#toggleTheme");
  await sleep(900);
  const after = await page.eval("document.documentElement.dataset.scheme");
  assert.notEqual(after, before);
  assert.equal(await page.eval("document.documentElement.dataset.theme"), after);
  const says = `switch to ${before} appearance`;
  assert.equal((await page.eval("document.querySelector('#toggleTheme').getAttribute('aria-label')")).toLowerCase(), says);
  assert.equal((await page.eval("document.querySelector('#toggleTheme').title")).toLowerCase(), says);
  assert.equal(await page.eval("JSON.parse(localStorage.getItem('lr-mask-presets:settings')).theme"), after);
  await open("demo");
  assert.equal(await page.eval("document.documentElement.dataset.scheme"), after, "survives a restart");
  await page.eval("localStorage.clear()");
});

test("sheet tabs move with the arrow keys and keep focus", { skip }, async () => {
  await open();
  await page.eval("app.showSettings('sources')");
  await sleep(300);
  await page.eval("document.querySelector('dialog [role=tab][data-tab=sources]').focus()");
  await page.send("Input.dispatchKeyEvent", { type: "keyDown", key: "ArrowRight", code: "ArrowRight", windowsVirtualKeyCode: 39 });
  await page.send("Input.dispatchKeyEvent", { type: "keyUp", key: "ArrowRight", code: "ArrowRight", windowsVirtualKeyCode: 39 });
  await sleep(200);
  assert.equal(await page.eval("document.querySelector('dialog [role=tab][aria-selected=true]').dataset.tab"), "output");
  assert.equal(await page.eval("document.activeElement.dataset.tab"), "output");
});

test("the inspector shows the look only inside the chosen mask", { skip }, async () => {
  await open("demo&theme=dark");
  await page.eval("app.show('Moody Teal'); app.setTargets(['sky'])");
  await sleep(700);
  const caption = () => page.eval("document.querySelector('#detail .hero-swatch figcaption').textContent");
  assert.equal(await caption(), "Inside Sky");
  // The look layer is opaque in the sky and transparent over the lake (fractions of the 640 × 400 picture).
  const alpha = (x, y) => page.eval(`(() => { const c = [...document.querySelectorAll('#detail .hero-frame .look')].pop(); return c.getContext('2d').getImageData(${Math.round(x * 640)}, ${Math.round(y * 400)}, 1, 1).data[3]; })()`);
  assert.equal(await alpha(0.5, 0.05), 255);
  assert.equal(await alpha(0.5, 0.65), 0);

  await page.eval("app.setTargets(['sky', 'water'])");
  await sleep(300);
  assert.equal(await caption(), "Inside Sky1/2");
  await page.click("#detail .hero-next");
  await sleep(800);
  assert.equal(await caption(), "Inside Water2/2");
  assert.equal(await alpha(0.5, 0.65), 255);
  assert.equal(await page.eval("document.querySelectorAll('#detail .hero-frame .look').length"), 1, "the old look is gone once the new one is in");

  await page.click("#detail .hero-mask");
  assert.equal(await page.eval("document.querySelector('#detail .hero-mask').getAttribute('aria-pressed')"), "true");
  assert.equal(await page.eval("getComputedStyle(document.querySelector('#detail .hero-frame .tint')).opacity"), "1");
  await page.click("#detail .hero-mask");
  assert.deepEqual(page.errors, []);
});

test("the done sheet deals a fan of what was made, once", { skip }, async () => {
  await open();
  await page.send("Browser.setDownloadBehavior", { behavior: "deny" }).catch(() => {});
  await page.eval("app.check(['Golden Hour Glow', 'Night City', 'Mono Matte']); app.setTargets(['background', 'sky'])");
  await page.eval("app.create()");
  assert.equal(await page.eval("document.querySelectorAll('dialog .deal .card canvas').length"), 5, "six presets, five cards");
  assert.equal(await page.eval("document.querySelector('dialog .deal').classList.contains('dealing')"), true);
  await page.click("dialog [role=tab][data-tab=classic]");
  assert.equal(await page.eval("document.querySelector('dialog .deal').classList.contains('dealing')"), false, "switching tabs doesn't deal again");
  assert.deepEqual(page.errors, []);
});

test("Reduce Motion: nothing travels", { skip }, async () => {
  await page.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
  try {
    await open("");
    await page.click("#list .found button:nth-child(3)"); // Try sample presets: the library's first appearance
    await page.waitFor("app.state.entries.length === 8");
    assert.equal(await page.eval("document.querySelectorAll('#list .item.arrive').length"), 0, "no cascade");
    await page.send("Browser.setDownloadBehavior", { behavior: "deny" }).catch(() => {});
    await page.eval("app.check(['Golden Hour Glow', 'Night City']); app.setTargets(['sky'])");
    await page.eval("app.create()");
    assert.equal(await page.eval("getComputedStyle(document.querySelector('dialog .deal .card')).animationName"), "fade-in");
    assert.equal(await page.eval("getComputedStyle(document.querySelector('#aurora .a1')).translate"), "none");
  } finally {
    await page.send("Emulation.setEmulatedMedia", { features: [] });
  }
});

test("a library's first appearance arrives in one short cascade", { skip }, async () => {
  await open("");
  await page.click("#list .found button:nth-child(3)");
  await page.waitFor("app.state.entries.length === 8");
  assert.equal(await page.eval("document.querySelectorAll('#list .item.arrive').length"), 8);
  await page.eval("app.setView('list')");
  await sleep(200);
  assert.equal(await page.eval("document.querySelectorAll('#list .item.arrive').length"), 0, "later renders just appear");
});

test("every mask the app offers covers part of the sample scene", () => {
  for (const t of TARGETS) {
    const regions = regionsOf(t.id);
    assert.ok(regions.length > 0, t.id);
    for (const r of regions) assert.ok(REGIONS.includes(r), `${t.id}: ${r}`);
  }
  assert.deepEqual(regionsOf("background").filter((r) => ["hair", "clothes", "face-skin", "body-skin"].includes(r)), []);
  assert.deepEqual(regionsOf("combo:subject/+water/-hair"), ["water", "clothes", "body-skin", "face-skin"]);
  assert.equal(regionsOf(null).length, REGIONS.length, "no mask: the whole frame");
});
