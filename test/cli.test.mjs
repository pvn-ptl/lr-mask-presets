import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { readZip } from "../web/core/zip.js";
import { FIXTURES, SAMPLES, inspect } from "./helpers.mjs";

const CLI = fileURLToPath(new URL("../cli/partly.mjs", import.meta.url));

test("converts a folder to several masks and writes files plus a zip", async () => {
  const out = mkdtempSync(join(tmpdir(), "partly-cli-"));
  try {
    const log = execFileSync(process.execPath, [CLI, SAMPLES, "--mask", "background,sky", "--out", out], { encoding: "utf8" });
    assert.match(log, /Wrote 16 presets/);
    const [folder] = readdirSync(out).filter((n) => !n.endsWith(".zip"));
    const xmps = readdirSync(join(out, folder));
    assert.equal(xmps.length, 16);
    const zipped = await readZip(new Uint8Array(readFileSync(join(out, `${folder}.zip`))));
    assert.equal(zipped.length, 16);
    const one = inspect(readFileSync(join(out, folder, xmps.find((n) => n.startsWith("Sky"))), "utf8"));
    assert.equal(one.corrections[0].masks[0].MaskSubType, "2");
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});

test("dry run explains each preset; bad masks are refused", () => {
  const dry = execFileSync(process.execPath, [CLI, join(FIXTURES, "full_look.xmp"), "--dry-run"], { encoding: "utf8" });
  assert.match(dry, /Moody & Warm/);
  assert.match(dry, /exact +Exposure/);
  const bad = spawnSync(process.execPath, [CLI, FIXTURES, "--mask", "nope"], { encoding: "utf8" });
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /Unknown mask "nope"/);
  const list = execFileSync(process.execPath, [CLI, "--list-masks"], { encoding: "utf8" });
  assert.match(list, /background-no-sky/);
});

test("combined masks and a lighter amount from the command line", async () => {
  const out = mkdtempSync(join(tmpdir(), "partly-cli-"));
  try {
    const log = execFileSync(process.execPath, [CLI, join(FIXTURES, "full_look.xmp"), "--mask", "subject +water -hair", "--amount", "50", "--out", out], { encoding: "utf8" });
    assert.match(log, /Wrote 1 presets/);
    const [folder] = readdirSync(out).filter((n) => !n.endsWith(".zip"));
    const [file] = readdirSync(join(out, folder));
    const one = inspect(readFileSync(join(out, folder, file), "utf8"));
    assert.equal(one.group, "Subject + Water − Hair · Test Looks");
    assert.equal(one.name, "Moody & Warm (50%)");
    assert.equal(one.corrections[0].values.CorrectionAmount, "0.5");
    assert.deepEqual(one.corrections[0].masks.map((m) => m.MaskBlendMode), ["0", "0", "1"]);
    const bad = spawnSync(process.execPath, [CLI, FIXTURES, "--mask", "sky water"], { encoding: "utf8" });
    assert.match(bad.stderr, /put \+ or -/);
    const badAmount = spawnSync(process.execPath, [CLI, FIXTURES, "--amount", "0"], { encoding: "utf8" });
    assert.match(badAmount.stderr, /percentage from 1 to 100/);
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});
