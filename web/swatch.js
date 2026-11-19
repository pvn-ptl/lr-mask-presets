// Pictures of a preset's look: a made-up alpine lake at golden hour (sky and clouds, snow on the peaks, a treeline, a
// cabin, a jetty, a meadow, a rock and a hiker) pushed through the preset's own settings. Every part of the scene is
// also a region (sky, mountains, water, the hiker's hair, skin and clothes, ...), so the inspector can show what an
// export really makes: the look inside the chosen mask, the rest of the scene untouched. It hints at the look on a
// sample scene; it isn't your photo, and the regions stand in for what Lightroom's AI would find.

import { interpolator, NAMED, parametricValues, mainCurve, isIdentity } from "./core/curves.js";
import { comboParts, isCombo } from "./core/targets.js";

/** Tiles and list rows (16:10). */
export const TILE = { w: 320, h: 200 };
/** The inspector's picture (16:10, shown cropped to 16:9). */
export const HERO = { w: 640, h: 400 };

// ---------- which parts of the scene each mask covers ----------

export const REGIONS = ["sky", "mountains", "snow", "water", "vegetation", "architecture", "natural-ground", "artificial-ground", "clothes", "body-skin", "face-skin", "hair"];
const PERSON = ["clothes", "body-skin", "face-skin", "hair"];
const all = (...but) => REGIONS.filter((r) => !but.includes(r));
// The hiker is small, so features too small to draw (eyes, lips, ...) stand in as the face.
const COVERS = {
  background: all(...PERSON), "background-no-sky": all(...PERSON, "sky"), subject: PERSON, sky: ["sky"], "not-sky": all("sky"),
  "not-people": all(...PERSON), people: PERSON, skin: ["face-skin", "body-skin"], "face-skin": ["face-skin"], "body-skin": ["body-skin"],
  hair: ["hair"], eyes: ["face-skin"], eyebrows: ["face-skin"], lips: ["face-skin"], teeth: ["face-skin"], "facial-hair": ["face-skin"],
  clothes: ["clothes"], mountains: ["mountains"], water: ["water"], vegetation: ["vegetation"], architecture: ["architecture"],
  "natural-ground": ["natural-ground"], "artificial-ground": ["artificial-ground"], snow: ["snow"],
};

/** The scene regions a mask (or combination: start + additions − subtractions) covers. No mask: the whole frame. */
export function regionsOf(targetId) {
  if (!targetId) return [...REGIONS];
  if (isCombo(targetId)) {
    const { base, add, subtract } = comboParts(targetId);
    const out = new Set(regionsOf(base));
    for (const id of add) for (const r of regionsOf(id)) out.add(r);
    for (const id of subtract) for (const r of regionsOf(id)) out.delete(r);
    return REGIONS.filter((r) => out.has(r));
  }
  return COVERS[targetId] ? [...COVERS[targetId]] : [...REGIONS];
}

// ---------- painting ----------

/** A preset's whole look, for a tile or a list row. */
export function paintSwatch(canvas, preset, key = preset) {
  put(canvas, TILE, cached(pixelCache, key, () => render(preset, key, TILE)));
}

/** The untouched scene, at the inspector's size. */
export function paintScene(canvas) {
  const sc = scene(HERO);
  put(canvas, HERO, cached(pixelCache, "scene", () => {
    const out = new Uint8ClampedArray(HERO.w * HERO.h * 4);
    for (let i = 0, o = 0; i < sc.rgb.length; i += 3, o += 4) { out[o] = sc.rgb[i] * 255; out[o + 1] = sc.rgb[i + 1] * 255; out[o + 2] = sc.rgb[i + 2] * 255; out[o + 3] = 255; }
    return out;
  }));
}

/** The look, only where the mask is (transparent elsewhere), at the inspector's size: lay it over paintScene. */
export function paintLook(canvas, preset, key, targetId) {
  put(canvas, HERO, cached(heroCache, `${key}|${targetId || ""}`, () => render(preset, key, HERO, coverage(HERO, targetId))));
}

