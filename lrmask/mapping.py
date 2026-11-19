"""Translate a preset's global settings into one masked adjustment.

Scales were checked against files Lightroom wrote itself (Adobe's adaptive presets and masks saved
from Lightroom 10): mask sliders are stored as -1..1, so a global +20 becomes 0.2, and mask
Exposure (±4 EV) is stored divided by 4. Color grading uses the same numbers globally and in masks.
"""
from __future__ import annotations

from dataclasses import dataclass, field

from . import curves
from .xmp import Preset

EXACT, APPROX, LOST = "exact", "approx", "lost"

# (global key, mask key, label, slider units per stored unit, decimals shown)
SLIDERS = [
    ("Exposure2012", "LocalExposure2012", "Exposure", 4, 2),
    ("Contrast2012", "LocalContrast2012", "Contrast", 100, 0),
    ("Highlights2012", "LocalHighlights2012", "Highlights", 100, 0),
    ("Shadows2012", "LocalShadows2012", "Shadows", 100, 0),
    ("Whites2012", "LocalWhites2012", "Whites", 100, 0),
    ("Blacks2012", "LocalBlacks2012", "Blacks", 100, 0),
    ("Texture", "LocalTexture", "Texture", 100, 0),
    ("Clarity2012", "LocalClarity2012", "Clarity", 100, 0),
    ("Dehaze", "LocalDehaze", "Dehaze", 100, 0),
    ("IncrementalTemperature", "LocalTemperature", "Temp", 100, 0),
    ("IncrementalTint", "LocalTint", "Tint", 100, 0),
]

# Color grading wheels: (label, global hue/sat/lum keys, mask key infix). Split toning is how
# Lightroom stores the Shadows and Highlights wheels.
WHEELS = [
    ("Shadows", ("SplitToningShadowHue", "SplitToningShadowSaturation", "ColorGradeShadowLum"), "Shadow"),
    ("Midtones", ("ColorGradeMidtoneHue", "ColorGradeMidtoneSat", "ColorGradeMidtoneLum"), "Midtone"),
    ("Highlights", ("SplitToningHighlightHue", "SplitToningHighlightSaturation", "ColorGradeHighlightLum"), "Highlight"),
    ("Global", ("ColorGradeGlobalHue", "ColorGradeGlobalSat", "ColorGradeGlobalLum"), "Global"),
]

VIBRANCE_WEIGHT = 0.5
# Profiles that are just the starting point, not part of a look (creative profiles live in "Look").
DEFAULT_PROFILES = {"Adobe Standard", "Adobe Color", "Adobe Default", "Default Color", "Default Profile",
                    "Default Monochrome", "Embedded"}
HSL_PREFIXES = ("HueAdjustment", "SaturationAdjustment", "LuminanceAdjustment")
CALIBRATION_KEYS = ("ShadowTint", "RedHue", "RedSaturation", "GreenHue", "GreenSaturation", "BlueHue", "BlueSaturation")


@dataclass
class Options:
    parametric: bool = True  # approximate parametric curve sliders with a point curve
    grayscale: bool = True   # black & white presets -> fully desaturated mask
    vibrance: bool = False   # fold Vibrance into Saturation at half strength


@dataclass
class Row:
    label: str
    before: str
    after: str
    status: str
    note: str = ""


@dataclass
class Conversion:
    local: dict = field(default_factory=dict)        # mask slider key -> stored value (-1..1)
    color_grade: dict = field(default_factory=dict)  # mask color grading key -> value
    curves: dict = field(default_factory=dict)       # MainCurve / RedCurve / ... -> points
    rows: list = field(default_factory=list)

    def count(self, status: str) -> int:
        return sum(row.status == status for row in self.rows)

    @property
    def coverage(self) -> float:
        return (self.count(EXACT) + self.count(APPROX)) / len(self.rows) if self.rows else 0.0

    @property
    def empty(self) -> bool:
        return not (self.local or self.color_grade or self.curves)


def convert(preset: Preset, options: Options | None = None) -> Conversion:
    options = options or Options()
    conv = Conversion()
    _sliders(preset, conv)
    _saturation(preset, conv, options)
    _tone_curves(preset, conv, options)
    _color_grading(preset, conv)
    _lost(preset, conv, options)
    return conv


def _sliders(preset: Preset, conv: Conversion) -> None:
    for key, local_key, label, scale, decimals in SLIDERS:
        value = preset.number(key)
        if not value:
            continue
        stored = _clamp(value / scale)
        shown = stored * scale
        exact = abs(shown - value) < 1e-9
        conv.local[local_key] = stored
        note = "" if exact else f"Mask {label} stops at ±{scale}{' EV' if decimals else ''}"
        conv.rows.append(Row(label, _signed(value, decimals), _signed(shown, decimals), EXACT if exact else APPROX, note))


def _saturation(preset: Preset, conv: Conversion, options: Options) -> None:
    saturation, vibrance = preset.number("Saturation"), preset.number("Vibrance")
    total = saturation
    if saturation:
        conv.rows.append(Row("Saturation", _signed(saturation), _signed(saturation), EXACT))
    if vibrance and options.vibrance:
        total += vibrance * VIBRANCE_WEIGHT
        conv.rows.append(Row("Vibrance", _signed(vibrance), f"{_signed(vibrance * VIBRANCE_WEIGHT)} Saturation", APPROX,
                             "Masks have no Vibrance slider, so it's added to Saturation at half strength"))
    elif vibrance:
        conv.rows.append(Row("Vibrance", _signed(vibrance), "", LOST,
                             "Masks have no Vibrance slider. Turn on “Vibrance → Saturation” to approximate it"))
    if _grayscale(preset):
        if options.grayscale:
            total = -100
            conv.rows.append(Row("Black & White", "On", "Saturation -100", APPROX, "Gives a B&W background; the B&W color mix isn't kept"))
        else:
            conv.rows.append(Row("Black & White", "On", "", LOST, "Turn on “B&W → desaturate” to keep it"))
    if total:
        conv.local["LocalSaturation"] = _clamp(total / 100)


