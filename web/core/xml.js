// A small, strict XML parser for XMP presets: elements, attributes, text and namespaces.
// DTDs are refused outright, so entity-expansion tricks can't get in.

export const XML_NS = "http://www.w3.org/XML/1998/namespace";
const MAX_DEPTH = 256;

export class XmlError extends Error {}

const ENTITIES = { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" };
const NAME = /[^\s/>=<]+/y;
const ATTRIBUTE = /([^\s/>=<]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/y;

function decode(text, at) {
  if (!text.includes("&")) return text;
  return text.replace(/&([^;\s&]{1,10});?/g, (match, name) => {
    if (!match.endsWith(";")) throw new XmlError(`Bare '&' near offset ${at}`);
    if (name[0] === "#") {
      const code = name[1] === "x" || name[1] === "X" ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
      if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) throw new XmlError(`Bad character reference &${name};`);
      return String.fromCodePoint(code);
    }
    if (!(name in ENTITIES)) throw new XmlError(`Unknown entity &${name};`);
    return ENTITIES[name];
  });
}

/** Parse `text` into a tree of { uri, local, prefix, attrs: [{uri, local, prefix, value}], children, text }. */
export function parseXml(text) {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  let i = 0;
  const n = text.length;
  const stack = [];
  let root = null;
  const scopes = [{ xml: XML_NS }];

  const fail = (msg) => { throw new XmlError(`${msg} (offset ${i})`); };

  while (i < n) {
    const lt = text.indexOf("<", i);
    if (lt === -1) {
      if (text.slice(i).trim() && !stack.length) fail("Text outside the root element");
      if (stack.length) stack[stack.length - 1].text += decode(text.slice(i), i);
      break;
    }
    if (lt > i) {
      const chunk = text.slice(i, lt);
      if (stack.length) stack[stack.length - 1].text += decode(chunk, i);
      else if (chunk.trim()) fail("Text outside the root element");
    }
    i = lt;
    if (text.startsWith("<!--", i)) {
      const end = text.indexOf("-->", i + 4);
      if (end === -1) fail("Unclosed comment");
      i = end + 3;
    } else if (text.startsWith("<![CDATA[", i)) {
      const end = text.indexOf("]]>", i + 9);
      if (end === -1) fail("Unclosed CDATA");
      if (!stack.length) fail("CDATA outside the root element");
      stack[stack.length - 1].text += text.slice(i + 9, end);
      i = end + 3;
    } else if (text.startsWith("<!", i)) {
      fail("DTDs and declarations are not allowed in presets");
    } else if (text.startsWith("<?", i)) {
      const end = text.indexOf("?>", i + 2);
      if (end === -1) fail("Unclosed processing instruction");
      i = end + 2;
    } else if (text.startsWith("</", i)) {
      const end = text.indexOf(">", i);
      if (end === -1) fail("Unclosed end tag");
      const name = text.slice(i + 2, end).trim();
      const open = stack.pop();
      if (!open || open.qname !== name) fail(`Mismatched </${name}>`);
      scopes.pop();
      i = end + 1;
    } else {
      i = parseStartTag(lt);
    }
  }
  if (stack.length) throw new XmlError(`Unclosed <${stack[stack.length - 1].qname}>`);
  if (!root) throw new XmlError("No root element");
  return root;

  function parseStartTag(start) {
    let j = start + 1;
    NAME.lastIndex = j;
    const nameMatch = NAME.exec(text);
    if (!nameMatch) { i = j; fail("Bad tag name"); }
    const qname = nameMatch[0];
    j += qname.length;
    const raw = [];
    for (;;) {
      while (j < n && /\s/.test(text[j])) j++;
      if (j >= n) { i = j; fail(`Unclosed <${qname}>`); }
      if (text[j] === ">" || text.startsWith("/>", j)) break;
      ATTRIBUTE.lastIndex = j;
      const found = ATTRIBUTE.exec(text);
      if (!found) { i = j; fail(`Bad attribute in <${qname}>`); }
      raw.push([found[1], decode(found[2] ?? found[3], j)]);
      j += found[0].length;
    }
    const selfClosing = text[j] === "/";
    const end = j + (selfClosing ? 2 : 1);

    const scope = Object.create(scopes[scopes.length - 1]);
    for (const [name, value] of raw) {
      if (name === "xmlns") scope[""] = value;
      else if (name.startsWith("xmlns:")) scope[name.slice(6)] = value;
    }
    const resolve = (name, isAttr) => {
      const colon = name.indexOf(":");
      const prefix = colon === -1 ? "" : name.slice(0, colon);
      const local = colon === -1 ? name : name.slice(colon + 1);
      if (isAttr && !prefix) return { uri: "", local, prefix };
      const uri = scope[prefix];
      if (uri === undefined && prefix) { i = start; fail(`Undeclared namespace prefix '${prefix}'`); }
      return { uri: uri || "", local, prefix };
    };
    const el = { ...resolve(qname, false), qname, attrs: [], children: [], text: "" };
    const seen = new Set();
    for (const [name, value] of raw) {
      if (seen.has(name)) { i = start; fail(`Duplicate attribute ${name} in <${qname}>`); }
      seen.add(name);
      if (name === "xmlns" || name.startsWith("xmlns:")) continue;
      const attr = { ...resolve(name, true), value };
      const key = `${attr.uri}\u0000${attr.local}`;
      if (seen.has(key)) { i = start; fail(`Duplicate attribute ${name} in <${qname}>`); }
      seen.add(key);
      el.attrs.push(attr);
    }
    if (stack.length) stack[stack.length - 1].children.push(el);
    else if (root) { i = start; fail("More than one root element"); }
    else root = el;
    if (!selfClosing) {
      if (stack.length >= MAX_DEPTH) { i = start; fail("Nesting too deep"); }
      stack.push(el);
      scopes.push(scope);
    }
    return end;
  }
}

export function attr(el, uri, local) {
  const found = el.attrs.find((a) => a.uri === uri && a.local === local);
  return found ? found.value : undefined;
}

export function child(el, uri, local) {
  return el.children.find((c) => c.uri === uri && c.local === local);
}

export function children(el, uri, local) {
  return el.children.filter((c) => c.uri === uri && c.local === local);
}