/** The mask itself as a tinted overlay, red like a photo editor's (it reads on sky, water and greenery alike). */
export function paintMask(canvas, targetId, rgb = [255, 40, 78]) {
  const alpha = coverage(HERO, targetId);
  const out = new Uint8ClampedArray(HERO.w * HERO.h * 4);
  for (let p = 0, o = 0; p < alpha.length; p++, o += 4) { out[o] = rgb[0]; out[o + 1] = rgb[1]; out[o + 2] = rgb[2]; out[o + 3] = alpha[p] * 0.58; }
  put(canvas, HERO, out);
}

/** What one exported preset does to the scene: the look inside its mask, the rest untouched (tile size). */
export function paintResult(canvas, preset, key, targetId) {
  const sc = scene(TILE), alpha = coverage(TILE, targetId);
  const look = cached(pixelCache, key, () => render(preset, key, TILE));
  const out = new Uint8ClampedArray(look.length);
  for (let p = 0, i = 0, o = 0; p < alpha.length; p++, i += 3, o += 4) {
    const a = alpha[p] / 255;
    for (let c = 0; c < 3; c++) out[o + c] = sc.rgb[i + c] * 255 * (1 - a) + look[o + c] * a;
    out[o + 3] = 255;
  }
  put(canvas, TILE, out);
}

export function clearSwatches() {
  pixelCache.clear(); heroCache.clear(); lutCache.clear();
}

function put(canvas, size, pixels) {
  if (canvas.width !== size.w) canvas.width = size.w;
  if (canvas.height !== size.h) canvas.height = size.h;
  canvas.getContext("2d")?.putImageData(new ImageData(pixels, size.w, size.h), 0, 0);
}

// Libraries can hold thousands of presets: keep only the most recent pictures (canvases keep what they show).
class Recent extends Map {
  constructor(limit) { super(); this.limit = limit; }
  get(k) { const v = super.get(k); if (v !== undefined) { super.delete(k); super.set(k, v); } return v; }
  set(k, v) { super.set(k, v); if (this.size > this.limit) this.delete(this.keys().next().value); return this; }
}
const pixelCache = new Recent(160), heroCache = new Recent(12), lutCache = new Recent(400);
const cached = (cache, key, make) => { let v = cache.get(key); if (!v) { v = make(); cache.set(key, v); } return v; };

/** The scene through a preset (via a 17³ colour lookup table: the look is a function of colour alone). */
function render(preset, key, size, alpha = null) {
  const lut = cached(lutCache, key, () => makeLut(transform(preset)));
  const { rgb } = scene(size);
  const out = new Uint8ClampedArray(size.w * size.h * 4);
  const px = [0, 0, 0];
  for (let i = 0, o = 0, p = 0; i < rgb.length; i += 3, o += 4, p++) {
    lookup(lut, rgb[i], rgb[i + 1], rgb[i + 2], px);
    out[o] = px[0] * 255; out[o + 1] = px[1] * 255; out[o + 2] = px[2] * 255; out[o + 3] = alpha ? alpha[p] : 255;
  }
  return out;
}

const N = 17, N1 = N - 1, SG = N * 3, SB = N * N * 3;
function makeLut(fn) {
  const t = new Float32Array(N * N * N * 3);
  let i = 0;
  for (let b = 0; b < N; b++) for (let g = 0; g < N; g++) for (let r = 0; r < N; r++) {
    const c = fn([r / N1, g / N1, b / N1]);
    t[i++] = c[0]; t[i++] = c[1]; t[i++] = c[2];
  }
  return t;
}
function lookup(t, r, g, b, out) {
  const fr = r * N1, fg = g * N1, fb = b * N1;
  const r0 = Math.min(N1 - 1, fr | 0), g0 = Math.min(N1 - 1, fg | 0), b0 = Math.min(N1 - 1, fb | 0);
  const dr = fr - r0, dg = fg - g0, db = fb - b0;
  const i = (b0 * N + g0) * SG + r0 * 3;
  for (let c = 0; c < 3; c++) {
    const k = i + c;
    const c00 = t[k] + (t[k + 3] - t[k]) * dr, c10 = t[k + SG] + (t[k + SG + 3] - t[k + SG]) * dr;
    const c01 = t[k + SB] + (t[k + SB + 3] - t[k + SB]) * dr, c11 = t[k + SB + SG] + (t[k + SB + SG + 3] - t[k + SB + SG]) * dr;
    const c0 = c00 + (c10 - c00) * dg, c1 = c01 + (c11 - c01) * dg;
    out[c] = c0 + (c1 - c0) * db;
  }
}

