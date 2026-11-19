import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dedupe, loadFiles, planBatch, renderBatch } from "../web/core/library.js";
import { writeZip } from "../web/core/zip.js";
import { SAMPLES, fixtureText, inspect, xmp } from "./helpers.mjs";

const samples = () => readdirSync(SAMPLES).filter((f) => f.endsWith(".xmp")).map((f) => ({ path: `Pack/${f}`, text: readFileSync(SAMPLES + f, "utf8") }));

test("loads presets from files and zip packs, skipping macOS junk, and reports broken files", async () => {
  const zip = writeZip([
    ...samples().map((f) => ({ name: f.path, data: f.text })),
    { name: "__MACOSX/Pack/._Golden-Hour-Glow.xmp", data: "junk" },
    { name: "Pack/._hidden.xmp", data: "junk" },
    { name: "Pack/readme.txt", data: "hi" },
    { name: "Pack/broken.xmp", data: "<oops" },
  ]);
  const { entries, errors } = await loadFiles([
    { path: "Downloads/pack.zip", bytes: zip },
    { path: "Downloads/full_look.xmp", text: fixtureText("full_look.xmp") },
    { path: "Downloads/notes.md", text: "# not a preset" },
  ], { source: "test" });
  assert.equal(entries.length, 9);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /^broken\.xmp: /);
  assert.equal(new Set(entries.map((e) => e.id)).size, 9);
});

test("a damaged zip is an error for that file, not a crash", async () => {
  const { entries, errors } = await loadFiles([{ path: "bad.zip", bytes: new Uint8Array([1, 2, 3]) }, { path: "ok.xmp", text: fixtureText("full_look.xmp") }], { source: "t" });
  assert.equal(entries.length, 1);
  assert.match(errors[0], /^bad\.zip: Not a zip/);
});

test("UTF-16 files (some Windows tools write them) are read", async () => {
  const text = xmp({ Contrast2012: "+5" }, { name: "Wide" });
  const bytes = new Uint8Array(2 + text.length * 2);
  bytes.set([0xff, 0xfe]);
  for (let i = 0; i < text.length; i++) { bytes[2 + i * 2] = text.charCodeAt(i) & 0xff; bytes[3 + i * 2] = text.charCodeAt(i) >> 8; }
  const { entries } = await loadFiles([{ path: "wide.xmp", bytes }], { source: "t" });
  assert.equal(entries[0].preset.name, "Wide");
});

test("photo sidecars and profiles are skipped unless explicitly allowed", async () => {
  const files = [{ path: "IMG_0001.xmp", text: xmp({ Exposure2012: "+1" }, { type: "" }) }, { path: "profile.xmp", text: xmp({}, { type: "Look" }) }];
  assert.equal((await loadFiles(files, { source: "t" })).entries.length, 0);
  assert.equal((await loadFiles(files, { source: "t", allowUntyped: true })).entries.length, 1);
});

test("duplicates (same UUID, or same name+group+settings) are shown once", async () => {
  const a = await loadFiles(samples(), { source: "a" });
  const b = await loadFiles(samples(), { source: "b" });
  const noUuid = xmp({ Contrast2012: "+5" }, { name: "Same" });
  const c = await loadFiles([{ path: "x/1.xmp", text: noUuid }, { path: "y/2.xmp", text: noUuid }], { source: "c" });
  assert.equal(dedupe([...a.entries, ...b.entries]).length, 8);
  assert.equal(dedupe(c.entries).length, 1);
  assert.equal(dedupe([...a.entries, ...b.entries])[0].source, "a");
});

test("batch: presets × masks, skipping empty and already-converted presets", async () => {
  const { entries } = await loadFiles(samples(), { source: "s" });
  const empty = (await loadFiles([{ path: "e.xmp", text: xmp({ HueAdjustmentRed: "+10" }, { name: "Only HSL" }) }], { source: "s" })).entries;
  const { jobs, skipped } = planBatch([...entries, ...empty], ["background", "sky"]);
  assert.equal(jobs.length, 16);
  assert.deepEqual(skipped.map((s) => s.name), ["Only HSL"]);

  const files = renderBatch(jobs);
  assert.equal(new Set(files.map((f) => f.name.toLowerCase())).size, 16);
  const converted = (await loadFiles(files.map((f) => ({ path: f.name, text: f.text })), { source: "out" })).entries;
  const again = planBatch(converted, ["background"]);
  assert.equal(again.jobs.length, 0);
  assert.equal(again.skipped[0].reason, "already made by this app");
});

test("several masks with a template that has no {target}: names say which mask", async () => {
  const { entries } = await loadFiles([{ path: "a.xmp", text: fixtureText("full_look.xmp") }], { source: "s" });
  const { jobs } = planBatch(entries, ["background", "subject"], { groupTemplate: "Masked" });
  const files = renderBatch(jobs).map((f) => inspect(f.text));
  assert.deepEqual(files.map((f) => [f.group, f.name]), [["Masked", "Moody & Warm (Background)"], ["Masked", "Moody & Warm (Subject)"]]);
});

test("same-named presets in one batch get distinct file names", async () => {
  const one = xmp({ Contrast2012: "+5" }, { name: "Look", group: "G" });
  const two = xmp({ Contrast2012: "+9" }, { name: "Look", group: "G" });
  const { entries } = await loadFiles([{ path: "1.xmp", text: one }, { path: "2.xmp", text: two }], { source: "s" });
  const names = renderBatch(planBatch(entries, ["sky"]).jobs).map((f) => f.name);
  assert.deepEqual(names, ["Sky · G - Look.xmp", "Sky · G - Look (2).xmp"]);
});
