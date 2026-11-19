import { test } from "node:test";
import assert from "node:assert/strict";
import { convert } from "../web/core/mapping.js";
import { isConverted, parsePreset } from "../web/core/preset.js";
import { TARGETS, target } from "../web/core/targets.js";
import { buildPreset, fileStem, groupName, stableId, uniqueNames } from "../web/core/writer.js";
import { inspect, load, xmp } from "./helpers.mjs";

function build(fixture = "full_look.xmp", targetId = "background", options = {}) {
  const preset = typeof fixture === "string" ? load(fixture) : fixture;
  const text = buildPreset(preset, convert(preset, options), targetId);
  return { preset, text, out: inspect(text) };
}

test("background preset: one correction with Lightroom's Select Background mask", () => {
  const { out } = build();
  assert.equal(out.top.PresetType, "Normal");
  assert.equal(out.top.ProcessVersion, "15.4");
  assert.equal(out.name, "Moody & Warm");
  assert.equal(out.group, "Background · Test Looks");
  assert.match(out.description, /made with LR Mask Presets/);
  assert.equal(out.corrections.length, 1);
  const [c] = out.corrections;
  assert.equal(c.values.What, "Correction");
  assert.equal(c.values.CorrectionName, "Background");
  assert.equal(c.values.LocalExposure2012, "0.125");
  assert.equal(c.values.LocalContrast2012, "0.2");
  assert.equal(c.values.LocalCurveRefineSaturation, "100");
  assert.equal(c.values.LocalColorGradeShadowHue, "+220");
  assert.equal(c.values.LocalColorGradeBalance, "-10");
  assert.equal(c.values.LocalColorGradeBlending, "+60");
  assert.deepEqual(c.curves.MainCurve, [[0, 20], [64, 58], [192, 200], [255, 240]]);
  assert.deepEqual(c.masks, [{
    What: "Mask/Image", MaskActive: "true", MaskName: "Background 1", MaskBlendMode: "0", MaskInverted: "false",
    MaskSyncID: c.masks[0].MaskSyncID, MaskValue: "1", MaskVersion: "1", MaskSubType: "0", MaskSubCategoryID: "22",
    ReferencePoint: "0.500000 0.500000", ErrorReason: "0",
  }]);
  assert.match(c.masks[0].MaskSyncID, /^[0-9A-F]{32}$/);
});

test("every mask in the catalog writes its components the way Lightroom does", () => {
  for (const t of TARGETS) {
    const { out } = build("full_look.xmp", t.id);
    const masks = out.corrections[0].masks;
    assert.equal(masks.length, t.components.length, t.id);
    t.components.forEach((comp, i) => {
      const m = masks[i];
      assert.equal(m.What, "Mask/Image", t.id);
      assert.equal(m.MaskSubType, comp.subType, t.id);
      assert.equal(m.MaskSubCategoryID, comp.category ?? undefined, t.id);
      assert.equal(m.MaskBlendMode, comp.subtract ? "1" : "0", t.id);
      assert.equal(m.MaskValue, comp.subtract ? "0" : "1", t.id);
      assert.equal(m.MaskInverted, comp.inverted ? "true" : "false", t.id);
    });
    assert.equal(out.group, `${t.label} · Test Looks`);
  }
});

test("known encodings: subject, sky, people parts, landscape parts", () => {
  const first = (id) => build("full_look.xmp", id).out.corrections[0].masks;
  assert.equal(first("subject")[0].MaskSubType, "1");
  assert.equal(first("sky")[0].MaskSubType, "2");
  assert.equal(first("sky")[0].MaskSubCategoryID, undefined);
  assert.deepEqual(first("skin").map((m) => [m.MaskSubType, m.MaskSubCategoryID]), [["3", "2"], ["3", "4"]]);
  assert.deepEqual(first("eyes").map((m) => m.MaskSubCategoryID), ["3", "8"]);
  assert.equal(first("water")[0].MaskSubCategoryID, "50007");
  assert.equal(first("mountains")[0].MaskSubCategoryID, "50002");
  const noSky = first("background-no-sky");
  assert.equal(noSky[1].MaskSubType, "2");
  assert.equal(noSky[1].MaskBlendMode, "1");
  assert.equal(first("not-people")[0].MaskInverted, "true");
});

