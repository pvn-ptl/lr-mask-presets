"""Assemble PNG frames into the README's demo GIF (needs Pillow).

    python3 scripts/make-gif.py frames.json out.gif

frames.json is [{"file": "...png", "ms": 40}, ...], written by scripts/capture-docs.mjs.
One shared palette keeps colors from flickering between frames; Pillow only stores what changed.
Gradients (preset swatches, the blurred sidebar) get an ordered dither: it depends only on pixel position,
so parts of the screen that don't change stay identical from frame to frame and don't shimmer.
"""

import json
import sys

from PIL import Image, ImageChops

MAX_WIDTH = 960
BAYER = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]]
STRENGTH = 10  # dither amplitude in 8-bit levels, roughly the palette's step in smooth gradients


def bayer_noise(size):
    """A tiled 4x4 Bayer matrix scaled to 0..2*STRENGTH, as an RGB image."""
    tile = Image.new("L", (4, 4))
    tile.putdata([round(v * 2 * STRENGTH / 15) for row in BAYER for v in row])
    full = Image.new("L", size)
    for y in range(0, size[1], 4):
        for x in range(0, size[0], 4):
            full.paste(tile, (x, y))
    return Image.merge("RGB", (full, full, full))


def main(spec_path, out_path):
    frames = json.load(open(spec_path))
    images = [Image.open(f["file"]).convert("RGB") for f in frames]
    if images[0].width > MAX_WIDTH:
        size = (MAX_WIDTH, round(images[0].height * MAX_WIDTH / images[0].width))
        images = [im.resize(size, Image.LANCZOS) for im in images]

    # Build the palette from a strip of evenly spaced frames so every screen's colors are in it.
    picks = images[:: max(1, len(images) // 10)]
    strip = Image.new("RGB", (images[0].width, images[0].height * len(picks)))
    for i, im in enumerate(picks):
        strip.paste(im, (0, i * im.height))
    palette = strip.quantize(colors=255, method=Image.Quantize.MEDIANCUT)

    noise = bayer_noise(images[0].size)
    quantized = [ImageChops.add(im, noise, 1.0, -STRENGTH).quantize(palette=palette, dither=Image.Dither.NONE) for im in images]
    quantized[0].save(
        out_path,
        save_all=True,
        append_images=quantized[1:],
        duration=[f["ms"] for f in frames],
        loop=0,
        optimize=False,
        disposal=1,
    )
    print(f"{out_path}: {len(frames)} frames, {sum(f['ms'] for f in frames) / 1000:.1f} s")


if __name__ == "__main__":
    main(*sys.argv[1:3])
