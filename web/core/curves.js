// Tone curves: smooth interpolation, the parametric-slider approximation, and composing the two.

export const IDENTITY = [[0, 0], [255, 255]];

// Point lists behind Lightroom's named PV2012 curves (used when a preset names a curve but omits its points).
export const NAMED = {
  Linear: IDENTITY,
  "Medium Contrast": [[0, 0], [32, 22], [64, 56], [128, 128], [192, 196], [255, 255]],
  "Strong Contrast": [[0, 0], [32, 16], [64, 50], [128, 128], [192, 202], [255, 255]],
};

export const PARAM_KEYS = ["ParametricShadows", "ParametricDarks", "ParametricLights", "ParametricHighlights"];
export const PARAM_LABELS = ["Shadows", "Darks", "Lights", "Highlights"];
const SPLIT_KEYS = ["ParametricShadowSplit", "ParametricMidtoneSplit", "ParametricHighlightSplit"];
export const DEFAULT_SPLITS = [25, 50, 75];

// How far a region moves at ±100, as a fraction of the region's width. Adobe doesn't publish the
// parametric curve's math, so this is a visual approximation, flagged as such in the UI.
const PARAM_STRENGTH = 0.5;

export function isIdentity(pts) {
  return pts.every(([x, y]) => x === y);
}

/** Smooth monotone (Fritsch-Carlson) curve through points in 0..255 space; returns f(x). */
export function interpolator(pts) {
  const byX = new Map();
  for (const [x, y] of pts) byX.set(x, y);
  const sorted = [...byX.entries()].sort((a, b) => a[0] - b[0]);
  if (sorted.length < 2) return (x) => x;
  const xs = sorted.map((p) => p[0]), ys = sorted.map((p) => p[1]);
  const n = xs.length;
  const d = [];
  for (let i = 0; i < n - 1; i++) d.push((ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]));
  const m = [d[0], ...Array(n - 2).fill(0), d[n - 2]];
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) { m[i] = 0; m[i + 1] = 0; continue; }
    const a = m[i] / d[i], b = m[i + 1] / d[i];
    if (a * a + b * b > 9) {
      const t = 3 / Math.hypot(a, b);
      m[i] = t * a * d[i];
      m[i + 1] = t * b * d[i];
    }
  }
  return (x) => {
    if (x <= xs[0]) return ys[0];
    if (x >= xs[n - 1]) return ys[n - 1];
    let i = 0;
    while (xs[i + 1] < x) i++;
    const h = xs[i + 1] - xs[i], t = (x - xs[i]) / h;
    return (2 * t ** 3 - 3 * t ** 2 + 1) * ys[i] + (t ** 3 - 2 * t ** 2 + t) * h * m[i]
      + (-2 * t ** 3 + 3 * t ** 2) * ys[i + 1] + (t ** 3 - t ** 2) * h * m[i + 1];
  };
}

/** { values, splits } if any parametric slider is non-zero, else null. */
export function parametricValues(settings) {
  const values = PARAM_KEYS.map((k) => numberOr(settings[k], 0));
  if (!values.some(Boolean)) return null;
  const splits = SPLIT_KEYS.map((k, i) => numberOr(settings[k], DEFAULT_SPLITS[i]));
  return { values, splits };
}

/**
 * Approximate the parametric curve as f(x) on 0..1: each slider lifts or lowers a smooth bump
 * peaking in the middle of its tonal region. Black and white points never move.
 */
export function parametric({ values, splits }) {
  const bounds = [0, ...splits.map((s) => s / 100), 1];
  const bumps = [];
  values.forEach((value, i) => {
    const lo = bounds[i], hi = bounds[i + 1], width = hi - lo;
    if (!value || width <= 0) return;
    bumps.push({ amp: (value / 100) * PARAM_STRENGTH * width, left: Math.max(0, lo - width / 2), center: (lo + hi) / 2, right: Math.min(1, hi + width / 2) });
  });
  return (x) => {
    let y = x;
    for (const { amp, left, center, right } of bumps) {
      if (x > left && x < right) {
        const t = x <= center ? (x - left) / (center - left) : (right - x) / (right - center);
        y += amp * Math.sin((t * Math.PI) / 2) ** 2;
      }
    }
    return Math.min(1, Math.max(0, y));
  };
}

/** Points for a mask's curve: the preset's point curve, with the parametric sliders folded in. */
export function mainCurve(point, param) {
  if (!param) return (point || IDENTITY).map((p) => [...p]);
  const lift = parametric(param);
  const through = point ? interpolator(point) : (v) => v;
  let xs;
  if (point) {
    xs = Array.from({ length: 17 }, (_, i) => Math.round((i * 255) / 16));
  } else {
    const bounds = [0, ...param.splits.map((s) => s / 100), 1];
    const marks = [...bounds, ...bounds.slice(1).map((b, i) => (bounds[i] + b) / 2)];
    xs = [...new Set(marks.map((x) => Math.round(255 * x)))].sort((a, b) => a - b);
  }
  let floor = 0;
  return xs.map((x) => {
    const y = Math.max(floor, Math.min(255, Math.round(through(255 * lift(x / 255)))));
    floor = y;
    return [x, y];
  });
}

/** Evenly spaced points along a curve, for drawing it. */
export function samples(pts, count = 64) {
  const f = interpolator(pts);
  return Array.from({ length: count + 1 }, (_, i) => {
    const x = (255 * i) / count;
    return [Math.round(x * 10) / 10, Math.round(Math.max(0, Math.min(255, f(x))) * 10) / 10];
  });
}

function numberOr(value, fallback) {
  const n = Number(value);
  return value === undefined || value === "" || !Number.isFinite(n) ? fallback : n;
}
