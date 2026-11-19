// Sharpening & noise in masks, mask combinations and mask strength (Amount).

import { test } from "node:test";
import assert from "node:assert/strict";
import { APPROX, GLOBAL, LOST, convert } from "../web/core/mapping.js";
import { parsePreset } from "../web/core/preset.js";
import { combinable, combineTargets, comboParts, isTarget, parseMaskSpec, target, TARGETS } from "../web/core/targets.js";
import { buildPreset, normalAmount } from "../web/core/writer.js";
import { planBatch, presetTitle, renderBatch } from "../web/core/library.js";
import { inspect, load, statuses, xmp } from "./helpers.mjs";

const preset = (settings, opts) => parsePreset(xmp(settings, opts));

// ---------- sharpening and noise reduction ----------

test("sharpening above Lightroom's default goes into the mask's Sharpness", () => {
  const conv = convert(preset({ Sharpness: "70", SharpenRadius: "+1.0", Contrast2012: "+10" }));
  assert.equal(conv.local.LocalSharpness, 0.3);
  assert.equal(statuses(conv).Sharpening, APPROX);
  assert.match(conv.rows.find((r) => r.label === "Sharpening").after, /\+30 Sharpness/);
});

test("default sharpening isn't reported; less than the default can't be made with a mask", () => {
  assert.equal(statuses(convert(preset({ Sharpness: "40", Contrast2012: "+10" }))).Sharpening, undefined);
  const low = convert(preset({ Sharpness: "0", Contrast2012: "+10" }));
  assert.equal(low.local.LocalSharpness, undefined);
  assert.equal(statuses(low).Sharpening, LOST);
  const kept = convert(preset({ Sharpness: "0", SharpenDetail: "25", Contrast2012: "+10" }), { leftovers: "global" });
  assert.equal(statuses(kept).Sharpening, GLOBAL);
  assert.deepEqual(kept.globals.settings, { Sharpness: "0", SharpenDetail: "25" });
});

test("luminance noise reduction goes into the mask's Noise slider", () => {
  const p = preset({ LuminanceSmoothing: "35", LuminanceNoiseReductionDetail: "50" });
  const conv = convert(p);
  assert.equal(conv.local.LocalLuminanceNoise, 0.35);
  assert.equal(statuses(conv)["Noise reduction"], APPROX);
  assert.equal(conv.empty, false);
  const text = buildPreset(p, conv, "background");
  assert.equal(inspect(text).corrections[0].values.LocalLuminanceNoise, "0.35");
});

test("sharpening & noise option off: reported, not put in the mask", () => {
  const conv = convert(preset({ Sharpness: "80", LuminanceSmoothing: "20", Exposure2012: "+0.5" }), { detail: false });
  assert.equal(conv.local.LocalSharpness, undefined);
  assert.equal(conv.local.LocalLuminanceNoise, undefined);
  assert.equal(statuses(conv).Sharpening, LOST);
  assert.equal(statuses(conv)["Noise reduction"], LOST);
});

// ---------- combinations ----------

test("a combination is start + additions − subtractions, written as Lightroom's Add and Subtract", () => {
  const id = combineTargets("subject", { add: ["water"], subtract: ["hair"] });
  assert.equal(id, "combo:subject/+water/-hair");
  const t = target(id);
  assert.equal(t.label, "Subject + Water − Hair");
  assert.equal(t.family, "combined");
  const masks = inspect(buildPreset(load("full_look.xmp"), convert(load("full_look.xmp")), id)).corrections[0].masks;
  assert.deepEqual(masks.map((m) => [m.MaskSubType, m.MaskSubCategoryID, m.MaskBlendMode, m.MaskValue, m.MaskInverted]), [
    ["1", undefined, "0", "1", "false"],      // Subject
    ["0", "50007", "0", "1", "false"],        // + Water
    ["3", "5", "1", "0", "false"],            // − Hair
  ]);
  assert.equal(new Set(masks.map((m) => m.MaskSyncID)).size, 3);
});

test("multi-part masks add or subtract every part; subtracting an inverted mask keeps the overlap", () => {
  const skin = target(combineTargets("people", { subtract: ["skin"] })).components;
  assert.deepEqual(skin.map((c) => [c.category, Boolean(c.subtract)]), [["13", false], ["2", true], ["4", true]]);
  const overlap = target(combineTargets("background", { subtract: ["not-sky"] })).components;
  assert.deepEqual(overlap.map((c) => [c.subType, Boolean(c.subtract), Boolean(c.inverted)]), [["0", false, false], ["2", true, true]]);
});

