// Translate a preset's global settings into one masked adjustment.
//
// Scales were checked against files Lightroom wrote itself (Adobe's adaptive presets and masks saved
// from Lightroom 10): mask sliders are stored as -1..1, so a global +20 becomes 0.2, and mask
// Exposure (±4 EV) is stored divided by 4. Color grading uses the same numbers globally and in masks.

import * as curves from "./curves.js";
import { num } from "./preset.js";

export const EXACT = "exact", APPROX = "approx", LOST = "lost", GLOBAL = "global";

// [global key, mask key, label, slider units per stored unit, decimals shown]
const SLIDERS = [
  ["Exposure2012", "LocalExposure2012", "Exposure", 4, 2],
  ["Contrast2012", "LocalContrast2012", "Contrast", 100, 0],
  ["Highlights2012", "LocalHighlights2012", "Highlights", 100, 0],
  ["Shadows2012", "LocalShadows2012", "Shadows", 100, 0],
  ["Whites2012", "LocalWhites2012", "Whites", 100, 0],
  ["Blacks2012", "LocalBlacks2012", "Blacks", 100, 0],
  ["Texture", "LocalTexture", "Texture", 100, 0],
  ["Clarity2012", "LocalClarity2012", "Clarity", 100, 0],
  ["Dehaze", "LocalDehaze", "Dehaze", 100, 0],
  ["IncrementalTemperature", "LocalTemperature", "Temp", 100, 0],
  ["IncrementalTint", "LocalTint", "Tint", 100, 0],
];

// Color grading wheels: [label, global hue/sat/lum keys, mask key infix]. Split toning is how
// Lightroom stores the Shadows and Highlights wheels.
const WHEELS = [
  ["Shadows", ["SplitToningShadowHue", "SplitToningShadowSaturation", "ColorGradeShadowLum"], "Shadow"],
  ["Midtones", ["ColorGradeMidtoneHue", "ColorGradeMidtoneSat", "ColorGradeMidtoneLum"], "Midtone"],
  ["Highlights", ["SplitToningHighlightHue", "SplitToningHighlightSaturation", "ColorGradeHighlightLum"], "Highlight"],
  ["Global", ["ColorGradeGlobalHue", "ColorGradeGlobalSat", "ColorGradeGlobalLum"], "Global"],
];

const VIBRANCE_WEIGHT = 0.5;
const HSL_PREFIXES = ["HueAdjustment", "SaturationAdjustment", "LuminanceAdjustment"];
const CALIBRATION_KEYS = ["ShadowTint", "RedHue", "RedSaturation", "GreenHue", "GreenSaturation", "BlueHue", "BlueSaturation"];
// Profiles that are just the starting point, not part of a look (creative profiles live in "Look").
const DEFAULT_PROFILES = new Set(["Adobe Standard", "Adobe Color", "Adobe Default", "Default Color", "Default Profile", "Default Monochrome", "Embedded"]);

export const DEFAULT_OPTIONS = Object.freeze({
  parametric: true,    // trace parametric curve sliders as a point curve
  grayscale: true,     // black & white presets -> fully desaturated mask
  vibrance: false,     // fold Vibrance into Saturation at half strength
  detail: true,        // extra sharpening and luminance noise reduction -> the mask's Sharpness and Noise sliders
  leftovers: "drop",   // what masks can't hold: "drop" it, or keep it on the whole photo ("global")
});

// Lightroom's default sharpening for raw photos. A mask's Sharpness adds to the photo's own, so only what a
// preset puts above this can be carried over.
export const DEFAULT_SHARPNESS = 40;

/**
 * Returns { local, colorGrade, curves, rows, globals, empty, coverage, counts }.
 * `globals` lists settings to keep on the whole photo when options.leftovers is "global".
 */
