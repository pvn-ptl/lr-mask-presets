// Render web/favicon.svg into macos/AppIcon.icns (needs Chrome, sips and iconutil).
// Run: node scripts/make-icon.mjs

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { launch } from "./cdp.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const svg = readFileSync(join(root, "web/favicon.svg"), "utf8");
const work = mkdtempSync(join(tmpdir(), "partly-icon-"));
const page = await launch({ width: 1024, height: 1024, scale: 1 });
try {
  await page.send("Emulation.setDefaultBackgroundColorOverride", { color: { r: 0, g: 0, b: 0, a: 0 } });
  await page.goto(`data:text/html;base64,${Buffer.from(`<style>html,body{margin:0;background:transparent}svg{display:block;width:1024px;height:1024px}</style>${svg}`).toString("base64")}`);
  const master = join(work, "icon-1024.png");
  writeFileSync(master, await page.screenshot());

  const set = join(work, "AppIcon.iconset");
  execFileSync("mkdir", ["-p", set]);
  for (const size of [16, 32, 128, 256, 512]) {
    for (const scale of [1, 2]) {
      const px = size * scale;
      const name = `icon_${size}x${size}${scale === 2 ? "@2x" : ""}.png`;
      execFileSync("sips", ["-z", String(px), String(px), master, "--out", join(set, name)], { stdio: "ignore" });
    }
  }
  execFileSync("iconutil", ["-c", "icns", set, "-o", join(root, "macos/AppIcon.icns")]);
  execFileSync("cp", [master, join(root, "docs/icon.png")]);
  console.log("Wrote macos/AppIcon.icns and docs/icon.png");
} finally {
  await page.close();
  rmSync(work, { recursive: true, force: true });
}