def _tone_curves(preset: Preset, conv: Conversion, options: Options) -> None:
    point = preset.curves.get("ToneCurvePV2012") or curves.NAMED.get(preset.settings.get("ToneCurveName2012", ""))
    if point and curves.is_identity(point):
        point = None
    param = curves.parametric_values(preset.settings)
    use_param = param is not None and options.parametric
    if point or use_param:
        conv.curves["MainCurve"] = curves.main_curve(point, param if use_param else None)
    if point:
        after = "merged with parametric" if use_param else f"{len(point)} points"
        conv.rows.append(Row("Tone Curve", f"{len(point)} points", after, EXACT))
    if param:
        moved = ", ".join(f"{name} {_signed(v)}" for name, v in zip(curves.PARAM_LABELS, param[0]) if v)
        if use_param:
            conv.rows.append(Row("Parametric curve", moved, f"{len(conv.curves['MainCurve'])}-point curve", APPROX,
                                 "Masks only take point curves, so the sliders are traced as points"))
        else:
            conv.rows.append(Row("Parametric curve", moved, "", LOST, "Turn on “Parametric → points” to approximate it"))
    for channel in ("Red", "Green", "Blue"):
        pts = preset.curves.get("ToneCurvePV2012" + channel)
        if pts and not curves.is_identity(pts):
            conv.curves[channel + "Curve"] = list(pts)
            conv.rows.append(Row(f"{channel} curve", f"{len(pts)} points", f"{len(pts)} points", EXACT))


def _color_grading(preset: Preset, conv: Conversion) -> None:
    wheels = [(label, infix, *(preset.number(k) for k in keys)) for label, keys, infix in WHEELS]
    if not any(sat or lum for _, _, _, sat, lum in wheels):
        return
    for label, infix, hue, sat, lum in wheels:
        conv.color_grade[f"LocalColorGrade{infix}Hue"] = round(hue)
        conv.color_grade[f"LocalColorGrade{infix}Sat"] = round(sat)
        conv.color_grade[f"LocalColorGrade{infix}Lum"] = round(lum)
        if sat or lum:
            text = f"Hue {hue:.0f}°, Sat {sat:.0f}" + (f", Lum {_signed(lum)}" if lum else "")
            conv.rows.append(Row(f"Color Grading: {label}", text, text, EXACT))
    conv.color_grade["LocalColorGradeBlending"] = round(preset.number("ColorGradeBlending", 50))
    conv.color_grade["LocalColorGradeBalance"] = round(preset.number("SplitToningBalance"))


def _lost(preset: Preset, conv: Conversion, options: Options) -> None:
    s = preset.settings

    def lost(label, before, note):
        conv.rows.append(Row(label, before, "", LOST, note))

    hsl = [k for k in s if k.startswith(HSL_PREFIXES) and preset.number(k)]
    if hsl:
        lost("Color Mixer (HSL)", f"{len(hsl)} sliders", "Masks have no per-color sliders")
    if _grayscale(preset) and any(preset.number(k) for k in s if k.startswith("GrayMixer")):
        lost("B&W Mix", "Custom", "Masks can desaturate but not remix colors into gray")
    if any(preset.number(k) for k in CALIBRATION_KEYS):
        lost("Calibration", "Custom", "Calibration applies to the whole photo")
    white_balance = s.get("WhiteBalance", "")
    incremental = "IncrementalTemperature" in s or "IncrementalTint" in s
    if not incremental and (("Temperature" in s and white_balance != "As Shot") or white_balance not in ("", "As Shot", "Custom")):
        before = f"{s['Temperature']} K, Tint {s.get('Tint', '0')}" if "Temperature" in s else white_balance
        lost("White Balance", before, "Kelvin is absolute; masks can only shift Temp/Tint relative to the photo")
    if preset.number("PostCropVignetteAmount"):
        lost("Vignette", _signed(preset.number("PostCropVignetteAmount")), "Vignette is a whole-frame effect")
    if preset.number("GrainAmount"):
        lost("Grain", _signed(preset.number("GrainAmount")), "Mask grain's scale isn't verified yet, so it's left out")
    if s.get("CameraProfile") and s["CameraProfile"] not in DEFAULT_PROFILES:
        lost("Profile", s["CameraProfile"], "Profiles apply to the whole photo")
    if "Look" in preset.structured:
        lost("Creative profile", "Look", "Profiles apply to the whole photo")
    if _point_colors_used(preset.structured.get("PointColors", [])):
        lost("Point Color", "Custom", "Point Color isn't translated yet")
    if preset.mask_count:
        lost("Existing masks", f"{preset.mask_count} mask{'s' * (preset.mask_count > 1)}", "The preset's own masks aren't copied")


def _grayscale(preset: Preset) -> bool:
    return preset.settings.get("ConvertToGrayscale", "").lower() == "true"


def _point_colors_used(items) -> bool:
    for item in items:
        for part in item.split(","):
            try:
                if abs(float(part) + 1) > 1e-6:
                    return True
            except ValueError:
                continue
    return False


def _clamp(value: float) -> float:
    return max(-1.0, min(1.0, value))


def _signed(value: float, decimals: int = 0) -> str:
    text = f"{value:+.{decimals}f}"
    return "0" if float(text) == 0 else text
