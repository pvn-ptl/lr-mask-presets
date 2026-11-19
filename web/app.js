import * as core from "./core/index.js";
import { createPlatform, droppedFiles } from "./platform.js";
import { icon } from "./icons.js";
import { paintSwatch } from "./swatch.js";

const platform = createPlatform();
const native = platform.kind === "native";
const params = new URLSearchParams(location.search);
const $ = (id) => document.getElementById(id);
const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
const narrow = (px) => matchMedia(`(max-width: ${px}px)`).matches;

const SOURCE_ICONS = { lightroom: "cloud-photos", lrc: "desktop-photos", acr: "camera", adobe: "stack", folder: "folder", added: "file", samples: "sparkle", custom: "folder" };
const STATUS_TEXT = { exact: "Exact", approx: "Approximate", global: "Whole photo", lost: "Not in mask" };
const OPTION_TEXT = [
  ["parametric", "Parametric → points", "Masks only take point curves, so parametric sliders are traced as points"],
  ["grayscale", "B&W → desaturate", "Black & white presets make the masked area black & white"],
  ["vibrance", "Vibrance → Saturation", "Masks have no Vibrance slider; add it to Saturation at half strength"],
];

const state = {
  sources: [],           // { key, label, kind, path, available, enabled, removable, entries, errors }
  entries: [],           // presets from enabled sources, duplicates and our own output removed
  byId: new Map(),       // every loaded entry, by id
  index: new Map(),      // entry id -> small number, for element ids and view-transition names
  filter: "all",         // source key
  group: null,           // group name inside the source, or null for all
  query: "",
  view: "grid",
  sort: "name",
  sortDir: 1,
  checked: new Set(),    // the selection
  current: null,         // the preset shown in the inspector
  anchor: null,          // for shift-click ranges
  targets: new Set(["background"]),
  options: { ...core.DEFAULT_OPTIONS },
  groupTemplate: core.DEFAULT_GROUP_TEMPLATE,
  inspector: true,
  settings: {},
  outputFolder: "",
  apps: {},
  conversions: new Map(),
};

// ---------- tiny DOM helper (text is always set as text, never parsed as HTML) ----------

function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "text") el.textContent = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (typeof v !== "string" && k in el) el[k] = v;
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const kid of kids.flat(Infinity)) if (kid != null && kid !== false) el.append(kid instanceof Node ? kid : String(kid));
  return el;
}

/** Replace an element's children, skipping empty slots (replaceChildren would print "null"). */
function fill(el, ...kids) {
  el.replaceChildren(...kids.flat(Infinity).filter((k) => k != null && k !== false));
  return el;
}

