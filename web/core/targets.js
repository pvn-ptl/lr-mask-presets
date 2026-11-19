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

export function target(id) {
  const found = BY_ID.get(id);
  if (!found) throw new Error(`Unknown mask: ${id}`);
  return found;
}
