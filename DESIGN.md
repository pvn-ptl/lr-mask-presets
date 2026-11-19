---
name: LR Mask Presets
description: A Mac library window of frosted panels over a living dusk-sky canvas, that turns Lightroom presets into masked presets.
colors:
  accent: "#0a84ff"
  accent-light: "#007aff"
  accent-text: "#409cff"
  accent-text-light: "#0066cc"
  accent-fill: "#0071e3"
  accent-fill-hover: "#0064d2"
  status-exact: "#30d158"
  status-exact-light: "#34c759"
  status-exact-ink-light: "#1f7a35"
  status-approx: "#ff9f0a"
  status-approx-light: "#ff9500"
  status-approx-ink-light: "#b33b00"
  status-global: "#c98bff"
  status-global-ink: "#d29cff"
  status-global-light: "#af52de"
  status-global-ink-light: "#8944ab"
  status-lost: "#98989d"
  status-lost-ink: "#a1a1a6"
  status-lost-light: "#aeaeb2"
  danger: "#ff6961"
  danger-fill: "#c4302b"
  danger-light: "#d70015"
  content: "#1c1c1e"
  elevated: "#252528"
  raised: "#2c2c30"
  tile: "#262629"
  sidebar-fill: "#232326"
  content-light: "#ffffff"
  elevated-light: "#f5f5f7"
  raised-light: "#ececf0"
  tile-light: "#f2f2f4"
  sidebar-fill-light: "#ebebef"
  label: "rgba(255, 255, 255, .9)"
  label-2: "rgba(235, 235, 245, .62)"
  label-3: "rgba(235, 235, 245, .58)"
  label-light: "rgba(0, 0, 0, .86)"
  label-2-light: "#5b5b62"
  label-3-light: "#6e6e73"
  separator: "rgba(255, 255, 255, .09)"
  separator-strong: "rgba(255, 255, 255, .16)"
  separator-light: "rgba(0, 0, 0, .08)"
  separator-strong-light: "rgba(0, 0, 0, .14)"
  fill: "rgba(255, 255, 255, .06)"
  fill-2: "rgba(255, 255, 255, .1)"
  fill-3: "rgba(255, 255, 255, .15)"
  fill-light: "rgba(0, 0, 0, .04)"
  fill-2-light: "rgba(0, 0, 0, .07)"
  fill-3-light: "rgba(0, 0, 0, .11)"
  glass: "rgba(44, 44, 50, .58)"
  glass-strong: "rgba(36, 36, 40, .82)"
  glass-edge: "rgba(255, 255, 255, .14)"
  glass-hi: "rgba(255, 255, 255, .2)"
  glass-light: "rgba(255, 255, 255, .62)"
  glass-strong-light: "rgba(250, 250, 252, .86)"
  glass-edge-light: "rgba(0, 0, 0, .09)"
  glass-hi-light: "rgba(255, 255, 255, .95)"
  on-accent: "#ffffff"
  canvas: "#111216"
  canvas-light: "#f1f2f7"
  aurora-1: "rgba(64, 102, 232, .34)"
  aurora-2: "rgba(150, 70, 196, .30)"
  aurora-3: "rgba(222, 112, 58, .22)"
  aurora-1-light: "rgba(104, 156, 255, .34)"
  aurora-2-light: "rgba(212, 146, 240, .30)"
  aurora-3-light: "rgba(255, 172, 116, .30)"
  glow: "rgba(118, 160, 255, .10)"
  glow-light: "rgba(255, 255, 255, .62)"
  panel: "rgba(28, 29, 34, .56)"
  panel-light: "rgba(255, 255, 255, .5)"
