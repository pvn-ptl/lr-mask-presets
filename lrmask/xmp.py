"""Read Lightroom / Camera Raw preset files (.xmp)."""
from __future__ import annotations

import xml.etree.ElementTree as ET
from dataclasses import dataclass, field

CRS = "{http://ns.adobe.com/camera-raw-settings/1.0/}"
RDF = "{http://www.w3.org/1999/02/22-rdf-syntax-ns#}"
XML_LANG = "{http://www.w3.org/XML/1998/namespace}lang"

MAX_PRESET_BYTES = 5 * 1024 * 1024

# Written into every preset this app makes, so they can be told apart once Lightroom syncs them back.
MARKER = "made with LR Mask Presets"

CURVE_KEYS = ("ToneCurvePV2012", "ToneCurvePV2012Red", "ToneCurvePV2012Green", "ToneCurvePV2012Blue")


class PresetError(ValueError):
    """The file is not a usable Lightroom preset."""


@dataclass
class Preset:
    name: str
    group: str = ""
    uuid: str = ""
    preset_type: str = ""
    settings: dict = field(default_factory=dict)    # simple crs values, e.g. {"Exposure2012": "+0.50"}
    curves: dict = field(default_factory=dict)      # point curves, e.g. {"ToneCurvePV2012": [(0, 0), (255, 255)]}
    structured: dict = field(default_factory=dict)  # other list-valued settings (PointColors, Look, ...) -> items
    mask_count: int = 0
    copyright: str = ""
    description: str = ""

    @property
    def converted(self) -> bool:
        return MARKER in self.description

    def number(self, key: str, default: float = 0.0) -> float:
        try:
            return float(self.settings.get(key, default))
        except ValueError:
            return default


def parse_preset(data: bytes, fallback_name: str = "") -> Preset:
    if len(data) > MAX_PRESET_BYTES:
        raise PresetError("file is larger than 5 MB")
    lowered = data.lower()
    if b"<!doctype" in lowered or b"<!entity" in lowered:
        raise PresetError("presets never contain DTDs; refusing to parse")
    try:
        root = ET.fromstring(data)
    except ET.ParseError as exc:
        raise PresetError(f"not valid XML ({exc})") from None

    rdf = root if root.tag == RDF + "RDF" else root.find(RDF + "RDF")
    if rdf is None:
        raise PresetError("no rdf:RDF block, so this is not an XMP preset")

    preset = Preset(name="")
    text = {}
    # Only the top-level descriptions hold the preset's own settings; masks nest their own.
    for desc in rdf.findall(RDF + "Description"):
        for attr, value in desc.attrib.items():
            if attr.startswith(CRS):
                preset.settings[attr[len(CRS):]] = value
        for child in desc:
            if not child.tag.startswith(CRS):
                continue
            key = child.tag[len(CRS):]
            alt, seq = child.find(RDF + "Alt"), child.find(RDF + "Seq")
            if key == "MaskGroupBasedCorrections":
                preset.mask_count += len(seq.findall(RDF + "li")) if seq is not None else 0
            elif alt is not None:
                text[key] = _alt_text(alt)
            elif seq is not None and key in CURVE_KEYS:
                preset.curves[key] = _points(seq)
            elif seq is not None:
                preset.structured[key] = [(li.text or "").strip() for li in seq.findall(RDF + "li")]
            elif len(child) or child.attrib:
                preset.structured[key] = []
            else:
                preset.settings[key] = (child.text or "").strip()

    if not (preset.settings or preset.curves or preset.mask_count):
        raise PresetError("no Camera Raw settings found")

    s = preset.settings
    preset.name = text.get("Name") or s.pop("Name", "") or fallback_name
    preset.group = text.get("Group") or s.pop("Group", "")
    preset.description = text.get("Description") or s.pop("Description", "")
    preset.uuid = s.get("UUID", "")
    preset.preset_type = s.get("PresetType", "")
    preset.copyright = s.get("Copyright", "")
    return preset


def _alt_text(alt) -> str:
    items = alt.findall(RDF + "li")
    for li in items:
        if li.get(XML_LANG) == "x-default":
            return (li.text or "").strip()
    return (items[0].text or "").strip() if items else ""


def _points(seq) -> list:
    points = []
    for li in seq.findall(RDF + "li"):
        parts = (li.text or "").split(",")
        if len(parts) != 2:
            continue
        try:
            points.append((round(float(parts[0])), round(float(parts[1]))))
        except ValueError:
            continue
    return points
