export { parsePreset, num, isConverted, PresetError, MARKER } from "./preset.js";
export { convert, DEFAULT_OPTIONS, EXACT, APPROX, LOST, GLOBAL } from "./mapping.js";
export { buildPreset, groupName, DEFAULT_GROUP_TEMPLATE, fileStem, uniqueNames } from "./writer.js";
export { TARGETS, FAMILIES, target } from "./targets.js";
export { readZip, writeZip, ZipError } from "./zip.js";
export { loadFiles, dedupe, planBatch, renderBatch, decodeText, base64ToBytes, bytesToBase64 } from "./library.js";
export { samples as curveSamples } from "./curves.js";
