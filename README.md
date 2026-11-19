# LR Mask Presets

Turn any Lightroom preset into one that only touches the **background**, or only the **subject** or **sky**.

Lightroom presets apply globally. This app rebuilds a preset's look inside a Lightroom AI mask and saves it as a
new preset. When you apply it, Lightroom detects the background on that photo and applies the look only there. It
works with Lightroom (cloud, "LR CC") and syncs to your other devices like any preset.

## Start it

Double-click **`Open LR Mask Presets.command`** (or run `python3 -m lrmask` in this folder). Your browser opens
the app. It needs only the Python that ships with macOS, so there's nothing to install.

1. **Pick presets.** Your synced Lightroom presets and Adobe's built-ins are listed. You can also drop in `.xmp`
   files or a `.zip` pack. Click one to see exactly what carries over; tick several, or a whole group, to batch.
2. **Choose the mask** (Background / Subject / Sky) and click **Create**.
3. **Import once in Lightroom:** *File › Import Profiles & Presets…*, then pick the `.zip` it made
   (in `output/`). The presets appear under *Presets › Yours › "Background · <original group>"*.

Creating the same preset again gives it the same ID, so re-importing replaces it instead of duplicating it.

## What carries over

Every mapping below was checked against files Lightroom wrote itself on this Mac: Adobe's adaptive presets,
and masks saved from Lightroom 10.

| Preset setting | In the mask | |
|---|---|---|
| Exposure | Exposure (stored ÷ 4; masks stop at ±4 EV) | exact |
| Contrast, Highlights, Shadows, Whites, Blacks, Texture, Clarity, Dehaze, Saturation | same sliders (stored ÷ 100) | exact |
| Temp / Tint on JPEG/HEIC presets (relative values) | Temp / Tint (÷ 100) | exact |
| Color Grading, incl. old Split Toning | the mask's own Color Grading wheels (same numbers) | exact |
| Point tone curve, Red/Green/Blue curves | the mask's Curve | exact |
| Parametric curve sliders | traced into the mask's point curve | approximate, can be turned off |
| Black & White | Saturation −100 (the B&W mix isn't kept) | approximate, can be turned off |
| Vibrance | added to Saturation at half strength | approximate, off by default |
| Color Mixer (HSL), Calibration, Kelvin white balance, profiles, vignette, grain, Point Color | — | not possible in a mask |

A **Background** mask here is Lightroom's own *Select Background* mask (`MaskSubType 0`, `MaskSubCategoryID 22`),
not an inverted subject mask. That matches what Lightroom writes when you pick Select Background yourself.

Each preset gets a coverage score (the share of its look settings that carry over). For looks that lean on HSL
or profiles, the exact route is still Photoshop: a virtual copy with the preset, opened as layers, with a layer mask.

## Command line

```sh
python3 -m lrmask list "Landscape"                      # find presets and their coverage
python3 -m lrmask convert --search "#WL - 1"             # convert every installed preset matching a name/group
python3 -m lrmask convert ~/Downloads/pack.zip --target sky
python3 -m lrmask convert my.xmp --vibrance --group "BG · {group}"
```

## Safety

- Lightroom's files are only ever read. New presets go to `output/` (ignored by git, since presets you bought
  shouldn't be pushed anywhere).
- The app listens on `127.0.0.1` only, and every request needs a per-launch token, so other websites can't use it.

## Tests

```sh
python3 -m unittest
```