typography:
  display-numeral:
    fontFamily: "ui-rounded, SF Pro Rounded, -apple-system, BlinkMacSystemFont, system-ui, sans-serif"
    fontSize: "46px"
    fontWeight: 700
    lineHeight: 1
    letterSpacing: "-0.03em"
    fontFeature: "tnum"
  headline:
    fontFamily: "-apple-system, BlinkMacSystemFont, SF Pro Text, Helvetica Neue, system-ui, sans-serif"
    fontSize: "24px"
    fontWeight: 700
    letterSpacing: "-0.022em"
  title-large:
    fontFamily: "-apple-system, BlinkMacSystemFont, SF Pro Text, Helvetica Neue, system-ui, sans-serif"
    fontSize: "20px"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "-0.02em"
  title:
    fontFamily: "-apple-system, BlinkMacSystemFont, SF Pro Text, Helvetica Neue, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "-0.012em"
  body:
    fontFamily: "-apple-system, BlinkMacSystemFont, SF Pro Text, Helvetica Neue, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.4
    letterSpacing: "-0.003em"
  caption:
    fontFamily: "-apple-system, BlinkMacSystemFont, SF Pro Text, Helvetica Neue, system-ui, sans-serif"
    fontSize: "11.5px"
    fontWeight: 400
    fontFeature: "tnum"
  label:
    fontFamily: "-apple-system, BlinkMacSystemFont, SF Pro Text, Helvetica Neue, system-ui, sans-serif"
    fontSize: "11px"
    fontWeight: 650
  mono:
    fontFamily: "ui-monospace, SF Mono, SFMono-Regular, Menlo, monospace"
    fontSize: "11.5px"
rounded:
  tag: "5px"
  swatch-row: "6px"
  field: "8px"
  row: "9px"
  segmented: "10px"
  target: "11px"
  card: "12px"
  tile: "14px"
  menu: "14px"
  panel: "18px"
  sheet: "20px"
  drop-target: "24px"
  pill: "99px"
spacing:
  gap: "8px"
  band: "52px"
  sidebar-w: "248px"
  sidebar-w-compact: "224px"
  inspector-w: "344px"
  inspector-w-compact: "312px"
  tile-gap: "14px"
  tile-min: "156px"
  browser-inline: "22px"
  inspector-inline: "16px"
components:
  button:
    backgroundColor: "{colors.fill-2}"
    textColor: "{colors.label}"
    rounded: "{rounded.pill}"
    height: "30px"
    padding: "0 13px"
  button-hover:
    backgroundColor: "{colors.fill-3}"
  button-primary:
    backgroundColor: "{colors.accent-fill}"
    textColor: "{colors.on-accent}"
    rounded: "{rounded.pill}"
    height: "30px"
    padding: "0 13px"
  button-primary-hover:
    backgroundColor: "{colors.accent-fill-hover}"
  button-create:
    backgroundColor: "{colors.accent-fill}"
    textColor: "{colors.on-accent}"
    rounded: "{rounded.pill}"
    height: "40px"
    padding: "0 20px"
  toolbar-tool:
    backgroundColor: "{colors.glass}"
    textColor: "{colors.label}"
    rounded: "{rounded.pill}"
    size: "34px"
  toolbar-capsule:
    backgroundColor: "{colors.glass}"
    rounded: "{rounded.pill}"
    height: "34px"
    padding: "2px"
  search-field:
    backgroundColor: "{colors.glass}"
    textColor: "{colors.label}"
    rounded: "{rounded.pill}"
    height: "34px"
    width: "200px"
  sidebar-row:
    textColor: "{colors.label}"
    rounded: "{rounded.row}"
    height: "30px"
    padding: "0 8px"
  sidebar-row-current:
    backgroundColor: "{colors.fill-3}"
  preset-tile:
    backgroundColor: "{colors.tile}"
    rounded: "{rounded.tile}"
  list-row:
    textColor: "{colors.label}"
    rounded: "{rounded.row}"
    height: "40px"
    padding: "0 8px"
  list-row-selected:
    backgroundColor: "{colors.accent-fill}"
    textColor: "{colors.on-accent}"
  mask-chip:
    textColor: "{colors.label}"
    rounded: "{rounded.pill}"
    height: "30px"
    padding: "0 5px 0 10px"
  mask-target:
    backgroundColor: "{colors.fill}"
    textColor: "{colors.label}"
    rounded: "{rounded.target}"
    height: "38px"
    padding: "4px 8px 4px 10px"
  status-pill:
    rounded: "{rounded.swatch-row}"
    padding: "2px 7px"
    typography: "{typography.label}"
  inspector:
    backgroundColor: "{colors.panel}"
    rounded: "{rounded.panel}"
    width: "{spacing.inspector-w}"
  selection-bar:
    backgroundColor: "{colors.glass}"
    rounded: "{rounded.pill}"
    height: "58px"
  popover:
    backgroundColor: "{colors.glass-strong}"
    rounded: "{rounded.panel}"
    padding: "6px"
  sheet:
    backgroundColor: "{colors.glass-strong}"
    rounded: "{rounded.sheet}"
    width: "min(560px, 100vw - 48px)"
  segmented:
    backgroundColor: "{colors.fill-2}"
    rounded: "{rounded.segmented}"
    padding: "2px"
  text-field:
    backgroundColor: "{colors.content}"
    rounded: "{rounded.field}"
    height: "30px"
    padding: "0 10px"