// ---------- the scene ----------

const scenes = new Map();
/** The untouched scene at a size: RGB 0..1 per pixel, plus (lazily) how much of each pixel each region covers. */
function scene(size) {
  const id = `${size.w}x${size.h}`;
  let sc = scenes.get(id);
  if (!sc) {
    const { ctx } = canvas2d(size);
    for (const [, draw] of LAYERS) draw(pen(ctx, size, false));
    const data = ctx.getImageData(0, 0, size.w, size.h).data;
    const rgb = new Float32Array(size.w * size.h * 3);
    for (let p = 0, o = 0; o < data.length; p += 3, o += 4) { rgb[p] = data[o] / 255; rgb[p + 1] = data[o + 1] / 255; rgb[p + 2] = data[o + 2] / 255; }
    sc = { rgb, regions: null, masks: new Map() };
    scenes.set(id, sc);
  }
  return sc;
}

/** Per region, how much of each pixel (0..255) it covers. Layers paint back to front; each hides what it covers. */
function regionCover(size) {
  const sc = scene(size);
  if (sc.regions) return sc.regions;
  const n = size.w * size.h;
  const regions = new Map(REGIONS.map((r) => [r, new Uint8Array(n)]));
  const { ctx } = canvas2d(size);
  for (const [region, draw] of LAYERS) {
    ctx.clearRect(0, 0, size.w, size.h);
    draw(pen(ctx, size, true));
    const a = ctx.getImageData(0, 0, size.w, size.h).data;
    const own = regions.get(region);
    for (let p = 0; p < n; p++) {
      const v = a[p * 4 + 3];
      if (!v) continue;
      if (v < 255) for (const other of regions.values()) { if (other !== own && other[p]) other[p] = (other[p] * (255 - v)) / 255; }
      else for (const other of regions.values()) if (other !== own) other[p] = 0;
      own[p] = Math.min(255, own[p] + v);
    }
  }
  sc.regions = regions;
  return regions;
}

/** How much of each pixel (0..255) a mask covers. */
function coverage(size, targetId) {
  const sc = scene(size);
  const id = targetId || "";
  let alpha = sc.masks.get(id);
  if (!alpha) {
    const parts = regionsOf(targetId).map((r) => regionCover(size).get(r));
    alpha = new Uint8Array(size.w * size.h);
    for (let p = 0; p < alpha.length; p++) { let v = 0; for (const part of parts) v += part[p]; alpha[p] = v > 255 ? 255 : v; }
    sc.masks.set(id, alpha);
  }
  return alpha;
}

function canvas2d(size) {
  const canvas = document.createElement("canvas");
  canvas.width = size.w; canvas.height = size.h;
  return { canvas, ctx: canvas.getContext("2d", { willReadFrequently: true }) };
}

