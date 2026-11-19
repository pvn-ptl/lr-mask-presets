"""Write converted presets as Lightroom .xmp files.

The layout mirrors presets Lightroom 10 saves itself. A Background mask is Lightroom's own
"Select Background" AI mask (MaskSubType 0, MaskSubCategoryID 22), not an inverted subject.
"""
from __future__ import annotations

import re
import uuid
import zipfile
from datetime import datetime
from pathlib import Path
from xml.sax.saxutils import escape

from .mapping import Conversion
from .xmp import MARKER, Preset

TARGETS = {
    "background": {"label": "Background", "mask_name": "Background 1", "subtype": "0", "subcategory": "22"},
    "subject": {"label": "Subject", "mask_name": "Subject 1", "subtype": "1"},
    "sky": {"label": "Sky", "mask_name": "Sky 1", "subtype": "2"},
}

DEFAULT_GROUP_TEMPLATE = "{target} · {group}"

# Same version stamps as Adobe's newest adaptive presets (Camera Raw 18 / process version 6).
CR_VERSION, COMPATIBLE_VERSION, PROCESS_VERSION = "18.0", "285474816", "15.4"

LOCAL_ORDER = [
    "LocalExposure", "LocalHue", "LocalSaturation", "LocalContrast", "LocalClarity", "LocalSharpness",
    "LocalBrightness", "LocalToningHue", "LocalToningSaturation", "LocalExposure2012", "LocalContrast2012",
    "LocalHighlights2012", "LocalShadows2012", "LocalWhites2012", "LocalBlacks2012", "LocalClarity2012",
    "LocalDehaze", "LocalLuminanceNoise", "LocalMoire", "LocalDefringe", "LocalTemperature", "LocalTint",
    "LocalTexture", "LocalGrain", "LocalCurveRefineSaturation",
]
COLOR_GRADE_ORDER = [
    "LocalColorGradeShadowHue", "LocalColorGradeShadowSat", "LocalColorGradeHighlightHue",
    "LocalColorGradeHighlightSat", "LocalColorGradeBalance", "LocalColorGradeMidtoneHue",
    "LocalColorGradeMidtoneSat", "LocalColorGradeShadowLum", "LocalColorGradeMidtoneLum",
    "LocalColorGradeHighlightLum", "LocalColorGradeBlending", "LocalColorGradeGlobalHue",
    "LocalColorGradeGlobalSat", "LocalColorGradeGlobalLum",
]
CURVE_ORDER = ["MainCurve", "RedCurve", "GreenCurve", "BlueCurve"]

_ID_NAMESPACE = uuid.UUID("3f5d8a8e-5c1b-4a43-9a52-7f0f6e0d2c11")


def group_name(preset: Preset, target: str, template: str = DEFAULT_GROUP_TEMPLATE) -> str:
    label = TARGETS[target]["label"]
    name = template.replace("{target}", label).replace("{group}", preset.group or "Presets").strip()
    return name or label