test("ids are stable for the same preset and mask, different across masks", () => {
  const a = build("full_look.xmp", "background").out;
  const b = build("full_look.xmp", "background").out;
  const c = build("full_look.xmp", "sky").out;
  assert.equal(a.top.UUID, b.top.UUID);
  assert.notEqual(a.top.UUID, c.top.UUID);
  assert.notEqual(a.corrections[0].values.CorrectionSyncID, a.corrections[0].masks[0].MaskSyncID);
  assert.match(stableId("x", "y"), /^[0-9A-F]{32}$/);
  assert.notEqual(stableId("x", "a"), stableId("x", "b"));
});

test("names with XML special characters and unicode are escaped and survive", () => {
  const preset = parsePreset(xmp({ Contrast2012: "+5", Copyright: 'A "quoted" <tag> & co' }, { name: "Tom &amp; Jerry &lt;3 “quotes” 夜", group: "Grp &amp; Co" }));
  const { out } = build(preset, "subject");
  assert.equal(out.name, "Tom & Jerry <3 “quotes” 夜");
  assert.equal(out.group, "Subject · Grp & Co");
  assert.equal(out.top.Copyright, 'A "quoted" <tag> & co');
});

test("output is recognised as made by this app (so it isn't converted twice)", () => {
  const { text } = build();
  assert.equal(isConverted(parsePreset(text)), true);
});

test("“Whole photo” writes kept settings at the top level and never overrides the header", () => {
  const preset = parsePreset(xmp({ Contrast2012: "+5", HueAdjustmentRed: "+20", CameraProfile: "Camera Portrait", UUID: "ABC" }, {
    extra: '<crs:Look><rdf:Description crs:Name="Vintage &amp; Co" crs:Amount="0.8"><crs:Parameters><rdf:Description crs:Version="18.0"/></crs:Parameters></rdf:Description></crs:Look>',
  }));
  const { out, text } = build(preset, "background", { leftovers: "global" });
  assert.equal(out.top.HueAdjustmentRed, "+20");
  assert.equal(out.top.CameraProfile, "Camera Portrait");
  assert.equal(out.top.Contrast2012, undefined);
  assert.notEqual(out.top.UUID, "ABC");
  assert.ok(out.elements.includes("Look"));
  const again = parsePreset(text);
  assert.ok(again.structured.Look.node);
  assert.equal(again.structured.Look.node.children[0].attrs.find((a) => a.local === "Name").value, "Vintage & Co");
});

test("“Leave out” writes no global settings", () => {
  const preset = parsePreset(xmp({ Contrast2012: "+5", HueAdjustmentRed: "+20" }));
  const { out } = build(preset, "background");
  assert.equal(out.top.HueAdjustmentRed, undefined);
  assert.ok(!out.elements.includes("Look"));
});

test("group template", () => {
  const preset = load("full_look.xmp");
  assert.equal(groupName(preset, "sky", "{group} / {target}"), "Test Looks / Sky");
  assert.equal(groupName(preset, "sky", "Masked"), "Masked");
  assert.equal(groupName(preset, "sky", "   "), target("sky").label);
  assert.equal(groupName({ ...preset, group: "" }, "sky"), "Sky · Presets");
});

test("file names are safe and unique", () => {
  assert.equal(fileStem('a/b:c*?"<>|d'), "a-b-c-d");
  assert.equal(fileStem("..hidden"), "hidden");
  assert.equal(fileStem("   "), "preset");
  assert.equal([...fileStem("x".repeat(500))].length, 120);
  assert.deepEqual(uniqueNames(["A", "a", "A", "b"]), ["A.xmp", "a (2).xmp", "A (3).xmp", "b.xmp"]);
});
