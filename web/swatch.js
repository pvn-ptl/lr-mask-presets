// A small picture of a preset's look: a made-up landscape (sky, sun, a ridge, a lake, a green hill and a warm rock
// in the foreground) pushed through the preset's own settings. Hard edges and a full range of tones make contrast,
// highlights, shadows and colour shifts visible at a glance. It hints at the look; it isn't a rendered photo.

import { interpolator, NAMED, parametricValues, mainCurve, isIdentity } from "./core/curves.js";

export const SWATCH_W = 120;
export const SWATCH_H = 75;

// Lightroom's HSL mixer bands and the hue each one centres on.
const HSL_BANDS = [["Red", 0], ["Orange", 30], ["Yellow", 60], ["Green", 120], ["Aqua", 180], ["Blue", 225], ["Purple", 275], ["Magenta", 320]];

const cache = new Map();

/** RGBA pixels (SWATCH_W × SWATCH_H) for a preset, cached by `key`. */
export function swatchPixels(preset, key = preset) {
  let px = cache.get(key);
  if (!px) {
    px = render(preset);
    cache.set(key, px);
  }
  return px;
}

/** Paint a preset's swatch into a canvas (sized SWATCH_W × SWATCH_H; CSS scales it). */
export function paintSwatch(canvas, preset, key) {
  if (canvas.width !== SWATCH_W) canvas.width = SWATCH_W;
  if (canvas.height !== SWATCH_H) canvas.height = SWATCH_H;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.putImageData(new ImageData(swatchPixels(preset, key), SWATCH_W, SWATCH_H), 0, 0);
}

export function clearSwatches() {
  cache.clear();
}

/** The untouched scene, computed once: RGB 0..1 per pixel. */
let scene = null;
function baseScene() {
  if (scene) return scene;
  const W = SWATCH_W, H = SWATCH_H, aspect = W / H;
  scene = new Float32Array(W * H * 3);
  const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  const cover = (v, edge) => clamp((v - edge) * H + 0.5, 0, 1); // anti-aliased "below this edge"
  const skyTop = hsl(216, 0.58, 0.28), skyMid = hsl(206, 0.5, 0.6), horizon = hsl(30, 0.75, 0.76);
  const sun = hsl(44, 1, 0.95), ridgeTop = hsl(228, 0.2, 0.5), ridgeLow = hsl(224, 0.24, 0.36);
  const lake = hsl(204, 0.42, 0.46), hillTop = hsl(92, 0.45, 0.4), hillLow = hsl(112, 0.4, 0.17);
  const rockLit = hsl(24, 0.46, 0.56), rockDark = hsl(18, 0.3, 0.1);
  for (let y = 0; y < H; y++) {
    const v = y / (H - 1);
    for (let x = 0; x < W; x++) {
      const u = x / (W - 1);
      // Sky: deep blue overhead, warm at the horizon, with the sun and its glow.
      let c = v < 0.36 ? mix(skyTop, skyMid, v / 0.36) : mix(skyMid, horizon, clamp((v - 0.36) / 0.22, 0, 1));
      const d = Math.hypot((u - 0.7) * aspect, v - 0.3);
      c = mix(c, horizon, Math.exp(-d / 0.16) * 0.55);
      c = mix(c, sun, clamp((0.075 - d) * H + 0.5, 0, 1));
      // Far ridge with a peak, hazier at the top.
      const ridge = 0.5 + 0.05 * Math.sin(u * 7.1 + 0.6) + 0.025 * Math.sin(u * 19.3 + 1.2) - 0.13 * Math.exp(-(((u - 0.3) / 0.11) ** 2));
      c = mix(c, mix(ridgeTop, ridgeLow, clamp((v - ridge) / 0.12, 0, 1)), cover(v, ridge));
      // Lake reflecting the sky, brightest under the sun.
      const glint = Math.exp(-(((u - 0.7) / 0.05) ** 2)) * 0.6;
      c = mix(c, mix(lake, horizon, glint), cover(v, 0.62));
      // Green hill.
      const hill = 0.71 + 0.045 * Math.sin(u * 4.3 + 2) + 0.015 * Math.sin(u * 15 + 0.4);
      c = mix(c, mix(hillTop, hillLow, clamp((v - hill) / 0.25, 0, 1)), cover(v, hill));
      // Warm rock in the foreground, lit from the sun's side.
      const rock = 0.74 + 0.5 * ((u - 0.02) / 0.42) ** 2;
      if (u < 0.5) c = mix(c, mix(rockLit, rockDark, clamp((v - rock) / 0.16 + (0.3 - u) * 0.8, 0, 1)), cover(v, rock));
      scene.set(c, (y * W + x) * 3);
    }
  }
  return scene;
}

function render(preset) {
  const look = transform(preset);
  const base = baseScene();
  const out = new Uint8ClampedArray(SWATCH_W * SWATCH_H * 4);
  for (let i = 0, o = 0; i < base.length; i += 3, o += 4) {
    const rgb = look([base[i], base[i + 1], base[i + 2]]);
    out[o] = rgb[0] * 255; out[o + 1] = rgb[1] * 255; out[o + 2] = rgb[2] * 255; out[o + 3] = 255;
  }
  return out;
}

