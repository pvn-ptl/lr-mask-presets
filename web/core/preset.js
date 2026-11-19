// Read Lightroom / Camera Raw presets (.xmp), photo sidecars and legacy .lrtemplate files
// into one plain shape the rest of the app works with.

import { XmlError, child, children, parseXml } from "./xml.js";
import { parseLrtemplate } from "./lrtemplate.js";

export const CRS = "http://ns.adobe.com/camera-raw-settings/1.0/";
export const RDF = "http://www.w3.org/1999/02/22-rdf-syntax-ns#";
export const MAX_PRESET_BYTES = 5 * 1024 * 1024;

// Written into every preset this app makes, so they can be told apart once Lightroom syncs them back.
export const MARKER = "made with LR Mask Presets";

const CURVE_KEYS = new Set(["ToneCurvePV2012", "ToneCurvePV2012Red", "ToneCurvePV2012Green", "ToneCurvePV2012Blue"]);

export class PresetError extends Error {}

export function emptyPreset(name = "") {
  return {
    name, group: "", uuid: "", presetType: "", format: "xmp",
    settings: {},    // simple values by Camera Raw key, e.g. { Exposure2012: "+0.50" }
    curves: {},      // point curves, e.g. { ToneCurvePV2012: [[0, 0], [255, 255]] }
    structured: {},  // other nested settings (Look, PointColors, ...) -> { items, node }
    maskCount: 0, copyright: "", description: "",
  };
}

/**
 * Parse preset text. `filename` picks the format; `fallbackName`/`fallbackGroup` fill in what the
 * file doesn't say (sidecars have no name, .lrtemplate files get their group from the folder).
 */
export function parsePreset(text, { filename = "", fallbackName = "", fallbackGroup = "" } = {}) {
  if (typeof text !== "string") throw new PresetError("Expected text");
  if (text.length > MAX_PRESET_BYTES) throw new PresetError("File is larger than 5 MB");
  if (/\.lrtemplate$/i.test(filename) || /^\s*(--[^\n]*\n\s*)*s\s*=\s*\{/.test(text)) {
    return parseLrtemplate(text, { fallbackName, fallbackGroup });
  }

  let root;
  try {
    root = parseXml(text);
  } catch (err) {
    if (err instanceof XmlError) throw new PresetError(`Not a readable preset (${err.message})`);
    throw err;
  }
  const rdf = root.uri === RDF && root.local === "RDF" ? root : child(root, RDF, "RDF");
  if (!rdf) throw new PresetError("No XMP data in this file");

  const preset = emptyPreset();
  const text_ = {};
  // Only the top-level descriptions hold the preset's own settings; masks nest their own.
  for (const desc of children(rdf, RDF, "Description")) {
    for (const a of desc.attrs) if (a.uri === CRS) preset.settings[a.local] = a.value;
    for (const el of desc.children) {
      if (el.uri !== CRS) continue;
      const key = el.local;
      const alt = child(el, RDF, "Alt");
      const list = child(el, RDF, "Seq") || child(el, RDF, "Bag");
      if (key === "MaskGroupBasedCorrections") {
        preset.maskCount += list ? children(list, RDF, "li").length : 0;
      } else if (alt) {
        text_[key] = altText(alt);
      } else if (list && CURVE_KEYS.has(key)) {
        preset.curves[key] = points(children(list, RDF, "li").map((li) => li.text));
      } else if (list || el.children.length || el.attrs.length) {
        preset.structured[key] = { items: list ? children(list, RDF, "li").map((li) => li.text.trim()) : [], node: el };
      } else {
        preset.settings[key] = el.text.trim();
      }
    }
  }
  const s = preset.settings;
  if (!Object.keys(s).length && !Object.keys(preset.curves).length && !preset.maskCount) {
    throw new PresetError("No Lightroom settings in this file");
  }
  preset.name = text_.Name || take(s, "Name") || fallbackName;
  preset.group = text_.Group || take(s, "Group") || fallbackGroup;
  preset.description = text_.Description || take(s, "Description") || "";
  preset.uuid = s.UUID || "";
  preset.presetType = s.PresetType || "";
  preset.copyright = s.Copyright || "";
  return preset;
}

export function num(preset, key, fallback = 0) {
  const raw = preset.settings[key];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

export function isConverted(preset) {
  return preset.description.includes(MARKER);
}

/** Profiles ("Look") and defaults files aren't presets; photo sidecars (no type) are allowed. */
export function isUsablePreset(preset, { allowUntyped }) {
  if (preset.presetType === "Normal") return true;
  return allowUntyped && preset.presetType === "";
}

export function points(items) {
  const out = [];
  for (const item of items) {
    const parts = String(item).split(",");
    if (parts.length !== 2) continue;
    const x = Number(parts[0]), y = Number(parts[1]);
    if (Number.isFinite(x) && Number.isFinite(y)) out.push([Math.round(x), Math.round(y)]);
  }
  return out;
}

function altText(alt) {
  const items = children(alt, RDF, "li");
  const preferred = items.find((li) => li.attrs.some((a) => a.local === "lang" && a.value === "x-default"));
  return ((preferred || items[0])?.text || "").trim();
}

function take(settings, key) {
  const value = settings[key] || "";
  delete settings[key];
  return value;
}