def build_preset(preset: Preset, conv: Conversion, target: str = "background", group: str = "") -> str:
    t = TARGETS[target]
    # Stable ids: converting the same preset again replaces it in Lightroom instead of duplicating it.
    seed = f"{preset.uuid or preset.group + '/' + preset.name}:{target}"

    header = [
        ("PresetType", "Normal"), ("Cluster", ""), ("UUID", _id(seed, "preset")),
        ("SupportsAmount2", "True"), ("SupportsAmount", "True"), ("SupportsColor", "True"),
        ("SupportsMonochrome", "True"), ("SupportsHighDynamicRange", "True"),
        ("SupportsNormalDynamicRange", "True"), ("SupportsSceneReferred", "True"),
        ("SupportsOutputReferred", "True"), ("RequiresRGBTables", "False"), ("CameraModelRestriction", ""),
        ("Copyright", preset.copyright), ("ContactInfo", ""), ("Version", CR_VERSION),
        ("CompatibleVersion", COMPATIBLE_VERSION), ("ProcessVersion", PROCESS_VERSION), ("HasSettings", "True"),
    ]
    local = dict.fromkeys(LOCAL_ORDER, 0.0)
    local["LocalCurveRefineSaturation"] = 100
    local.update(conv.local)
    correction = [
        ("What", "Correction"), ("CorrectionAmount", "1"), ("CorrectionActive", "true"),
        ("CorrectionName", t["label"]), ("CorrectionSyncID", _id(seed, "correction")),
    ] + [(k, _number(local[k])) for k in LOCAL_ORDER]
    if conv.color_grade:
        grade = dict.fromkeys(COLOR_GRADE_ORDER, 0)
        grade["LocalColorGradeBlending"] = 50
        grade.update(conv.color_grade)
        correction += [(k, _signed_int(grade[k])) for k in COLOR_GRADE_ORDER]
    mask = [
        ("What", "Mask/Image"), ("MaskActive", "true"), ("MaskName", t["mask_name"]), ("MaskBlendMode", "0"),
        ("MaskInverted", "false"), ("MaskSyncID", _id(seed, "mask")), ("MaskValue", "1"), ("MaskVersion", "1"),
        ("MaskSubType", t["subtype"]),
    ]
    if "subcategory" in t:
        mask.append(("MaskSubCategoryID", t["subcategory"]))
    mask += [("ReferencePoint", "0.500000 0.500000"), ("ErrorReason", "0")]

    description = f"{t['label']}-only version of “{preset.name}” ({MARKER})"
    out = [
        '<x:xmpmeta xmlns:x="adobe:ns:meta/" x:xmptk="LR Mask Presets">',
        ' <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">',
        '  <rdf:Description rdf:about=""',
        '    xmlns:crs="http://ns.adobe.com/camera-raw-settings/1.0/"',
        _attrs(header, "   ") + ">",
        _alt("Name", preset.name), _alt("ShortName", ""), _alt("SortName", ""),
        _alt("Group", group or group_name(preset, target)), _alt("Description", description),
        "   <crs:MaskGroupBasedCorrections>",
        "    <rdf:Seq>",
        "     <rdf:li>",
        "      <rdf:Description",
        _attrs(correction, "       ") + ">",
    ]
    for key in CURVE_ORDER:
        if key in conv.curves:
            out += [f"      <crs:{key}>", "       <rdf:Seq>"]
            out += [f"        <rdf:li>{x},{y}</rdf:li>" for x, y in conv.curves[key]]
            out += ["       </rdf:Seq>", f"      </crs:{key}>"]
    out += [
        "      <crs:CorrectionMasks>",
        "       <rdf:Seq>",
        "        <rdf:li",
        _attrs(mask, "         ") + "/>",
        "       </rdf:Seq>",
        "      </crs:CorrectionMasks>",
        "      </rdf:Description>",
        "     </rdf:li>",
        "    </rdf:Seq>",
        "   </crs:MaskGroupBasedCorrections>",
        "  </rdf:Description>",
        " </rdf:RDF>",
        "</x:xmpmeta>",
        "",
    ]
    return "\n".join(out)


def write_batch(jobs, out_dir, target: str) -> dict:
    """Write (preset, conversion, group) jobs into a new folder plus a .zip ready for Lightroom's importer."""
    label = TARGETS[target]["label"]
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    base = f"{datetime.now():%Y-%m-%d %H%M%S} {label} presets ({len(jobs)})"
    folder, n = out_dir / base, 2
    while folder.exists() or folder.with_name(folder.name + ".zip").exists():
        folder, n = out_dir / f"{base} {n}", n + 1
    folder.mkdir()

    files, used = [], set()
    for preset, conv, group in jobs:
        stem = _filename(f"{group} - {preset.name}")
        name, n = stem, 2
        while name.lower() in used:
            name, n = f"{stem} ({n})", n + 1
        used.add(name.lower())
        path = folder / f"{name}.xmp"
        path.write_text(build_preset(preset, conv, target, group), encoding="utf-8")
        files.append(path)

    zip_path = folder.with_name(folder.name + ".zip")
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as archive:
        for path in files:
            archive.write(path, path.name)
    return {"folder": folder, "zip": zip_path, "files": files}


def _id(seed: str, kind: str) -> str:
    return uuid.uuid5(_ID_NAMESPACE, f"{seed}:{kind}").hex.upper()


def _attrs(pairs, indent: str) -> str:
    return "\n".join(f'{indent}crs:{key}="{escape(str(value), {chr(34): "&quot;"})}"' for key, value in pairs)


def _alt(key: str, text: str) -> str:
    li = f'<rdf:li xml:lang="x-default">{escape(text)}</rdf:li>' if text else '<rdf:li xml:lang="x-default"/>'
    return f"   <crs:{key}>\n    <rdf:Alt>\n     {li}\n    </rdf:Alt>\n   </crs:{key}>"


def _number(value: float) -> str:
    return "0" if value == 0 else f"{value:.6f}".rstrip("0").rstrip(".")


def _signed_int(value: int) -> str:
    return "0" if value == 0 else f"{value:+d}"


def _filename(text: str) -> str:
    cleaned = re.sub(r'[\\/:*?"<>|\x00-\x1f]+', "-", text).strip(" .-")
    return cleaned[:120] or "preset"
