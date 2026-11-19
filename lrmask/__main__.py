"""`python3 -m lrmask` opens the app. `list` and `convert` work from the terminal without it."""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

from .mapping import Options, convert
from .server import App, serve
from .sources import Catalog, default_sources, load_paths
from .writer import DEFAULT_GROUP_TEMPLATE, TARGETS, group_name, write_batch

DEFAULT_OUT = Path(__file__).resolve().parent.parent / "output"


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(prog="lrmask", description="Turn Lightroom presets into Background / Subject / Sky presets.")
    sub = parser.add_subparsers(dest="command")

    run = sub.add_parser("serve", help="open the app in your browser (the default)")
    run.add_argument("--port", type=int, default=8765)
    run.add_argument("--no-browser", action="store_true", help="don't open a browser tab")

    find = sub.add_parser("list", help="list the presets found on this Mac")
    find.add_argument("search", nargs="?", default="", help="only show names or groups containing this text")

    make = sub.add_parser("convert", help="convert preset files, folders, .zip packs, or installed presets")
    make.add_argument("paths", nargs="*", type=Path, help=".xmp files, folders or .zip packs")
    make.add_argument("--search", help="convert installed presets whose name or group contains this text")
    make.add_argument("--target", choices=list(TARGETS), default="background")
    make.add_argument("--group", default=DEFAULT_GROUP_TEMPLATE, help="Lightroom group, e.g. '{target} · {group}'")
    make.add_argument("--no-parametric", action="store_true", help="drop parametric curve sliders instead of approximating")
    make.add_argument("--no-grayscale", action="store_true", help="drop B&W instead of desaturating the mask")
    make.add_argument("--vibrance", action="store_true", help="fold Vibrance into Saturation at half strength")

    for p in (run, find, make):
        p.add_argument("--presets", type=Path, action="append", default=[], help="extra preset folder to include")
        p.add_argument("--out", type=Path, default=DEFAULT_OUT, help=f"where new presets go (default: {DEFAULT_OUT})")

    args = parser.parse_args(argv)
    command = args.command or "serve"
    extra = getattr(args, "presets", [])
    out = getattr(args, "out", DEFAULT_OUT)

    catalog = Catalog(default_sources(extra))
    if command == "serve":
        catalog.refresh()
        serve(App(catalog, out), port=getattr(args, "port", 8765), open_browser=not getattr(args, "no_browser", False))
        return 0

    if command == "list":
        catalog.refresh()
        needle = args.search.lower()
        entries = [e for e in catalog.all() if needle in e.preset.name.lower() or needle in e.preset.group.lower()]
        for entry in sorted(entries, key=lambda e: (e.source, e.preset.group.lower(), e.preset.name.lower())):
            conv = convert(entry.preset)
            print(f"{entry.source:10} {conv.coverage:4.0%}  {entry.preset.group or '-'} / {entry.preset.name}")
        print(f"\n{len(entries)} presets")
        return 0

    options = Options(parametric=not args.no_parametric, grayscale=not args.no_grayscale, vibrance=args.vibrance)
    entries, errors = load_paths(args.paths)
    if args.search:
        catalog.refresh()
        needle = args.search.lower()
        entries += [e for e in catalog.all() if not e.preset.converted
                    and (needle in e.preset.name.lower() or needle in e.preset.group.lower())]
    if not entries:
        print("No presets to convert. Pass .xmp files, folders or zips, or use --search.", file=sys.stderr)
        for error in errors:
            print(f"  skipped {error}", file=sys.stderr)
        return 1

    jobs = []
    for entry in entries:
        conv = convert(entry.preset, options)
        lost = [r.label for r in conv.rows if r.status == "lost"]
        if conv.empty:
            print(f"  skip  {entry.preset.name}: nothing in it can go into a mask")
            continue
        jobs.append((entry.preset, conv, group_name(entry.preset, args.target, args.group)))
        print(f"  {conv.coverage:4.0%}  {entry.preset.name}" + (f"  (not carried over: {', '.join(lost)})" if lost else ""))
    for error in errors:
        print(f"  skipped {error}", file=sys.stderr)
    if not jobs:
        return 1
    result = write_batch(jobs, out, args.target)
    print(f"\nMade {len(jobs)} {TARGETS[args.target]['label']} presets.")
    print(f"Import into Lightroom with File > Import Profiles & Presets...:\n  {result['zip']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
