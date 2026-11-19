import { test } from "node:test";
import assert from "node:assert/strict";
import * as curves from "../web/core/curves.js";
import { APPROX, EXACT, GLOBAL, LOST, convert } from "../web/core/mapping.js";
import { parsePreset } from "../web/core/preset.js";
import { load, statuses, xmp } from "./helpers.mjs";

const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`);

test("slider scales match Lightroom's own masks (Exposure ÷ 4, the rest ÷ 100)", () => {
  const { local } = convert(load("full_look.xmp"));
  near(local.LocalExposure2012, 0.125);
  near(local.LocalContrast2012, 0.2);
  near(local.LocalHighlights2012, -0.3);
  near(local.LocalShadows2012, 0.4);
  near(local.LocalTexture, 0.12);
  near(local.LocalDehaze, 0.05);
  near(local.LocalSaturation, -0.1);
});

test("color grading carries over one to one", () => {
  const grade = convert(load("full_look.xmp")).colorGrade;
  assert.equal(grade.LocalColorGradeShadowHue, 220);
  assert.equal(grade.LocalColorGradeShadowSat, 18);
  assert.equal(grade.LocalColorGradeHighlightSat, 22);
  assert.equal(grade.LocalColorGradeMidtoneHue, 30);
  assert.equal(grade.LocalColorGradeBalance, -10);
  assert.equal(grade.LocalColorGradeBlending, 60);
});

test("curves pass through; identity channel curves are dropped", () => {
  const conv = convert(load("full_look.xmp"));
  assert.deepEqual(conv.curves.MainCurve, [[0, 20], [64, 58], [192, 200], [255, 240]]);
  assert.deepEqual(conv.curves.BlueCurve, [[0, 10], [255, 245]]);
  assert.equal(conv.curves.RedCurve, undefined);
});

test("reports what can't carry over; the default profile isn't counted", () => {
  const s = statuses(convert(load("full_look.xmp")));
  for (const label of ["Color Mixer (HSL)", "Vibrance", "White Balance", "Vignette", "Grain"]) assert.equal(s[label], LOST, label);
  assert.equal(s.Profile, undefined);
  assert.equal(s.Exposure, EXACT);
  assert.equal(s["Tone Curve"], EXACT);
});

test("Vibrance → Saturation option", () => {
  const conv = convert(load("full_look.xmp"), { vibrance: true });
  near(conv.local.LocalSaturation, -0.1 + 0.26 * 0.5);
  assert.equal(statuses(conv).Vibrance, APPROX);
});

test("exposure beyond a mask's ±4 EV is clamped and flagged", () => {
  const conv = convert(load("mono_fade.xmp"));
  assert.equal(conv.local.LocalExposure2012, 1);
  assert.equal(statuses(conv).Exposure, APPROX);
  const row = conv.rows.find((r) => r.label === "Exposure");
  assert.equal(row.after, "+4.00");
  assert.match(row.note, /±4 EV/);
});

test("black & white and relative white balance", () => {
  const conv = convert(load("mono_fade.xmp"));
  assert.equal(conv.local.LocalSaturation, -1);
  near(conv.local.LocalTemperature, 0.15);
  near(conv.local.LocalTint, -0.05);
  const s = statuses(conv);
  assert.equal(s["Black & White"], APPROX);
  assert.equal(s["B&W Mix"], LOST);
  assert.equal(s["Existing masks"], LOST);
  assert.equal(s["White Balance"], undefined);
});

test("B&W option off", () => {
  const conv = convert(load("mono_fade.xmp"), { grayscale: false });
  assert.equal(conv.local.LocalSaturation, undefined);
  assert.equal(statuses(conv)["Black & White"], LOST);
});

test("parametric curve is traced as a monotonic point curve", () => {
  const conv = convert(load("mono_fade.xmp"));
  const main = conv.curves.MainCurve;
  assert.deepEqual(main[0], [0, 0]);
  assert.deepEqual(main.at(-1), [255, 255]);
  const ys = main.map(([, y]) => y);
  assert.deepEqual(ys, [...ys].sort((a, b) => a - b));
  const at = Object.fromEntries(main);
  assert.ok(at[32] > 32, "Shadows +30 lifts the shadows");
  assert.ok(at[223] < 223, "Highlights -25 pulls highlights down");
  assert.equal(statuses(conv)["Parametric curve"], APPROX);
});

test("parametric option off", () => {
  const conv = convert(load("mono_fade.xmp"), { parametric: false });
  assert.equal(conv.curves.MainCurve, undefined);
  assert.equal(statuses(conv)["Parametric curve"], LOST);
});

test("a named curve is used when the points are missing", () => {
  const preset = load("full_look.xmp");
  delete preset.curves.ToneCurvePV2012;
  preset.settings.ToneCurveName2012 = "Medium Contrast";
  assert.deepEqual(convert(preset).curves.MainCurve, curves.NAMED["Medium Contrast"]);
});

test("“Whole photo” keeps what masks can't hold as global settings", () => {
  const conv = convert(load("full_look.xmp"), { leftovers: "global" });
  const s = statuses(conv);
  for (const label of ["Color Mixer (HSL)", "Vibrance", "White Balance", "Vignette", "Grain"]) assert.equal(s[label], GLOBAL, label);
  assert.equal(conv.globals.settings.HueAdjustmentRed, "+12");
  assert.equal(conv.globals.settings.SaturationAdjustmentBlue, "-40");
  assert.equal(conv.globals.settings.Vibrance, "+26");
  assert.equal(conv.globals.settings.Temperature, "5600");
  assert.equal(conv.globals.settings.WhiteBalance, "Custom");
  assert.ok(Object.keys(conv.globals.settings).some((k) => k.startsWith("PostCropVignette")));
  // Things that went into the mask aren't duplicated globally.
  assert.equal(conv.globals.settings.Exposure2012, undefined);
  assert.equal(conv.globals.settings.Contrast2012, undefined);
  // Existing masks can't be kept either way.
  assert.equal(statuses(convert(load("mono_fade.xmp"), { leftovers: "global" }))["Existing masks"], LOST);
});

test("a non-default profile and a creative profile can be kept on the whole photo", () => {
  const look = '<crs:Look><rdf:Description crs:Name="Vintage 03" crs:Amount="0.8"/></crs:Look>';
  const preset = parsePreset(xmp({ Contrast2012: "+5", CameraProfile: "Camera Landscape" }, { extra: look }));
  const dropped = statuses(convert(preset));
  assert.equal(dropped.Profile, LOST);
  assert.equal(dropped["Creative profile"], LOST);
  const kept = convert(preset, { leftovers: "global" });
  assert.equal(statuses(kept).Profile, GLOBAL);
  assert.equal(statuses(kept)["Creative profile"], GLOBAL);
  assert.equal(kept.globals.elements.length, 1);
  assert.equal(kept.rows.find((r) => r.label === "Creative profile").before, "Vintage 03");
});

test("As Shot white balance isn't reported; Kelvin is", () => {
  assert.equal(statuses(convert(parsePreset(xmp({ WhiteBalance: "As Shot", Temperature: "5000", Contrast2012: "+5" }))))["White Balance"], undefined);
  assert.equal(statuses(convert(parsePreset(xmp({ WhiteBalance: "Daylight", Contrast2012: "+5" }))))["White Balance"], LOST);
});

test("Point Color only counts when it's actually used", () => {
  const unused = '<crs:PointColors><rdf:Seq><rdf:li>-1.000000, -1.000000, -1.000000, -1.000000</rdf:li></rdf:Seq></crs:PointColors>';
  const used = '<crs:PointColors><rdf:Seq><rdf:li>0.25, 0.5, -1, 12</rdf:li></rdf:Seq></crs:PointColors>';
  assert.equal(statuses(convert(parsePreset(xmp({ Contrast2012: "+5" }, { extra: unused }))))["Point Color"], undefined);
  assert.equal(statuses(convert(parsePreset(xmp({ Contrast2012: "+5" }, { extra: used }))))["Point Color"], LOST);
});

test("a preset with nothing maskable is empty; coverage is 0..1", () => {
  const conv = convert(parsePreset(xmp({ HueAdjustmentRed: "+20", PostCropVignetteAmount: "-30" })));
  assert.equal(conv.empty, true);
  assert.equal(conv.coverage, 0);
  const full = convert(parsePreset(xmp({ Exposure2012: "+0.5", Contrast2012: "+10" })));
  assert.equal(full.empty, false);
  assert.equal(full.coverage, 1);
});

test("garbage numbers don't produce garbage output", () => {
  const conv = convert(parsePreset(xmp({ Exposure2012: "abc", Contrast2012: "1e9", Shadows2012: "-Infinity", Whites2012: "NaN", Blacks2012: "" })));
  for (const [key, value] of Object.entries(conv.local)) {
    assert.ok(Number.isFinite(value) && value >= -1 && value <= 1, `${key}=${value}`);
  }
});