export function convert(preset, options = {}) {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const conv = { local: {}, colorGrade: {}, curves: {}, rows: [], globals: { settings: {}, elements: [] } };
  sliders(preset, conv);
  saturation(preset, conv, opts);
  toneCurves(preset, conv, opts);
  colorGrading(preset, conv);
  detail(preset, conv, opts);
  leftovers(preset, conv, opts);
  conv.counts = { exact: 0, approx: 0, lost: 0, global: 0 };
  for (const row of conv.rows) conv.counts[row.status]++;
  conv.coverage = conv.rows.length ? (conv.counts.exact + conv.counts.approx) / conv.rows.length : 0;
  conv.empty = !Object.keys(conv.local).length && !Object.keys(conv.colorGrade).length && !Object.keys(conv.curves).length;
  return conv;
}

function row(label, before, after, status, note = "") {
  return { label, before, after, status, note };
}

function sliders(preset, conv) {
  for (const [key, localKey, label, scale, decimals] of SLIDERS) {
    const value = num(preset, key);
    if (!value) continue;
    const stored = clamp(value / scale);
    const shown = stored * scale;
    const exact = Math.abs(shown - value) < 1e-9;
    conv.local[localKey] = stored;
    const note = exact ? "" : `Mask ${label} stops at ±${scale}${decimals ? " EV" : ""}`;
    conv.rows.push(row(label, signed(value, decimals), signed(shown, decimals), exact ? EXACT : APPROX, note));
  }
}

function saturation(preset, conv, opts) {
  const sat = num(preset, "Saturation"), vib = num(preset, "Vibrance");
  let total = sat;
  if (sat) conv.rows.push(row("Saturation", signed(sat), signed(sat), EXACT));
  if (vib && opts.vibrance) {
    total += vib * VIBRANCE_WEIGHT;
    conv.rows.push(row("Vibrance", signed(vib), `${signed(vib * VIBRANCE_WEIGHT)} Saturation`, APPROX,
      "Masks have no Vibrance slider, so it's added to Saturation at half strength"));
  } else if (vib) {
    leftover(conv, opts, preset, "Vibrance", signed(vib), "Masks have no Vibrance slider. Turn on “Vibrance → Saturation” to approximate it", ["Vibrance"]);
  }
  if (isGrayscale(preset)) {
    if (opts.grayscale) {
      total = -100;
      conv.rows.push(row("Black & White", "On", "Saturation -100", APPROX, "Gives a black & white mask area; the B&W color mix isn't kept"));
    } else {
      const keys = ["ConvertToGrayscale", ...Object.keys(preset.settings).filter((k) => k.startsWith("GrayMixer"))];
      leftover(conv, opts, preset, "Black & White", "On", "Turn on “B&W → desaturate” to make the mask area black & white", keys);
    }
  }
  if (total) conv.local.LocalSaturation = clamp(total / 100);
}

function toneCurves(preset, conv, opts) {
  let point = preset.curves.ToneCurvePV2012 || curves.NAMED[preset.settings.ToneCurveName2012];
  if (point && curves.isIdentity(point)) point = null;
  const param = curves.parametricValues(preset.settings);
  const useParam = Boolean(param && opts.parametric);
  if (point || useParam) conv.curves.MainCurve = curves.mainCurve(point, useParam ? param : null);
  if (point) conv.rows.push(row("Tone Curve", `${point.length} points`, useParam ? "merged with parametric" : `${point.length} points`, EXACT));
  if (param) {
    const moved = curves.PARAM_LABELS.map((name, i) => (param.values[i] ? `${name} ${signed(param.values[i])}` : "")).filter(Boolean).join(", ");
    if (useParam) {
      conv.rows.push(row("Parametric curve", moved, `${conv.curves.MainCurve.length}-point curve`, APPROX, "Masks only take point curves, so the sliders are traced as points"));
    } else {
      const keys = Object.keys(preset.settings).filter((k) => k.startsWith("Parametric"));
      leftover(conv, opts, preset, "Parametric curve", moved, "Turn on “Parametric → points” to approximate it", keys);
    }
  }
  for (const channel of ["Red", "Green", "Blue"]) {
    const pts = preset.curves[`ToneCurvePV2012${channel}`];
    if (pts && !curves.isIdentity(pts)) {
      conv.curves[`${channel}Curve`] = pts.map((p) => [...p]);
      conv.rows.push(row(`${channel} curve`, `${pts.length} points`, `${pts.length} points`, EXACT));
    }
  }
}

