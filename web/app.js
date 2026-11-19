import * as core from "./core/index.js";
import { createPlatform, droppedFiles } from "./platform.js";
import { icon } from "./icons.js";

const platform = createPlatform();
const params = new URLSearchParams(location.search);
const $ = (id) => document.getElementById(id);

const SOURCE_ICONS = { lightroom: "lightroom", lrc: "lrc", acr: "ps", adobe: "stack", folder: "folder", added: "file", samples: "sparkle" };
const STATUS_TEXT = { exact: "Exact", approx: "Approximate", global: "Whole photo", lost: "Not in mask" };
const OPTION_TEXT = [
  ["parametric", "Parametric → points", "Masks only take point curves, so parametric sliders are traced as points"],
  ["grayscale", "B&W → desaturate", "Black & white presets make the masked area black & white"],
  ["vibrance", "Vibrance → Saturation", "Masks have no Vibrance slider; add it to Saturation at half strength"],
];
const MANY_GROUPS = 150; // above this many presets, groups start collapsed

const state = {
  sources: [],           // { key, label, kind, path, available, enabled, removable, entries, errors }
  entries: [],           // presets from enabled sources, duplicates and our own output removed
  byId: new Map(),       // every loaded entry, by id
  filter: "all",
  query: "",
  sort: "name",
  collapsed: new Set(),
  checked: new Set(),
  current: null,
  anchor: null,
  targets: new Set(["background"]),
  openFamilies: new Set(["scene"]),
  options: { ...core.DEFAULT_OPTIONS },
  groupTemplate: core.DEFAULT_GROUP_TEMPLATE,
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

const plural = (n, one, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

// ---------- loading presets ----------

async function boot() {
  for (const el of document.querySelectorAll("[data-icon]")) el.append(icon(el.dataset.icon));
  if (platform.kind === "native") document.documentElement.classList.add("native");
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

async function addFiles(files, label = "Added files") {
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
    state.query = "";
    $("search").value = "";
    setCurrent(usable[0].id);
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
  state.sources.push(await loadSource({ key: "samples", label: "Sample looks", kind: "samples", path: "", available: true, enabled: true, removable: true, files }));
  rebuild();
  if (!quiet) {
    state.filter = "samples";
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
  const unique = core.dedupe(state.sources.filter((s) => s.enabled).flatMap((s) => s.entries));
  state.entries = unique.filter((e) => !core.isConverted(e.preset));
  if (state.filter !== "all" && !state.sources.some((s) => s.key === state.filter && s.enabled)) state.filter = "all";
  for (const id of state.checked) if (!state.byId.has(id)) state.checked.delete(id);
  const visible = visibleEntries();
  if (!state.current || !visible.some((e) => e.id === state.current)) state.current = firstShown(visible)?.id || null;
  if (state.collapsed.size === 0 && !state.query && visible.length > MANY_GROUPS && !state.autoCollapsed) {
    state.autoCollapsed = true;
    const current = state.byId.get(state.current);
    for (const g of groupsOf(visible)) if (g.name !== current?.preset.group) state.collapsed.add(g.name);
  }
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

function visibleEntries() {
  const words = state.query.toLowerCase().split(/\s+/).filter(Boolean);
  const list = sourceEntries().filter((e) => {
    if (!words.length) return true;
    const hay = `${e.preset.name} ${e.preset.group}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
  const byName = (a, b) => a.preset.name.localeCompare(b.preset.name, undefined, { numeric: true, sensitivity: "base" });
  const byFit = (a, b) => conversion(b).coverage - conversion(a).coverage || byName(a, b);
  return list.sort(state.sort === "fit" ? byFit : byName);
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

// ---------- rendering ----------

function render() {
  renderSources();
  renderListTools();
  renderList();
  renderDetail();
  renderCreate();
}

function renderSources() {
  const nav = $("sources");
  const count = (s) => s.entries.filter((e) => !core.isConverted(e.preset)).length;
  // Empty places stay out of the way; Settings › Sources still lists them.
  const enabled = state.sources.filter((s) => s.enabled && s.available !== false && (count(s) || s.kind === "folder"));
  const row = (key, label, iconName, n, removable) => h("button", {
    class: "source", "aria-current": String(state.filter === key), title: label,
    onclick: () => { state.filter = key; state.anchor = null; rebuild(); render(); },
  }, icon(iconName, 16), h("span", { class: "label", text: label }), h("span", { class: "count", text: n.toLocaleString() }),
  removable ? h("span", { class: "remove", role: "button", title: `Remove ${label}`, "aria-label": `Remove ${label}`, onclick: (ev) => { ev.stopPropagation(); removeSource(key); } }, icon("close", 14)) : null);

  nav.replaceChildren(
    h("div", { class: "sources-title", text: "Presets" }),
    row("all", "All presets", "stack", state.entries.length),
    ...enabled.map((s) => row(s.key, s.label, SOURCE_ICONS[s.kind] || "folder", count(s), s.removable)),
    h("button", { class: "source add", onclick: addFolder }, icon("plus", 16), h("span", { class: "label", text: "Add a folder…" })),
  );
}

function renderListTools() {
  const visible = visibleEntries();
  const allChecked = visible.length > 0 && visible.every((e) => state.checked.has(e.id));
  const someChecked = visible.some((e) => state.checked.has(e.id));
  const box = h("input", {
    type: "checkbox", checked: allChecked, indeterminate: someChecked && !allChecked, title: "Select all shown", "aria-label": "Select all shown",
    onchange: () => {
      for (const e of visible) allChecked ? state.checked.delete(e.id) : state.checked.add(e.id);
      render();
    },
  });
  const text = state.checked.size
    ? h("span", null, h("b", { text: state.checked.size.toLocaleString() }), " selected · ", h("button", { class: "link", text: "Clear", onclick: () => { state.checked.clear(); render(); } }))
    : h("span", { text: state.query ? `${plural(visible.length, "match", "matches")}` : plural(visible.length, "preset") });
  const sort = h("select", { "aria-label": "Sort", onchange: (ev) => { state.sort = ev.target.value; renderList(); } },
    h("option", { value: "name", text: "Name", selected: state.sort === "name" }),
    h("option", { value: "fit", text: "Best fit", selected: state.sort === "fit" }));
  $("listTools").replaceChildren(box, text, h("span", { class: "grow" }), sort);
}

function renderList() {
  const list = $("list");
  const visible = visibleEntries();
  if (!visible.length) {
    list.replaceChildren(emptyList());
    return;
  }
  const searching = Boolean(state.query);
  const frag = document.createDocumentFragment();
  for (const group of groupsOf(visible)) {
    const open = searching || !state.collapsed.has(group.name);
    const n = group.items.filter((e) => state.checked.has(e.id)).length;
    frag.append(h("div", { class: "group", "data-group": group.name },
      h("button", { class: "chev", "aria-expanded": String(open), "aria-label": open ? "Collapse" : "Expand", onclick: () => toggleGroup(group.name) }, icon("chevron", 14)),
      h("input", {
        type: "checkbox", checked: n === group.items.length, indeterminate: n > 0 && n < group.items.length, "aria-label": `Select ${group.name}`,
        onchange: () => { for (const e of group.items) n === group.items.length ? state.checked.delete(e.id) : state.checked.add(e.id); render(); },
      }),
      h("span", { class: "name", text: group.name, title: group.name, onclick: () => toggleGroup(group.name) }),
      h("span", { class: "count", text: group.items.length.toLocaleString() })));
    if (!open) continue;
    for (const e of group.items) frag.append(itemRow(e, visible));
  }
  list.replaceChildren(frag);
  list.querySelector('.item[aria-current="true"]')?.scrollIntoView({ block: "nearest" });
}

function itemRow(entry, visible) {
  const conv = conversion(entry);
  const pct = Math.round(conv.coverage * 100);
  const score = conv.empty ? h("span", { class: "score", text: "—", title: "Nothing in it can go into a mask" })
    : h("span", { class: `score ${pct >= 80 ? "hi" : pct >= 50 ? "mid" : ""}`, text: `${pct}%`, title: `${pct}% of its settings carry over into a mask` });
  return h("div", {
    class: "item", role: "option", "data-id": entry.id, "aria-current": String(state.current === entry.id), "aria-selected": String(state.checked.has(entry.id)),
    onclick: (ev) => { if (ev.target.tagName !== "INPUT") { setCurrent(entry.id); renderAfterSelect(); } },
  },
  h("input", {
    type: "checkbox", checked: state.checked.has(entry.id), "aria-label": `Select ${entry.preset.name}`,
    onclick: (ev) => { toggleCheck(entry.id, ev.shiftKey, visible); },
  }),
  h("span", { class: "name", text: entry.preset.name, title: entry.preset.name }),
  entry.preset.format === "lrtemplate" ? h("span", { class: "tag", text: "Classic", title: "Older Lightroom Classic preset (.lrtemplate)" }) : null,
  score);
}

function emptyList() {
  if (state.query) return h("div", { class: "list-empty" }, h("span", { text: `Nothing matches “${state.query}”.` }), h("button", { class: "link", text: "Clear search", onclick: () => setQuery("") }));
  if (!state.entries.length) return h("div", { class: "list-empty" }, h("span", { text: "No presets yet." }));
  return h("div", { class: "list-empty" }, h("span", { text: "No presets here." }));
}

function renderDetail() {
  const pane = $("detail");
  const entry = state.byId.get(state.current);
  if (!state.entries.length && !entry) return pane.replaceChildren(welcome());
  if (!entry) return pane.replaceChildren(h("div", { class: "hero" }, h("p", { text: "Pick a preset on the left to see how it carries over." })));

  const { preset } = entry;
  const conv = conversion(entry);
  const src = state.sources.find((s) => s.key === entry.source);
  const firstTarget = [...state.targets][0];

  const eyebrow = h("div", { class: "eyebrow" },
    src ? h("span", { class: "badge" }, src.label) : null,
    h("span", { text: preset.group || "Presets" }),
    preset.format === "lrtemplate" ? h("span", { class: "badge", text: ".lrtemplate" }) : null);

  const c = conv.counts;
  const mapped = c.exact + c.approx;
  const total = conv.rows.length;
  const legend = h("div", { class: "legend" },
    ...["exact", "approx", "global", "lost"].filter((k) => c[k]).map((k) => h("span", null, h("i", { style: `background: var(--${k})` }), `${STATUS_TEXT[k]} ${c[k]}`)));
  const meter = h("div", { class: "meter", role: "img", "aria-label": `${mapped} of ${total} settings carry over` },
    ...["exact", "approx", "global", "lost"].filter((k) => c[k]).map((k) => h("div", { style: `flex: ${c[k]}; background: var(--${k})` })));
  const destination = firstTarget ? h("div", { class: "destination" },
    "Saved in Lightroom as", h("b", { text: core.groupName(preset, firstTarget, state.groupTemplate) }), "›", h("b", { text: presetName(preset) }),
    state.targets.size > 1 ? h("span", { text: `(+${state.targets.size - 1} more ${state.targets.size === 2 ? "mask" : "masks"})` }) : null) : null;
  const summary = h("div", { class: "card summary" },
    h("div", { class: "summary-main" },
      h("div", { class: "summary-top" },
        h("strong", { text: total ? `${mapped} of ${total} settings carry over into the mask` : "This preset has no settings" }),
        legend),
      total ? meter : null,
      destination),
    miniCurve(conv));

  const notices = [];
  if (conv.empty) notices.push("Nothing in this preset can go into a mask, so it will be skipped. Masks can't hold profiles, per-color (HSL) sliders, vignette or grain.");
  if (preset.maskCount) notices.push("This preset already has its own masks. They aren't copied; only its global settings are.");

  const table = h("div", { class: "table-wrap" }, h("table", null,
    h("thead", null, h("tr", null, h("th", { text: "Setting" }), h("th", { text: "In the preset" }), h("th", { text: "In the mask" }), h("th", { text: "Result" }))),
    h("tbody", null, total ? conv.rows.map((r) => [
      h("tr", { class: `${r.status}${r.note ? " has-note" : ""}` },
        h("td", { class: "setting", text: r.label }),
        h("td", { class: "num", text: r.before }),
        h("td", { class: "num", text: r.after || "—" }),
        h("td", null, h("span", { class: `status ${r.status}`, text: STATUS_TEXT[r.status] }))),
      r.note ? h("tr", { class: `note-row ${r.status}` }, h("td", { colspan: "4", text: r.note })) : null,
    ]) : h("tr", null, h("td", { colspan: "4", class: "muted", text: "No adjustments found." })))));

  pane.replaceChildren(
    eyebrow,
    h("h2", { class: "title", text: preset.name }),
    summary,
    ...notices.map((n) => h("div", { class: "notice" }, icon("info", 16), h("span", { text: n }))),
    table,
    h("p", { class: "footnote", text: "Exact: same value in the mask. Approximate: the closest a mask can get (noted per row). Whole photo: kept on the whole image, as you chose. Not in mask: masks have no slider for it." }),
  );
}

/** A small drawing of the curves the mask will apply. */
function miniCurve(conv) {
  const curves = [["MainCurve", "var(--text)"], ["RedCurve", "#ef5b5b"], ["GreenCurve", "#3fbd6f"], ["BlueCurve", "#4d8dff"]].filter(([k]) => conv.curves[k]);
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
  add("rect", { width: 255, height: 255, fill: "var(--raised)" });
  for (const q of [63.75, 127.5, 191.25]) {
    add("line", { x1: q, y1: 0, x2: q, y2: 255, stroke: "var(--line)", "stroke-width": 2.5 });
    add("line", { x1: 0, y1: q, x2: 255, y2: q, stroke: "var(--line)", "stroke-width": 2.5 });
  }
  add("line", { x1: 0, y1: 255, x2: 255, y2: 0, stroke: "var(--line-strong)", "stroke-dasharray": "8 8", "stroke-width": 2.5 });
  for (const [key, color] of curves) {
    const pts = core.curveSamples(conv.curves[key], 96).map(([x, y]) => `${x},${255 - y}`).join(" ");
    add("polyline", { points: pts, fill: "none", stroke: color, "stroke-width": 7, "stroke-linejoin": "round", "stroke-linecap": "round" });
  }
  return h("figure", { class: "mini-curve", title: `${names} curve${curves.length > 1 ? "s" : ""}, as Lightroom will apply ${curves.length > 1 ? "them" : "it"} inside the mask` },
    svg, h("figcaption", { text: curves.length > 1 ? "Curves" : "Curve" }));
}

function welcome() {
  const native = platform.kind === "native";
  const looked = state.sources.filter((s) => s.kind !== "added" && s.kind !== "samples");
  return h("div", { class: "hero" },
    h("h2", { text: native ? "Let's find your presets" : "Turn any Lightroom preset into a masked preset" }),
    h("p", { text: native
      ? "No Lightroom presets turned up in the usual places on this Mac. Point the app at a folder of presets, drop in a preset pack, or try the samples."
      : "Pick a preset and where it should go (background, subject, sky, people, skin, water…). You get a new preset that applies the look inside an AI mask. Everything happens on your computer; nothing is uploaded." }),
    h("ol", { class: "steps" },
      h("li", null, h("div", null, h("b", { text: "Add presets" }), h("span", { text: "A folder, .xmp or .lrtemplate files, or a .zip preset pack. You can also drop them anywhere on this window." }))),
      h("li", null, h("div", null, h("b", { text: "Choose where the look goes" }), h("span", { text: "Background, subject, sky, people, skin, hair, mountains, water and more. Pick several at once." }))),
      h("li", null, h("div", null, h("b", { text: "Import into Lightroom" }), h("span", { text: "File › Import Profiles & Presets, then choose the .zip. The new presets show up in their own groups." })))),
    h("div", { class: "found" },
      h("button", { class: "button primary", onclick: addFolder }, icon("folder"), "Choose a folder…"),
      h("button", { class: "button", onclick: pickFiles }, icon("file"), "Choose files…"),
      h("button", { class: "button", onclick: () => loadSamples() }, icon("sparkle"), "Try sample presets")),
    native && looked.length ? h("p", { class: "footnote" }, "Looked in: ", looked.map((s) => s.label).join(", "), ". You can add more places in Settings.") : null,
  );
}

let createScroll = 0;
function renderCreate() {
  const pane = $("create");
  const { presets, usable, skipped, total } = plannedCount();

  const families = core.FAMILIES.map((fam) => {
    const items = core.TARGETS.filter((t) => t.family === fam.id);
    const picked = items.filter((t) => state.targets.has(t.id)).length;
    const open = state.openFamilies.has(fam.id);
    return h("div", { class: "family", "data-family": fam.id },
      h("button", { "aria-expanded": String(open), onclick: () => { open ? state.openFamilies.delete(fam.id) : state.openFamilies.add(fam.id); saveSettings(); renderCreate(); } },
        h("span", { class: "chev", "aria-expanded": String(open) }, icon("chevron", 13)), fam.label,
        picked ? h("span", { class: "picked", text: `${picked} picked` }) : null),
      open ? h("div", { class: "targets" }, items.map((t) => h("button", {
        class: "target", "aria-pressed": String(state.targets.has(t.id)), title: t.hint || t.label, "data-target": t.id,
        onclick: () => { state.targets.has(t.id) ? state.targets.delete(t.id) : state.targets.add(t.id); saveSettings(); renderDetail(); renderCreate(); },
      }, icon(t.id, 17), h("span", { class: "label", text: t.label })))) : null);
  });

  const leftovers = h("div", { class: "segmented", role: "group", "aria-label": "Settings masks can't hold" },
    ...[["drop", "Leave out"], ["global", "Whole photo"]].map(([value, label]) => h("button", {
      "aria-pressed": String(state.options.leftovers === value),
      onclick: () => setOption("leftovers", value),
    }, label)));

  const options = OPTION_TEXT.map(([key, label, hint]) => h("label", { class: "option" },
    h("input", { type: "checkbox", checked: Boolean(state.options[key]), onchange: (ev) => setOption(key, ev.target.checked) }),
    h("b", { text: label }), h("span", { text: hint })));

  const example = core.groupName({ group: state.byId.get(state.current)?.preset.group || "Moody" }, [...state.targets][0] || "background", state.groupTemplate);
  const template = h("input", {
    type: "text", value: state.groupTemplate, spellcheck: "false", "aria-label": "Lightroom group name",
    oninput: (ev) => {
      state.groupTemplate = ev.target.value || core.DEFAULT_GROUP_TEMPLATE;
      saveSettings();
      renderDetail();
      pane.querySelector(".example").textContent = `e.g. ${core.groupName({ group: state.byId.get(state.current)?.preset.group || "Moody" }, [...state.targets][0] || "background", state.groupTemplate)}`;
    },
  });

  const tally = h("div", { class: "tally" },
    presets === 0 ? "Pick a preset on the left."
      : state.targets.size === 0 ? "Pick at least one place for the look."
        : [h("b", { text: plural(usable, "preset") }), " × ", h("b", { text: plural(state.targets.size, "mask") }), " = ", h("b", { text: plural(total, "new preset") }),
          skipped ? h("div", { class: "muted", text: `${plural(skipped, "preset")} skipped: nothing in ${skipped === 1 ? "it" : "them"} can go into a mask` }) : null,
          state.checked.size ? null : h("div", { class: "muted", text: "Tick presets in the list to do many at once." })]);

  const where = platform.kind === "native"
    ? (state.outputFolder ? `Saves to ${state.outputFolder.replace(/^\/Users\/[^/]+/, "~")}` : "")
    : "Downloads a .zip to import into Lightroom";

  const more = h("details", { class: "more", open: Boolean(state.settings.moreOpen), ontoggle: (ev) => { state.settings.moreOpen = ev.target.open; saveSettings(); } },
    h("summary", null, h("span", { class: "chev" }, icon("chevron", 13)), "More options"),
    h("div", { class: "more-body" },
      h("section", null, h("h3", { text: "Approximations" }), ...options),
      h("section", { class: "field" }, h("h3", { text: "Lightroom group" }), template,
        h("small", { class: "example", text: `e.g. ${example}` }),
        h("small", { text: "{target} and {group} are filled in for you." }))));

  pane.replaceChildren(
    h("div", { class: "create-scroll" },
      h("section", null,
        h("div", { class: "head" }, h("h3", { text: "Put the look on" }), state.targets.size ? h("button", { class: "link", text: "Clear", onclick: () => { state.targets.clear(); saveSettings(); renderDetail(); renderCreate(); } }) : null),
        ...families),
      h("section", null, h("h3", { text: "Settings a mask can't hold" }), leftovers,
        h("small", { class: "muted", text: state.options.leftovers === "global"
          ? "Profile, HSL, vignette, grain and the like stay on the whole photo, as in the original preset."
          : "Profile, HSL, vignette, grain and the like are left out, so only the masked area changes." })),
      more),
    h("div", { class: "create-footer" },
      tally,
      h("button", { class: "button primary big", id: "createButton", disabled: total === 0, onclick: create }, icon("sparkle"), total ? `Create ${plural(total, "preset")}` : "Create presets"),
      where ? h("div", { class: "where", text: where, title: state.outputFolder }) : null),
  );
  const scroller = pane.querySelector(".create-scroll");
  scroller.scrollTop = createScroll;
  scroller.addEventListener("scroll", () => { createScroll = scroller.scrollTop; });
}

// ---------- actions ----------

function setCurrent(id) {
  state.current = id;
  state.anchor = id;
}

function renderAfterSelect() {
  for (const row of $("list").querySelectorAll(".item")) row.setAttribute("aria-current", String(row.dataset.id === state.current));
  renderDetail();
  renderCreate();
}

function toggleCheck(id, range, visible) {
  if (range && state.anchor && state.anchor !== id) {
    const ids = visible.map((e) => e.id);
    const [a, b] = [ids.indexOf(state.anchor), ids.indexOf(id)].sort((x, y) => x - y);
    if (a >= 0) {
      const on = !state.checked.has(id);
      for (const each of ids.slice(a, b + 1)) on ? state.checked.add(each) : state.checked.delete(each);
    }
  } else {
    state.checked.has(id) ? state.checked.delete(id) : state.checked.add(id);
  }
  state.anchor = id;
  render();
}

function toggleGroup(name) {
  state.collapsed.has(name) ? state.collapsed.delete(name) : state.collapsed.add(name);
  renderList();
}

function setOption(key, value) {
  state.options[key] = value;
  state.conversions.clear();
  saveSettings();
  render();
}

function setQuery(text) {
  state.query = text.trim();
  if ($("search").value !== text) $("search").value = text;
  const visible = visibleEntries();
  if (visible.length && !visible.some((e) => e.id === state.current)) setCurrent(firstShown(visible).id);
  render();
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
  try {
    const { jobs, skipped } = core.planBatch(entries, targets, { options: state.options, groupTemplate: state.groupTemplate });
    if (!jobs.length) return toast("Nothing to create: those presets have nothing a mask can hold", true);
    const files = core.renderBatch(jobs);
    const label = targets.length === 1 ? core.target(targets[0]).label : `${targets.length} masks`;
    const folderName = core.fileStem(`${timestamp()} ${label} presets (${files.length})`);
    const zip = core.writeZip(files.map((f) => ({ name: f.name, data: f.text })));
    const result = await platform.save({ folderName, zipName: `${folderName}.zip`, files, zipBase64: core.bytesToBase64(zip) });
    if (result?.error) return toast(result.error, true);
    showDone(result, files, skipped);
    return { ...result, count: files.length, skipped: skipped.length };
  } catch (err) {
    platform.log(err?.stack || err);
    toast(`Couldn't create the presets: ${err?.message || err}`, true);
  } finally {
    button.disabled = false;
  }
}

function timestamp(d = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

// ---------- dialogs ----------

function openDialog(content) {
  const dialog = $("dialog");
  dialog.replaceChildren(content);
  if (!dialog.open) dialog.showModal();
}

function closeDialog() {
  $("dialog").close();
}

function tabs(items, selected, onSelect) {
  return h("div", { class: "tabs", role: "tablist" }, items.map(([id, label, iconName]) => h("button", {
    role: "tab", "aria-selected": String(id === selected), onclick: () => onSelect(id),
  }, iconName ? icon(iconName, 15) : null, label)));
}

function showDone(result, files, skipped, tab = state.apps.cloud === false && state.apps.classic ? "classic" : "cloud") {
  const native = platform.kind === "native";
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
  const render = (current) => openDialog(h("div", { class: "sheet" },
    h("h2", null, h("span", { class: "ok" }, icon("check", 18)), `${plural(files.length, "preset")} ready`),
    native && result.folder ? h("div", { class: "path selectable", text: zip || result.folder }) : h("p", { class: "muted", text: `Downloaded ${zipName}.` }),
    skipped.length ? h("details", null, h("summary", { class: "muted", text: `${plural(skipped.length, "preset")} skipped` }),
      h("ul", null, skipped.map((s) => h("li", { class: "muted", text: `${s.name}: ${s.reason}` })))) : null,
    tabs([["cloud", "Lightroom", "lightroom"], ["classic", "Lightroom Classic", "lrc"], ["acr", "Camera Raw", "ps"]], current, (id) => render(id)),
    h("ol", null, steps[current].map((s) => h("li", { text: s }))),
    h("div", { class: "actions" },
      native && current !== "cloud" ? h("button", {
        class: "button", onclick: async (ev) => {
          ev.currentTarget.disabled = true;
          const r = await platform.installCameraRaw(files);
          toast(r?.error ? r.error : `Installed ${plural(r.count, "preset")}. Restart Lightroom Classic or Photoshop to see them.`, Boolean(r?.error));
        },
      }, icon("download", 16), "Install for Classic & Camera Raw") : null,
      native ? h("button", { class: "button", onclick: () => platform.reveal(zip || result.folder) }, icon("reveal", 16), "Show in Finder") : null,
      native ? h("button", { class: "button", onclick: () => { platform.copyText(zip); toast("Path copied"); } }, "Copy path") : null,
      native && current === "cloud" ? h("button", {
        class: "button", onclick: async () => { const r = await platform.openLightroom(); if (r?.error) toast(r.error, true); },
      }, icon("lightroom", 16), "Open Lightroom") : null,
      h("button", { class: "button primary", onclick: closeDialog, autofocus: true }, "Done"))));
  render(tab);
}

function showSettings(tab = "sources") {
  const native = platform.kind === "native";
  const body = {
    sources: () => h("div", { class: "settings-list" },
      state.sources.length ? state.sources.map((s) => {
        const usable = s.entries.filter((e) => !core.isConverted(e.preset)).length;
        const status = s.available === false ? "Not found on this Mac" : `${plural(usable, "preset")}${s.errors.length ? ` · ${s.errors.length} unreadable` : ""}`;
        return h("div", { class: "settings-row" },
          icon(SOURCE_ICONS[s.kind] || "folder"),
          h("div", { class: "grow" }, h("div", { text: s.label }), h("small", { class: "selectable", text: s.path ? `${s.path.replace(/^\/Users\/[^/]+/, "~")} · ${status}` : status, title: [s.path, ...s.errors.slice(0, 20)].filter(Boolean).join("\n") })),
          s.removable ? h("button", { class: "icon-button", title: "Remove", "aria-label": `Remove ${s.label}`, onclick: () => { removeSource(s.key); showSettings("sources"); } }, icon("close", 15)) : null,
          h("input", {
            type: "checkbox", checked: s.enabled, disabled: s.available === false, "aria-label": `Use ${s.label}`,
            onchange: (ev) => { s.enabled = ev.target.checked; rebuild(); saveSettings(); render(); showSettings("sources"); },
          }));
      }) : h("p", { class: "muted", text: "No sources yet." }),
      h("div", { class: "actions" },
        native ? h("button", { class: "button", onclick: async () => { closeDialog(); setLoading("Looking for your presets…"); await scan(); hideLoading(); render(); } }, icon("refresh", 16), "Look again") : null,
        h("button", { class: "button", onclick: async () => { closeDialog(); await addFolder(); } }, icon("folder", 16), "Add a folder…"))),
    output: () => h("div", { class: "settings-list" },
      native ? h("div", { class: "settings-row" }, icon("folder"),
        h("div", { class: "grow" }, h("div", { text: "Save new presets in" }), h("small", { class: "selectable", text: state.outputFolder })),
        h("button", { class: "button", onclick: () => platform.reveal(state.outputFolder) }, "Show"),
        h("button", { class: "button", onclick: async () => { const r = await platform.chooseOutputFolder(); if (r?.outputFolder) { state.outputFolder = r.outputFolder; render(); showSettings("output"); } } }, "Change…"))
        : h("p", { class: "muted", text: "In the browser, new presets download as a .zip." }),
      h("div", { class: "settings-row" }, icon("sparkle"),
        h("div", { class: "grow" }, h("div", { text: "Appearance" })),
        h("div", { class: "segmented", style: "grid-template-columns: repeat(3, auto)" },
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
  if (Array.isArray(s.openFamilies)) state.openFamilies = new Set(s.openFamilies);
  for (const id of state.targets) state.openFamilies.add(core.target(id).family);
}

let saveTimer;
function saveSettings() {
  state.settings = {
    ...state.settings,
    targets: [...state.targets],
    options: state.options,
    groupTemplate: state.groupTemplate,
    openFamilies: [...state.openFamilies],
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

// ---------- chrome: toolbar, drag & drop, keyboard ----------

function bindChrome() {
  $("addFolder").addEventListener("click", addFolder);
  $("addFiles").addEventListener("click", pickFiles);
  $("openSettings").addEventListener("click", () => showSettings());
  $("search").addEventListener("input", (ev) => setQuery(ev.target.value));
  $("search").addEventListener("keydown", (ev) => {
    if (ev.key === "Escape") setQuery("");
    if (ev.key === "ArrowDown") { ev.preventDefault(); $("list").focus(); }
  });
  $("dialog").addEventListener("click", (ev) => { if (ev.target === ev.currentTarget) closeDialog(); });

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

  $("list").addEventListener("keydown", (ev) => {
    const ids = [...$("list").querySelectorAll(".item")].map((r) => r.dataset.id);
    const at = ids.indexOf(state.current);
    if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
      ev.preventDefault();
      const next = ids[Math.max(0, Math.min(ids.length - 1, at + (ev.key === "ArrowDown" ? 1 : -1)))];
      if (next) { setCurrent(next); renderAfterSelect(); $("list").querySelector(`[data-id="${next}"]`)?.scrollIntoView({ block: "nearest" }); }
    } else if (ev.key === " " && state.current) {
      ev.preventDefault();
      toggleCheck(state.current, false, visibleEntries());
    } else if ((ev.metaKey || ev.ctrlKey) && ev.key.toLowerCase() === "a") {
      ev.preventDefault();
      command("selectAll");
    }
  });

  window.addEventListener("keydown", (ev) => {
    if (!(ev.metaKey || ev.ctrlKey) || $("dialog").open) return;
    const key = ev.key.toLowerCase();
    if (platform.kind === "native") return; // the Mac app's menu bar handles these
    if (key === "f") { ev.preventDefault(); command("find"); }
    else if (key === "enter") { ev.preventDefault(); command("create"); }
    else if (key === "o") { ev.preventDefault(); command(ev.shiftKey ? "addFolder" : "addFiles"); }
  });
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
    case "selectAll": for (const e of visibleEntries()) state.checked.add(e.id); render(); break;
    case "selectNone": state.checked.clear(); render(); break;
    default: platform.log(`Unknown command: ${name}`);
  }
}

// ---------- feedback ----------

let toastTimer;
function toast(message, error = false) {
  const el = $("toast");
  el.textContent = message;
  el.classList.toggle("error", error);
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
    if (entry) { setCurrent(entry.id); state.collapsed.delete(entry.preset.group || "Presets"); render(); }
    return Boolean(entry);
  },
  check(names) {
    state.checked = new Set(visibleEntries().filter((e) => names.includes(e.preset.name)).map((e) => e.id));
    render();
  },
  setTargets(ids) {
    state.targets = new Set(ids);
    for (const id of ids) state.openFamilies.add(core.target(id).family);
    render();
  },
  setOption,
  showSettings,
  create,
  get state() { return state; },
};

boot().catch((err) => {
  hideLoading();
  platform.log(err?.stack || err);
  $("detail").replaceChildren(h("div", { class: "hero" }, h("h2", { text: "Something went wrong" }), h("p", { class: "selectable", text: String(err?.message || err) })));
});
