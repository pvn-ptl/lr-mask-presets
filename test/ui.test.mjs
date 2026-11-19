// The web UI in headless Chrome (skipped when Chrome isn't installed).

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { findChrome, launch } from "../scripts/cdp.mjs";
import { serve } from "../scripts/serve.mjs";

const skip = findChrome() ? false : "Chrome not installed";
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

test("starts with a welcome screen and no errors", { skip }, async () => {
  await open("");
  assert.match(await page.eval("document.querySelector('#detail').textContent"), /Turn any Lightroom preset/);
  await page.click("#detail .found button:nth-child(3)"); // Try sample presets
  await page.waitFor("app.state.entries.length === 8");
  assert.deepEqual(page.errors, []);
});

test("shows a preset's carry-over table and updates when options change", { skip }, async () => {
  await open();
  await page.eval("app.show('Moody Teal')");
  const before = await page.eval("[...document.querySelectorAll('tr.lost td.setting')].map((td) => td.textContent)");
  assert.ok(before.includes("Color Mixer (HSL)"));
  await page.eval("app.setOption('leftovers', 'global')");
  const after = await page.eval("[...document.querySelectorAll('tr.global td.setting')].map((td) => td.textContent)");
  assert.ok(after.includes("Color Mixer (HSL)"));
  assert.ok(await page.eval("Boolean(document.querySelector('.mini-curve svg polyline'))"));
});

test("search, ticking and the mask chips drive the tally", { skip }, async () => {
  await open();
  await page.eval("document.querySelector('#search').value = 'moody'; document.querySelector('#search').dispatchEvent(new Event('input'))");
  assert.equal(await page.eval("document.querySelectorAll('#list .item').length"), 3);
  await page.click("#listTools input[type=checkbox]");
  await page.click('[data-target="sky"]');
  assert.match(await page.eval("document.querySelector('.tally').textContent"), /3 presets × 2 masks = 6 new presets/);
  assert.match(await page.eval("document.querySelector('#createButton').textContent"), /Create 6 presets/);
});

test("creating presets downloads a zip and explains how to import it", { skip }, async () => {
  await open();
  await page.send("Browser.setDownloadBehavior", { behavior: "deny" }).catch(() => {});
  await page.eval("app.check(['Golden Hour Glow', 'Night City']); app.setTargets(['background', 'hair'])");
  const result = await page.eval("app.create()");
  assert.equal(result.count, 4);
  assert.match(result.zip, /Background|2 masks/);
  assert.match(await page.eval("document.querySelector('dialog').textContent"), /4 presets ready.*Import Profiles & Presets/s);
  assert.deepEqual(page.errors, []);
});

test("preset names from files are shown as text, never run as HTML", { skip }, async () => {
  await open();
  const evil = `<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmlns:crs="http://ns.adobe.com/camera-raw-settings/1.0/" crs:PresetType="Normal" crs:Contrast2012="+10"><crs:Name><rdf:Alt><rdf:li xml:lang="x-default">&lt;img src=x onerror="window.pwned=1"&gt;</rdf:li></rdf:Alt></crs:Name><crs:Group><rdf:Alt><rdf:li xml:lang="x-default">&lt;b&gt;bold&lt;/b&gt;</rdf:li></rdf:Alt></crs:Group></rdf:Description></rdf:RDF></x:xmpmeta>`;
  await page.eval(`app.addFiles([{ path: "evil.xmp", text: ${JSON.stringify(evil)} }])`);
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(await page.eval("document.querySelectorAll('#list img, #detail img, #list b, #detail h2 b').length"), 0);
  assert.equal(await page.eval("window.pwned === undefined"), true);
  assert.match(await page.eval("document.querySelector('#detail h2').textContent"), /<img src=x/);
});

test("dropping a broken file explains the problem", { skip }, async () => {
  await open();
  await page.eval(`app.addFiles([{ path: "broken.xmp", text: "<nope" }])`);
  await page.waitFor("document.querySelector('#toast').classList.contains('show')");
  assert.match(await page.eval("document.querySelector('#toast').textContent"), /broken\.xmp/);
});

test("layout holds at narrow and wide sizes in both themes", { skip }, async () => {
  for (const [width, theme] of [[1440, "light"], [1100, "dark"], [860, "light"], [420, "dark"]]) {
    await page.send("Emulation.setDeviceMetricsOverride", { width, height: 820, deviceScaleFactor: 1, mobile: false });
    await open(`demo&theme=${theme}`);
    const overflow = await page.eval("document.documentElement.scrollWidth - document.documentElement.clientWidth");
    assert.ok(overflow <= 0, `${width}px scrolls sideways by ${overflow}px`);
    assert.ok(await page.eval("document.querySelector('#createButton').getBoundingClientRect().width > 100"), `${width}px create button`);
  }
  await page.send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 820, deviceScaleFactor: 1, mobile: false });
});