/** The preset as a function from an RGB colour (0..1) to the RGB colour it becomes. Deliberately approximate. */
function transform(preset) {
  const s = preset.settings || {};
  const has = (k) => s[k] !== undefined && s[k] !== "" && Number.isFinite(Number(s[k]));
  const n = (k, f = 0) => (has(k) ? Number(s[k]) : f);

  const exposure = n("Exposure2012", n("Exposure"));
  const contrast = n("Contrast2012", n("Contrast")) / 100;
  const highlights = n("Highlights2012") / 100, shadows = n("Shadows2012") / 100;
  const whites = n("Whites2012") / 100, blacks = n("Blacks2012") / 100;
  const clarity = n("Clarity2012", n("Clarity")) / 100, dehaze = n("Dehaze") / 100;
  const saturation = n("Saturation") / 100, vibrance = n("Vibrance") / 100;
  let temp = n("IncrementalTemperature") / 100, tint = n("IncrementalTint") / 100;
  if (has("Temperature")) temp = clamp((n("Temperature") - 5500) / 3500, -1, 1);
  if (has("Tint") && !has("IncrementalTint")) tint = clamp(n("Tint") / 100, -1, 1);
  const mono = /^true$/i.test(String(s.ConvertToGrayscale || ""));

  const wheels = [
    [n("SplitToningShadowHue", n("ColorGradeShadowHue")), n("SplitToningShadowSaturation", n("ColorGradeShadowSat")), (l) => (1 - l) ** 2],
    [n("ColorGradeMidtoneHue"), n("ColorGradeMidtoneSat"), (l) => 4 * l * (1 - l)],
    [n("SplitToningHighlightHue", n("ColorGradeHighlightHue")), n("SplitToningHighlightSaturation", n("ColorGradeHighlightSat")), (l) => l * l],
    [n("ColorGradeGlobalHue"), n("ColorGradeGlobalSat"), () => 1],
  ].filter(([, sat]) => sat > 0).map(([hue, sat, weight]) => {
    const c = hsl(hue, 1, 0.5), l = luma(c);
    return { sat: sat / 100, weight, tint: c.map((v) => v - l) };
  });

  const mixer = HSL_BANDS.map(([name, hue]) => ({
    hue, shift: n(`HueAdjustment${name}`), sat: n(`SaturationAdjustment${name}`) / 100, lum: n(`LuminanceAdjustment${name}`) / 100,
  })).filter((b) => b.shift || b.sat || b.lum);

  let point = preset.curves?.ToneCurvePV2012 || NAMED[s.ToneCurveName2012];
  if (point && isIdentity(point)) point = null;
  const param = parametricValues(s);
  const main = point || param ? interpolator(mainCurve(point, param)) : null;
  const channels = ["Red", "Green", "Blue"].map((c) => {
    const pts = preset.curves?.[`ToneCurvePV2012${c}`];
    return pts && !isIdentity(pts) ? interpolator(pts) : null;
  });

  const gain = 2 ** (exposure * 0.5);
  const slope = 1 + contrast * 0.45 + dehaze * 0.25;

  return ([r, g, b]) => {
    // White balance: warm/cool along blue-amber, tint along green-magenta.
    r += temp * 0.09 + tint * 0.03;
    g -= tint * 0.06;
    b += -temp * 0.09 + tint * 0.03;

    if (mixer.length) [r, g, b] = mix([r, g, b], mixer);

    r *= gain; g *= gain; b *= gain;
    r = 0.5 + (r - 0.5) * slope; g = 0.5 + (g - 0.5) * slope; b = 0.5 + (b - 0.5) * slope;

    let l = clamp(luma([r, g, b]), 0, 1);
    const hw = smooth(0.45, 1, l), sw = smooth(0.55, 0, l);
    const lift = highlights * 0.22 * hw + shadows * 0.22 * sw + whites * 0.12 * hw * hw + blacks * 0.12 * sw * sw
      - dehaze * 0.05 * sw + clarity * 0.3 * (l - 0.5) * l * (1 - l);
    r += lift; g += lift; b += lift;

    l = luma([r, g, b]);
    const chroma = Math.max(r, g, b) - Math.min(r, g, b);
    const keep = mono ? 0 : Math.max(0, 1 + saturation + vibrance * 0.7 * (1 - Math.min(1, chroma * 2)) + dehaze * 0.15);
    r = l + (r - l) * keep; g = l + (g - l) * keep; b = l + (b - l) * keep;

    const at = clamp(l, 0, 1);
    for (const w of wheels) {
      const amount = w.sat * 0.42 * w.weight(at);
      r += w.tint[0] * amount; g += w.tint[1] * amount; b += w.tint[2] * amount;
    }

    r = clamp(r, 0, 1); g = clamp(g, 0, 1); b = clamp(b, 0, 1);
    if (main) { r = main(r * 255) / 255; g = main(g * 255) / 255; b = main(b * 255) / 255; }
    if (channels[0]) r = channels[0](r * 255) / 255;
    if (channels[1]) g = channels[1](g * 255) / 255;
    if (channels[2]) b = channels[2](b * 255) / 255;
    return [clamp(r, 0, 1), clamp(g, 0, 1), clamp(b, 0, 1)];
  };
}

/** Per-colour (HSL mixer) adjustments, weighted by how close the colour's hue is to each band. */
function mix(rgb, bands) {
  let [h, s, l] = toHsl(rgb);
  if (s < 0.02) return rgb;
  let dh = 0, ds = 0, dl = 0;
  for (const band of bands) {
    const d = Math.abs(((h - band.hue + 540) % 360) - 180);
    const w = Math.max(0, 1 - d / 45);
    if (!w) continue;
    dh += band.shift * 0.3 * w; ds += band.sat * w; dl += band.lum * 0.15 * w * s;
  }
  return hsl((h + dh + 360) % 360, clamp(s * (1 + ds), 0, 1), clamp(l + dl, 0, 1));
}

function hsl(h, s, l) {
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  return [f(0), f(8), f(4)];
}

function toHsl([r, g, b]) {
  r = clamp(r, 0, 1); g = clamp(g, 0, 1); b = clamp(b, 0, 1);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min, s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}

const luma = ([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
function smooth(a, b, x) {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}
