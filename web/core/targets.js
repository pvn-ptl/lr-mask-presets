// Where the look can go. Every encoding here was copied from masks Lightroom itself wrote:
// Select Background is MaskSubType 0 / category 22, Select Landscape parts are 0 / 5000x,
// Select People parts are 3 / n (as in Adobe's Adaptive: Portrait presets), Subject is 1, Sky is 2.
// A subtracted component is MaskBlendMode 1 with MaskValue 0; an inverted one has MaskInverted.

const image = (subType, category, name) => ({ subType: String(subType), category: category == null ? null : String(category), name });
const minus = (component) => ({ ...component, subtract: true });
const inverted = (component) => ({ ...component, inverted: true });

const SKY = image(2, null, "Sky 1");
const SUBJECT = image(1, null, "Subject 1");
const BACKGROUND = image(0, 22, "Background 1");
const PEOPLE = image(3, 13, "All People");

export const FAMILIES = [
  { id: "scene", label: "Scene" },
  { id: "people", label: "People" },
  { id: "landscape", label: "Landscape" },
];

export const TARGETS = [
  { id: "background", family: "scene", label: "Background", hint: "Everything behind the main subject", components: [BACKGROUND] },
  { id: "background-no-sky", family: "scene", label: "Background, not sky", hint: "The background with the sky left alone", components: [BACKGROUND, minus(SKY)] },
  { id: "subject", family: "scene", label: "Subject", hint: "The main subject Lightroom detects", components: [SUBJECT] },
  { id: "sky", family: "scene", label: "Sky", hint: "Just the sky", components: [SKY] },
  { id: "not-sky", family: "scene", label: "Everything but sky", hint: "The land, water and people below the sky", components: [inverted(SKY)] },
  { id: "not-people", family: "scene", label: "Everything but people", hint: "The whole frame except anyone in it", components: [inverted(PEOPLE)] },

  { id: "people", family: "people", label: "All people", hint: "Every person in the photo", components: [PEOPLE] },
  { id: "skin", family: "people", label: "Skin", hint: "Face and body skin", components: [image(3, 2, "Facial Skin"), image(3, 4, "Body Skin")] },
  { id: "face-skin", family: "people", label: "Face skin", components: [image(3, 2, "Facial Skin")] },
  { id: "body-skin", family: "people", label: "Body skin", components: [image(3, 4, "Body Skin")] },
  { id: "hair", family: "people", label: "Hair", components: [image(3, 5, "Hair")] },
  { id: "eyes", family: "people", label: "Eyes", hint: "Irises and whites of the eyes", components: [image(3, 3, "Iris and Pupil"), image(3, 8, "Eye Sclera")] },
  { id: "eyebrows", family: "people", label: "Eyebrows", components: [image(3, 9, "Eyebrows")] },
  { id: "lips", family: "people", label: "Lips", components: [image(3, 6, "Lips")] },
  { id: "teeth", family: "people", label: "Teeth", components: [image(3, 12, "Teeth")] },
  { id: "facial-hair", family: "people", label: "Facial hair", components: [image(3, 7, "Facial Hair")] },
  { id: "clothes", family: "people", label: "Clothes", components: [image(3, 11, "Clothes")] },

  { id: "mountains", family: "landscape", label: "Mountains", components: [image(0, 50002, "Mountains")] },
  { id: "water", family: "landscape", label: "Water", components: [image(0, 50007, "Water")] },
  { id: "vegetation", family: "landscape", label: "Vegetation", components: [image(0, 50005, "Vegetation")] },
  { id: "architecture", family: "landscape", label: "Architecture", components: [image(0, 50001, "Architecture")] },
  { id: "natural-ground", family: "landscape", label: "Natural ground", components: [image(0, 50004, "Natural Ground")] },
  { id: "artificial-ground", family: "landscape", label: "Artificial ground", hint: "Roads, pavement, floors", components: [image(0, 50003, "Artificial Ground")] },
  { id: "snow", family: "landscape", label: "Snow", components: [image(0, 50008, "Snow")] },
];

const BY_ID = new Map(TARGETS.map((t) => [t.id, t]));
const ORDER = new Map(TARGETS.map((t, i) => [t.id, i]));

export function target(id) {
  const found = BY_ID.get(id) || (isCombo(id) ? combination(id) : null);
  if (!found) throw new Error(`Unknown mask: ${id}`);
  return found;
}

export function isTarget(id) {
  if (BY_ID.has(id)) return true;
  try { return isCombo(id) && Boolean(combination(id)); } catch { return false; }
}