const plural = (n, one, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

/** Set text and, when it actually changed, let it roll in. */
function setRolling(el, text) {
  if (!el || el.textContent === text) return;
  const first = !el.textContent;
  el.textContent = text;
  if (first || reducedMotion()) return; // the first fill arrives with its container; only changes roll
  el.classList.remove("roll");
  void el.offsetWidth;
  el.classList.add("roll");
}

// ---------- loading presets ----------

async function boot() {
  for (const el of document.querySelectorAll("[data-icon]")) el.append(icon(el.dataset.icon));
  if (native) document.documentElement.classList.add("native");
  bindChrome();

  state.settings = (await platform.getSettings()) || {};
  restoreSettings();
  applyTheme();

  if (params.has("demo")) {
    await loadSamples({ quiet: true });
  } else {
    await scan();
  }
  hideLoading();
  render();
  document.documentElement.dataset.ready = "1";
  requestAnimationFrame(() => requestAnimationFrame(() => document.documentElement.classList.add("settled")));
  platform.ready({ presets: state.entries.length });
}

async function scan() {
  setLoading("Looking for your presets…");
  const result = await platform.scan();
  state.outputFolder = result.outputFolder || "";
  state.apps = result.apps || {};
  const kept = state.sources.filter((s) => s.kind === "added" || s.kind === "samples");
  const enabled = state.settings.sources || {};
  const found = [];
  for (const src of result.sources || []) {
    const count = (src.files || []).length;
    if (count) setLoading(`Reading ${plural(count, "file")} from ${src.label}…`);
    found.push(await loadSource({ ...src, enabled: enabled[src.key] ?? src.defaultEnabled ?? true }));
  }
  state.sources = [...found, ...kept];
  rebuild();
  const errors = state.sources.reduce((n, s) => n + s.errors.length, 0);
  if (errors) toast(`${plural(errors, "file")} couldn't be read (details in Settings › Sources)`);
}

async function loadSource(src, { allowUntyped = false } = {}) {
  const loose = allowUntyped ? (src.files || []).filter((f) => !String(f.path).includes("/")) : [];
  const nested = (src.files || []).filter((f) => !loose.includes(f));
  const a = await core.loadFiles(nested, { source: src.key });
  const b = await core.loadFiles(loose, { source: src.key, allowUntyped: true });
  const { files, ...rest } = src;
  return { ...rest, entries: [...a.entries, ...b.entries], errors: [...(src.errors || []), ...a.errors, ...b.errors] };
}

async function addFiles(files, label = "Added Files") {
  if (!files?.length) return;
  setLoading(`Reading ${plural(files.length, "file")}…`);
  const existing = state.sources.find((s) => s.key === "added");
  const loaded = await loadSource({ key: "added", label, kind: "added", path: "", available: true, enabled: true, removable: true, files }, { allowUntyped: true });
  hideLoading();
  const known = new Set(existing?.entries.map((e) => e.id));
  const fresh = loaded.entries.filter((e) => !known.has(e.id));
  if (existing) {
    existing.entries.push(...fresh);
    existing.errors.push(...loaded.errors);
    existing.enabled = true;
  } else {
    state.sources.push(loaded);
  }
  rebuild();
  const usable = fresh.filter((e) => !core.isConverted(e.preset));
  if (usable.length) {
    state.filter = "added";
    state.group = null;
    state.query = "";
    $("search").value = "";
    selectOnly(usable[0].id);
    toast(`Added ${plural(usable.length, "preset")}${loaded.errors.length ? ` · ${plural(loaded.errors.length, "file")} couldn't be read` : ""}`);
  } else if (loaded.errors.length) {
    toast(loaded.errors.length === 1 ? loaded.errors[0] : `${plural(loaded.errors.length, "file")} couldn't be read`, true);
  } else {
    toast(fresh.length ? "Those are presets made by this app already" : "No new Lightroom presets in there", !fresh.length);
  }
  render();
}

async function loadSamples({ quiet = false } = {}) {
  if (state.sources.some((s) => s.kind === "samples")) return;
  const names = await (await fetch("samples/index.json")).json();
  const files = await Promise.all(names.map(async (name) => ({ path: `Sample Looks/${name}`, text: await (await fetch(`samples/${encodeURIComponent(name)}`)).text() })));
  state.sources.push(await loadSource({ key: "samples", label: "Sample Looks", kind: "samples", path: "", available: true, enabled: true, removable: true, files }));
  rebuild();
  if (!quiet) {
    state.filter = "samples";
    state.group = null;
    rebuild();
    toast("Loaded 8 sample looks to try");
  }
  render();
}

async function addFolder() {
  const result = await platform.chooseFolders();
  if (!result?.sources?.length) return;
  setLoading("Reading folder…");
  for (const src of result.sources) {
    const loaded = await loadSource({ ...src, enabled: true, removable: true });
    const at = state.sources.findIndex((s) => s.key === src.key);
    if (at >= 0) state.sources[at] = loaded; else state.sources.push(loaded);
    state.filter = src.key;
    state.group = null;
  }
  hideLoading();
  rebuild();
  const src = state.sources.find((s) => s.key === state.filter);
  const count = src ? src.entries.filter((e) => !core.isConverted(e.preset)).length : 0;
  toast(count ? `Found ${plural(count, "preset")} in ${src.label}` : `No Lightroom presets in ${src?.label || "that folder"}`, !count);
  saveSettings();
  render();
}

async function pickFiles() {
  const result = await platform.chooseFiles();
  if (result?.files) await addFiles(result.files);
}

function rebuild() {
  state.byId = new Map(state.sources.flatMap((s) => s.entries.map((e) => [e.id, e])));
  state.index = new Map([...state.byId.keys()].map((id, i) => [id, i]));
  const unique = core.dedupe(state.sources.filter((s) => s.enabled).flatMap((s) => s.entries));
  state.entries = unique.filter((e) => !core.isConverted(e.preset));
  if (state.filter !== "all" && !state.sources.some((s) => s.key === state.filter && s.enabled)) state.filter = "all";
  if (state.group && !scopeEntries().length) state.group = null;
  for (const id of state.checked) if (!state.byId.has(id)) state.checked.delete(id);
  const visible = visibleEntries();
  if (!state.current || !visible.some((e) => e.id === state.current)) state.current = firstShown(visible)?.id || null;
}

// ---------- derived data ----------

function conversion(entry) {
  let conv = state.conversions.get(entry.id);
  if (!conv) {
    conv = core.convert(entry.preset, state.options);
    state.conversions.set(entry.id, conv);
  }
  return conv;
}

function sourceEntries() {
  if (state.filter === "all") return state.entries;
  const src = state.sources.find((s) => s.key === state.filter);
  return src ? src.entries.filter((e) => !core.isConverted(e.preset)) : [];
}

/** The current source, narrowed to the chosen group (before searching). */
function scopeEntries() {
  const all = sourceEntries();
  return state.group ? all.filter((e) => (e.preset.group || "Presets") === state.group) : all;
}

const byName = (a, b) => a.preset.name.localeCompare(b.preset.name, undefined, { numeric: true, sensitivity: "base" });
const byGroupName = (a, b) => (a.preset.group || "").localeCompare(b.preset.group || "", undefined, { numeric: true, sensitivity: "base" });

function visibleEntries() {
  const words = state.query.toLowerCase().split(/\s+/).filter(Boolean);
  const list = scopeEntries().filter((e) => {
    if (!words.length) return true;
    const hay = `${e.preset.name} ${e.preset.group}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
  const dir = state.sortDir;
  const sorters = {
    name: (a, b) => dir * byName(a, b),
    group: (a, b) => dir * (byGroupName(a, b) || byName(a, b)),
    fit: (a, b) => dir * (conversion(b).coverage - conversion(a).coverage) || byName(a, b),
  };
  return list.sort(sorters[state.sort] || sorters.name);
}

function groupsOf(entries) {
  const groups = new Map();
  for (const e of entries) {
    const name = e.preset.group || "Presets";
    if (!groups.has(name)) groups.set(name, []);
    groups.get(name).push(e);
  }
  return [...groups.entries()]
    .sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true, sensitivity: "base" }))
    .map(([name, items]) => ({ name, items }));
}

/** Presets in the order they appear on screen. */
function displayOrder(visible = visibleEntries()) {
  return state.view === "grid" ? groupsOf(visible).flatMap((g) => g.items) : visible;
}

/** The first preset in list order, preferring one that has something a mask can hold. */
function firstShown(visible) {
  const ordered = groupsOf(visible).flatMap((g) => g.items);
  return ordered.slice(0, 200).find((e) => !conversion(e).empty) || ordered[0];
}

function selectedEntries() {
  // The same preset can be ticked in two sources; it should still only be made once.
  if (state.checked.size) return core.dedupe([...state.checked].map((id) => state.byId.get(id)).filter(Boolean));
  const current = state.byId.get(state.current);
  return current ? [current] : [];
}

function plannedCount() {
  const entries = selectedEntries();
  const usable = entries.filter((e) => !conversion(e).empty).length;
  return { presets: entries.length, usable, skipped: entries.length - usable, total: usable * state.targets.size };
}

function presetName(preset) {
  const multi = state.targets.size > 1 && !state.groupTemplate.includes("{target}");
  const first = [...state.targets][0];
  return multi && first ? `${preset.name} (${core.target(first).label})` : preset.name;
}

const pctOf = (conv) => Math.round(conv.coverage * 100);
const itemId = (id) => `p${state.index.get(id) ?? "x"}`;

// ---------- rendering ----------

function render() {
  const empty = !state.entries.length;
  $("app").classList.toggle("is-empty", empty);
  $("app").classList.toggle("no-inspector", !state.inspector || empty);
  renderSidebar();
  renderToolbar();
  renderBrowser();
  renderDetail();
  renderBar();
  syncPicker();
  queueDragRegions();
}

// sidebar

const highlight = h("span", { class: "side-highlight", "aria-hidden": "true" });
const sideContent = h("div", { class: "side-content" });

function renderSidebar() {
  const nav = $("sources");
  if (!nav.contains(sideContent)) fill(nav, highlight, sideContent);
  const count = (s) => s.entries.filter((e) => !core.isConverted(e.preset)).length;
  // Empty places stay out of the way; Settings › Sources still lists them.
  const shown = state.sources.filter((s) => s.enabled && s.available !== false && (count(s) || s.kind === "folder"));
  const row = ({ key, label, iconName, n, removable, group }) => h("button", {
    class: `side-row${group ? " group-row" : ""}`, title: label,
    "aria-current": String(group ? state.group === key : !state.group && state.filter === key),
    onclick: () => (group ? selectGroup(key) : selectSource(key)),
  }, icon(iconName, 16), h("span", { class: "label", text: label }),
  h("span", { class: "count", text: n.toLocaleString() }),
  removable ? h("span", {
    class: "remove", role: "button", title: `Remove ${label}`, "aria-label": `Remove ${label}`,
    onclick: (ev) => { ev.stopPropagation(); removeSource(key); },
  }, icon("close", 11)) : null);

  const groups = groupsOf(sourceEntries());
  fill(sideContent, 
    h("div", { class: "side-section" },
      h("div", { class: "side-heading", text: "Library" }),
      row({ key: "all", label: "All Presets", iconName: "stack", n: state.entries.length }),
      ...shown.map((s) => row({ key: s.key, label: s.label, iconName: SOURCE_ICONS[s.kind] || "folder", n: count(s), removable: s.removable })),
      h("button", { class: "side-row add", onclick: addFolder }, icon("plus", 16), h("span", { class: "label", text: "Add Folder…" }))),
    groups.length > 1 ? h("div", { class: "side-section" },
      h("div", { class: "side-heading", text: "Groups" }),
      ...groups.map((g) => row({ key: g.name, label: g.name, iconName: "group", n: g.items.length, group: true }))) : null,
  );
  placeHighlight();
}

function placeHighlight() {
  const active = sideContent.querySelector('.side-row[aria-current="true"]');
  highlight.classList.toggle("on", Boolean(active));
  if (!active) return;
  highlight.style.height = `${active.offsetHeight}px`;
  highlight.style.transform = `translateY(${active.offsetTop}px)`;
}

// toolbar

function renderToolbar() {
  const src = state.filter === "all" ? null : state.sources.find((s) => s.key === state.filter);
  const title = state.group || src?.label || "All Presets";
  $("viewTitle").textContent = title;
  document.title = state.entries.length ? `${title} – LR Mask Presets` : "LR Mask Presets";
  const total = scopeEntries().length;
  const parts = [];
  if (!state.entries.length) parts.push("No presets yet");
  else if (state.query) parts.push(`${visibleEntries().length.toLocaleString()} of ${plural(total, "preset")}`);
  else parts.push(plural(total, "preset"));
  if (state.checked.size > 1) parts.push(`${state.checked.size.toLocaleString()} selected`);
  $("viewSubtitle").textContent = parts.join(" · ");

  const sw = document.querySelector(".view-switch");
  sw.dataset.view = state.view;
  for (const b of sw.querySelectorAll("button")) b.setAttribute("aria-checked", String(b.dataset.view === state.view));

  const ins = $("toggleInspector");
  const open = narrow(980) ? $("app").classList.contains("show-inspector") : state.inspector;
  ins.setAttribute("aria-pressed", String(open));
  ins.title = ins.ariaLabel = open ? "Hide details" : "Show details";
}

// library

function renderBrowser({ keepScroll = true } = {}) {
  const list = $("list");
  const top = list.scrollTop;
  const visible = visibleEntries();
  list.classList.toggle("selecting", state.checked.size > 1);
  list.dataset.view = state.view;
  list.removeAttribute("aria-activedescendant");

  if (!state.entries.length) fill(list, welcome());
  else if (!visible.length) fill(list, emptyList());
  else if (state.view === "list") fill(list, listView(visible));
  else fill(list, gridView(visible));

  if (keepScroll) list.scrollTop = top;
  syncActiveDescendant();
  paintVisible(true);
}

function gridView(visible) {
  const groups = groupsOf(visible);
  const heads = groups.length > 1 || !state.group;
  return h("div", { class: "grid-view" }, groups.map((g) => h("section", { class: "tile-group", "aria-label": g.name },
    heads ? h("header", { class: "tile-group-head" },
      h("h2", { text: g.name, title: g.name }),
      h("span", { class: "count", text: g.items.length.toLocaleString() }),
      h("button", { class: "link", text: "Select All", onclick: () => { selectMany(g.items); } })) : null,
    h("div", { class: "tiles" }, g.items.map(tile)))));
}

function tile(entry) {
  const conv = conversion(entry);
  const { name } = entry.preset;
  return h("div", {
    class: "item tile", role: "option", id: itemId(entry.id), "data-id": entry.id,
    "aria-selected": String(state.checked.has(entry.id)), "aria-current": String(state.current === entry.id),
  },
  h("div", { class: "tile-face" },
    h("canvas", { class: "swatch", width: 120, height: 75, "aria-hidden": "true" }),
    h("span", { class: "check", role: "checkbox", "aria-checked": String(state.checked.has(entry.id)), "aria-label": `Select ${name}` }, icon("check", 13))),
  h("div", { class: "tile-meta" },
    h("span", { class: "name", text: name, title: name }),
    h("span", { class: "sub" }, fitText(conv), entry.preset.format === "lrtemplate" ? h("span", { class: "tag", text: "Classic", title: "Older Lightroom Classic preset (.lrtemplate)" }) : null),
    miniMeter(conv)));
}

function listView(visible) {
  const sortButton = (key, label, extra = "") => h("button", {
    class: `sort ${extra}`, "aria-sort": state.sort === key ? (state.sortDir > 0 ? "ascending" : "descending") : null,
    onclick: () => setSort(key),
  }, label, icon(state.sort === key && state.sortDir < 0 ? "down" : "up", 12));
  const all = visible.every((e) => state.checked.has(e.id));
  const some = visible.some((e) => state.checked.has(e.id));
  return h("div", { class: "list-view" },
    h("div", { class: "list-head" },
      h("span", { class: "check-cell" }, h("input", {
        type: "checkbox", id: "selectAllShown", checked: all, indeterminate: some && !all, "aria-label": "Select all shown", title: "Select all shown",
        onchange: () => (all ? clearSelection() : selectMany(visible)),
      })),
      h("span"),
      sortButton("name", "Name"), sortButton("group", "Group", "hide-narrow"), sortButton("fit", "Carries Over"),
      h("span", { class: "num hide-narrow", text: "Exact" }), h("span", { class: "num hide-narrow hide-mid", text: "Approx." }), h("span", { class: "num hide-narrow hide-mid", text: "Left Out" })),
    visible.map(row));
}

function row(entry) {
  const conv = conversion(entry);
  const c = conv.counts;
  const { name, group } = entry.preset;
  return h("div", {
    class: "item row", role: "option", id: itemId(entry.id), "data-id": entry.id,
    "aria-selected": String(state.checked.has(entry.id)), "aria-current": String(state.current === entry.id),
  },
  h("span", { class: "check-cell" }, h("span", { class: "rowcheck check-hit", role: "checkbox", "aria-checked": String(state.checked.has(entry.id)), "aria-label": `Select ${name}` }, icon("check", 11))),
  h("canvas", { class: "swatch", width: 120, height: 75, "aria-hidden": "true" }),
  h("span", { class: "name", title: name }, h("span", { text: name }), entry.preset.format === "lrtemplate" ? h("span", { class: "tag", text: "Classic" }) : null),
  h("span", { class: "group muted hide-narrow", text: group || "Presets", title: group || "" }),
  h("span", { class: "fit" }, miniMeter(conv), h("span", { class: "pct", text: conv.empty ? "—" : `${pctOf(conv)}%` })),
  h("span", { class: "num hide-narrow", text: String(c.exact) }),
  h("span", { class: "num hide-narrow hide-mid", text: String(c.approx) }),
  h("span", { class: "num hide-narrow hide-mid", text: String(c.global + c.lost) }));
}

function fitText(conv) {
  return conv.empty ? h("span", { text: "Nothing for a mask" }) : h("span", null, h("span", { class: "pct", text: `${pctOf(conv)}%` }), " carries over");
}

function miniMeter(conv) {
  const c = conv.counts;
  const total = conv.rows.length || 1;
  return h("div", { class: "mini-meter", "aria-hidden": "true" },
    ...["exact", "approx", "global"].filter((k) => c[k]).map((k) => h("i", { style: `width: ${(100 * c[k]) / total}%; background: var(--${k})` })));
}

function emptyList() {
  if (state.query) {
    return h("div", { class: "empty" }, h("h2", { text: `No Results for “${state.query}”` }), h("p", { text: "Check the spelling or search for a group name." }),
      h("button", { class: "button", text: "Clear Search", onclick: () => setQuery("") }));
  }
  return h("div", { class: "empty" }, h("h2", { text: "No Presets Here" }), h("p", { text: "Pick another source in the sidebar, or add a folder of presets." }));
}

function welcome() {
  const looked = state.sources.filter((s) => s.kind !== "added" && s.kind !== "samples");
  return h("div", { class: "welcome" },
    h("div", { class: "drop-target" },
      h("div", { class: "halo" }, icon("masks", 32)),
      h("h2", { text: native ? "Let's find your presets" : "Turn any Lightroom preset into a masked preset" }),
      h("p", { text: native
        ? "No Lightroom presets turned up in the usual places on this Mac. Choose a folder of presets, drop a preset pack on this window, or try the samples."
        : "Pick a preset and where it should go: background, subject, sky, people, skin, water and more. You get a new preset that applies the look inside an AI mask. Everything happens on your computer; nothing is uploaded." }),
      h("div", { class: "found" },
        h("button", { class: "button primary big", onclick: addFolder }, icon("folder", 16), "Choose a Folder…"),
        h("button", { class: "button big", onclick: pickFiles }, icon("file", 16), "Choose Files…"),
        h("button", { class: "button big", onclick: () => loadSamples() }, icon("sparkle", 16), "Try Sample Presets"))),
    h("ol", { class: "steps" },
      h("li", null, h("b", { text: "Add presets" }), h("span", { text: "A folder, .xmp or .lrtemplate files, or a .zip preset pack. Drop them anywhere on this window." })),
      h("li", null, h("b", { text: "Choose where the look goes" }), h("span", { text: "Background, subject, sky, people, skin, hair, mountains, water and more. Pick several at once." })),
      h("li", null, h("b", { text: "Import into Lightroom" }), h("span", { text: "File › Import Profiles & Presets, then choose the .zip. The new presets arrive in their own groups." }))),
    native && looked.length ? h("p", { class: "footnote", text: `Looked in: ${looked.map((s) => s.label).join(", ")}. You can add more places in Settings.` }) : null);
}

/** Draw swatches for presets on (or near) the screen. */
let paintQueued = false;
function paintVisible(now = false) {
  const run = () => {
    paintQueued = false;
    const list = $("list");
    const box = list.getBoundingClientRect();
    for (const canvas of list.querySelectorAll("canvas.swatch:not(.painted)")) {
      const r = canvas.getBoundingClientRect();
      if (r.bottom < box.top - 500 || r.top > box.bottom + 500) continue;
      const entry = state.byId.get(canvas.closest(".item")?.dataset.id);
      if (!entry) continue;
      paintSwatch(canvas, entry.preset, entry.id);
      canvas.classList.add("painted");
    }
  };
  if (now) return run();
  if (!paintQueued) { paintQueued = true; requestAnimationFrame(run); }
}

function syncActiveDescendant() {
  const list = $("list");
  const el = state.current && list.querySelector(`#${itemId(state.current)}`);
  if (el) list.setAttribute("aria-activedescendant", el.id); else list.removeAttribute("aria-activedescendant");
}

/** Selection changed: update what's on screen in place instead of rebuilding it. */
function syncSelection({ detail = true } = {}) {
  const list = $("list");
  for (const el of list.querySelectorAll(".item")) {
    const on = state.checked.has(el.dataset.id);
    el.setAttribute("aria-selected", String(on));
    el.setAttribute("aria-current", String(state.current === el.dataset.id));
    el.querySelector('[role="checkbox"]')?.setAttribute("aria-checked", String(on));
  }
  list.classList.toggle("selecting", state.checked.size > 1);
  const box = $("selectAllShown");
  if (box) {
    const visible = visibleEntries();
    const all = visible.every((e) => state.checked.has(e.id)), some = visible.some((e) => state.checked.has(e.id));
    box.checked = all;
    box.indeterminate = some && !all;
  }
  syncActiveDescendant();
  renderToolbar();
  renderBar();
  syncPicker();
  if (detail) renderDetail();
}

// inspector

let shownDetail = null;
let shownPct = 0;
let shownCounts = null; // the meter's last segments, so a new preset's meter morphs from them

function renderDetail() {
  const pane = $("detail");
  const entry = state.byId.get(state.current);
  if (!entry) {
    shownDetail = null;
    return fill(pane, h("div", { class: "placeholder" }, h("b", { text: "No Preset Selected" }), h("span", { text: "Pick a preset to see what carries over into the mask." })));
  }
  const { preset } = entry;
  const conv = conversion(entry);
  const src = state.sources.find((s) => s.key === entry.source);
  const firstTarget = [...state.targets][0];
  const changed = shownDetail !== entry.id;
  const previousScroll = pane.querySelector(".inspector-scroll")?.scrollTop || 0;

  const hero = h("figure", { class: "hero-swatch", title: "The look's tones and colours, from shadows (left) to highlights (right). A sketch from its settings, not a photo." },
    h("canvas", { class: "glow", width: 120, height: 75, "aria-hidden": "true" }),
    h("canvas", { class: "face", width: 120, height: 75, role: "img", "aria-label": `Colour sketch of ${preset.name}` }));
  paintSwatch(hero.children[0], preset, entry.id);
  paintSwatch(hero.children[1], preset, entry.id);

  const c = conv.counts;
  const mapped = c.exact + c.approx;
  const total = conv.rows.length;
  const pct = pctOf(conv);
  const scoreNum = h("span", { class: "num", text: conv.empty ? "—" : String(pct) });
  const score = h("div", { class: "score-row" },
    h("div", { class: "big-score", "aria-label": conv.empty ? "Nothing carries over" : `${pct} percent carries over` }, scoreNum, conv.empty ? null : h("span", { class: "unit", text: "%" })),
    h("div", { class: "score-label" },
      h("b", { text: conv.empty ? "Nothing fits in a mask" : "of the look carries over" }),
      total ? `${mapped} of ${plural(total, "setting")}` : "This preset has no settings"),
    miniCurve(conv));

  const legend = h("div", { class: "legend" },
    ...["exact", "approx", "global", "lost"].filter((k) => c[k]).map((k) => h("span", null, h("i", { style: `background: var(--${k})` }), `${STATUS_TEXT[k]} ${c[k]}`)));
  // First reveal: the meter grows in. Afterwards each segment morphs from the previous preset's share.
  const KINDS = ["exact", "approx", "global", "lost"];
  const morphMeter = changed && shownCounts && !reducedMotion();
  const meter = h("div", { class: `meter${shownDetail ? "" : " reveal"}`, role: "img", "aria-label": `${mapped} of ${total} settings carry over` },
    ...KINDS.map((k) => h("div", { "data-k": k, style: `flex-grow: ${morphMeter ? shownCounts[k] || 0 : c[k]}; background: var(--${k})` })));
  const destination = firstTarget ? h("div", { class: "destination" },
    "Saved in Lightroom as ", h("b", { text: core.groupName(preset, firstTarget, state.groupTemplate) }), " › ", h("b", { text: presetName(preset) }),
    state.targets.size > 1 ? ` (+${state.targets.size - 1} more ${state.targets.size === 2 ? "mask" : "masks"})` : "") : null;

  const notices = [];
  if (conv.empty) notices.push("Nothing in this preset can go into a mask, so it will be skipped. Masks can't hold profiles, per-colour (HSL) sliders, vignette or grain.");
  if (preset.maskCount) notices.push("This preset already has its own masks. They aren't copied; only its global settings are.");

  const rows = h("div", { class: "rows-card" }, h("table", { class: "rows" },
    h("tbody", null, total ? conv.rows.map((r) => [
      h("tr", { class: `${r.status}${r.note ? " has-note" : ""}` },
        h("td", { class: "setting" }, r.label, h("span", { class: "change", text: r.after && r.after !== r.before ? `${r.before} → ${r.after}` : r.before })),
        h("td", { class: "result" }, h("span", { class: `status ${r.status}`, text: STATUS_TEXT[r.status] }))),
      r.note ? h("tr", { class: `note-row ${r.status}` }, h("td", { colspan: "2", text: r.note })) : null,
    ]) : h("tr", null, h("td", { colspan: "2", class: "muted", text: "No adjustments found." })))));

  const scroller = h("div", { class: `inspector-scroll${changed && shownDetail ? " swap" : ""}` },
    hero,
    h("div", { class: "ins-head" },
      h("h2", { class: "title", text: preset.name }),
      h("p", { class: "ins-sub" },
        h("span", { text: preset.group || "Presets" }),
        src ? [h("span", { class: "dot", text: "·" }), h("span", { text: src.label })] : null,
        preset.format === "lrtemplate" ? [h("span", { class: "dot", text: "·" }), h("span", { class: "tag", text: ".lrtemplate" })] : null)),
    score, total ? meter : null, legend, destination,
    ...notices.map((n) => h("div", { class: "notice" }, icon("warning", 15), h("span", { text: n }))),
    h("div", { class: "section-title", text: "What carries over" }),
    rows,
    h("p", { class: "footnote", text: "Exact: the same value in the mask. Approximate: the closest a mask can get (noted per row). Whole photo: kept on the whole image, as you chose. Not in mask: masks have no slider for it." }));

  // The previous preset's details fade out in place while the new ones arrive.
  const old = pane.querySelector(".inspector-scroll:not(.leaving)");
  for (const gone of pane.querySelectorAll(".inspector-scroll.leaving")) gone.remove();
  if (changed && shownDetail && old) {
    old.classList.add("leaving");
    old.addEventListener("animationend", () => old.remove(), { once: true });
    setTimeout(() => old.remove(), 300);
    pane.querySelector(".placeholder")?.remove();
    pane.append(scroller);
  } else {
    fill(pane, scroller);
  }
  if (!changed) scroller.scrollTop = previousScroll;
  if (changed && !conv.empty) countUp(scoreNum, shownDetail ? shownPct : 0, pct, shownDetail ? 360 : 520);
  if (!changed) for (const el of scroller.querySelectorAll(".meter > div, .mini-curve polyline")) el.style.animation = "none";
  if (morphMeter) requestAnimationFrame(() => requestAnimationFrame(() => {
    for (const seg of meter.children) seg.style.flexGrow = String(c[seg.dataset.k] || 0);
  }));
  shownDetail = entry.id;
  shownPct = conv.empty ? 0 : pct;
  shownCounts = { ...c };
}

function countUp(el, from, to, ms = 520) {
  if (reducedMotion() || from === to) return void (el.textContent = String(to));
  el.textContent = String(from);
  let start = null;
  const step = (now) => {
    start ??= now; // the first frame's own clock, so progress never runs backwards past `from`
    const t = Math.max(0, Math.min(1, (now - start) / ms)), e = 1 - (1 - t) ** 3;
    el.textContent = String(Math.round(from + (to - from) * e));
    if (t < 1 && el.isConnected) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

/** A small drawing of the curves the mask will apply. */
function miniCurve(conv) {
  const curves = [["MainCurve", "var(--label)"], ["RedCurve", "#ff5f57"], ["GreenCurve", "#30d158"], ["BlueCurve", "#0a84ff"]].filter(([k]) => conv.curves[k]);
  if (!curves.length) return null;
  const NS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", "0 0 255 255");
  svg.setAttribute("role", "img");
  const names = curves.map(([k]) => k.replace("Curve", "").replace("Main", "Tone")).join(", ");
  svg.setAttribute("aria-label", `${names} curve in the mask`);
  const add = (tag, attrs) => {
    const el = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    svg.append(el);
  };
  add("rect", { width: 255, height: 255, fill: "var(--fill)" });
  for (const q of [63.75, 127.5, 191.25]) {
    add("line", { x1: q, y1: 0, x2: q, y2: 255, stroke: "var(--separator)", "stroke-width": 3 });
    add("line", { x1: 0, y1: q, x2: 255, y2: q, stroke: "var(--separator)", "stroke-width": 3 });
  }
  add("line", { x1: 0, y1: 255, x2: 255, y2: 0, stroke: "var(--separator-strong)", "stroke-dasharray": "8 8", "stroke-width": 3 });
  for (const [key, color] of curves) {
    const pts = core.curveSamples(conv.curves[key], 96).map(([x, y]) => `${x},${255 - y}`).join(" ");
    add("polyline", { points: pts, fill: "none", stroke: color, "stroke-width": 9, "stroke-linejoin": "round", "stroke-linecap": "round", pathLength: "1" });
  }
  return h("figure", { class: "mini-curve", title: `${names} curve${curves.length > 1 ? "s" : ""}, as Lightroom will apply ${curves.length > 1 ? "them" : "it"} inside the mask` },
    svg, h("figcaption", { text: curves.length > 1 ? "Curves" : "Curve" }));
}

// floating bar

const bar = {};
function buildBar() {
  bar.title = h("strong", { id: "barCount" });
  bar.selectAll = h("button", { class: "link", id: "selectAll", onclick: () => {
    const visible = visibleEntries();
    if (visible.length && visible.every((e) => state.checked.has(e.id))) clearSelection(); else selectMany(visible);
  } });
  bar.masks = h("div", { class: "bar-masks" });
  bar.masksButton = h("button", { class: "masks-button lit", id: "masksButton", "aria-haspopup": "dialog", "aria-expanded": "false", onclick: (ev) => togglePicker(ev.currentTarget) },
    icon("masks", 15), h("span", { class: "label long" }), h("span", { class: "label short" }));
  bar.label = h("span");
  bar.create = h("button", { class: "button primary", id: "createButton", onclick: create }, bar.label);
  fill($("bar"), 
    h("div", { class: "bar-summary" }, bar.title, h("span", { class: "bar-sub" }, bar.selectAll)),
    h("span", { class: "bar-divider", "aria-hidden": "true" }),
    bar.masks, bar.masksButton, bar.create);
  $("bar").classList.add("lit");
}

let chipsShown = new Set();
function renderBar() {
  if (!bar.create) buildBar();
  $("bar").parentElement.hidden = !state.entries.length;
  const { total } = plannedCount();
  const many = state.checked.size > 1;
  const first = selectedEntries()[0];
  setRolling(bar.title, many ? plural(state.checked.size, "Preset") : first?.preset.name || "No preset");
  bar.title.title = bar.title.textContent;
  const visible = visibleEntries();
  bar.selectAll.textContent = visible.length && visible.every((e) => state.checked.has(e.id)) ? "Deselect All" : "Select All";

  const chosen = [...state.targets];
  const shown = chosen.slice(0, 3);
  const fresh = new Set(shown);
  const rest = (from) => chosen.slice(from).map((id) => core.target(id).label).join(", ");
  fill(bar.masks,
    chosen.length ? h("span", { class: "bar-into", text: "into" }) : null,
    ...shown.map((id, i) => {
      const t = core.target(id);
      const chip = h("span", { class: "chip", "data-chip": id, "data-i": String(i) }, icon(id, 15), h("span", { text: t.label }),
        h("button", { class: "chip-x", "aria-label": `Remove ${t.label}`, title: `Remove ${t.label}`, onclick: () => toggleTarget(id) }, icon("close", 10)));
      if (chipsShown.has(id)) chip.style.animation = "none";
      return chip;
    }),
    // "+N" for what doesn't fit: one for the full bar (after three chips), one for a narrow bar (after the first).
    chosen.length > 3 ? h("span", { class: "chip more-chip more-3", text: `+${chosen.length - 3}`, title: rest(3) }) : null,
    chosen.length > 1 ? h("span", { class: "chip more-chip more-1", text: `+${chosen.length - 1}`, title: rest(1) }) : null);
  chipsShown = fresh;
  bar.masksButton.classList.toggle("empty-pick", !chosen.length);
  bar.masksButton.querySelector(".long").textContent = chosen.length ? "Masks…" : "Choose Masks…";
  bar.masksButton.querySelector(".short").textContent = !chosen.length ? "Choose Masks…"
    : chosen.length === 1 ? core.target(chosen[0]).label : `${chosen.length} Masks`;
  bar.masksButton.title = chosen.length ? `Into: ${rest(0)}` : "Choose where the look goes";

  if (!bar.create.classList.contains("busy-state")) {
    setRolling(bar.label, total ? `Create ${plural(total, "Preset")}` : "Create Presets");
    bar.create.disabled = total === 0;
  }
  bar.create.title = total ? `${plural(plannedCount().usable, "preset")} × ${plural(state.targets.size, "mask")} (⌘↩)` : state.targets.size ? "Pick a preset first" : "Pick at least one mask";
}

// mask picker

let pickerBuilt = false;
function buildPicker() {
  const pop = $("maskPicker");
  const families = core.FAMILIES.map((fam) => h("div", { class: "mp-family", "data-family": fam.id },
    h("h4", { text: fam.label }),
    h("div", { class: "targets" }, core.TARGETS.filter((t) => t.family === fam.id).map((t) => h("button", {
      class: "target", "data-target": t.id, "aria-pressed": "false", title: t.hint || t.label, onclick: () => toggleTarget(t.id),
    }, icon(t.id, 17), h("span", { class: "label", text: t.label }), h("span", { class: "tick" }, icon("check", 11)))))));

  const leftovers = h("div", { class: "segmented", role: "group", "aria-label": "Settings a mask can't hold" },
    [["drop", "Leave Out"], ["global", "Whole Photo"]].map(([value, label]) => h("button", {
      "data-leftovers": value, "aria-pressed": "false", onclick: () => setOption("leftovers", value),
    }, label)));

  const options = OPTION_TEXT.map(([key, label, hint]) => h("label", { class: "option" },
    h("b", { text: label }), h("span", { text: hint }),
    h("input", { type: "checkbox", class: "switch", role: "switch", "data-option": key, onchange: (ev) => setOption(key, ev.target.checked) })));

  const template = h("input", {
    type: "text", id: "groupTemplate", value: state.groupTemplate, spellcheck: "false", "aria-label": "Lightroom group name",
    oninput: (ev) => {
      state.groupTemplate = ev.target.value || core.DEFAULT_GROUP_TEMPLATE;
      saveSettings();
      renderDetail();
      syncPicker();
    },
  });

  fill(pop, 
    h("div", { class: "mp-scroll" },
      h("div", { class: "mp-head" }, h("h3", { text: "Put the look on" }),
        h("button", { class: "link", id: "clearTargets", text: "Clear", onclick: () => { state.targets.clear(); targetsChanged(); } })),
      ...families,
      h("div", { class: "mp-section" }, h("h4", { text: "Settings a mask can't hold" }), leftovers, h("small", { id: "leftoverHint" })),
      h("details", { class: "more", open: Boolean(state.settings.moreOpen), ontoggle: (ev) => { state.settings.moreOpen = ev.target.open; saveSettings(); } },
        h("summary", null, icon("chevron", 12), "More Options"),
        h("div", { class: "more-body" }, ...options,
          h("div", { class: "field" }, h("h4", { text: "Lightroom group" }), template,
            h("small", { id: "templateExample" }), h("small", { text: "{target} and {group} are filled in for you." }))))),
    h("div", { class: "mp-foot" }, h("div", { class: "tally", id: "tally", "aria-live": "polite" }),
      h("button", { class: "button primary", id: "pickerDone", text: "Done", onclick: () => closePopover() })));
  pickerBuilt = true;
}

function syncPicker() {
  if (!pickerBuilt) return;
  const pop = $("maskPicker");
  for (const b of pop.querySelectorAll("[data-target]")) b.setAttribute("aria-pressed", String(state.targets.has(b.dataset.target)));
  for (const b of pop.querySelectorAll("[data-leftovers]")) b.setAttribute("aria-pressed", String(state.options.leftovers === b.dataset.leftovers));
  for (const s of pop.querySelectorAll("[data-option]")) s.checked = Boolean(state.options[s.dataset.option]);
  for (const fam of pop.querySelectorAll(".mp-family")) {
    const picked = core.TARGETS.filter((t) => t.family === fam.dataset.family && state.targets.has(t.id)).length;
    fam.querySelector("h4").textContent = `${core.FAMILIES.find((f) => f.id === fam.dataset.family).label}${picked ? ` · ${picked} picked` : ""}`;
  }
  $("clearTargets").hidden = !state.targets.size;
  $("leftoverHint").textContent = state.options.leftovers === "global"
    ? "Profile, HSL, vignette, grain and the like stay on the whole photo, as in the original preset."
    : "Profile, HSL, vignette, grain and the like are left out, so only the masked area changes.";
  const example = core.groupName({ group: state.byId.get(state.current)?.preset.group || "Moody" }, [...state.targets][0] || "background", state.groupTemplate);
  $("templateExample").textContent = `e.g. ${example}`;

  const { presets, usable, skipped, total } = plannedCount();
  fill($("tally"), ...(presets === 0 ? ["Pick a preset first."]
    : state.targets.size === 0 ? ["Pick at least one place for the look."]
      : [h("b", { text: plural(usable, "preset") }), " × ", h("b", { text: plural(state.targets.size, "mask") }), " = ", h("b", { text: plural(total, "new preset") }),
        skipped ? h("div", { class: "muted", text: `${plural(skipped, "preset")} skipped: nothing in ${skipped === 1 ? "it" : "them"} can go into a mask` }) : null]));
}

function togglePicker(anchor = $("masksButton")) {
  const pop = $("maskPicker");
  if (openPop?.pop === pop) return closePopover();
  if (!pickerBuilt) buildPicker();
  syncPicker();
  openPopover(pop, anchor, { place: "above", focus: '[data-target][aria-pressed="true"], [data-target]' });
}

// popovers

let openPop = null;
// Opened from the keyboard, focus goes to the first choice; opened with the mouse, to the panel (no focus ring).
let keyboardOpen = false;
document.addEventListener("keydown", () => { keyboardOpen = true; }, true);
document.addEventListener("pointerdown", () => { keyboardOpen = false; }, true);
function openPopover(pop, anchor, { place = "below", focus = "button" } = {}) {
  closePopover(true);
  pop.hidden = false;
  pop.classList.remove("closing");
  openPop = { pop, anchor, place };
  anchor.setAttribute("aria-expanded", "true");
  positionPopover();
  requestAnimationFrame(() => (keyboardOpen ? pop.querySelector(focus) : pop)?.focus({ preventScroll: true }));
}

function positionPopover() {
  if (!openPop) return;
  const { pop, anchor, place } = openPop;
  const a = anchor.getBoundingClientRect();
  const w = pop.offsetWidth, ht = pop.offsetHeight;
  const left = Math.min(Math.max(12, a.left + a.width / 2 - w / 2), innerWidth - w - 12);
  let top = place === "above" ? a.top - ht - 12 : a.bottom + 8;
  let fromTop = place !== "above";
  if (top < 12) { top = Math.min(a.bottom + 8, innerHeight - ht - 12); fromTop = true; }
  if (top + ht > innerHeight - 12) top = Math.max(12, innerHeight - ht - 12);
  pop.style.left = `${left}px`;
  pop.style.top = `${top}px`;
  pop.style.setProperty("--origin", `${a.left + a.width / 2 - left}px ${fromTop ? 0 : ht}px`);
}

function closePopover(instant = false) {
  if (!openPop) return;
  const { pop, anchor } = openPop;
  openPop = null;
  anchor.setAttribute("aria-expanded", "false");
  if (instant) { pop.hidden = true; return; }
  pop.classList.add("closing");
  const done = () => { if (openPop?.pop !== pop && pop.classList.contains("closing")) { pop.hidden = true; pop.classList.remove("closing"); } };
  pop.addEventListener("animationend", done, { once: true });
  setTimeout(done, 200);
}

function openAddMenu() {
  const menu = $("addMenu");
  if (openPop?.pop === menu) return closePopover();
  const item = (iconName, label, keys, fn) => h("button", { role: "menuitem", onclick: () => { closePopover(true); fn(); } },
    icon(iconName, 16), h("span", { text: label }), keys ? h("kbd", { text: keys }) : null);
  fill(menu, 
    item("folder", "Add Folder…", "⇧⌘O", addFolder),
    item("file", "Add Files…", "⌘O", pickFiles),
    h("hr"),
    item("sparkle", "Load Sample Presets", "", () => loadSamples()),
    native ? item("refresh", "Look for Presets Again", "⌘R", () => command("rescan")) : null);
  openPopover(menu, $("addButton"), { place: "below" });
}

// ---------- selection and actions ----------

function selectOnly(id) {
  state.checked = new Set(id ? [id] : []);
  state.current = id;
  state.anchor = id;
}

function toggleCheck(id) {
  if (state.checked.size === 0 && state.current && state.current !== id) state.checked.add(state.current);
  state.checked.has(id) ? state.checked.delete(id) : state.checked.add(id);
  state.current = id;
  state.anchor = id;
}

function selectRange(id) {
  const ids = displayOrder().map((e) => e.id);
  const from = ids.indexOf(state.anchor ?? state.current), to = ids.indexOf(id);
  if (from < 0 || to < 0) return selectOnly(id);
  const [a, b] = from < to ? [from, to] : [to, from];
  for (const each of ids.slice(a, b + 1)) state.checked.add(each);
  state.current = id;
}

function selectMany(entries) {
  for (const e of entries) state.checked.add(e.id);
  if (!entries.some((e) => e.id === state.current) && entries[0]) state.current = entries[0].id;
  syncSelection();
}

function clearSelection() {
  state.checked.clear();
  syncSelection({ detail: false });
}

function onListClick(ev) {
  const item = ev.target.closest(".item");
  if (!item) return;
  const id = item.dataset.id;
  if (ev.target.closest('[role="checkbox"]') || ev.metaKey || ev.ctrlKey) toggleCheck(id);
  else if (ev.shiftKey) selectRange(id);
  else selectOnly(id);
  syncSelection();
}

function moveSelection(key, extend) {
  const order = displayOrder();
  if (!order.length) return;
  const ids = order.map((e) => e.id);
  let at = ids.indexOf(state.current);
  let next;
  if (state.view === "grid" && (key === "ArrowUp" || key === "ArrowDown")) {
    const list = $("list");
    const cur = list.querySelector(`#${itemId(state.current)}`)?.getBoundingClientRect();
    if (cur) {
      const down = key === "ArrowDown";
      let best = null;
      for (const el of list.querySelectorAll(".item")) {
        const r = el.getBoundingClientRect();
        if (down ? r.top <= cur.bottom - 2 : r.bottom >= cur.top + 2) continue;
        const dy = Math.abs(r.top - cur.top), dx = Math.abs(r.left + r.width / 2 - (cur.left + cur.width / 2));
        if (!best || dy < best.dy - 2 || (Math.abs(dy - best.dy) <= 2 && dx < best.dx)) best = { id: el.dataset.id, dy, dx };
      }
      next = best?.id;
    }
  } else {
    const delta = key === "ArrowDown" || key === "ArrowRight" ? 1 : -1;
    if (state.view === "list" && (key === "ArrowLeft" || key === "ArrowRight")) return;
    at = at < 0 ? 0 : Math.max(0, Math.min(ids.length - 1, at + delta));
    next = ids[at];
  }
  if (!next) return;
  if (extend) { state.anchor ??= state.current; selectRange(next); } else selectOnly(next);
  syncSelection();
  $("list").querySelector(`#${itemId(next)}`)?.scrollIntoView({ block: "nearest", behavior: reducedMotion() ? "auto" : "smooth" });
}

function selectSource(key) {
  state.filter = key;
  state.group = null;
  state.anchor = null;
  afterNavigate();
}

function selectGroup(name) {
  state.group = name;
  state.anchor = null;
  afterNavigate();
}

function afterNavigate() {
  rebuild();
  $("list").scrollTop = 0;
  $("app").classList.remove("show-sidebar");
  render();
}

function setSort(key) {
  if (state.sort === key) state.sortDir = -state.sortDir;
  else { state.sort = key; state.sortDir = 1; }
  saveSettings();
  renderBrowser();
}

/** Grid ⇄ list. Each preset's swatch flies from its tile to its row (or back). */
function setView(view) {
  if (!["grid", "list"].includes(view) || view === state.view) return;
  const apply = () => {
    state.view = view;
    renderBrowser({ keepScroll: false });
    const el = state.current && $("list").querySelector(`#${itemId(state.current)}`);
    el?.scrollIntoView({ block: "center" });
    paintVisible(true);
    nameSwatches();
    renderToolbar();
    saveSettings();
  };
  if (!document.startViewTransition || reducedMotion()) return apply();
  nameSwatches();
  const t = document.startViewTransition(apply);
  t.finished.finally(() => { for (const c of $("list").querySelectorAll(".tile-face, canvas.swatch")) c.style.viewTransitionName = ""; });
}

/** Give the swatches on screen names so the view transition can move each one to its new place. */
function nameSwatches() {
  const list = $("list");
  const box = list.getBoundingClientRect();
  let n = 0;
  // In the grid the whole face moves (rounded corners, highlight, selection ring); in the list, the row's swatch.
  const faces = list.querySelectorAll(".tile .tile-face, .row canvas.swatch");
  for (const c of faces) {
    c.style.viewTransitionName = "";
    if (n >= 60) continue;
    const r = c.getBoundingClientRect();
    if (r.bottom < box.top || r.top > box.bottom) continue;
    c.style.viewTransitionName = `sw-${itemId(c.closest(".item").dataset.id)}`;
    n++;
  }
}

function toggleTarget(id) {
  state.targets.has(id) ? state.targets.delete(id) : state.targets.add(id);
  targetsChanged();
}

function targetsChanged() {
  saveSettings();
  renderBar();
  renderDetail();
  syncPicker();
  if (openPop) positionPopover();
}

function setOption(key, value) {
  state.options[key] = value;
  state.conversions.clear();
  saveSettings();
  renderBrowser();
  renderDetail();
  renderBar();
  syncPicker();
}

function setQuery(text) {
  state.query = text.trim();
  if ($("search").value !== text) $("search").value = text;
  const visible = visibleEntries();
  if (visible.length && !visible.some((e) => e.id === state.current)) state.current = firstShown(visible).id;
  $("list").scrollTop = 0;
  render();
}

function toggleInspector() {
  if (narrow(980)) {
    $("app").classList.toggle("show-inspector");
  } else {
    state.inspector = !state.inspector;
    $("app").classList.toggle("no-inspector", !state.inspector);
    saveSettings();
  }
  renderToolbar();
  setTimeout(() => { paintVisible(); queueDragRegions(); }, 480);
}

function removeSource(key) {
  const src = state.sources.find((s) => s.key === key);
  if (!src) return;
  if (src.kind === "folder") platform.removeFolder?.(src.path);
  state.sources = state.sources.filter((s) => s !== src);
  rebuild();
  saveSettings();
  render();
}

async function create() {
  const entries = selectedEntries();
  const targets = [...state.targets];
  if (!entries.length || !targets.length) return;
  const button = $("createButton");
  button.disabled = true;
  button.classList.add("busy-state");
  bar.label.textContent = "Creating…";
  button.prepend(h("span", { class: "busy", "aria-hidden": "true" }));
  try {
    const { jobs, skipped } = core.planBatch(entries, targets, { options: state.options, groupTemplate: state.groupTemplate });
    if (!jobs.length) return toast("Nothing to create: those presets have nothing a mask can hold", true);
    const files = core.renderBatch(jobs);
    const label = targets.length === 1 ? core.target(targets[0]).label : `${targets.length} masks`;
    const folderName = core.fileStem(`${timestamp()} ${label} presets (${files.length})`);
    const zip = core.writeZip(files.map((f) => ({ name: f.name, data: f.text })));
    const result = await platform.save({ folderName, zipName: `${folderName}.zip`, files, zipBase64: core.bytesToBase64(zip) });
    if (result?.error) return toast(result.error, true);
    closePopover(true);
    showDone(result, files, skipped);
    return { ...result, count: files.length, skipped: skipped.length };
  } catch (err) {
    platform.log(err?.stack || err);
    toast(`Couldn't create the presets: ${err?.message || err}`, true);
  } finally {
    button.classList.remove("busy-state");
    button.querySelector(".busy")?.remove();
    bar.label.textContent = "";
    renderBar();
  }
}

function timestamp(d = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

// ---------- sheets ----------

function openDialog(content) {
  const dialog = $("dialog");
  dialog.classList.remove("closing");
  fill(dialog, content);
  if (!dialog.open) dialog.showModal();
}

function closeDialog() {
  const dialog = $("dialog");
  if (!dialog.open) return;
  dialog.classList.add("closing");
  setTimeout(() => { dialog.classList.remove("closing"); dialog.close(); }, 170);
}

function tabs(items, selected, onSelect) {
  return h("div", { class: "tabs", role: "tablist" }, items.map(([id, label, iconName]) => h("button", {
    role: "tab", "aria-selected": String(id === selected), onclick: () => onSelect(id),
  }, iconName ? icon(iconName, 15) : null, label)));
}

function showDone(result, files, skipped, tab = state.apps.cloud === false && state.apps.classic ? "classic" : "cloud") {
  const zip = result.zip || "";
  const zipName = zip.split("/").pop();
  const steps = {
    cloud: [
      "Open Lightroom.",
      "Choose File › Import Profiles & Presets…",
      native ? `Pick “${zipName}” (Show in Finder points at it; in the dialog, ⇧⌘G and paste the copied path).` : `Pick “${zipName}” from your Downloads folder.`,
      "Open Edit › Presets: the new presets are in their own groups and sync to your other devices.",
    ],
    classic: native ? [
      "Click “Install for Classic & Camera Raw” below (or import the .zip from the Develop module: Presets panel › + › Import Presets…).",
      "Restart Lightroom Classic.",
      "The presets appear in the Develop module's Presets panel.",
    ] : [
      "In the Develop module, click + on the Presets panel and choose Import Presets…",
      `Pick “${zipName}”.`,
      "The presets appear in their own groups.",
    ],
    acr: native ? [
      "Click “Install for Classic & Camera Raw” below.",
      "Restart Photoshop (or Bridge) and open Camera Raw.",
      "The presets are in the Presets panel.",
    ] : [
      "Open Camera Raw's Presets panel, click … and choose Import Profiles & Presets…",
      `Pick “${zipName}”.`,
    ],
  };
  const draw = (current) => openDialog(h("div", { class: "sheet" },
    h("h2", null, h("span", { class: "ok" }, icon("check", 18)), `${plural(files.length, "preset")} ready`),
    native && result.folder ? h("div", { class: "path selectable", text: zip || result.folder }) : h("p", { class: "muted", text: `Downloaded ${zipName}.` }),
    skipped.length ? h("details", null, h("summary", { class: "muted", text: `${plural(skipped.length, "preset")} skipped` }),
      h("ul", null, skipped.map((s) => h("li", { class: "muted", text: `${s.name}: ${s.reason}` })))) : null,
    tabs([["cloud", "Lightroom", "cloud-photos"], ["classic", "Lightroom Classic", "desktop-photos"], ["acr", "Camera Raw", "camera"]], current, (id) => draw(id)),
    h("ol", null, steps[current].map((s) => h("li", { text: s }))),
    h("div", { class: "actions" },
      native && current !== "cloud" ? h("button", {
        class: "button", onclick: async (ev) => {
          ev.currentTarget.disabled = true;
          const r = await platform.installCameraRaw(files);
          toast(r?.error ? r.error : `Installed ${plural(r.count, "preset")}. Restart Lightroom Classic or Photoshop to see them.`, Boolean(r?.error));
        },
      }, icon("download", 15), "Install for Classic & Camera Raw") : null,
      native ? h("button", { class: "button", onclick: () => platform.reveal(zip || result.folder) }, icon("reveal", 15), "Show in Finder") : null,
      native ? h("button", { class: "button", onclick: () => { platform.copyText(zip); toast("Path copied"); } }, "Copy Path") : null,
      native && current === "cloud" ? h("button", {
        class: "button", onclick: async () => { const r = await platform.openLightroom(); if (r?.error) toast(r.error, true); },
      }, icon("cloud-photos", 15), "Open Lightroom") : null,
      h("button", { class: "button primary", onclick: closeDialog, autofocus: true }, "Done"))));
  draw(tab);
}

function showSettings(tab = "sources") {
  const body = {
    sources: () => h("div", { class: "settings-list" },
      state.sources.length ? state.sources.map((s) => {
        const usable = s.entries.filter((e) => !core.isConverted(e.preset)).length;
        const status = s.available === false ? "Not found on this Mac" : `${plural(usable, "preset")}${s.errors.length ? ` · ${s.errors.length} unreadable` : ""}`;
        return h("div", { class: "settings-row" },
          icon(SOURCE_ICONS[s.kind] || "folder"),
          h("div", { class: "grow" }, h("div", { text: s.label }), h("small", { class: "selectable", text: s.path ? `${s.path.replace(/^\/Users\/[^/]+/, "~")} · ${status}` : status, title: [s.path, ...s.errors.slice(0, 20)].filter(Boolean).join("\n") })),
          s.removable ? h("button", { class: "icon-button", title: "Remove", "aria-label": `Remove ${s.label}`, onclick: () => { removeSource(s.key); showSettings("sources"); } }, icon("close", 14)) : null,
          h("input", {
            type: "checkbox", class: "switch", role: "switch", checked: s.enabled, disabled: s.available === false, "aria-label": `Use ${s.label}`,
            onchange: (ev) => { s.enabled = ev.target.checked; rebuild(); saveSettings(); render(); },
          }));
      }) : h("p", { class: "muted", text: "No sources yet." }),
      h("div", { class: "actions" },
        native ? h("button", { class: "button", onclick: async () => { closeDialog(); setLoading("Looking for your presets…"); await scan(); hideLoading(); render(); } }, icon("refresh", 15), "Look Again") : null,
        h("button", { class: "button", onclick: async () => { closeDialog(); await addFolder(); } }, icon("folder", 15), "Add Folder…"))),
    output: () => h("div", { class: "settings-list" },
      native ? h("div", { class: "settings-row" }, icon("folder"),
        h("div", { class: "grow" }, h("div", { text: "Save new presets in" }), h("small", { class: "selectable", text: state.outputFolder })),
        h("button", { class: "button", onclick: () => platform.reveal(state.outputFolder) }, "Show"),
        h("button", { class: "button", onclick: async () => { const r = await platform.chooseOutputFolder(); if (r?.outputFolder) { state.outputFolder = r.outputFolder; render(); showSettings("output"); } } }, "Change…"))
        : h("p", { class: "muted", text: "In the browser, new presets download as a .zip." }),
      h("div", { class: "settings-row" }, icon("sparkle"),
        h("div", { class: "grow" }, h("div", { text: "Appearance" })),
        h("div", { class: "segmented" },
          ...[["system", "Auto"], ["light", "Light"], ["dark", "Dark"]].map(([v, label]) => h("button", {
            "aria-pressed": String((state.settings.theme || "system") === v),
            onclick: () => { state.settings.theme = v; applyTheme(); saveSettings(); showSettings("output"); },
          }, label))))),
    about: () => h("div", { class: "settings-list" },
      h("p", null, h("b", { text: "LR Mask Presets" }), document.documentElement.dataset.version ? ` ${document.documentElement.dataset.version}` : ""),
      h("p", { class: "muted", text: "Turns Lightroom presets into presets that apply the look inside an AI mask: background, subject, sky, people, landscape parts and more." }),
      h("p", { class: "muted", text: "Private by design: presets are read on this computer and never uploaded. The app makes no network requests. It only reads Lightroom's folders; it never changes them." }),
      h("p", { class: "muted", text: "Not made by or affiliated with Adobe. Lightroom is a trademark of Adobe." }),
      h("button", { class: "link", text: "Project page on GitHub", onclick: () => platform.openURL("https://github.com/pvn-ptl/lr-mask-presets") })),
  };
  openDialog(h("div", { class: "sheet" },
    h("h2", null, "Settings"),
    tabs([["sources", "Sources", "stack"], ["output", "Output", "folder"], ["about", "About", "info"]], tab, (id) => showSettings(id)),
    body[tab](),
    h("div", { class: "actions" }, h("button", { class: "button primary", onclick: closeDialog }, "Done"))));
}

// ---------- settings ----------

function restoreSettings() {
  const s = state.settings;
  if (Array.isArray(s.targets)) state.targets = new Set(s.targets.filter((id) => core.TARGETS.some((t) => t.id === id)));
  if (s.options) state.options = { ...core.DEFAULT_OPTIONS, ...pick(s.options, Object.keys(core.DEFAULT_OPTIONS)) };
  if (typeof s.groupTemplate === "string" && s.groupTemplate.trim()) state.groupTemplate = s.groupTemplate;
  if (s.view === "grid" || s.view === "list") state.view = s.view;
  if (["name", "group", "fit"].includes(s.sort)) state.sort = s.sort;
  if (s.sortDir === -1) state.sortDir = -1;
  if (typeof s.inspector === "boolean") state.inspector = s.inspector;
  if (params.get("view") === "list" || params.get("view") === "grid") state.view = params.get("view");
}

let saveTimer;
function saveSettings() {
  state.settings = {
    ...state.settings,
    targets: [...state.targets],
    options: state.options,
    groupTemplate: state.groupTemplate,
    view: state.view,
    sort: state.sort,
    sortDir: state.sortDir,
    inspector: state.inspector,
    sources: Object.fromEntries(state.sources.filter((s) => s.kind !== "added" && s.kind !== "samples").map((s) => [s.key, s.enabled])),
  };
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => platform.setSettings(state.settings), 250);
}

function pick(obj, keys) {
  return Object.fromEntries(keys.filter((k) => k in obj).map((k) => [k, obj[k]]));
}

function applyTheme() {
  const theme = params.get("theme") || state.settings.theme || "system";
  if (theme === "system") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
}

// ---------- window chrome: toolbar, drag & drop, keyboard ----------

function bindChrome() {
  $("addButton").addEventListener("click", openAddMenu);
  $("openSettings").addEventListener("click", () => showSettings());
  $("toggleInspector").addEventListener("click", toggleInspector);
  $("toggleSidebar").addEventListener("click", () => $("app").classList.toggle("show-sidebar"));
  for (const b of document.querySelectorAll(".view-switch button")) b.addEventListener("click", () => setView(b.dataset.view));
  $("search").addEventListener("input", (ev) => setQuery(ev.target.value));
  $("search").addEventListener("keydown", (ev) => {
    if (ev.key === "Escape") { setQuery(""); ev.target.blur(); }
    if (ev.key === "ArrowDown") { ev.preventDefault(); $("list").focus(); }
  });
  $("dialog").addEventListener("click", (ev) => { if (ev.target === ev.currentTarget) closeDialog(); });
  $("dialog").addEventListener("cancel", (ev) => { ev.preventDefault(); closeDialog(); });

  const list = $("list");
  list.addEventListener("click", onListClick);
  list.addEventListener("scroll", () => {
    $("content").classList.toggle("scrolled", list.scrollTop > 2);
    paintVisible();
  }, { passive: true });
  list.addEventListener("keydown", (ev) => {
    if (ev.target !== list) return;
    if (ev.key.startsWith("Arrow")) { ev.preventDefault(); moveSelection(ev.key, ev.shiftKey); }
    else if (ev.key === " " && state.current) { ev.preventDefault(); toggleCheck(state.current); syncSelection(); }
    else if (ev.key === "Escape" && state.checked.size) { ev.preventDefault(); clearSelection(); }
    else if ((ev.metaKey || ev.ctrlKey) && ev.key.toLowerCase() === "a") { ev.preventDefault(); command("selectAll"); }
  });

  document.addEventListener("pointerdown", (ev) => {
    if (openPop && !openPop.pop.contains(ev.target) && !openPop.anchor.contains(ev.target)) closePopover();
    if ($("app").classList.contains("show-sidebar") && !ev.target.closest(".sidebar, #toggleSidebar")) $("app").classList.remove("show-sidebar");
  });
  document.addEventListener("pointermove", (ev) => {
    const el = ev.target.closest?.(".lit");
    if (!el) return;
    const r = el.getBoundingClientRect();
    el.style.setProperty("--mx", `${ev.clientX - r.left}px`);
    el.style.setProperty("--my", `${ev.clientY - r.top}px`);
  }, { passive: true });
  $("addMenu").addEventListener("keydown", (ev) => {
    if (ev.key !== "ArrowDown" && ev.key !== "ArrowUp") return;
    ev.preventDefault();
    const items = [...$("addMenu").querySelectorAll("button")];
    const at = items.indexOf(document.activeElement);
    items[(at + (ev.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus();
  });
  window.addEventListener("resize", () => { positionPopover(); placeHighlight(); paintVisible(); queueDragRegions(); renderToolbar(); });
  $("app").addEventListener("transitionend", (ev) => { if (ev.target === $("app")) { paintVisible(); queueDragRegions(); } });

  let depth = 0;
  const hasFiles = (ev) => [...(ev.dataTransfer?.types || [])].includes("Files");
  window.addEventListener("dragenter", (ev) => { if (!hasFiles(ev)) return; ev.preventDefault(); depth++; document.body.classList.add("dragging"); });
  window.addEventListener("dragover", (ev) => { if (hasFiles(ev)) ev.preventDefault(); });
  window.addEventListener("dragleave", () => { if (--depth <= 0) { depth = 0; document.body.classList.remove("dragging"); } });
  window.addEventListener("drop", async (ev) => {
    ev.preventDefault();
    depth = 0;
    document.body.classList.remove("dragging");
    try {
      await addFiles(await droppedFiles(ev.dataTransfer));
    } catch (err) {
      hideLoading();
      toast(`Couldn't read what was dropped: ${err?.message || err}`, true);
    }
  });

  window.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape" && openPop) { ev.preventDefault(); const anchor = openPop.anchor; closePopover(); anchor.focus(); return; }
    if (!(ev.metaKey || ev.ctrlKey) || $("dialog").open) return;
    if (native) return; // the Mac app's menu bar handles these
    const key = ev.key.toLowerCase();
    if (key === "f") { ev.preventDefault(); command("find"); }
    else if (key === "enter") { ev.preventDefault(); command("create"); }
    else if (key === "o") { ev.preventDefault(); command(ev.shiftKey ? "addFolder" : "addFiles"); }
    else if (key === "1") { ev.preventDefault(); command("viewGrid"); }
    else if (key === "2") { ev.preventDefault(); command("viewList"); }
    else if (key === "i" && ev.altKey) { ev.preventDefault(); command("toggleInspector"); }
  });
}

/** In the Mac app, tell the window which parts of the page can drag it (the toolbar band, minus its controls). */
let dragTimer;
function queueDragRegions() {
  if (!native) return;
  clearTimeout(dragTimer);
  dragTimer = setTimeout(() => {
    const rect = (el) => { const r = el.getBoundingClientRect(); return [r.x, r.y, r.width, r.height]; };
    const zones = [...document.querySelectorAll("[data-drag]")].filter((el) => el.offsetParent);
    const holes = zones.flatMap((z) => [...z.querySelectorAll("button, input, label, select, a, [role=button], .capsule")].filter((el) => el.offsetParent));
    platform.dragRegions?.({ regions: zones.map(rect), holes: holes.map(rect) });
  }, 60);
}

/** Menu commands (the Mac app's menu bar calls these) and shortcuts. */
function command(name) {
  switch (name) {
    case "find": $("search").focus(); $("search").select(); break;
    case "create": if (!$("createButton")?.disabled) create(); break;
    case "addFolder": addFolder(); break;
    case "addFiles": pickFiles(); break;
    case "settings": showSettings(); break;
    case "samples": loadSamples(); break;
    case "rescan": setLoading("Looking for your presets…"); scan().then(() => { hideLoading(); render(); }); break;
    case "selectAll": selectMany(visibleEntries()); break;
    case "selectNone": clearSelection(); break;
    case "viewGrid": setView("grid"); break;
    case "viewList": setView("list"); break;
    case "toggleInspector": toggleInspector(); break;
    case "toggleSidebar": $("app").classList.toggle("show-sidebar"); break;
    case "masks": togglePicker(); break;
    default: platform.log(`Unknown command: ${name}`);
  }
}

// ---------- feedback ----------

let toastTimer;
function toast(message, error = false) {
  const el = $("toast");
  fill(el, icon(error ? "warning" : "check", 16), h("span", { text: message }));
  el.classList.toggle("error", error);
  el.classList.remove("show");
  void el.offsetWidth;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), error ? 6000 : 3200);
}

function setLoading(text) {
  $("loadingText").textContent = text;
  $("loading").classList.remove("hidden");
}

function hideLoading() {
  $("loading").classList.add("hidden");
}

// For the Mac app's menus and for scripted screenshots.
window.app = {
  command,
  addFiles,
  show(name) {
    const entry = state.entries.find((e) => e.preset.name === name) || [...state.byId.values()].find((e) => e.preset.name === name);
    if (!entry) return false;
    state.current = entry.id;
    state.anchor = entry.id;
    if (!visibleEntries().some((e) => e.id === entry.id)) { state.group = null; state.query = ""; $("search").value = ""; }
    render();
    $("list").querySelector(`#${itemId(entry.id)}`)?.scrollIntoView({ block: "nearest" });
    return true;
  },
  check(names) {
    state.checked = new Set(visibleEntries().filter((e) => names.includes(e.preset.name)).map((e) => e.id));
    syncSelection();
  },
  setTargets(ids) {
    state.targets = new Set(ids);
    targetsChanged();
  },
  setView,
  setOption,
  showSettings,
  openMasks: () => togglePicker(),
  create,
  get state() { return state; },
};

boot().catch((err) => {
  hideLoading();
  platform.log(err?.stack || err);
  fill($("list"), h("div", { class: "empty" }, h("h2", { text: "Something went wrong" }), h("p", { class: "selectable", text: String(err?.message || err) })));
});
