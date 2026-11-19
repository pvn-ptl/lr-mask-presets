// Write converted presets as Lightroom .xmp files. The layout mirrors presets Lightroom 10 saves itself.

import { CRS, MARKER, RDF } from "./preset.js";
import { XML_NS } from "./xml.js";
import { target as getTarget } from "./targets.js";

export const DEFAULT_GROUP_TEMPLATE = "{target} · {group}";

// Same version stamps as Adobe's newest adaptive presets (Camera Raw 18 / process version 6).
const CR_VERSION = "18.0", COMPATIBLE_VERSION = "285474816", PROCESS_VERSION = "15.4";

const LOCAL_ORDER = [
  "LocalExposure", "LocalHue", "LocalSaturation", "LocalContrast", "LocalClarity", "LocalSharpness",
  "LocalBrightness", "LocalToningHue", "LocalToningSaturation", "LocalExposure2012", "LocalContrast2012",
  "LocalHighlights2012", "LocalShadows2012", "LocalWhites2012", "LocalBlacks2012", "LocalClarity2012",
  "LocalDehaze", "LocalLuminanceNoise", "LocalMoire", "LocalDefringe", "LocalTemperature", "LocalTint",
  "LocalTexture", "LocalGrain", "LocalCurveRefineSaturation",
];
const COLOR_GRADE_ORDER = [
  "LocalColorGradeShadowHue", "LocalColorGradeShadowSat", "LocalColorGradeHighlightHue",
  "LocalColorGradeHighlightSat", "LocalColorGradeBalance", "LocalColorGradeMidtoneHue",
  "LocalColorGradeMidtoneSat", "LocalColorGradeShadowLum", "LocalColorGradeMidtoneLum",
  "LocalColorGradeHighlightLum", "LocalColorGradeBlending", "LocalColorGradeGlobalHue",
  "LocalColorGradeGlobalSat", "LocalColorGradeGlobalLum",
];
const CURVE_ORDER = ["MainCurve", "RedCurve", "GreenCurve", "BlueCurve"];

export function groupName(preset, targetId, template = DEFAULT_GROUP_TEMPLATE) {
  const label = getTarget(targetId).label;
  const name = String(template).replaceAll("{target}", label).replaceAll("{group}", preset.group || "Presets").trim();
  return name || label;
}

/**
 * The new preset's XMP text. `name` defaults to the original preset's name. `amount` (0..1) is the mask's
 * Amount: how strongly the whole look is applied inside the mask.
 */
export function buildPreset(preset, conv, targetId = "background", { group, name, amount = 1 } = {}) {
  const t = getTarget(targetId);
  const strength = normalAmount(amount);
  // Stable ids: converting the same preset again replaces it in Lightroom instead of duplicating it.
  // A lighter version is a different preset, so it gets its own ids.
  const seed = `${preset.uuid || `${preset.group}/${preset.name}`}:${targetId}${strength === 1 ? "" : `@${Math.round(strength * 100)}`}`;
  const title = name || preset.name;

  const header = [
    ["PresetType", "Normal"], ["Cluster", ""], ["UUID", stableId(seed, "preset")],
    ["SupportsAmount2", "True"], ["SupportsAmount", "True"], ["SupportsColor", "True"],
    ["SupportsMonochrome", "True"], ["SupportsHighDynamicRange", "True"], ["SupportsNormalDynamicRange", "True"],
    ["SupportsSceneReferred", "True"], ["SupportsOutputReferred", "True"], ["RequiresRGBTables", "False"],
    ["CameraModelRestriction", ""], ["Copyright", preset.copyright || ""], ["ContactInfo", ""],
    ["Version", CR_VERSION], ["CompatibleVersion", COMPATIBLE_VERSION], ["ProcessVersion", PROCESS_VERSION],
    ...Object.entries(conv.globals?.settings || {}).filter(([k]) => !HEADER_KEYS.has(k)),
    ["HasSettings", "True"],
  ];

  const local = Object.fromEntries(LOCAL_ORDER.map((k) => [k, 0]));
  local.LocalCurveRefineSaturation = 100;
  Object.assign(local, conv.local);
  const correction = [
    ["What", "Correction"], ["CorrectionAmount", number(strength)], ["CorrectionActive", "true"],
    ["CorrectionName", t.label], ["CorrectionSyncID", stableId(seed, "correction")],
    ...LOCAL_ORDER.map((k) => [k, number(local[k])]),
  ];
  if (Object.keys(conv.colorGrade).length) {
    const grade = Object.fromEntries(COLOR_GRADE_ORDER.map((k) => [k, 0]));
    grade.LocalColorGradeBlending = 50;
    Object.assign(grade, conv.colorGrade);
    correction.push(...COLOR_GRADE_ORDER.map((k) => [k, signedInt(grade[k])]));
  }

  const masks = t.components.map((c, i) => {
    const attrs = [
      ["What", "Mask/Image"], ["MaskActive", "true"], ["MaskName", c.name],
      ["MaskBlendMode", c.subtract ? "1" : "0"], ["MaskInverted", c.inverted ? "true" : "false"],
      ["MaskSyncID", stableId(seed, `mask${i}`)], ["MaskValue", c.subtract ? "0" : "1"], ["MaskVersion", "1"],
      ["MaskSubType", c.subType],
    ];
    if (c.category !== null) attrs.push(["MaskSubCategoryID", c.category]);
    attrs.push(["ReferencePoint", "0.500000 0.500000"], ["ErrorReason", "0"]);
    return ["        <rdf:li", attrs.map(([k, v]) => `         crs:${k}="${escapeAttr(v)}"`).join("\n") + "/>"].join("\n");
  });

  const description = `${t.label}-only version of “${preset.name}”${strength === 1 ? "" : ` at ${Math.round(strength * 100)}%`} (${MARKER})`;
  const out = [
    '<x:xmpmeta xmlns:x="adobe:ns:meta/" x:xmptk="LR Mask Presets">',
    ' <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">',
    '  <rdf:Description rdf:about=""',
    '    xmlns:crs="http://ns.adobe.com/camera-raw-settings/1.0/"',
    attrLines(header, "   ") + ">",
    alt("Name", title), alt("ShortName", ""), alt("SortName", ""),
    alt("Group", group ?? groupName(preset, targetId)), alt("Description", description),
    ...(conv.globals?.elements || []).map((node) => serialize(node, "   ")).filter(Boolean),
    "   <crs:MaskGroupBasedCorrections>",
    "    <rdf:Seq>",
    "     <rdf:li>",
    "      <rdf:Description",
    attrLines(correction, "       ") + ">",
  ];
  for (const key of CURVE_ORDER) {
    if (!conv.curves[key]) continue;
    out.push(`      <crs:${key}>`, "       <rdf:Seq>");
    for (const [x, y] of conv.curves[key]) out.push(`        <rdf:li>${x},${y}</rdf:li>`);
    out.push("       </rdf:Seq>", `      </crs:${key}>`);
  }
  out.push(
    "      <crs:CorrectionMasks>",
    "       <rdf:Seq>",
    ...masks,
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
  );
  return out.join("\n");
}

