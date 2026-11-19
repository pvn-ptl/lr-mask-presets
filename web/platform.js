// What the page needs from its host. In the Mac app, Swift answers over a WebKit message handler;
// in a browser, files come from pickers and drops, and results download as a .zip.

export function createPlatform() {
  const handler = globalThis.webkit?.messageHandlers?.native;
  return handler ? nativePlatform(handler) : webPlatform();
}

function nativePlatform(handler) {
  const call = (cmd, args = {}) => handler.postMessage({ cmd, ...args });
  return {
    kind: "native",
    scan: () => call("scan"),
    chooseFolders: () => call("chooseFolders"),
    chooseFiles: () => call("chooseFiles"),
    removeFolder: (path) => call("removeFolder", { path }),
    save: (batch) => call("save", batch),
    reveal: (path) => call("reveal", { path }),
    exists: (paths) => call("exists", { paths }),
    openLightroom: () => call("openLightroom"),
    installCameraRaw: (files) => call("installCameraRaw", { files }),
    chooseOutputFolder: () => call("chooseOutputFolder"),
    copyText: (text) => call("copyText", { text }),
    openURL: (url) => call("openURL", { url }),
    getSettings: () => call("getSettings"),
    setSettings: (settings) => call("setSettings", { settings }),
    ready: (info) => call("ready", info || {}),
    log: (message) => call("log", { message: String(message) }),
    // Rectangles (in page points) where a mouse-down drags the window, and the controls cut out of them.
    dragRegions: ({ regions, holes }) => call("dragRegions", { regions, holes }),
  };
}

const SETTINGS_KEY = "partly:settings";
const EARLIER_SETTINGS_KEY = "lr-mask-presets:settings"; // from 1.0.0, when the app was called LR Mask Presets

function webPlatform() {
  return {
    kind: "web",
    async scan() {
      return { sources: [], settings: await this.getSettings(), outputFolder: "" };
    },
    async chooseFolders() {
      const files = await pick({ directory: true });
      if (!files.length) return null;
      const root = files[0].path.split("/")[0] || "Folder";
      return { sources: [{ key: `folder:${root}`, label: root, kind: "custom", path: root, enabled: true, available: true, files }] };
    },
    async chooseFiles() {
      const files = await pick({ accept: ".xmp,.zip,.lrtemplate", multiple: true });
      return files.length ? { files } : null;
    },
    async save(batch) {
      const blob = new Blob([fromBase64(batch.zipBase64)], { type: "application/zip" });
      const url = URL.createObjectURL(blob);
      const a = Object.assign(document.createElement("a"), { href: url, download: batch.zipName });
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      return { zip: batch.zipName, downloaded: true };
    },
    async copyText(text) {
      try { await navigator.clipboard.writeText(text); } catch { /* clipboard may be blocked; not important */ }
    },
    async openURL(url) {
      window.open(url, "_blank", "noopener");
    },
    async getSettings() {
      try { return JSON.parse(localStorage.getItem(SETTINGS_KEY) || localStorage.getItem(EARLIER_SETTINGS_KEY) || "{}"); } catch { return {}; }
    },
    async setSettings(settings) {
      try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch { /* private mode */ }
    },
    async ready() {},
    log(message) { console.log(message); },
  };
}

/** Files from an <input type=file>: [{ path, bytes }]. Folders keep their relative paths. */
function pick({ directory = false, accept = "", multiple = true }) {
  return new Promise((resolve) => {
    const input = Object.assign(document.createElement("input"), { type: "file", multiple, accept });
    if (directory) input.webkitdirectory = true;
    input.style.display = "none";
    input.addEventListener("change", async () => {
      const list = [...input.files].filter((f) => /\.(xmp|lrtemplate|zip)$/i.test(f.name));
      const files = await Promise.all(list.map(async (f) => ({ path: f.webkitRelativePath || f.name, bytes: new Uint8Array(await f.arrayBuffer()) })));
      input.remove();
      resolve(files);
    });
    input.addEventListener("cancel", () => { input.remove(); resolve([]); });
    document.body.append(input);
    input.click();
  });
}

/** Files dropped on the page, including whole folders where the browser allows it. */
export async function droppedFiles(dataTransfer) {
  const out = [];
  const entries = [...(dataTransfer.items || [])].map((item) => item.webkitGetAsEntry?.()).filter(Boolean);
  if (!entries.length) {
    for (const f of dataTransfer.files || []) out.push({ path: f.name, bytes: new Uint8Array(await f.arrayBuffer()) });
    return out;
  }
  const walk = async (entry, prefix) => {
    if (out.length > 20000) return;
    if (entry.isFile) {
      if (!/\.(xmp|lrtemplate|zip)$/i.test(entry.name)) return;
      const file = await new Promise((res, rej) => entry.file(res, rej));
      out.push({ path: prefix + entry.name, bytes: new Uint8Array(await file.arrayBuffer()) });
    } else if (entry.isDirectory) {
      const reader = entry.createReader();
      for (;;) {
        const batch = await new Promise((res, rej) => reader.readEntries(res, rej));
        if (!batch.length) break;
        for (const child of batch) await walk(child, `${prefix}${entry.name}/`);
      }
    }
  };
  for (const entry of entries) await walk(entry, "");
  return out;
}

function fromBase64(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