function colorGrading(preset, conv) {
  const wheels = WHEELS.map(([label, keys, infix]) => ({ label, infix, hue: num(preset, keys[0]), sat: num(preset, keys[1]), lum: num(preset, keys[2]) }));
  if (!wheels.some((w) => w.sat || w.lum)) return;
  for (const { label, infix, hue, sat, lum } of wheels) {
    conv.colorGrade[`LocalColorGrade${infix}Hue`] = Math.round(hue);
    conv.colorGrade[`LocalColorGrade${infix}Sat`] = Math.round(sat);
    conv.colorGrade[`LocalColorGrade${infix}Lum`] = Math.round(lum);
    if (sat || lum) {
      const text = `Hue ${Math.round(hue)}°, Sat ${Math.round(sat)}${lum ? `, Lum ${signed(lum)}` : ""}`;
      conv.rows.push(row(`Color Grading: ${label}`, text, text, EXACT));
    }
  }
  conv.colorGrade.LocalColorGradeBlending = Math.round(num(preset, "ColorGradeBlending", 50));
  conv.colorGrade.LocalColorGradeBalance = Math.round(num(preset, "SplitToningBalance"));
}

// Sharpening and noise reduction. Masks have their own Sharpness and Noise sliders, which act on top of the
// photo's: so extra sharpening goes in as the difference from the default, and luminance noise reduction as Noise.
function detail(preset, conv, opts) {
  const s = preset.settings;
  if ("Sharpness" in s) {
    const amount = num(preset, "Sharpness", DEFAULT_SHARPNESS);
    const extra = amount - DEFAULT_SHARPNESS;
    const keys = Object.keys(s).filter((k) => k === "Sharpness" || k.startsWith("Sharpen"));
    if (extra > 0 && opts.detail) {
      const stored = clamp(extra / 100);
      conv.local.LocalSharpness = stored;
      conv.rows.push(row("Sharpening", String(Math.round(amount)), `${signed(stored * 100)} Sharpness`, APPROX,
        `A mask's Sharpness adds to the photo's own, so it gets what the preset adds above Lightroom's default of ${DEFAULT_SHARPNESS}`));
    } else if (extra > 0) {
      leftover(conv, opts, preset, "Sharpening", String(Math.round(amount)), "Turn on “Sharpening & noise → mask” to approximate it", keys);
    } else if (extra < 0) {
      leftover(conv, opts, preset, "Sharpening", String(Math.round(amount)), `A mask can't take sharpening below the default (${DEFAULT_SHARPNESS}) without blurring`, keys);
    }
  }
  const noise = num(preset, "LuminanceSmoothing");
  if (noise > 0) {
    const keys = Object.keys(s).filter((k) => k === "LuminanceSmoothing" || k.startsWith("LuminanceNoiseReduction"));
    if (opts.detail) {
      const stored = clamp(noise / 100);
      conv.local.LocalLuminanceNoise = stored;
      conv.rows.push(row("Noise reduction", String(Math.round(noise)), `${signed(stored * 100)} Noise`, APPROX,
        "A mask's Noise slider is a local luminance noise reduction; its Detail and Contrast settings aren't kept"));
    } else {
      leftover(conv, opts, preset, "Noise reduction", String(Math.round(noise)), "Turn on “Sharpening & noise → mask” to approximate it", keys);
    }
  }
}

