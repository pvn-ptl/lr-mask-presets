"""Assemble PNG frames into the README's demo GIF (needs Pillow).

    python3 scripts/make-gif.py frames.json out.gif

frames.json is [{"file": "...png", "ms": 40}, ...], written by scripts/capture-docs.mjs.
One shared palette keeps colors from flickering between frames; Pillow only stores what changed.
"""

import json
import sys

from PIL import Image

MAX_WIDTH = 1100


def main(spec_path, out_path):
    frames = json.load(open(spec_path))
    images = [Image.open(f["file"]).convert("RGB") for f in frames]
    if images[0].width > MAX_WIDTH:
        size = (MAX_WIDTH, round(images[0].height * MAX_WIDTH / images[0].width))
        images = [im.resize(size, Image.LANCZOS) for im in images]

    # Build the palette from a strip of evenly spaced frames so every screen's colors are in it.
    picks = images[:: max(1, len(images) // 6)]
    strip = Image.new("RGB", (images[0].width, images[0].height * len(picks)))
    for i, im in enumerate(picks):
        strip.paste(im, (0, i * im.height))
    palette = strip.quantize(colors=255, method=Image.Quantize.MEDIANCUT)

    quantized = [im.quantize(palette=palette, dither=Image.Dither.NONE) for im in images]
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
