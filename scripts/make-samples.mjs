// Writes the bundled sample presets (original looks made for this project) to web/samples/.
// Run: node scripts/make-samples.mjs

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { stableId } from "../web/core/writer.js";

const out = join(dirname(fileURLToPath(import.meta.url)), "..", "web", "samples");

const SAMPLES = [
  { name: "Golden Hour Glow", group: "Warm", settings: { Exposure2012: "+0.25", Contrast2012: "+12", Highlights2012: "-35", Shadows2012: "+28", Whites2012: "+8", Blacks2012: "-6", Texture: "+6", Clarity2012: "+8", Vibrance: "+18", Saturation: "+4", SplitToningShadowHue: "32", SplitToningShadowSaturation: "14", SplitToningHighlightHue: "44", SplitToningHighlightSaturation: "26", ColorGradeBlending: "60", WhiteBalance: "Custom", Temperature: "6200", Tint: "+6" }, curve: [[0, 12], [64, 62], [192, 200], [255, 248]] },
  { name: "Moody Teal", group: "Moody", settings: { Exposure2012: "-0.20", Contrast2012: "+18", Highlights2012: "-48", Shadows2012: "+12", Whites2012: "-10", Blacks2012: "-18", Clarity2012: "+10", Dehaze: "+6", Saturation: "-12", SplitToningShadowHue: "196", SplitToningShadowSaturation: "24", SplitToningHighlightHue: "36", SplitToningHighlightSaturation: "16", ColorGradeMidtoneHue: "190", ColorGradeMidtoneSat: "8", HueAdjustmentOrange: "-6", SaturationAdjustmentGreen: "-40", LuminanceAdjustmentBlue: "-20" }, curve: [[0, 18], [70, 60], [190, 196], [255, 236]] },
  { name: "Clean & Bright", group: "Warm", settings: { Exposure2012: "+0.45", Contrast2012: "-8", Highlights2012: "-22", Shadows2012: "+35", Whites2012: "+18", Blacks2012: "+6", Texture: "+4", Vibrance: "+12" }, param: { ParametricLights: "+10", ParametricDarks: "+6" } },
  { name: "Faded Film", group: "Moody", settings: { Contrast2012: "-14", Highlights2012: "-20", Shadows2012: "+20", Blacks2012: "+14", Saturation: "-18", SplitToningShadowHue: "210", SplitToningShadowSaturation: "10", SplitToningHighlightHue: "48", SplitToningHighlightSaturation: "12", GrainAmount: "22", GrainSize: "25", GrainFrequency: "50", PostCropVignetteAmount: "-12" }, curve: [[0, 34], [60, 66], [128, 130], [200, 206], [255, 232]] },
  { name: "Mono Matte", group: "Mono & Outdoors", settings: { ConvertToGrayscale: "True", Contrast2012: "+22", Highlights2012: "-30", Shadows2012: "+16", Blacks2012: "+10", Clarity2012: "+14", GrayMixerRed: "-12", GrayMixerBlue: "-24" }, curve: [[0, 26], [64, 58], [192, 204], [255, 244]] },
  { name: "Crisp Alpine", group: "Mono & Outdoors", settings: { Exposure2012: "+0.10", Contrast2012: "+20", Highlights2012: "-40", Shadows2012: "+30", Whites2012: "+14", Blacks2012: "-12", Texture: "+18", Clarity2012: "+16", Dehaze: "+14", Vibrance: "+22", ColorGradeGlobalHue: "214", ColorGradeGlobalSat: "6", IncrementalTemperature: "-6" }, red: [[0, 0], [128, 122], [255, 255]], blue: [[0, 6], [128, 134], [255, 255]] },
  { name: "Soft Pastel", group: "Warm", settings: { Exposure2012: "+0.35", Contrast2012: "-20", Highlights2012: "-15", Shadows2012: "+25", Whites2012: "+10", Blacks2012: "+18", Clarity2012: "-10", Texture: "-6", Saturation: "-8", ColorGradeMidtoneHue: "330", ColorGradeMidtoneSat: "10", ColorGradeHighlightLum: "+6", IncrementalTint: "+8" } },
  { name: "Night City", group: "Moody", settings: { Exposure2012: "-0.35", Contrast2012: "+24", Highlights2012: "-55", Shadows2012: "+18", Whites2012: "-8", Blacks2012: "-22", Clarity2012: "+18", Dehaze: "+10", Saturation: "+6", SplitToningShadowHue: "222", SplitToningShadowSaturation: "30", SplitToningHighlightHue: "28", SplitToningHighlightSaturation: "20", HueAdjustmentBlue: "-12", SaturationAdjustmentOrange: "+15" }, param: { ParametricShadows: "-14", ParametricHighlights: "+8" } },
];

const attr = (k, v) => `   crs:${k}="${v}"`;
const seq = (key, pts) => pts ? `   <crs:${key}>\n    <rdf:Seq>\n${pts.map(([x, y]) => `     <rdf:li>${x}, ${y}</rdf:li>`).join("\n")}\n    </rdf:Seq>\n   </crs:${key}>` : "";
const alt = (key, text) => `   <crs:${key}>\n    <rdf:Alt>\n     <rdf:li xml:lang="x-default">${text.replace(/&/g, "&amp;")}</rdf:li>\n    </rdf:Alt>\n   </crs:${key}>`;

mkdirSync(out, { recursive: true });
const index = [];
for (const s of SAMPLES) {
  const settings = { ProcessVersion: "15.4", ...s.settings, ...(s.param || {}), ...(s.curve ? { ToneCurveName2012: "Custom" } : {}) };
  const xmp = [
    '<x:xmpmeta xmlns:x="adobe:ns:meta/" x:xmptk="LR Mask Presets samples">',
    ' <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">',
    '  <rdf:Description rdf:about=""',
    '    xmlns:crs="http://ns.adobe.com/camera-raw-settings/1.0/"',
    attr("PresetType", "Normal"), attr("UUID", stableId(`sample:${s.name}`, "uuid")), attr("Version", "18.0"),
    ...Object.entries(settings).map(([k, v]) => attr(k, v)),
    attr("HasSettings", "True") + ">",
    alt("Name", s.name), alt("Group", `Sample ${s.group}`),
    seq("ToneCurvePV2012", s.curve), seq("ToneCurvePV2012Red", s.red), seq("ToneCurvePV2012Blue", s.blue),
    "  </rdf:Description>", " </rdf:RDF>", "</x:xmpmeta>", "",
  ].filter(Boolean).join("\n");
  const file = `${s.name.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "")}.xmp`;
  writeFileSync(join(out, file), xmp);
  index.push(file);
}
writeFileSync(join(out, "index.json"), JSON.stringify(index, null, 2) + "\n");
console.log(`Wrote ${index.length} samples to ${out}`);