---

# Design System: LR Mask Presets

## Overview

**Creative North Star: "The Window Apple Would Have Shipped"**

LR Mask Presets is one Mac window that reads like Photos or Finder: a floating sidebar of sources and groups, a library browsed as a grid of swatch tiles or a sortable list, an inspector on the right, and a floating glass bar at the bottom that holds the one primary action, Create. It is built from macOS's own materials rather than a web dashboard's boxes: frosted panels over a living canvas (a dusk sky of soft colour fields that leans toward the pointer), Liquid Glass capsules (blur, saturation, a specular top edge, a soft drop shadow) for everything that floats over content, system colours for meaning, SF Pro for text and SF Pro Rounded for the numbers that matter.

Density is a desktop app's density, not a web page's: 13px body text, 30px controls, 8px insets, a 52px title band shared with the traffic lights. Colour is almost entirely neutral. The system blue marks selection and the primary action; green, orange, purple and gray say how a setting carries over and nothing else. The only rich colour on screen is the presets themselves, each drawn as a computed swatch: a synthetic landscape pushed through that preset's own settings.

Motion is part of the material. Things arrive on springs (about 5% overshoot), leave faster on a plain ease-in, and travel only where travel explains something: the List and Grid morph, the sidebar highlight sliding to the current row, popovers growing from their button, the carry-over meter reflowing between presets, the score counting to its value.

**Key Characteristics:**
- Dark by default, light following the system or Settings; every colour token has both variants.
- One gradient, the canvas, under everything; the sidebar and inspector frost it, and glass floats over that: toolbar capsules, selection bar, popovers, sheets, toasts, the sticky list header.
- A sun/moon switch in the toolbar flips Light and Dark; the new look spreads out in a circle from it.
- One primary action per screen, in system blue, inside the floating bar.
- Every preset is shown as its own computed swatch; every figure is computed from the preset.
- Springs in, quick out; Reduce Motion keeps fades and stops all travel.
- The same page runs in the native WKWebView window and in a plain browser.

## Colors

A neutral macOS palette in two appearances, with the system blue as the only accent and four system hues reserved for carry-over status.

### Primary
- **System Blue** (`accent`, `accent-light`): selection rings on tiles, checkmarks, the caret, the focus ring (`accent` at 55% / 50%), active toolbar tools, picked mask targets.
- **Action Blue** (`accent-fill`, hover `accent-fill-hover`): filled primary buttons (Create, Done), the current list row, highlighted menu items. White text on it, always.
- **Link Blue** (`accent-text`, `accent-text-light`): text-weight blue for links, chip icons, step numbers; brighter in dark, deeper in light so it passes contrast as text.

