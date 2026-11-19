import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { CRS, RDF, parsePreset } from "../web/core/preset.js";
import { child, children, parseXml } from "../web/core/xml.js";

export const FIXTURES = fileURLToPath(new URL("./fixtures/", import.meta.url));
export const SAMPLES = fileURLToPath(new URL("../web/samples/", import.meta.url));

export function fixtureText(name) {
  return readFileSync(FIXTURES + name, "utf8");
}

export function load(name) {
  return parsePreset(fixtureText(name), { filename: name, fallbackName: name });
}

export function statuses(conv) {
  return Object.fromEntries(conv.rows.map((r) => [r.label, r.status]));
}

/** A minimal XMP preset with the given crs attributes and optional extra elements. */
export function xmp(settings = {}, { name = "Test", group = "Tests", extra = "", type = "Normal" } = {}) {
  const esc = (v) => String(v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
  const attrs = Object.entries({ ...(type ? { PresetType: type } : {}), ...settings }).map(([k, v]) => `\n   crs:${k}="${esc(v)}"`).join("");
  return `<x:xmpmeta xmlns:x="adobe:ns:meta/">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:about="" xmlns:crs="http://ns.adobe.com/camera-raw-settings/1.0/"${attrs}>
   <crs:Name><rdf:Alt><rdf:li xml:lang="x-default">${name}</rdf:li></rdf:Alt></crs:Name>
   <crs:Group><rdf:Alt><rdf:li xml:lang="x-default">${group}</rdf:li></rdf:Alt></crs:Group>
   ${extra}
  </rdf:Description>
 </rdf:RDF>
</x:xmpmeta>`;
}

/** Pull the parts Lightroom cares about out of a written preset. */
export function inspect(text) {
  const root = parseXml(text);
  const desc = child(child(root, RDF, "RDF"), RDF, "Description");
  const top = Object.fromEntries(desc.attrs.filter((a) => a.uri === CRS).map((a) => [a.local, a.value]));
  const at = (el, ...path) => path.reduce((node, [uri, local]) => node && child(node, uri, local), el);
  const alt = (key) => at(desc, [CRS, key], [RDF, "Alt"], [RDF, "li"])?.text ?? "";
  const groups = children(at(desc, [CRS, "MaskGroupBasedCorrections"], [RDF, "Seq"]), RDF, "li");
  const corrections = groups.map((li) => {
    const c = child(li, RDF, "Description");
    const values = Object.fromEntries(c.attrs.filter((a) => a.uri === CRS).map((a) => [a.local, a.value]));
    const masks = children(at(c, [CRS, "CorrectionMasks"], [RDF, "Seq"]), RDF, "li")
      .map((m) => Object.fromEntries(m.attrs.filter((a) => a.uri === CRS).map((a) => [a.local, a.value])));
    const curves = {};
    for (const key of ["MainCurve", "RedCurve", "GreenCurve", "BlueCurve"]) {
      const el = child(c, CRS, key);
      const seq = el && child(el, RDF, "Seq");
      if (seq) curves[key] = children(seq, RDF, "li").map((li) => li.text.split(",").map(Number));
    }
    return { values, masks, curves };
  });
  const elements = desc.children.filter((e) => e.uri === CRS).map((e) => e.local);
  return { top, name: alt("Name"), group: alt("Group"), description: alt("Description"), corrections, elements };
}
