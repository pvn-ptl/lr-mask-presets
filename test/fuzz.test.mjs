// Throw broken and random input at the parser and writer: they must either work or fail with a
// clear PresetError, and anything they write must be a well-formed preset.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { convert } from "../web/core/mapping.js";
import { PresetError, parsePreset } from "../web/core/preset.js";
import { TARGETS } from "../web/core/targets.js";
import { buildPreset } from "../web/core/writer.js";
import { FIXTURES, SAMPLES, inspect, xmp } from "./helpers.mjs";

// Small deterministic PRNG so failures are reproducible.
function rng(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const corpus = [
  ...readdirSync(FIXTURES).map((f) => readFileSync(FIXTURES + f, "utf8")),
  ...readdirSync(SAMPLES).filter((f) => f.endsWith(".xmp")).map((f) => readFileSync(SAMPLES + f, "utf8")),
];

function mutate(text, random) {
  const ops = [
    (s, i) => s.slice(0, i) + s.slice(i + 1 + Math.floor(random() * 20)),                       // delete
    (s, i) => s.slice(0, i) + "<>&\"'=/!?[]{}".charAt(Math.floor(random() * 13)) + s.slice(i),   // insert a special char
    (s, i) => s.slice(0, i) + s.slice(i, i + 40) + s.slice(i),                                     // duplicate
    (s, i) => s.slice(0, i),                                                                       // truncate
    (s, i) => s.slice(0, i) + String.fromCharCode(Math.floor(random() * 0x3000)) + s.slice(i + 1), // replace
  ];
  let out = text;
  const n = 1 + Math.floor(random() * 4);
  for (let k = 0; k < n; k++) out = ops[Math.floor(random() * ops.length)](out, Math.floor(random() * out.length));
  return out;
}

test("mutated presets parse or fail cleanly; anything that parses converts to valid XMP", () => {
  const random = rng(1234);
  let parsed = 0, refused = 0;
  for (let i = 0; i < 3000; i++) {
    const text = mutate(corpus[i % corpus.length], random);
    let preset;
    try {
      preset = parsePreset(text);
    } catch (err) {
      assert.ok(err instanceof PresetError, `unexpected ${err?.constructor?.name}: ${err?.message}`);
      refused++;
      continue;
    }
    parsed++;
    const conv = convert(preset, { leftovers: random() < 0.5 ? "global" : "drop" });
    const t = TARGETS[i % TARGETS.length];
    const out = inspect(buildPreset(preset, conv, t.id));
    for (const [key, value] of Object.entries(out.corrections[0].values)) {
      if (key.startsWith("Local") && !key.startsWith("LocalColorGrade") && key !== "LocalCurveRefineSaturation") {
        const v = Number(value);
        assert.ok(Number.isFinite(v) && v >= -1 && v <= 1, `${key}=${value}`);
      }
    }
  }
  assert.ok(parsed > 100 && refused > 100, `parsed ${parsed}, refused ${refused}`);
});

test("random settings never produce out-of-range mask values or broken curves", () => {
  const random = rng(99);
  const keys = ["Exposure2012", "Contrast2012", "Highlights2012", "Shadows2012", "Whites2012", "Blacks2012", "Texture", "Clarity2012", "Dehaze",
    "Saturation", "Vibrance", "IncrementalTemperature", "IncrementalTint", "ParametricShadows", "ParametricDarks", "ParametricLights",
    "ParametricHighlights", "ParametricShadowSplit", "ParametricMidtoneSplit", "ParametricHighlightSplit", "SplitToningShadowHue",
    "SplitToningShadowSaturation", "ColorGradeMidtoneLum", "ColorGradeBlending", "SplitToningBalance"];
  const values = () => ["0", "+100", "-100", "+5.00", "-4.99", "1e3", "-1e9", "abc", "", "+0.0001", String(Math.round((random() - 0.5) * 400))];
  for (let i = 0; i < 1500; i++) {
    const settings = {};
    for (const k of keys) if (random() < 0.5) settings[k] = values()[Math.floor(random() * 11)];
    const curve = random() < 0.5 ? `<crs:ToneCurvePV2012><rdf:Seq>${Array.from({ length: 1 + Math.floor(random() * 6) }, () => `<rdf:li>${Math.floor(random() * 300 - 20)}, ${Math.floor(random() * 300 - 20)}</rdf:li>`).join("")}</rdf:Seq></crs:ToneCurvePV2012>` : "";
    const preset = parsePreset(xmp(settings, { extra: curve }));
    const conv = convert(preset, { vibrance: random() < 0.5, parametric: random() < 0.7 });
    for (const [k, v] of Object.entries(conv.local)) assert.ok(Number.isFinite(v) && v >= -1 && v <= 1, `${k}=${v}`);
    for (const [k, v] of Object.entries(conv.colorGrade)) assert.ok(Number.isInteger(v), `${k}=${v}`);
    for (const pts of Object.values(conv.curves)) {
      for (const [x, y] of pts) assert.ok(Number.isFinite(x) && Number.isFinite(y), JSON.stringify(pts));
    }
    if (!conv.empty) inspect(buildPreset(preset, conv, "background"));
  }
});
