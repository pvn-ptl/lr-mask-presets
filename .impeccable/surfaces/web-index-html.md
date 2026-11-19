---
version: 1
slug: "web-index-html"
primary_target: "web/index.html"
related_targets: ["web/app.css","web/app.js"]
---

# Surface: the app window (web/index.html, shown in the Mac app and in the browser)

Mode: Operate. Audience: photographers on a Mac with hundreds of Lightroom presets. Task: pick presets, pick where
the look goes (24 masks), see what carries over, create, import. Constraints: everything local, Lightroom files
read-only, macOS 13+, same page runs in WKWebView and in a browser, Reduce Motion / Reduce Transparency honored.
User's binding words: "make this look like apple built the app with all kinds of blur and glass effects also with
amazing animations"; layout free to change; the user steered to "library list plus photos grid".

## Direction contract

THESIS: An Apple-built Mac library for presets: one window that reads like Photos or Finder, browsed as a list or a
grid, refusing the boxed three-panel web dashboard the app used to be.

OWN-WORLD: macOS materials. Real behind-window vibrancy in a floating sidebar (inset 8px, radius 18px); Liquid
Glass toolbar controls, floating selection bar, popover, sheets and HUD toasts (blur + saturate, specular top edge,
soft offset shadow); system colours (blue accent, green / orange / purple / gray status, accessible variants in
light); SF Pro text, SF Pro Rounded numerals; every preset drawn as a tone swatch computed from its own settings.

STORY: The visitor sees their presets as looks, ticks several, chooses where the look goes, reads exactly what
carries over, creates them and is shown how to import.

FIRST VIEWPORT: Floating glass sidebar left (~232px: sources, groups). Toolbar over the content: title + subtitle,
List | Grid switch, Add menu, search, inspector toggle. Grouped grid of swatch tiles. Inspector right (~330px):
large swatch, name, rounded carry-over %, meter, curve, rows. Floating glass bar bottom-centre: count, mask chips,
Masks…, Create (the primary action).

FORM: user steer fusing my list positions 4 (sortable library list) and 2 (Photos grid with glass selection bar);
seed:cbe2f708accec029. Signature interaction: List ⇄ Grid morph (each preset's swatch flies between tile and row via
view transitions). Motion grammar: springs for arrival, faster exits, a sliding sidebar highlight, popovers that
grow from their button, numbers that count, curves that draw; reduced-motion keeps fades only.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
