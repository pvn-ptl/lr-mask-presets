// Legacy Lightroom presets (.lrtemplate) are a Lua table: s = { title = "...", value = { settings = {...} } }.
// This reads just enough Lua (tables, strings, numbers, booleans, ZSTR "...") to get the settings out.

import { PresetError, emptyPreset, points } from "./preset.js";

export function parseLrtemplate(text, { fallbackName = "", fallbackGroup = "" } = {}) {
  let table;
  try {
    table = new LuaReader(text).document();
  } catch (err) {
    throw new PresetError(`Not a readable .lrtemplate (${err.message})`);
  }
  if (!table || typeof table !== "object") throw new PresetError("Not a Lightroom template");
  if (table.type && table.type !== "Develop") throw new PresetError(`This is a ${table.type} template, not a develop preset`);
  const settings = table.value?.settings;
  if (!settings || typeof settings !== "object") throw new PresetError("No develop settings in this template");

  const preset = emptyPreset(cleanTitle(table.title) || cleanTitle(table.internalName) || fallbackName);
  preset.format = "lrtemplate";
  preset.group = fallbackGroup;
  preset.uuid = String(table.value.uuid || table.id || "").replace(/-/g, "").toUpperCase();
  preset.presetType = "Normal";
  for (const [key, value] of Object.entries(settings)) {
    if (Array.isArray(value)) {
      if (/^ToneCurvePV2012(Red|Green|Blue)?$/.test(key)) {
        const pairs = [];
        for (let i = 0; i + 1 < value.length; i += 2) pairs.push(`${value[i]},${value[i + 1]}`);
        preset.curves[key] = points(pairs);
      } else {
        preset.structured[key] = { items: value.map(String), node: null };
      }
    } else if (value && typeof value === "object") {
      preset.structured[key] = { items: [], node: null };
    } else if (typeof value === "boolean") {
      preset.settings[key] = value ? "True" : "False";
    } else if (value !== null && value !== undefined) {
      preset.settings[key] = String(value);
    }
  }
  return preset;
}

// "$$$/AgDevelop/Presets/Name=Shown Name" is Lightroom's localization form; keep the shown part.
function cleanTitle(value) {
  if (typeof value !== "string") return "";
  return value.startsWith("$$$/") && value.includes("=") ? value.slice(value.indexOf("=") + 1) : value;
}

class LuaReader {
  constructor(text) {
    this.text = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
    this.i = 0;
  }

  document() {
    this.space();
    const name = this.identifier();
    if (name !== "s") throw new Error("expected 's = {'");
    this.space();
    this.expect("=");
    const value = this.value();
    this.space();
    if (this.i < this.text.length) throw new Error(`unexpected text at ${this.i}`);
    return value;
  }

  space() {
    const t = this.text;
    for (;;) {
      while (this.i < t.length && /\s/.test(t[this.i])) this.i++;
      if (t.startsWith("--", this.i)) {
        const long = /^--\[(=*)\[/.exec(t.slice(this.i, this.i + 20));
        const end = long ? t.indexOf(`]${long[1]}]`, this.i) : t.indexOf("\n", this.i);
        this.i = end === -1 ? t.length : end + (long ? long[1].length + 2 : 1);
      } else return;
    }
  }

  expect(ch) {
    if (this.text[this.i] !== ch) throw new Error(`expected '${ch}' at ${this.i}`);
    this.i++;
  }

  identifier() {
    const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(this.text.slice(this.i, this.i + 200));
    if (!m) return null;
    this.i += m[0].length;
    return m[0];
  }

  value(depth = 0) {
    if (depth > 64) throw new Error("tables nested too deep");
    this.space();
    const t = this.text, c = t[this.i];
    if (c === "{") return this.table(depth);
    if (c === '"' || c === "'") return this.string();
    if (c === "[" && /^\[=*\[/.test(t.slice(this.i, this.i + 20))) return this.longString();
    if (c === "-" || c === "." || /[0-9]/.test(c)) return this.number();
    const word = this.identifier();
    if (word === "true") return true;
    if (word === "false") return false;
    if (word === "nil") return null;
    if (word) {
      // Function call sugar used by Lightroom: ZSTR "text", LOC "text", ZSTR("text").
      this.space();
      const paren = t[this.i] === "(";
      if (paren) { this.i++; this.space(); }
      const arg = this.value(depth + 1);
      if (paren) { this.space(); this.expect(")"); }
      return arg;
    }
    throw new Error(`unexpected '${c ?? "end of file"}' at ${this.i}`);
  }

  table(depth) {
    this.expect("{");
    const named = {};
    const list = [];
    for (;;) {
      this.space();
      if (this.text[this.i] === "}") { this.i++; break; }
      let key = null;
      const save = this.i;
      if (this.text[this.i] === "[" && !/^\[=*\[/.test(this.text.slice(this.i, this.i + 20))) {
        this.i++;
        key = this.value(depth + 1);
        this.space();
        this.expect("]");
        this.space();
        this.expect("=");
      } else {
        const id = this.identifier();
        this.space();
        if (id && this.text[this.i] === "=" && this.text[this.i + 1] !== "=") { key = id; this.i++; }
        else this.i = save;
      }
      const value = this.value(depth + 1);
      if (key === null) list.push(value);
      else named[key] = value;
      this.space();
      if (this.text[this.i] === "," || this.text[this.i] === ";") this.i++;
      else if (this.text[this.i] !== "}") throw new Error(`expected ',' or '}' at ${this.i}`);
    }
    return Object.keys(named).length || !list.length ? Object.assign(list.length ? { ...list } : {}, named) : list;
  }

  string() {
    const t = this.text, quote = t[this.i++];
    let out = "";
    while (this.i < t.length && t[this.i] !== quote) {
      const ch = t[this.i++];
      if (ch !== "\\") { out += ch; continue; }
      const e = t[this.i++];
      const map = { n: "\n", t: "\t", r: "\r", '"': '"', "'": "'", "\\": "\\", "\n": "\n" };
      if (e in map) out += map[e];
      else if (/[0-9]/.test(e)) {
        const m = /^[0-9]{1,3}/.exec(t.slice(this.i - 1, this.i + 2));
        out += String.fromCharCode(Number(m[0]));
        this.i += m[0].length - 1;
      } else out += e;
    }
    this.expect(quote);
    return out;
  }

  longString() {
    const m = /^\[(=*)\[/.exec(this.text.slice(this.i, this.i + 20));
    const close = `]${m[1]}]`;
    const start = this.i + m[0].length;
    const end = this.text.indexOf(close, start);
    if (end === -1) throw new Error("unclosed long string");
    this.i = end + close.length;
    return this.text.slice(start, end).replace(/^\r?\n/, "");
  }

  number() {
    const m = /^-?\s*(0[xX][0-9a-fA-F]+|(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?)/.exec(this.text.slice(this.i, this.i + 64));
    if (!m) throw new Error(`bad number at ${this.i}`);
    this.i += m[0].length;
    const value = Number(m[0].replace(/\s+/g, ""));
    if (!Number.isFinite(value)) throw new Error(`bad number at ${this.i}`);
    return value;
  }
}
