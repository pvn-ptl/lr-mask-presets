#!/bin/zsh
# Double-click in Finder to open LR Mask Presets in your browser. Close this window to stop it.
cd "${0:A:h}" || exit 1
exec /usr/bin/python3 -m lrmask
