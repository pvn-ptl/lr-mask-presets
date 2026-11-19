import { test } from "node:test";
import assert from "node:assert/strict";
import { PresetError, isConverted, isUsablePreset, parsePreset } from "../web/core/preset.js";
import { load, xmp } from "./helpers.mjs";

test("reads attributes, alt-text names and curves", () => {
  const preset = load("full_look.xmp");
  assert.equal(preset.name, "Moody & Warm");
  assert.equal(preset.group, "Test Looks");
  assert.equal(preset.settings.Exposure2012, "+0.50");
  assert.deepEqual(preset.curves.ToneCurvePV2012, [[0, 20], [64, 58], [192, 200], [255, 240]]);
  assert.equal(preset.presetType, "Normal");
});

test("reads settings written as elements, and ignores the settings inside existing masks", () => {
  const preset = load("mono_fade.xmp");
  assert.equal(preset.settings.Exposure2012, "+4.60");
  assert.equal(preset.maskCount, 1);
  assert.equal(preset.settings.LocalExposure2012, undefined);
  assert.equal(preset.settings.What, undefined);
});

test("any namespace prefix works", () => {
  const text = xmp({ Exposure2012: "+1.00" }).replaceAll("crs:", "cr:").replace("xmlns:crs=", "xmlns:cr=");
  const preset = parsePreset(text);
  assert.equal(preset.settings.Exposure2012, "+1.00");
  assert.equal(preset.name, "Test");
});

test("names fall back to the file name; groups to the folder", () => {
  const text = xmp({ Contrast2012: "+5" }).replace(/<crs:Name>.*?<\/crs:Name>/s, "").replace(/<crs:Group>.*?<\/crs:Group>/s, "");
  const preset = parsePreset(text, { fallbackName: "From File", fallbackGroup: "From Folder" });
  assert.equal(preset.name, "From File");
  assert.equal(preset.group, "From Folder");
});

test("unicode and escaped characters in names survive", () => {
  const preset = parsePreset(xmp({ Contrast2012: "+5" }, { name: "Café &amp; “Ciné” 夜 🌙", group: "Ünïcode" }));
  assert.equal(preset.name, "Café & “Ciné” 夜 🌙");
  assert.equal(preset.group, "Ünïcode");
});

test("profiles and other non-preset XMP are not offered as presets; photo sidecars only when asked", () => {
  assert.equal(isUsablePreset(parsePreset(xmp({ Contrast2012: "+5" }, { type: "Look" })), { allowUntyped: true }), false);
  const sidecar = parsePreset(xmp({ Contrast2012: "+5" }, { type: "" }));
  assert.equal(isUsablePreset(sidecar, { allowUntyped: false }), false);
  assert.equal(isUsablePreset(sidecar, { allowUntyped: true }), true);
});

test("clear errors for things that aren't presets", () => {
  assert.throws(() => parsePreset("<html><body>hi</body></html>"), PresetError);
  assert.throws(() => parsePreset("not xml"), PresetError);
  assert.throws(() => parsePreset('<!DOCTYPE x [<!ENTITY a "b">]><x/>'), PresetError);
  assert.throws(() => parsePreset(xmp({}, { type: "" }).replace(/<crs:Name>.*?<\/crs:Group>/s, "")), PresetError);
  assert.throws(() => parsePreset("x".repeat(6 * 1024 * 1024)), PresetError);
});

test("presets made by this app are recognised, including those made before it was renamed", () => {
  const madeBy = (name) => parsePreset(xmp({ Contrast2012: "+5" }, { extra: `<crs:Description><rdf:Alt><rdf:li xml:lang="x-default">Background-only version of “X” (made with ${name})</rdf:li></rdf:Alt></crs:Description>` }));
  assert.equal(isConverted(madeBy("Partly")), true);
  assert.equal(isConverted(madeBy("LR Mask Presets")), true, "1.0.0 presets");
  assert.equal(isConverted(load("full_look.xmp")), false);
});

test("structured elements (creative profile Look, PointColors) are kept for later", () => {
  const look = '<crs:Look><rdf:Description crs:Name="Vintage 03" crs:Amount="0.8"><crs:Parameters><rdf:Description crs:ConvertToGrayscale="False"/></crs:Parameters></rdf:Description></crs:Look>';
  const preset = parsePreset(xmp({ Contrast2012: "+5" }, { extra: look }));
  assert.ok(preset.structured.Look.node);
});

// .lrtemplate: the Lua-table format older Lightroom Classic presets use.
const LRTEMPLATE = `s = {
\tid = "6F8E2A10-0000-4C3B-9D2E-5A1B2C3D4E5F",
\tinternalName = "Old Warm",
\ttitle = ZSTR "$$$/Presets/Old Warm=Old Warm",
\ttype = "Develop",
\tvalue = {
\t\tsettings = {
\t\t\tExposure2012 = 0.35, -- a comment
\t\t\tContrast2012 = -12,
\t\t\tConvertToGrayscale = false,
\t\t\tToneCurvePV2012 = { 0, 10, 128, 130, 255, 245, },
\t\t\tSplitToningShadowHue = 210,
\t\t\tSplitToningShadowSaturation = 15,
\t\t\tProcessVersion = "11.0",
\t\t\tLook = { Name = "Adobe Color" },
\t\t\tNote = [[long
string]],
\t\t},
\t\tuuid = "6F8E2A10-0000-4C3B-9D2E-5A1B2C3D4E5F",
\t},
\tversion = 0,
}
`;

test(".lrtemplate presets are read", () => {
  const preset = parsePreset(LRTEMPLATE, { filename: "Old Warm.lrtemplate", fallbackGroup: "User Presets" });
  assert.equal(preset.name, "Old Warm");
  assert.equal(preset.group, "User Presets");
  assert.equal(preset.format, "lrtemplate");
  assert.equal(preset.settings.Exposure2012, "0.35");
  assert.equal(preset.settings.Contrast2012, "-12");
  assert.equal(preset.settings.ConvertToGrayscale, "False");
  assert.deepEqual(preset.curves.ToneCurvePV2012, [[0, 10], [128, 130], [255, 245]]);
  assert.equal(preset.uuid, "6F8E2A1000004C3B9D2E5A1B2C3D4E5F");
});

test(".lrtemplate files that aren't develop presets, or aren't readable, are refused", () => {
  assert.throws(() => parsePreset('s = { title = "x", type = "Export", value = { settings = {} } }', { filename: "x.lrtemplate" }), PresetError);
  assert.throws(() => parsePreset("s = { title = ", { filename: "x.lrtemplate" }), PresetError);
  assert.throws(() => parsePreset("os.execute('rm -rf /')", { filename: "x.lrtemplate" }), PresetError);
});
