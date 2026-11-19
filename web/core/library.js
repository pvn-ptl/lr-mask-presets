// Turn files from a source (a folder, a zip, a drop) into presets, and plan a batch of new presets.

import { PresetError, isConverted, isUsablePreset, parsePreset } from "./preset.js";
import { ZipError, readZip } from "./zip.js";
import { convert } from "./mapping.js";
import { buildPreset, fileStem, groupName, normalAmount, stableId, uniqueNames } from "./writer.js";
import { target } from "./targets.js";

const PRESET_FILE = /\.(xmp|lrtemplate)$/i;

/**
 * files: [{ path, text } | { path, bytes } | { path, base64 }] from one source.
 * Zips are opened, presets parsed. Returns { entries: [{ id, source, path, preset }], errors }.
 * `allowUntyped` accepts photo sidecars (no PresetType) — on for files people pick themselves.
 */
export async function loadFiles(files, { source, allowUntyped = false }) {
  const entries = [], errors = [];
  const add = (path, text) => {
    const name = basename(path);
    try {
      const preset = parsePreset(text, { filename: name, fallbackName: name.replace(/\.[^.]+$/, ""), fallbackGroup: parentName(path) });
      if (!isUsablePreset(preset, { allowUntyped })) return;
      entries.push({ id: stableId(`${source}:${path}`, "entry").slice(0, 16), source, path, preset });
    } catch (err) {
      if (!(err instanceof PresetError)) throw err;
      errors.push(`${name}: ${err.message}`);
    }
  };
  for (const file of files) {
    const path = file.path || file.name || "preset.xmp";
    if (/\.zip$/i.test(path)) {
      let members;
      try {
        members = await readZip(bytesOf(file));
      } catch (err) {
        if (!(err instanceof ZipError)) throw err;
        errors.push(`${basename(path)}: ${err.message}`);
        continue;
      }
      for (const m of members) {
        if (!PRESET_FILE.test(m.name) || m.name.includes("__MACOSX/") || basename(m.name).startsWith("._")) continue;
        add(`${path}/${m.name}`, decodeText(m.data));
      }
    } else if (PRESET_FILE.test(path)) {
      add(path, file.text ?? decodeText(bytesOf(file)));
    }
  }
  return { entries, errors };
}

/** Drop presets that appear in more than one place; the first source wins. */
export function dedupe(entries) {
  const seen = new Set();
  return entries.filter((e) => {
    const p = e.preset;
    const key = p.uuid ? `uuid:${p.uuid.toUpperCase()}` : `name:${p.group}\u0000${p.name}\u0000${JSON.stringify(p.settings)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// Mask strengths offered in the app (the mask's Amount).
export const AMOUNTS = [1, 0.75, 0.5, 0.25];

/**
 * A new preset's name: the original's, plus the mask when several masks share a group (the template has no
 * {target}), plus the strength when it isn't 100%. "Moody Teal (Sky, 50%)".
 */
export function presetTitle(name, targetId, { targetCount = 1, groupTemplate = "{target} · {group}", amount = 1 } = {}) {
  const extra = [];
  if (targetCount > 1 && !String(groupTemplate).includes("{target}")) extra.push(target(targetId).label);
  const strength = normalAmount(amount);
  if (strength !== 1) extra.push(`${Math.round(strength * 100)}%`);
  return extra.length ? `${name} (${extra.join(", ")})` : name;
}

/** One job per (preset, mask). Presets with nothing maskable, or made by this app, are skipped. */
export function planBatch(entries, targetIds, { options = {}, groupTemplate, amount = 1 } = {}) {
  const jobs = [], skipped = [];
  const template = groupTemplate || "{target} · {group}";
  for (const entry of entries) {
    const { preset } = entry;
    if (isConverted(preset)) { skipped.push({ name: preset.name, reason: "already made by this app" }); continue; }
    const conv = convert(preset, options);
    if (conv.empty) { skipped.push({ name: preset.name, reason: "nothing in it can go into a mask" }); continue; }
    for (const id of targetIds) {
      jobs.push({
        entry, targetId: id, conv, amount: normalAmount(amount),
        group: groupName(preset, id, template),
        name: presetTitle(preset.name, id, { targetCount: targetIds.length, groupTemplate: template, amount }),
      });
    }
  }
  return { jobs, skipped };
}

/** The .xmp files for a batch, with unique, readable file names. */
export function renderBatch(jobs) {
  const names = uniqueNames(jobs.map((j) => fileStem(`${j.group} - ${j.name}`)));
  return jobs.map((j, i) => ({ name: names[i], text: buildPreset(j.entry.preset, j.conv, j.targetId, { group: j.group, name: j.name, amount: j.amount }) }));
}

export function decodeText(bytes) {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder("utf-16le").decode(bytes.subarray(2));
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder("utf-16be").decode(bytes.subarray(2));
  return new TextDecoder("utf-8").decode(bytes);
}

export function base64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function bytesToBase64(bytes) {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

function bytesOf(file) {
  if (file.bytes) return file.bytes;
  if (file.base64) return base64ToBytes(file.base64);
  return new TextEncoder().encode(file.text || "");
}

function basename(path) {
  return String(path).split("/").filter(Boolean).pop() || String(path);
}

function parentName(path) {
  const parts = String(path).split("/").filter(Boolean);
  return parts.length > 1 ? parts[parts.length - 2].replace(/\.zip$/i, "") : "";
}