function leftovers(preset, conv, opts) {
  const s = preset.settings;
  const keysWith = (test) => Object.keys(s).filter(test);

  const hsl = keysWith((k) => HSL_PREFIXES.some((p) => k.startsWith(p)) && num(preset, k));
  if (hsl.length) leftover(conv, opts, preset, "Color Mixer (HSL)", `${hsl.length} sliders`, "Masks have no per-color sliders", keysWith((k) => HSL_PREFIXES.some((p) => k.startsWith(p))));
  if (isGrayscale(preset) && opts.grayscale && keysWith((k) => k.startsWith("GrayMixer") && num(preset, k)).length) {
    conv.rows.push(row("B&W Mix", "Custom", "", LOST, "Masks can desaturate but not remix colors into gray"));
  }
  if (CALIBRATION_KEYS.some((k) => num(preset, k))) leftover(conv, opts, preset, "Calibration", "Custom", "Calibration applies to the whole photo", CALIBRATION_KEYS.filter((k) => k in s));

  const wb = s.WhiteBalance || "";
  const incremental = "IncrementalTemperature" in s || "IncrementalTint" in s;
  if (!incremental && (("Temperature" in s && wb !== "As Shot") || !["", "As Shot", "Custom"].includes(wb))) {
    const before = "Temperature" in s ? `${s.Temperature} K, Tint ${s.Tint ?? "0"}` : wb;
    leftover(conv, opts, preset, "White Balance", before, "Kelvin is absolute; masks can only shift Temp/Tint relative to the photo", ["WhiteBalance", "Temperature", "Tint"].filter((k) => k in s));
  }
  if (num(preset, "PostCropVignetteAmount")) {
    leftover(conv, opts, preset, "Vignette", signed(num(preset, "PostCropVignetteAmount")), "Vignette is a whole-frame effect", keysWith((k) => k.startsWith("PostCropVignette")));
  }
  if (num(preset, "GrainAmount")) {
    leftover(conv, opts, preset, "Grain", signed(num(preset, "GrainAmount")), "Mask grain's scale isn't verified yet, so it isn't put in the mask", keysWith((k) => k.startsWith("Grain")));
  }
  if (s.CameraProfile && !DEFAULT_PROFILES.has(s.CameraProfile)) {
    leftover(conv, opts, preset, "Profile", s.CameraProfile, "Profiles apply to the whole photo", ["CameraProfile", "CameraProfileDigest"].filter((k) => k in s));
  }
  if (preset.structured.Look) {
    leftover(conv, opts, preset, "Creative profile", lookName(preset.structured.Look) || "Look", "Profiles apply to the whole photo", [], ["Look"]);
  }
  if (pointColorsUsed(preset.structured.PointColors?.items || [])) {
    leftover(conv, opts, preset, "Point Color", "Custom", "Point Color isn't translated into masks yet", [], ["PointColors"]);
  }
  if (preset.maskCount) {
    conv.rows.push(row("Existing masks", `${preset.maskCount} mask${preset.maskCount > 1 ? "s" : ""}`, "", LOST, "The preset's own masks aren't copied"));
  }
}

// Something a mask can't hold: drop it, or keep it on the whole photo if the user asked for that.
function leftover(conv, opts, preset, label, before, note, keys, elements = []) {
  const keepable = opts.leftovers === "global" && (keys.length || elements.some((e) => preset.structured[e]?.node));
  if (!keepable) {
    conv.rows.push(row(label, before, "", LOST, note));
    return;
  }
  for (const key of keys) conv.globals.settings[key] = preset.settings[key];
  for (const name of elements) if (preset.structured[name]?.node) conv.globals.elements.push(preset.structured[name].node);
  conv.rows.push(row(label, before, "Whole photo", GLOBAL, "Kept on the whole photo, as you chose"));
}

function lookName(look) {
  const desc = look.node?.children?.[0];
  return desc?.attrs?.find((a) => a.local === "Name")?.value || "";
}

function isGrayscale(preset) {
  return (preset.settings.ConvertToGrayscale || "").toLowerCase() === "true";
}

function pointColorsUsed(items) {
  return items.some((item) => item.split(",").some((part) => {
    const v = Number(part);
    return part.trim() !== "" && Number.isFinite(v) && Math.abs(v + 1) > 1e-6;
  }));
}

function clamp(v) {
  return Math.max(-1, Math.min(1, v));
}

export function signed(value, decimals = 0) {
  const text = value.toFixed(decimals);
  if (Number(text) === 0) return "0";
  return value > 0 ? `+${text}` : text;
}