// Drawing helpers. Coordinates are fractions of the width (x) and height (y); `s` is 1% of the height. In mask mode
// every shape is plain white and details (reflections, glints, grass) are skipped, so only outlines count.
function pen(ctx, size, mask) {
  const W = size.w, H = size.h;
  const g = {
    ctx, W, H, mask, s: H / 100,
    x: (v) => v * W, y: (v) => v * H,
    poly(pts) { ctx.beginPath(); pts.forEach(([x, y], i) => (i ? ctx.lineTo(x * W, y * H) : ctx.moveTo(x * W, y * H))); ctx.closePath(); return g; },
    fill(style) { ctx.fillStyle = mask ? "#fff" : style; ctx.fill(); return g; },
    linear(x0, y0, x1, y1, stops) {
      const gr = ctx.createLinearGradient(x0 * W, y0 * H, x1 * W, y1 * H);
      for (const [at, color] of stops) gr.addColorStop(at, color);
      return gr;
    },
    radial(x, y, r, stops) {
      const gr = ctx.createRadialGradient(x * W, y * H, 0, x * W, y * H, r * H);
      for (const [at, color] of stops) gr.addColorStop(at, color);
      return gr;
    },
  };
  return g;
}
function random(seed) {
  let a = seed;
  return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

const SUN = [0.69, 0.3];
const FAR = [[0, 0.41], [0.06, 0.35], [0.12, 0.285], [0.17, 0.345], [0.23, 0.32], [0.33, 0.17], [0.4, 0.29], [0.46, 0.265], [0.53, 0.33],
  [0.6, 0.305], [0.66, 0.36], [0.73, 0.39], [0.79, 0.31], [0.86, 0.235], [0.93, 0.31], [1, 0.34], [1, 0.53], [0, 0.53]];
const PEAKS = [2, 5, 7, 9, 13];
const SHORE = 0.525;

function sky(g) {
  const { ctx, W, H } = g;
  ctx.beginPath(); ctx.rect(0, 0, W, H);
  if (g.mask) return g.fill();
  g.fill(g.linear(0, 0, 0, 0.54, [[0, "#1d3b74"], [0.42, "#4a7cbf"], [0.76, "#a7b6d6"], [1, "#f3bf8b"]]));
  ctx.fillStyle = g.radial(SUN[0], SUN[1], 0.62, [[0, "rgba(255,214,150,.9)"], [0.22, "rgba(255,190,130,.38)"], [1, "rgba(255,170,120,0)"]]);
  ctx.fillRect(0, 0, W, H);
  for (const [x, y, w, h, warm] of [[0.16, 0.15, 0.2, 0.075, 0], [0.43, 0.085, 0.24, 0.06, 0], [0.585, 0.2, 0.13, 0.045, 1], [0.9, 0.13, 0.22, 0.065, 0.6]]) {
    cloud(g, x, y, w, h, warm);
  }
  ctx.beginPath(); ctx.arc(g.x(SUN[0]), g.y(SUN[1]), H * 0.034, 0, Math.PI * 2);
  ctx.fillStyle = "#fff7df"; ctx.fill();
}

function cloud(g, x, y, w, h, warm) {
  const { ctx } = g;
  const cx = g.x(x), cy = g.y(y), cw = g.x(w), ch = g.y(h);
  ctx.beginPath();
  for (const [px, py, pr] of [[-0.4, 0.2, 0.34], [-0.2, -0.05, 0.46], [0.05, -0.2, 0.55], [0.28, 0, 0.44], [0.45, 0.22, 0.3], [0, 0.28, 0.4]]) {
    ctx.moveTo(cx + px * cw + pr * ch * 1.5, cy + py * ch);
    ctx.ellipse(cx + px * cw, cy + py * ch, pr * ch * 1.5, pr * ch, 0, 0, Math.PI * 2);
  }
  const under = warm ? `rgba(${Math.round(196 + 40 * warm)},${Math.round(150 + 20 * warm)},${Math.round(170 - 30 * warm)},.9)` : "rgba(150,142,188,.88)";
  ctx.fillStyle = g.linear(0, y - h * 0.7, 0, y + h * 0.6, [[0, "rgba(255,246,232,.96)"], [0.55, "rgba(236,214,222,.92)"], [1, under]]);
  ctx.fill();
}

function farMountains(g) {
  const { ctx } = g;
  g.poly(FAR);
  if (g.mask) return g.fill();
  g.fill(g.linear(0, 0.17, 0, 0.53, [[0, "#8a96c4"], [0.6, "#a4abcc"], [1, "#cdbfd0"]]));
  ctx.save(); g.poly(FAR); ctx.clip();
  // Faces turned away from the sun, then the haze where the mountains meet the lake.
  for (const i of PEAKS) {
    const [px, py] = FAR[i], [vx, vy] = FAR[i - 1];
    const shade = g.linear(0, py, 0, 0.5, [[0, "rgba(58,66,124,.46)"], [0.6, "rgba(58,66,124,.2)"], [1, "rgba(58,66,124,0)"]]);
    g.poly([[px, py], [vx, vy], [vx + 0.012, (vy + 0.53) / 2], [px - 0.018, 0.53], [px + 0.006, (py + 0.53) / 2]]).fill(shade);
    // The sunlit ridge from each peak, a hairline catching the light.
    ctx.beginPath(); ctx.moveTo(g.x(px), g.y(py)); ctx.lineTo(g.x(FAR[i + 1][0]), g.y(FAR[i + 1][1]));
    ctx.strokeStyle = "rgba(255,226,200,.35)"; ctx.lineWidth = g.s * 0.3; ctx.stroke();
  }
  ctx.fillStyle = g.linear(0, 0.42, 0, 0.53, [[0, "rgba(246,206,170,0)"], [1, "rgba(246,206,170,.5)"]]);
  ctx.fillRect(0, g.y(0.42), g.W, g.y(0.12));
  ctx.restore();
}

function snow(g) {
  const { ctx } = g;
  ctx.save(); g.poly(FAR); ctx.clip();
  const caps = [
    [[0.33, 0.17], [0.353, 0.207], [0.344, 0.214], [0.352, 0.236], [0.334, 0.224], [0.322, 0.239], [0.314, 0.214], [0.303, 0.222]],
    [[0.86, 0.235], [0.879, 0.264], [0.871, 0.27], [0.877, 0.288], [0.862, 0.278], [0.851, 0.293], [0.845, 0.27], [0.836, 0.275]],
    [[0.12, 0.285], [0.134, 0.306], [0.127, 0.312], [0.131, 0.325], [0.118, 0.318], [0.107, 0.327], [0.104, 0.307]],
  ];
  for (const cap of caps) {
    const px = cap[0][0];
    g.poly(cap).fill(g.linear(px - 0.03, 0, px + 0.03, 0, [[0, "#bcc5e6"], [0.5, "#e9ecfb"], [1, "#fff9f0"]]));
  }
  ctx.restore();
}

function nearRidge(g) {
  const { ctx } = g;
  const ridge = [[0, 0.39], [0.05, 0.405], [0.11, 0.43], [0.17, 0.455], [0.23, 0.49], [0.28, 0.515], [0.31, 0.537], [0, 0.56]];
  g.poly(ridge);
  if (g.mask) return g.fill();
  g.fill(g.linear(0, 0.39, 0, 0.56, [[0, "#57717c"], [1, "#2e434c"]]));
  ctx.beginPath(); ridge.slice(0, 7).forEach(([x, y], i) => (i ? ctx.lineTo(g.x(x), g.y(y)) : ctx.moveTo(g.x(x), g.y(y))));
  ctx.strokeStyle = "rgba(255,206,160,.55)"; ctx.lineWidth = g.s * 0.45; ctx.stroke();
}

function lake(g) {
  const { ctx, W, H } = g;
  ctx.beginPath(); ctx.rect(0, g.y(SHORE), W, H - g.y(SHORE));
  if (g.mask) return g.fill();
  g.fill(g.linear(0, SHORE, 0, 1, [[0, "#f0c396"], [0.07, "#c8a3aa"], [0.24, "#6d8ebd"], [0.6, "#33608d"], [1, "#1c3c62"]]));
  ctx.save(); ctx.beginPath(); ctx.rect(0, g.y(SHORE), W, H); ctx.clip();
  // The mountains, upside down and darker; then the sun's path across the water.
  g.poly(FAR.slice(0, -2).map(([x, y]) => [x, SHORE + (0.53 - y) * 0.55]).concat([[1, SHORE], [0, SHORE]])).fill("rgba(58,68,118,.3)");
  const rnd = random(7);
  for (let y = SHORE + 0.004; y < 0.82; y += 0.0105) {
    const t = (y - SHORE) / (0.82 - SHORE), w = (0.01 + t * 0.06) * (0.45 + rnd() * 0.9);
    ctx.fillStyle = `rgba(255,236,202,${(0.85 * (1 - t)).toFixed(3)})`;
    ctx.fillRect(g.x(SUN[0] + (rnd() - 0.5) * 0.01) - (w * W) / 2, g.y(y), w * W, g.s * 0.42);
  }
  for (let i = 0; i < 26; i++) {
    const y = SHORE + 0.02 + rnd() * 0.25, x = rnd(), w = 0.03 + rnd() * 0.08;
    ctx.fillStyle = "rgba(220,230,255,.13)"; ctx.fillRect(g.x(x), g.y(y), g.x(w), g.s * 0.28);
  }
  ctx.restore();
}

function shore(g) {
  g.poly([[0.3, SHORE + 0.004], [0.48, SHORE - 0.006], [1, SHORE - 0.01], [1, SHORE + 0.01], [0.3, SHORE + 0.016]]);
  g.fill(g.linear(0, SHORE - 0.01, 0, SHORE + 0.016, [[0, "#d7b48c"], [1, "#8d6e55"]]));
}

function treeline(g) {
  const { ctx } = g;
  const rnd = random(3);
  const trees = [];
  for (let x = 0.335; x < 0.64; x += 0.009 + rnd() * 0.008) trees.push(x);
  for (let x = 0.705; x < 0.765; x += 0.01 + rnd() * 0.006) trees.push(x);
  for (let x = 0.845; x < 1.01; x += 0.009 + rnd() * 0.008) trees.push(x);
  for (const x of trees) {
    const h = 0.03 + rnd() * 0.035, w = 0.011 + rnd() * 0.008, base = SHORE - 0.004;
    for (let tier = 0; tier < 3; tier++) {
      const top = base - h * (0.55 + tier * 0.22), wide = w * (1 - tier * 0.25);
      g.poly([[x - wide / 2, base - h * tier * 0.26], [x, top], [x + wide / 2, base - h * tier * 0.26]]).fill("#1d392c");
      if (!g.mask) g.poly([[x, top], [x + wide / 2, base - h * tier * 0.26], [x + wide * 0.08, base - h * tier * 0.26]]).fill("rgba(96,150,88,.45)");
    }
  }
  if (g.mask) return;
  ctx.fillStyle = "rgba(255,190,140,.12)"; ctx.fillRect(g.x(0.33), g.y(SHORE - 0.07), g.x(0.7), g.y(0.07));
}

function cabin(g) {
  g.poly([[0.778, 0.505], [0.803, 0.505], [0.803, 0.534], [0.778, 0.534]]).fill("#7a482d");
  g.poly([[0.802, 0.505], [0.823, 0.505], [0.823, 0.534], [0.802, 0.534]]).fill("#c07644");
  g.poly([[0.802, 0.507], [0.8125, 0.489], [0.823, 0.507]]).fill("#cf8752");
  g.poly([[0.771, 0.508], [0.789, 0.485], [0.8125, 0.485], [0.8125, 0.489], [0.802, 0.508]]).fill("#3a2c30");
  g.poly([[0.783, 0.487], [0.789, 0.487], [0.789, 0.497], [0.783, 0.497]]).fill("#4a3b3b");
  g.poly([[0.808, 0.513], [0.818, 0.513], [0.818, 0.525], [0.808, 0.525]]).fill("#ffd98a");
}

function meadow(g) {
  const { ctx } = g;
  const edge = () => {
    ctx.beginPath(); ctx.moveTo(0, g.y(0.86));
    ctx.bezierCurveTo(g.x(0.2), g.y(0.81), g.x(0.38), g.y(0.79), g.x(0.55), g.y(0.815));
    ctx.bezierCurveTo(g.x(0.7), g.y(0.836), g.x(0.85), g.y(0.8), g.x(1), g.y(0.79));
    ctx.lineTo(g.W, g.H); ctx.lineTo(0, g.H); ctx.closePath();
  };
  edge();
  if (g.mask) return g.fill();
  g.fill(g.linear(0, 0.79, 0, 1, [[0, "#b5c860"], [0.25, "#7b9b3d"], [0.6, "#3f6a2a"], [1, "#203d1c"]]));
  ctx.save(); edge(); ctx.clip();
  const rnd = random(11);
  ctx.lineWidth = g.s * 0.22;
  for (let i = 0; i < 520; i++) {
    const x = rnd() * g.W, y = g.y(0.79 + rnd() * 0.21), len = g.s * (0.8 + rnd() * 1.6);
    ctx.strokeStyle = rnd() < 0.5 ? "rgba(28,58,24,.45)" : "rgba(214,228,122,.35)";
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + (rnd() - 0.4) * g.s * 0.6, y - len); ctx.stroke();
  }
  const petals = ["#e2489c", "#9a63d8", "#f4d44c", "#fff3ee", "#e2489c"];
  for (let i = 0; i < 90; i++) {
    const x = rnd(), y = 0.835 + rnd() * 0.15;
    ctx.beginPath(); ctx.arc(g.x(x), g.y(y), g.s * (0.35 + rnd() * 0.4) * (0.6 + (y - 0.8) * 3), 0, Math.PI * 2);
    ctx.fillStyle = petals[i % petals.length]; ctx.fill();
  }
  ctx.restore();
}

