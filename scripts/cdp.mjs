// Drive headless Chrome over the DevTools protocol (no dependencies; uses Node's built-in WebSocket).
// Used by the docs screenshot script and the browser tests.

import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CANDIDATES = [
  process.env.CHROME,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser",
].filter(Boolean);

export function findChrome() {
  return CANDIDATES.find((p) => existsSync(p)) || null;
}

export async function launch({ width = 1440, height = 900, scale = 2, dark = false } = {}) {
  const chrome = findChrome();
  if (!chrome) throw new Error("Chrome not found (set CHROME=/path/to/chrome)");
  const profile = mkdtempSync(join(tmpdir(), "lrmask-chrome-"));
  const proc = spawn(chrome, [
    "--headless=new", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "--no-first-run", "--no-default-browser-check",
    "--hide-scrollbars", "--disable-gpu", "--disable-extensions", "--force-color-profile=srgb", "--font-render-hinting=none",
    `--blink-settings=preferredColorScheme=${dark ? 0 : 1}`, "about:blank",
  ], { stdio: ["ignore", "ignore", "pipe"] });
  const wsUrl = await new Promise((resolve, reject) => {
    let buf = "";
    const timer = setTimeout(() => reject(new Error("Chrome didn't start")), 15000);
    proc.stderr.on("data", (d) => {
      buf += d;
      const m = buf.match(/DevTools listening on (ws:\/\/\S+)/);
      if (m) { clearTimeout(timer); resolve(m[1]); }
    });
    proc.on("exit", () => reject(new Error("Chrome exited")));
  });
  const browser = await connect(wsUrl);
  const { targetId } = await browser.send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await browser.send("Target.attachToTarget", { targetId, flatten: true });
  const page = browser.session(sessionId);
  await page.send("Page.enable");
  await page.send("Runtime.enable");
  await page.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: scale, mobile: false });
  await page.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: dark ? "dark" : "light" }] });
  page.errors = [];
  browser.on("Runtime.exceptionThrown", (p) => page.errors.push(p.exceptionDetails?.exception?.description || p.exceptionDetails?.text));
  browser.on("Runtime.consoleAPICalled", (p) => { if (p.type === "error") page.errors.push(p.args.map((a) => a.value ?? a.description).join(" ")); });
  page.close = async () => {
    const exited = proc.exitCode !== null ? Promise.resolve() : new Promise((resolve) => proc.once("exit", resolve));
    try { await browser.send("Browser.close"); } catch { /* already gone */ }
    await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 3000))]);
    proc.kill();
    rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  };
  return page;
}

async function connect(url) {
  const ws = new WebSocket(url);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  let id = 0;
  const pending = new Map(), listeners = new Map();
  ws.onmessage = (msg) => {
    const data = JSON.parse(msg.data);
    if (data.id && pending.has(data.id)) {
      const { resolve, reject } = pending.get(data.id);
      pending.delete(data.id);
      data.error ? reject(new Error(`${data.error.message} ${data.error.data || ""}`)) : resolve(data.result);
    } else if (data.method) {
      for (const fn of listeners.get(data.method) || []) fn(data.params, data.sessionId);
    }
  };
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const msgId = ++id;
    pending.set(msgId, { resolve, reject });
    ws.send(JSON.stringify({ id: msgId, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
  const on = (method, fn) => { if (!listeners.has(method)) listeners.set(method, []); listeners.get(method).push(fn); };
  return {
    send, on,
    session(sessionId) {
      const page = {
        send: (method, params) => send(method, params, sessionId),
        on,
        async goto(url) {
          const loaded = new Promise((resolve) => on("Page.loadEventFired", resolve));
          await page.send("Page.navigate", { url });
          await loaded;
        },
        async eval(expression) {
          const r = await page.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
          if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
          return r.result.value;
        },
        async waitFor(expression, timeout = 10000) {
          const end = Date.now() + timeout;
          while (Date.now() < end) {
            if (await page.eval(expression)) return;
            await new Promise((r) => setTimeout(r, 50));
          }
          throw new Error(`Timed out waiting for ${expression}`);
        },
        async screenshot(clip) {
          const r = await page.send("Page.captureScreenshot", { format: "png", ...(clip ? { clip: { ...clip, scale: 1 } } : {}), captureBeyondViewport: false });
          return Buffer.from(r.data, "base64");
        },
        async click(selector) {
          const box = await page.eval(`(() => { const r = document.querySelector(${JSON.stringify(selector)})?.getBoundingClientRect(); return r && { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
          if (!box) throw new Error(`No element ${selector}`);
          for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) {
            await page.send("Input.dispatchMouseEvent", { type, x: box.x, y: box.y, button: "left", clickCount: 1 });
          }
          return box;
        },
      };
      return page;
    },
  };
}
