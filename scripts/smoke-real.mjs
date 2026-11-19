// Opt-in check against the presets on this Mac: reads (never writes) the usual Lightroom folders,
// converts every preset to every mask, and checks each result is a well-formed preset.
// Run: node scripts/smoke-real.mjs [extra folders…]

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import * as core from "../web/core/index.js";
import { CRS, RDF } from "../web/core/preset.js";
import { child, children, parseXml } from "../web/core/xml.js";

const home = homedir();
const roots = [
  ...(() => {
    const pics = join(home, "Pictures");
    if (!existsSync(pics)) return [];
    return readdirSync(pics).filter((n) => n.endsWith(".lrlibrary")).flatMap((lib) =>
      readdirSync(join(pics, lib)).map((id) => join(pics, lib, id, "cr_settings")).filter((p) => existsSync(p)));
  })(),
  join(home, "Library/Application Support/Adobe/CameraRaw/Settings"),
  join(home, "Library/Application Support/Adobe/Lightroom/Develop Presets"),
  "/Library/Application Support/Adobe/CameraRaw/Settings",
  ...process.argv.slice(2),
].filter((p) => existsSync(p));

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name.startsWith(".")) continue;
    const p = join(dir, name);
    const info = statSync(p);
    if (info.isDirectory()) walk(p, out);
    else if (/\.(xmp|lrtemplate|zip)$/i.test(name)) out.push({ path: p.slice(dir.length + 1) || name, bytes: new Uint8Array(readFileSync(p)) });
  }
  return out;
}

const started = Date.now();
let files = 0, presets = 0, errors = 0, written = 0, bad = 0;
const coverage = [];
for (const root of roots) {
  const list = walk(root);
  files += list.length;
  const loaded = await core.loadFiles(list, { source: root });
  errors += loaded.errors.length;
  const entries = core.dedupe(loaded.entries).filter((e) => !core.isConverted(e.preset));
  presets += entries.length;
  for (const { preset } of entries) {
    for (const leftovers of ["drop", "global"]) {
      const conv = core.convert(preset, { leftovers });
      if (leftovers === "drop") coverage.push(conv.coverage);
      if (conv.empty) continue;
      for (const t of core.TARGETS) {
        const text = core.buildPreset(preset, conv, t.id);
        written++;
        try {
          const desc = child(child(parseXml(text), RDF, "RDF"), RDF, "Description");
          const correction = child(children(child(child(desc, CRS, "MaskGroupBasedCorrections"), RDF, "Seq"), RDF, "li")[0], RDF, "Description");
          const masks = children(child(child(correction, CRS, "CorrectionMasks"), RDF, "Seq"), RDF, "li");
          if (masks.length !== t.components.length) throw new Error("mask count");
          const again = core.parsePreset(text);
          if (!core.isConverted(again)) throw new Error("not marked as converted");
        } catch (err) {
          bad++;
          if (bad <= 5) console.error(`BAD ${preset.name} → ${t.id}: ${err.message}`);
        }
      }
    }
  }
  console.log(`${root.replace(home, "~")}: ${list.length} files, ${entries.length} presets, ${loaded.errors.length} unreadable`);
}
coverage.sort((a, b) => a - b);
const median = coverage.length ? coverage[Math.floor(coverage.length / 2)] : 0;
console.log(`\n${files} files · ${presets} presets · ${errors} unreadable · ${written} presets written in memory · ${bad} invalid`);
console.log(`median carry-over ${Math.round(median * 100)}% · ${coverage.filter((c) => c >= 0.7).length} of ${coverage.length} at 70% or more · ${((Date.now() - started) / 1000).toFixed(1)} s`);
process.exitCode = bad ? 1 : 0;
