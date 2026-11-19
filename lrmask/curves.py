"""Tone curves: smooth interpolation, the parametric-slider approximation, and composing the two."""
from __future__ import annotations

import math
from bisect import bisect_right

IDENTITY = [(0, 0), (255, 255)]

# Point lists behind Lightroom's named PV2012 curves (used when a preset names a curve but omits its points).
NAMED = {
    "Linear": IDENTITY,
    "Medium Contrast": [(0, 0), (32, 22), (64, 56), (128, 128), (192, 196), (255, 255)],
    "Strong Contrast": [(0, 0), (32, 16), (64, 50), (128, 128), (192, 202), (255, 255)],
}

PARAM_KEYS = ("ParametricShadows", "ParametricDarks", "ParametricLights", "ParametricHighlights")
PARAM_LABELS = ("Shadows", "Darks", "Lights", "Highlights")
SPLIT_KEYS = ("ParametricShadowSplit", "ParametricMidtoneSplit", "ParametricHighlightSplit")
DEFAULT_SPLITS = (25.0, 50.0, 75.0)

# How far a region moves at ±100, as a fraction of the region's width. Adobe doesn't publish the
# parametric curve's math, so this is a visual approximation, flagged as such in the UI.
PARAM_STRENGTH = 0.5


def is_identity(points) -> bool:
    return all(x == y for x, y in points)


def interpolator(points):
    """Smooth monotone (Fritsch-Carlson) curve through points in 0..255 space; returns f(x)."""
    pts = sorted(dict(points).items())
    if len(pts) < 2:
        return lambda x: x
    xs = [float(x) for x, _ in pts]
    ys = [float(y) for _, y in pts]
    n = len(xs)
    d = [(ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]) for i in range(n - 1)]
    m = [d[0]] + [0.0] * (n - 2) + [d[-1]]
    for i in range(1, n - 1):
        m[i] = 0.0 if d[i - 1] * d[i] <= 0 else (d[i - 1] + d[i]) / 2
    for i in range(n - 1):
        if d[i] == 0:
            m[i] = m[i + 1] = 0.0
            continue
        a, b = m[i] / d[i], m[i + 1] / d[i]
        if a * a + b * b > 9:
            t = 3 / math.sqrt(a * a + b * b)
            m[i], m[i + 1] = t * a * d[i], t * b * d[i]

    def f(x: float) -> float:
        if x <= xs[0]:
            return ys[0]
        if x >= xs[-1]:
            return ys[-1]
        i = bisect_right(xs, x) - 1
        h = xs[i + 1] - xs[i]
        t = (x - xs[i]) / h
        return ((2 * t**3 - 3 * t**2 + 1) * ys[i] + (t**3 - 2 * t**2 + t) * h * m[i]
                + (-2 * t**3 + 3 * t**2) * ys[i + 1] + (t**3 - t**2) * h * m[i + 1])

    return f


def parametric_values(settings: dict):
    """(slider values, split points) if any parametric slider is non-zero, else None."""
    values = tuple(_num(settings.get(k)) for k in PARAM_KEYS)
    if not any(values):
        return None
    splits = tuple(_num(settings.get(k), d) for k, d in zip(SPLIT_KEYS, DEFAULT_SPLITS))
    return values, splits


def parametric(values, splits):
    """Approximate the parametric curve as f(x) on 0..1: each slider lifts or lowers a smooth bump
    peaking in the middle of its tonal region. Black and white points never move."""
    bounds = [0.0] + [s / 100 for s in splits] + [1.0]
    bumps = []
    for i, value in enumerate(values):
        lo, hi = bounds[i], bounds[i + 1]
        width = hi - lo
        if not value or width <= 0:
            continue
        center = (lo + hi) / 2
        bumps.append((value / 100 * PARAM_STRENGTH * width,
                      max(0.0, lo - width / 2), center, min(1.0, hi + width / 2)))

    def f(x: float) -> float:
        y = x
        for amp, left, center, right in bumps:
            if left < x < right:
                t = (x - left) / (center - left) if x <= center else (right - x) / (right - center)
                y += amp * math.sin(t * math.pi / 2) ** 2
        return min(1.0, max(0.0, y))

    return f


def main_curve(point=None, param=None) -> list:
    """Points for a mask's MainCurve: the preset's point curve, with the parametric sliders folded in."""
    if param is None:
        return list(point or IDENTITY)
    lift = parametric(*param)
    through = interpolator(point) if point else (lambda v: v)
    if point:
        xs = [round(i * 255 / 16) for i in range(17)]
    else:
        bounds = [0.0] + [s / 100 for s in param[1]] + [1.0]
        marks = bounds + [(a + b) / 2 for a, b in zip(bounds, bounds[1:])]
        xs = sorted({round(255 * x) for x in marks})
    out, floor = [], 0
    for x in xs:
        y = max(floor, min(255, round(through(255 * lift(x / 255)))))
        out.append((x, y))
        floor = y
    return out


def samples(points, count: int = 64) -> list:
    """Evenly spaced points along a curve, for drawing it."""
    f = interpolator(points)
    return [(round(255 * i / count, 1), round(max(0.0, min(255.0, f(255 * i / count))), 1))
            for i in range(count + 1)]


def _num(value, default: float = 0.0) -> float:
    try:
        return float(value) if value is not None else default
    except ValueError:
        return default