function jetty(g) {
  const { ctx } = g;
  if (!g.mask) for (const x of [0.656, 0.694]) g.poly([[x - 0.002, 0.7], [x + 0.002, 0.7], [x + 0.002, 0.727], [x - 0.002, 0.727]]).fill("#3a2f28");
  g.poly([[0.556, 1], [0.744, 1], [0.698, 0.7], [0.652, 0.7]]);
  if (g.mask) return g.fill();
  g.fill(g.linear(0, 0.7, 0, 1, [[0, "#b29c83"], [1, "#5f4e40"]]));
  ctx.strokeStyle = "rgba(48,36,28,.55)"; ctx.lineWidth = g.s * 0.2;
  for (let t = 0.04; t < 1; t += 0.06 + t * 0.05) {
    const y = 0.7 + 0.3 * t, l = 0.652 - (0.652 - 0.556) * t, r = 0.698 + (0.744 - 0.698) * t;
    ctx.beginPath(); ctx.moveTo(g.x(l), g.y(y)); ctx.lineTo(g.x(r), g.y(y)); ctx.stroke();
  }
}

function rock(g) {
  const { ctx } = g;
  const outline = [[0, 0.66], [0.04, 0.625], [0.1, 0.61], [0.17, 0.612], [0.23, 0.628], [0.28, 0.66], [0.32, 0.71], [0.345, 0.78], [0.35, 0.86], [0.3, 0.92], [0, 0.95]];
  g.poly(outline);
  if (g.mask) return g.fill();
  g.fill(g.linear(0.34, 0.6, 0.02, 0.9, [[0, "#e2a770"], [0.35, "#b77446"], [0.7, "#6d3f2a"], [1, "#3a2219"]]));
  ctx.save(); g.poly(outline); ctx.clip();
  ctx.strokeStyle = "rgba(50,26,18,.5)"; ctx.lineWidth = g.s * 0.35;
  for (const crack of [[[0.12, 0.64], [0.15, 0.7], [0.13, 0.78]], [[0.25, 0.66], [0.27, 0.73], [0.31, 0.79]], [[0.05, 0.72], [0.08, 0.8]]]) {
    ctx.beginPath(); crack.forEach(([x, y], i) => (i ? ctx.lineTo(g.x(x), g.y(y)) : ctx.moveTo(g.x(x), g.y(y)))); ctx.stroke();
  }
  // The hiker's shadow, thrown away from the sun.
  ctx.beginPath(); ctx.ellipse(g.x(0.17), g.y(0.62), g.s * 4.2, g.s * 0.7, 0, 0, Math.PI * 2); ctx.fillStyle = "rgba(40,20,14,.45)"; ctx.fill();
  ctx.restore();
}

