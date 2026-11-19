#!/usr/bin/env node
// Command-line version: convert presets without the app.
//   node cli/lrmask.mjs <files, folders or .zip packs…> [options]
// Run with --help for the options.

import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync, existsSync } from "node:fs";
import { basename, join, relative, resolve } from "node:path";
import { parseArgs } from "node:util";
import * as core from "../web/core/index.js";

const HELP = `Usage: lrmask <presets…> [options]

Turns Lightroom presets into presets that apply the look inside an AI mask.
<presets> can be .xmp or .lrtemplate files, .zip preset packs, or folders (searched recursively).

Options:
  -m, --mask <ids>        Where the look goes, comma-separated (default: background). See --list-masks.
  -o, --out <folder>      Where to write (default: ./output)
      --whole-photo       Keep what masks can't hold (HSL, profile, vignette…) on the whole photo
      --no-parametric     Don't trace parametric curve sliders as points
      --no-grayscale      Don't turn black & white presets into a desaturated mask
      --vibrance          Add Vibrance to the mask's Saturation at half strength
  -g, --group <template>  Lightroom group name; {target} and {group} are filled in (default: "{target} · {group}")
      --dry-run           Show what would carry over, write nothing
      --list-masks        List the masks you can use
  -h, --help              Show this help
`;

const PRESET = /\.(xmp|lrtemplate|zip)$/i;

function collect(paths) {
  const files = [];
  const walk = (path, root) => {
    const info = statSync(path);
    if (info.isDirectory()) {
      for (const name of readdirSync(path).sort()) if (!name.startsWith(".") && name !== "__MACOSX") walk(join(path, name), root);
    } else if (PRESET.test(path) && info.size <= 100 * 1024 * 1024) {
      files.push({ path: relative(root, path) || basename(path), bytes: new Uint8Array(readFileSync(path)) });
    }
  };
  for (const p of paths) {
    const full = resolve(p);
    if (!existsSync(full)) throw new Error(`Not found: ${p}`);
    walk(full, statSync(full).isDirectory() ? resolve(full, "..") : resolve(full, ".."));
  }
  return files;
}

async function main(argv) {
  const { values: opts, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      mask: { type: "string", short: "m", default: "background" },
      out: { type: "string", short: "o", default: "output" },
      "whole-photo": { type: "boolean", default: false },
      "no-parametric": { type: "boolean", default: false },
      "no-grayscale": { type: "boolean", default: false },
      vibrance: { type: "boolean", default: false },
      group: { type: "string", short: "g", default: core.DEFAULT_GROUP_TEMPLATE },
      "dry-run": { type: "boolean", default: false },
      "list-masks": { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
  });
  if (opts.help) return void process.stdout.write(HELP);
  if (opts["list-masks"]) {
    for (const fam of core.FAMILIES) {
      console.log(`${fam.label}:`);
      for (const t of core.TARGETS.filter((x) => x.family === fam.id)) console.log(`  ${t.id.padEnd(20)} ${t.label}${t.hint ? ` (${t.hint})` : ""}`);
    }
    return;
  }
  if (!positionals.length) {
    process.stderr.write(HELP);
    return 2;
  }
  const targets = opts.mask.split(",").map((s) => s.trim()).filter(Boolean);
  for (const id of targets) {
    if (!core.TARGETS.some((t) => t.id === id)) throw new Error(`Unknown mask "${id}". Try --list-masks.`);
  }
  const options = {
    parametric: !opts["no-parametric"], grayscale: !opts["no-grayscale"], vibrance: opts.vibrance,
    leftovers: opts["whole-photo"] ? "global" : "drop",
  };

  const { entries, errors } = await core.loadFiles(collect(positionals), { source: "cli", allowUntyped: true });
  for (const e of errors) console.error(`skipped ${e}`);
  const unique = core.dedupe(entries);
  if (!unique.length) {
    console.error("No Lightroom presets found.");
    return 1;
  }

  if (opts["dry-run"]) {
    for (const { preset } of unique) {
      const conv = core.convert(preset, options);
      console.log(`\n${preset.group ? `${preset.group} › ` : ""}${preset.name}  (${Math.round(conv.coverage * 100)}% carries over)`);
      for (const r of conv.rows) console.log(`  ${r.status.padEnd(7)} ${r.label.padEnd(28)} ${r.before}${r.after && r.after !== r.before ? ` → ${r.after}` : ""}`);
    }
    return 0;
  }

  const { jobs, skipped } = core.planBatch(unique, targets, { options, groupTemplate: opts.group });
  for (const s of skipped) console.error(`skipped ${s.name}: ${s.reason}`);
  if (!jobs.length) {
    console.error("Nothing to write.");
    return 1;
  }
  const files = core.renderBatch(jobs);
  const stamp = new Date().toISOString().slice(0, 19).replace("T", " ").replace(/:/g, "");
  const label = targets.length === 1 ? core.target(targets[0]).label : `${targets.length} masks`;
  const name = core.fileStem(`${stamp} ${label} presets (${files.length})`);
  const folder = join(resolve(opts.out), name);
  mkdirSync(folder, { recursive: true });
  for (const f of files) writeFileSync(join(folder, f.name), f.text);
  writeFileSync(`${folder}.zip`, core.writeZip(files.map((f) => ({ name: f.name, data: f.text }))));
  console.log(`Wrote ${files.length} presets to ${folder}`);
  console.log(`Import into Lightroom with File › Import Profiles & Presets… and pick ${folder}.zip`);
  return 0;
}

main(process.argv.slice(2)).then((code) => { process.exitCode = code ?? 0; }, (err) => {
  console.error(`lrmask: ${err.message}`);
  process.exitCode = 1;
});