### Secondary: carry-over status
Each status has a fill hue (meter segments, legend dots, tinted pill backgrounds at 14-15%) and an ink variant for text on those pills. In light appearance the ink is darkened for AA contrast.
- **Exact Green** (`status-exact` / `status-exact-light`, ink `status-exact-ink-light`): settings that carry over exactly. Also the success tick in the done sheet and the toast icon.
- **Approximate Orange** (`status-approx` / `status-approx-light`, ink `status-approx-ink-light`): approximated settings and the warning notice.
- **Whole-photo Purple** (`status-global` / `status-global-light`, inks `status-global-ink` / `status-global-ink-light`): settings applied to the whole photo instead of the mask.
- **Not-in-mask Gray** (`status-lost` / `status-lost-light`, ink `status-lost-ink`): settings left out.

### Tertiary
- **Danger Red** (`danger`, `danger-fill`, `danger-light`): error toasts only.

### The canvas
- **Canvas** (`canvas` / `canvas-light`): the window's base colour, under everything.
- **Aurora** (`aurora-1`, `aurora-2`, `aurora-3` and light variants): three soft radial fields placed over the library pane, where the canvas shows: blue overhead, violet to the right (it tints the inspector), an ember rising from the bottom. Centres follow the window's width (`vw`) and sizes its longer side (`vmax`), so the same sky fills a laptop and a 5K display.
- **Glow** (`glow` / `glow-light`): a soft light that follows the pointer across the canvas.

### Neutral
- **Window** (`content` / `content-light`): text-field wells; at 55% it is the inspector's row card.
- **Panel** (`panel` / `panel-light`): the frosted sidebar, inspector and welcome cards (blur 26px + saturate 185% of the canvas behind).
- **Elevated** (`elevated` / `elevated-light`): the opaque fallback for glass and panels under Reduce Transparency.
- **Raised, Tile, Sidebar** (`raised`, `tile`, `sidebar-fill` and light variants): tile backgrounds behind swatches and the browser-mode sidebar.
- **Labels** (`label`, `label-2`, `label-3` and light variants): primary text, secondary text and counts, section headings and placeholders. Increase Contrast collapses `label-2` into `label`.
- **Separators and fills** (`separator`, `separator-strong`, `fill`, `fill-2`, `fill-3`): hairlines, zebra rows, hover and pressed backgrounds, tracks for meters and switches. Translucent, so they read on glass and on solid panels alike.
- **Glass** (`glass`, `glass-strong`, `glass-edge`, `glass-hi` and light variants): the Liquid Glass recipe (see Elevation & Depth).