test("equal recipes give the same id (and so the same presets), whatever the order", () => {
  const a = combineTargets("sky", { add: ["water", "mountains"], subtract: [] });
  const b = combineTargets("sky", { add: ["mountains", "water", "water"] });
  assert.equal(a, b);
  assert.equal(parseMaskSpec("sky +water +mountains"), a);
  assert.equal(parseMaskSpec("sky −hair +water +mountains"), combineTargets("sky", { add: ["water", "mountains"], subtract: ["hair"] }));
  assert.equal(parseMaskSpec(a), a);
  assert.equal(parseMaskSpec("sky"), "sky");
  const p = load("full_look.xmp"), conv = convert(p);
  const ids = (text) => inspect(text).top.UUID;
  assert.equal(ids(buildPreset(p, conv, a)), ids(buildPreset(p, conv, b)));
  assert.notEqual(ids(buildPreset(p, conv, a)), ids(buildPreset(p, conv, "sky")));
});

test("recipes that don't make sense are refused with a reason", () => {
  assert.throws(() => combineTargets("sky"), /at least one/);
  assert.throws(() => combineTargets("sky", { add: ["sky"] }), /each mask once/);
  assert.throws(() => combineTargets("sky", { add: ["background-no-sky"] }), /starting mask/);
  assert.throws(() => combineTargets("nope", { add: ["sky"] }), /Unknown mask/);
  assert.throws(() => combineTargets("sky", { add: TARGETS.filter((t) => t.id !== "sky" && combinable(t.id)).slice(0, 7).map((t) => t.id) }), /up to 6/);
  assert.throws(() => parseMaskSpec("sky water"), /put \+ or -/);
  assert.throws(() => target("combo:sky/~water"), /Unknown mask/);
  assert.equal(isTarget("combo:sky/+water"), true);
  assert.equal(isTarget("combo:sky"), false);
  assert.equal(isTarget("combo:<script>"), false);
  assert.equal(comboParts("sky"), null);
  assert.ok(combinable("not-sky") && !combinable("background-no-sky"));
});

// ---------- strength ----------

test("strength is the mask's Amount and part of the name; full strength changes nothing", () => {
  const p = load("full_look.xmp"), conv = convert(p);
  const full = inspect(buildPreset(p, conv, "sky"));
  const half = inspect(buildPreset(p, conv, "sky", { amount: 0.5, name: "Moody & Warm (50%)" }));
  assert.equal(full.corrections[0].values.CorrectionAmount, "1");
  assert.equal(half.corrections[0].values.CorrectionAmount, "0.5");
  assert.equal(half.corrections[0].values.LocalContrast2012, full.corrections[0].values.LocalContrast2012); // the sliders stay exact
  assert.notEqual(half.top.UUID, full.top.UUID); // a lighter version doesn't replace the full one
  assert.match(half.description, /at 50%/);
  assert.equal(normalAmount(0.755), 0.76);
  for (const bad of [0, -1, 2, "x", undefined, NaN]) assert.equal(normalAmount(bad), 1);
});

test("batch names say the strength (and the mask, when the group doesn't)", async () => {
  assert.equal(presetTitle("Moody", "sky", { amount: 0.75 }), "Moody (75%)");
  assert.equal(presetTitle("Moody", "sky", { targetCount: 2, groupTemplate: "{group}", amount: 0.5 }), "Moody (Sky, 50%)");
  assert.equal(presetTitle("Moody", "sky", { targetCount: 2 }), "Moody");
  const entry = { id: "a", preset: load("full_look.xmp") };
  const { jobs } = planBatch([entry], ["sky", combineTargets("subject", { add: ["water"] })], { amount: 0.25 });
  const files = renderBatch(jobs);
  assert.deepEqual(files.map((f) => inspect(f.text).name), ["Moody & Warm (25%)", "Moody & Warm (25%)"]);
  assert.deepEqual(files.map((f) => inspect(f.text).group), ["Sky · Test Looks", "Subject + Water · Test Looks"]);
  assert.ok(files.every((f) => inspect(f.text).corrections[0].values.CorrectionAmount === "0.25"));
});
