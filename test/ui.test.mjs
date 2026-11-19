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
  assert.match(await page.eval("document.querySelector('#list').textContent"), /Turn any Lightroom preset/);
  await page.click("#list .found button:nth-child(3)"); // Try sample presets
  await page.waitFor("app.state.entries.length === 8");
  assert.deepEqual(page.errors, []);
});

test("shows a preset's carry-over table and updates when options change", { skip }, async () => {
  await open();
  await page.eval("app.show('Moody Teal')");
  const before = await page.eval("[...document.querySelectorAll('#detail .inspector-scroll:not(.leaving) tr.lost td.setting')].map((td) => td.firstChild.textContent)");
  assert.ok(before.includes("Color Mixer (HSL)"));
  await page.eval("app.setOption('leftovers', 'global')");
  const after = await page.eval("[...document.querySelectorAll('#detail .inspector-scroll:not(.leaving) tr.global td.setting')].map((td) => td.firstChild.textContent)");
  assert.ok(after.includes("Color Mixer (HSL)"));
  assert.ok(await page.eval("Boolean(document.querySelector('.mini-curve svg polyline'))"));
});

test("search, ticking and the mask chips drive the tally", { skip }, async () => {
  await open();
  await page.eval("document.querySelector('#search').value = 'moody'; document.querySelector('#search').dispatchEvent(new Event('input'))");
  assert.equal(await page.eval("document.querySelectorAll('#list .item').length"), 3);
  await page.click("#selectAll");
  await page.click("#masksButton");
  await page.click('[data-target="sky"]');
  assert.match(await page.eval("document.querySelector('.tally').textContent"), /3 presets × 2 masks = 6 new presets/);
  assert.match(await page.eval("document.querySelector('#createButton').textContent"), /Create 6 Presets/);
  assert.equal(await page.eval("document.querySelectorAll('#bar .chip[data-chip]').length"), 2);
});

test("list view sorts, and clicks select like Finder", { skip }, async () => {
  await open("demo&view=list");
  assert.equal(await page.eval("document.querySelectorAll('#list .row').length"), 8);
  const names = () => page.eval("[...document.querySelectorAll('#list .row .name')].map((n) => n.textContent)");
  const first = (await names())[0];
  await page.click("#list .list-head .sort");
  assert.notEqual((await names())[0], first, "clicking Name again reverses the order");
  await page.click("#list .row:nth-of-type(2)");
  assert.equal(await page.eval("app.state.checked.size"), 1);
  await page.eval(`(() => { const r = document.querySelector('#list .row:nth-of-type(5)'); r.dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true })); })()`);
  assert.equal(await page.eval("app.state.checked.size"), 4, "shift-click selects the range");
  await page.eval(`(() => { const r = document.querySelector('#list .row:nth-of-type(3)'); r.dispatchEvent(new MouseEvent('click', { bubbles: true, metaKey: true })); })()`);
  assert.equal(await page.eval("app.state.checked.size"), 3, "command-click toggles one");
  assert.match(await page.eval("document.querySelector('#createButton').textContent"), /Create 3 Presets/);
  await page.eval("app.setView('grid')");
  await page.waitFor("document.querySelectorAll('#list .tile').length === 8");
  assert.equal(await page.eval("document.querySelectorAll('#list .tile[aria-selected=true]').length"), 3, "the selection survives the switch");
  assert.deepEqual(page.errors, []);
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
  assert.match(await page.eval("document.querySelector('#detail .inspector-scroll:not(.leaving) h2.title').textContent"), /<img src=x/);
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