// ---------- combinations ----------
//
// A combination starts from one mask, then adds (+) or subtracts (−) others, the way Lightroom's own
// Add and Subtract buttons build a mask. The recipe is the id itself, e.g. "combo:subject/+water/-hair",
// so a combination needs no registry: the same recipe always gives the same mask and the same preset ids.
// Components are written in order (start, then additions, then subtractions), which Lightroom evaluates as
// (start + additions) − subtractions.

const COMBO = "combo:";
export const MAX_COMBINED = 6;

export function isCombo(id) {
  return typeof id === "string" && id.startsWith(COMBO);
}

/** Masks that can be added or subtracted: ones that are a plain area, not already a subtraction themselves. */
export function combinable(id) {
  const t = BY_ID.get(id);
  return Boolean(t && !t.components.some((c) => c.subtract));
}

/** The id for a combination, with additions and subtractions in catalog order (so equal recipes are equal ids). */
export function combineTargets(base, { add = [], subtract = [] } = {}) {
  const sorted = (ids) => [...new Set(ids)].sort((a, b) => (ORDER.get(a) ?? 1e9) - (ORDER.get(b) ?? 1e9));
  const id = [COMBO + base, ...sorted(add).map((x) => `+${x}`), ...sorted(subtract).map((x) => `-${x}`)].join("/");
  combination(id); // throws on a recipe that doesn't make sense
  return id;
}

/** { base, add, subtract } for a combination id, or null. Throws if the recipe is invalid. */
export function comboParts(id) {
  if (!isCombo(id)) return null;
  const [base, ...rest] = id.slice(COMBO.length).split("/");
  const add = [], subtract = [];
  for (const part of rest) {
    const sign = part[0], name = part.slice(1);
    if (sign === "+") add.push(name);
    else if (sign === "-") subtract.push(name);
    else throw new Error(`Unknown mask: ${id}`);
  }
  if (!BY_ID.has(base)) throw new Error(`Unknown mask: ${base}`);
  const parts = [...add, ...subtract];
  for (const name of parts) {
    if (!BY_ID.has(name)) throw new Error(`Unknown mask: ${name}`);
    if (!combinable(name)) throw new Error(`“${BY_ID.get(name).label}” can only be the starting mask`);
  }
  if (!parts.length) throw new Error("A combination needs at least one mask to add or subtract");
  if (parts.length > MAX_COMBINED) throw new Error(`A combination can add or subtract up to ${MAX_COMBINED} masks`);
  if (new Set([base, ...parts]).size !== parts.length + 1) throw new Error("A combination can use each mask once");
  return { base, add, subtract };
}

const comboCache = new Map();
function combination(id) {
  if (comboCache.has(id)) return comboCache.get(id);
  const parts = comboParts(id);
  const base = BY_ID.get(parts.base);
  const label = [base.label, ...parts.add.map((x) => `+ ${BY_ID.get(x).label}`), ...parts.subtract.map((x) => `− ${BY_ID.get(x).label}`)].join(" ");
  const t = {
    id, family: "combined", label, combo: parts,
    hint: [`${base.label}`, parts.add.length ? `plus ${list(parts.add)}` : "", parts.subtract.length ? `without ${list(parts.subtract)}` : ""].filter(Boolean).join(", "),
    components: [
      ...base.components,
      ...parts.add.flatMap((x) => BY_ID.get(x).components),
      ...parts.subtract.flatMap((x) => BY_ID.get(x).components.map(minus)),
    ],
  };
  if (comboCache.size > 500) comboCache.clear();
  comboCache.set(id, t);
  return t;
}

const list = (ids) => ids.map((x) => BY_ID.get(x).label.toLowerCase()).join(" and ");

/**
 * A mask from text: an id ("sky"), a combination id, or a recipe written with spaces, "subject +water -hair".
 * Returns the id, or throws with a readable message.
 */
export function parseMaskSpec(text) {
  const spec = String(text).trim();
  if (BY_ID.has(spec)) return spec;
  if (isCombo(spec)) { combination(spec); return combineTargets(...fromParts(comboParts(spec))); }
  const words = spec.split(/\s+/).filter(Boolean);
  if (words.length > 1 && BY_ID.has(words[0])) {
    const add = [], subtract = [];
    for (const w of words.slice(1)) {
      if (w[0] === "+") add.push(w.slice(1));
      else if (w[0] === "-" || w[0] === "−") subtract.push(w.slice(1));
      else throw new Error(`In “${spec}”, put + or - before “${w}”`);
    }
    return combineTargets(words[0], { add, subtract });
  }
  throw new Error(`Unknown mask "${spec}"`);
}

const fromParts = (p) => [p.base, { add: p.add, subtract: p.subtract }];