/** An amount between 1% and 100%; anything else (missing, garbage) means full strength. */
export function normalAmount(amount) {
  const v = Number(amount);
  return Number.isFinite(v) && v > 0 && v < 1 ? Math.max(0.01, Math.round(v * 100) / 100) : 1;
}

// Keys the header already sets; a kept global setting never overrides them.
const HEADER_KEYS = new Set(["PresetType", "Cluster", "UUID", "Version", "CompatibleVersion", "ProcessVersion", "HasSettings", "Copyright", "ContactInfo"]);

/** A safe, readable file name (without extension). */
export function fileStem(text) {
  const cleaned = String(text).normalize("NFC").replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "-").replace(/\s+/g, " ").trim().replace(/^[.\- ]+|[.\- ]+$/g, "");
  return [...cleaned].slice(0, 120).join("") || "preset";
}

/** Give every name a unique (case-insensitive) file name: "a.xmp", "a (2).xmp", ... */
export function uniqueNames(stems, extension = ".xmp") {
  const used = new Set();
  return stems.map((stem) => {
    let name = stem, n = 2;
    while (used.has(name.toLowerCase())) name = `${stem} (${n++})`;
    used.add(name.toLowerCase());
    return name + extension;
  });
}

// Deterministic 128-bit id (hex, upper case) from a seed. Not cryptographic; just stable and well spread.
export function stableId(seed, kind) {
  const text = `${seed}:${kind}`;
  let out = "";
  for (let round = 0; round < 4; round++) {
    let h = 0x811c9dc5 ^ (round * 0x9e3779b9);
    for (let i = 0; i < text.length; i++) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d); h ^= h >>> 12; h = Math.imul(h, 0x297a2d39); h ^= h >>> 15;
    out += (h >>> 0).toString(16).padStart(8, "0");
  }
  return out.toUpperCase();
}

function attrLines(pairs, indent) {
  return pairs.map(([k, v]) => `${indent}crs:${k}="${escapeAttr(v)}"`).join("\n");
}

function alt(key, text) {
  const li = text ? `<rdf:li xml:lang="x-default">${escapeText(text)}</rdf:li>` : '<rdf:li xml:lang="x-default"/>';
  return `   <crs:${key}>\n    <rdf:Alt>\n     ${li}\n    </rdf:Alt>\n   </crs:${key}>`;
}

const PREFIXES = new Map([[CRS, "crs"], [RDF, "rdf"], [XML_NS, "xml"]]);

// Re-emit a parsed element (e.g. a creative profile's <crs:Look>) with this file's prefixes.
function serialize(node, indent) {
  const prefix = PREFIXES.get(node.uri);
  if (!prefix || prefix === "xml") return "";
  const attrs = node.attrs
    .filter((a) => a.uri === "" || PREFIXES.has(a.uri))
    .map((a) => ` ${a.uri ? `${PREFIXES.get(a.uri)}:` : ""}${a.local}="${escapeAttr(a.value)}"`)
    .join("");
  const name = `${prefix}:${node.local}`;
  const kids = node.children.map((c) => serialize(c, indent + " ")).filter(Boolean);
  const text = node.text.trim();
  if (!kids.length && !text) return `${indent}<${name}${attrs}/>`;
  if (!kids.length) return `${indent}<${name}${attrs}>${escapeText(text)}</${name}>`;
  return `${indent}<${name}${attrs}>\n${kids.join("\n")}\n${indent}</${name}>`;
}

function number(value) {
  if (value === 0) return "0";
  return value.toFixed(6).replace(/0+$/, "").replace(/\.$/, "");
}

function signedInt(value) {
  return value === 0 ? "0" : value > 0 ? `+${value}` : String(value);
}

function escapeText(text) {
  return String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeAttr(text) {
  return escapeText(text).replace(/"/g, "&quot;").replace(/\n/g, "&#10;").replace(/\r/g, "&#13;").replace(/\t/g, "&#9;");
}