// The hiker stands on the rock facing the sun; `u` runs right and `v` up from the feet, in % of the height.
const FEET = [0.19, 0.617];
function hiker(g, pts) {
  const fx = g.x(FEET[0]), fy = g.y(FEET[1]);
  g.ctx.beginPath();
  pts.forEach(([u, v], i) => (i ? g.ctx.lineTo(fx + u * g.s, fy - v * g.s) : g.ctx.moveTo(fx + u * g.s, fy - v * g.s)));
  g.ctx.closePath();
  return g;
}
function hikerDisc(g, u, v, r) {
  g.ctx.beginPath(); g.ctx.arc(g.x(FEET[0]) + u * g.s, g.y(FEET[1]) - v * g.s, r * g.s, 0, Math.PI * 2);
  return g;
}
function clothes(g) {
  hiker(g, [[-3.3, 10.2], [-1.3, 10.2], [-1.2, 16.2], [-3.1, 16.0]]).fill("#4c5a3b"); // backpack
  hiker(g, [[-1.8, 0], [-0.35, 0], [-0.35, 1.3], [-1.8, 1.3]]).fill("#2b2421"); // boots
  hiker(g, [[0.45, 0], [1.95, 0], [1.95, 1.3], [0.45, 1.3]]).fill("#2b2421");
  hiker(g, [[-1.5, 1.1], [-0.45, 1.1], [0.05, 7.2], [0.55, 1.1], [1.6, 1.1], [1.35, 9.6], [-1.35, 9.6]]).fill("#2d3753"); // trousers
  hiker(g, [[-1.7, 9.2], [1.75, 9.2], [2.05, 13.6], [1.45, 16.3], [0.6, 16.9], [-0.6, 16.9], [-1.45, 16.3], [-2.0, 13.6]])
    .fill(g.linear(FEET[0] - 0.015, 0, FEET[0] + 0.015, 0, [[0, "#9a2b23"], [1, "#e2603e"]])); // jacket
  hiker(g, [[1.2, 16.0], [2.1, 15.6], [2.95, 12.4], [2.6, 11.3], [1.95, 11.6], [1.55, 14.6]]).fill("#d65538"); // sleeve
}
function bodySkin(g) {
  hikerDisc(g, 2.8, 10.95, 0.68).fill("#e8ad87");
}
function faceSkin(g) {
  hiker(g, [[-0.3, 16.6], [0.9, 16.6], [0.9, 17.3], [-0.3, 17.3]]).fill("#c98c68");
  hikerDisc(g, 0.35, 18.6, 1.95).fill(g.linear(FEET[0] - 0.008, 0, FEET[0] + 0.01, 0, [[0, "#b77858"], [1, "#f3c09b"]]));
}
function hair(g) {
  const { ctx } = g;
  ctx.beginPath();
  ctx.ellipse(g.x(FEET[0]) - 0.15 * g.s, g.y(FEET[1]) - 19.3 * g.s, 1.95 * g.s, 1.45 * g.s, -0.35, 0, Math.PI * 2);
  g.fill("#3a2418");
  ctx.beginPath(); ctx.ellipse(g.x(FEET[0]) - 1.1 * g.s, g.y(FEET[1]) - 17.9 * g.s, 0.75 * g.s, 1.3 * g.s, 0.2, 0, Math.PI * 2);
  g.fill("#3a2418");
}

// Back to front. A region may paint more than once (two mountain layers, the treeline and the meadow).
const LAYERS = [
  ["sky", sky], ["mountains", farMountains], ["snow", snow], ["mountains", nearRidge], ["water", lake], ["natural-ground", shore],
  ["vegetation", treeline], ["architecture", cabin], ["vegetation", meadow], ["artificial-ground", jetty], ["natural-ground", rock],
  ["clothes", clothes], ["body-skin", bodySkin], ["face-skin", faceSkin], ["hair", hair],
];

// ---------- the look ----------

// Lightroom's HSL mixer bands and the hue each one centres on.
const HSL_BANDS = [["Red", 0], ["Orange", 30], ["Yellow", 60], ["Green", 120], ["Aqua", 180], ["Blue", 225], ["Purple", 275], ["Magenta", 320]];

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

    if (mixer.length) [r, g, b] = mixHsl([r, g, b], mixer);

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
function mixHsl(rgb, bands) {
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