### Named Rules
**The System Colour Rule.** Every hue on a control is an Apple system colour with its accessible light-appearance variant. No brand colour on controls, no gradient fills on them; the gradients live on the canvas (and the welcome screen's drop halo), behind everything.

**The Quiet Sky Rule.** The canvas stays dim enough that `label-2` keeps 4.5:1 on its brightest point, in both appearances. It moves only when the pointer does (`translate`, `scale`, `opacity`, nothing that repaints), settles within about two seconds, and holds still under Reduce Motion.

**The Status Means Status Rule.** Green, orange, purple and gray belong to carry-over status. They never decorate, never mark selection, and always appear with a text label (pill, legend) beside the colour.

**The Swatches Are the Colour Rule.** The interface stays neutral so the presets' computed swatches are the richest thing on screen.

## Typography

**Display Font:** SF Pro Rounded (`ui-rounded`, with SF Pro / system-ui fallback), numerals only
**Body Font:** SF Pro Text (`-apple-system`, BlinkMacSystemFont, Helvetica Neue, system-ui)
**Label/Mono Font:** SF Mono (`ui-monospace`, Menlo) for file paths

**Character:** The platform's own text face at the platform's own sizes, tightened slightly as it grows; the rounded cut is saved for the big carry-over number and step counters, where it reads as friendly instrumentation.

### Hierarchy
- **Display numeral** (700, 46px, line-height 1, -0.03em, tabular): the inspector's carry-over percentage, with a 24px `%` in `label-2`. Counts up to its value.
- **Headline** (700, 24px, -0.022em, balanced): the first-run drop target only. Sheets use 18px, empty states 17px.
- **Title large** (700, 20px, -0.02em): the preset name in the inspector, selectable.
- **Title** (700, 15px, -0.012em): window title in the toolbar, group headings in the grid, popover titles.
- **Body** (400, 13px, 1.4, -0.003em): everything else. Names in tiles and rows step up to 520-560 weight; current sidebar row to 560.
- **Caption** (400, 11.5px, tabular figures): subtitles, counts, setting changes, footnotes (max 72ch).
- **Label** (650, 11px, `label-3`, sentence case): sidebar sections, inspector section titles, picker family headings, status pills.

### Named Rules
**The Tabular Figures Rule.** Every number that can change (counts, percentages, setting deltas, tallies) uses tabular figures so values never jitter as they update.

**The Sentence Case Rule.** Headings and labels are sentence case at 11px/650 the way macOS writes them; nothing is set in tracked uppercase.

## Layout

A three-column window grid: sidebar (`sidebar-w`: 248px on laptop screens, growing to 288px on big displays; 224px under 1240px wide), library (fluid), inspector (`inspector-w`: 344px, growing to 420px; 312px under 1240px). Side panels sit inset by the 8px `gap` and float with an 18px radius; hiding the inspector collapses its track to 0 on a soft spring. A 52px `band` runs across the top: in the native app it is the title bar (the traffic lights sit in the sidebar's top, like Finder), and the toolbar overlays the library with a scroll-edge blur that appears once content slides under it.

The library is a grouped grid (`auto-fill`, tiles at least `clamp(156px, 12cqi, 248px)` so they grow with the pane on big displays; 14-22px gaps; 16:10 tiles) or a sortable list (40px rows, sticky glass header; the carry-over column stops at 240px). The library pane is a size container: the list drops its smaller number columns under 860px and the group column under 560px; the selection bar collapses chips, then the summary, at 780 / 720 / 520px. The browser keeps 120px of bottom padding so the floating bar never covers the last row.

Window breakpoints: under 980px the inspector becomes an overlay sheet from the right; under 760px the sidebar becomes an overlay too, search collapses to an icon, tiles shrink to 140px; under 480px the view switch hides. The native window's minimum is 980 x 620, and it opens no bigger than the screen it is on.

**Sheets** hang from the toolbar (`sheet-top`, `clamp(24px, 9vh, 88px)`) at `min(560px, 100vw - 48px)` wide (620px for the export sheet) and never taller than the window. Each has three parts: a head that stays put (title, path, tabs), a body that scrolls (content fades under the edges as it does), and a row of buttons with secondary actions on the left and the default button on the right. Every grid track is `minmax(0, 1fr)`, so long folder paths wrap (at any character) instead of widening the sheet; tabs share the width and shorten their labels, and drop their icons in a sheet under 420px.

## Elevation & Depth

Depth is material, not shadow stacks. There are three levels: the canvas (the dusk sky, `.aurora`), panels that float on it (sidebar and inspector: frosted `panel` with `panel-shadow`, a `glass-edge` hairline and a `glass-hi` top edge), and glass that floats over everything (blur 26px + saturate 185%, a 1px `glass-edge`, an inset 1px `glass-hi` specular top edge, and the soft `glass-shadow`). The page paints the canvas edge to edge in the native app and in a browser alike. The canvas's fields lean toward the pointer, each by a different amount (so the sky shifts in depth), swell slightly while the pointer is in the window, and a `glow` follows it; the panels frost all of it. A pointer-following radial light (`.lit`) also catches on the selection bar and the Masks button.

### Shadow Vocabulary
- **Glass** (`0 18px 50px rgba(0,0,0,.42), 0 3px 10px rgba(0,0,0,.25)` dark; `0 18px 48px rgba(20,20,50,.16), 0 2px 8px rgba(20,20,50,.08)` light): selection bar, popovers, toasts, overlay panels.
- **Panel** (`0 10px 30px rgba(0,0,0,.28), 0 1px 3px rgba(0,0,0,.25)` dark; lighter blue-gray in light): sidebar and inspector.
- **Control** (`inset 0 1px 0 glass-hi, 0 2px 8px rgba(0,0,0,.12)`): toolbar capsules and tools.
- **Tile lift** (`0 10px 24px rgba(0,0,0,.22)` with a 2px rise): tile hover.
- **Sheet** (`0 30px 80px rgba(0,0,0,.4)`): modal sheets over a 42% / 20% scrim with 3px blur.

### Named Rules
**The Glass Floats Rule.** Glass is for things that float over content. Content itself (tiles, rows, inspector cards) is never glass.

**The Opaque Fallback Rule.** Under Reduce Transparency (system setting, or forwarded from macOS as `html.reduce-transparency`) all backdrop filters turn off and glass and panels become `elevated`. The design must read fully without blur.

## Shapes

Continuous, soft rounding scaled to the object: pills (99px) for every button, capsule, chip, bar and toast; 18px for floating panels and popovers; 20px for sheets; 14px for tiles and menus; 12px for inspector cards; 9-11px for rows and mask targets; 5-8px for tags, fields and row swatches. Selection checks and the step counters are circles. Borders are 1px hairlines in translucent separator colours; the only dashed edge is the drop target. Icons are 24px-grid line drawings, 1.7 stroke, round caps and joins, in `currentColor`.

## Components

### Buttons
Quiet, pill-shaped, pressable.
- **Shape:** full pill (99px), 30px tall; 38px "big"; Create is 40px.
- **Default:** `fill-2` with a `separator-strong` hairline, 500 weight.
- **Primary:** `accent-fill`, white 600 text, an inset white top highlight and a small drop shadow; hover deepens to `accent-fill-hover`.
- **Press:** scales to .96 in 80ms and springs back. Disabled at 42% opacity.
- **Icon button / link:** borderless 28px circle in `label-2`; links in `accent-text`, underline on hover.

### Toolbar capsules and tools
Glass pills grouping 34px circular controls (view switch; Add, Recent Exports, Appearance and Settings; search; inspector toggle). The view switch has a sliding thumb that springs between Grid and List. The Appearance switch shows a moon in Dark and a sun in Light; the other icon turns away on a spring, the sun turns a quarter on hover, and a click spreads the other appearance out in a circle from the button (a view transition, 720ms; instant under Reduce Motion). Settings › Output keeps Auto / Light / Dark. Search widens from 200 to 260px on focus with a blue ring. Pressed toggles turn their icon blue.

### Preset tile (signature)
A 16:10 computed swatch with a 14px radius, inner hairline and specular edge; name (560) and "NN% carries over" caption under it, then a 4px segmented mini meter in status colours. Hover lifts 2px; current gets a 3px solid blue ring, selected a 3px translucent ring. A frosted circular check appears top-left on hover or while selecting and fills blue when picked.

### List row
40px rows on a zebra `fill`, 9px radius, with a 44 x 26 swatch, name, group, mini meter + percentage, and counts. Selected rows tint `accent-soft`; the current row fills `accent-fill` with white text. Circular row checks pop their tick on a spring.

### Selection bar (signature)
A glass pill docked bottom-centre (58px): selection summary, "into", mask chips (`accent-soft` with a blue inner ring and a close button), Masks… and Create. Rises in on a soft spring; chips pop in; the Create count rolls when it changes.

### Mask picker popover
A 600px glass popover grown from the Masks button: three families of 38px mask targets (fill, hairline, icon + label, blue tick when picked), a Combined family, a four-part segmented Amount (100/75/50/25%), a segmented choice for settings a mask can't hold, and a footer tally ("2 presets × 3 masks = 6 new presets at 50%").
- **Combined targets:** the same 38px target with the shared two-circle icon; a small raised delete badge appears at the top-left corner on hover or focus. The last tile is a dashed "Combine Masks…" target.
- **Combine page:** a second page in the same popover, pushed in from the right (22px slide + fade on the soft spring) and back from the left. Native `<select>` menus (30px, 8px radius, `content` well, chevron) for Start with / Add / Subtract; chosen masks are mask chips; an `accent-soft` preview card names the result ("Subject + Water − Hair") and says it in words. Escape steps back a page before it closes the popover.

### Recent exports popover
A 380px glass popover from the toolbar's clock button (which pops in after the first export). Rows: a 32px `accent-soft` tile with the mask icon, the presets ("Moody Teal and 1 other") over "into …" and the time, then reveal and Export Again icon buttons. An export whose file is gone greys its tile and disables reveal.

### Inspector
A frosted `panel`: a 16:9 hero swatch with a blurred glow of itself beneath, the name, the rounded display percentage beside a drawn mini curve, an 8px segmented meter with legend, a destination card, and a table of settings each with a status pill. Content swaps by fading the old view out (120ms) and the new one in with a 6px rise (240ms).

### Status pill
11px/650 ink text with a 6px dot, on its status hue at 14-15%, 6px radius. Gray uses `fill-2`.

### Chips, segmented controls, switches, fields
Segmented and tab controls: a `fill-2` track, 10px radius, the selected segment raised on `content` with a small shadow. Switches are iOS-style 38 x 22 with a white knob that springs across. Text fields: 30px, 8px radius, `content` well, blue 3px focus ring.

### Sheets, toasts, menus
Sheets drop in from above on a soft spring (glass-strong, 20px radius) and are sized as in Layout; the done sheet draws its green tick, and its path box has a copy button at its end. Settings rows put the source's name and its count on one line and its folder, wrapped, underneath; a folder that isn't on this Mac says so in `approx-ink`. Toasts are glass HUD pills at the top centre. Menus highlight the hovered item with `accent-fill` and white text, macOS style.

## Do's and Don'ts

### Do:
- **Do** take every colour from the token set, in both appearances; add a light variant (with an accessible ink) for any new colour.
- **Do** use glass (blur 26px + saturate 185%, `glass-edge` hairline, `glass-hi` top edge, `glass-shadow`) only for floating controls, bars, popovers, sheets and toasts; the sidebar and inspector are frosted `panel`s on the canvas.
- **Do** give every grid and flex track that holds text `minmax(0, 1fr)` / `min-width: 0`, and let paths wrap; nothing may widen a sheet or a popover past the window.
- **Do** use `--spring` / `--spring-soft` (linear() springs with about 5% overshoot, cubic-bezier fallbacks) for arrivals and `--ease-in` at 120-180ms for exits.
- **Do** keep fades and stop all travel under Reduce Motion; turn glass opaque under Reduce Transparency; strengthen separators under Increase Contrast.
- **Do** show presets as computed swatches from `swatch.js`, and compute every percentage, count and status from the presets themselves.
- **Do** keep the page working the same in WKWebView (`html.native`, drag regions, forwarded settings) and in a plain browser.
- **Do** draw icons as 24px line drawings at 1.7 stroke in `currentColor`; draw apps as generic objects (a cloud, a display, a camera).
- **Do** use tabular figures for every changing number.

### Don't:
- **Don't** use Adobe's or Lightroom's logos, lettermarks, colours or branding anywhere; this app is not made by or affiliated with Adobe.
- **Don't** show anyone's purchased presets in screenshots or committed assets; samples are synthetic.
- **Don't** invent figures, testimonials or counts; a number on screen is computed or it is not shown.
- **Don't** imply the app writes to Lightroom's own files; they are read-only.
- **Don't** put glass on content (tiles, rows, cards), and don't stack glass on glass.
- **Don't** use the status colours for decoration or selection, or show a status by colour alone.
- **Don't** set labels in tracked uppercase or add kicker lines above titles.
- **Don't** let anything travel or bounce when Reduce Motion is on.
- **Don't** animate the canvas on its own: it answers the pointer and then rests.
