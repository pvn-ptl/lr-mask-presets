# Security Policy

## Supported versions

Only the [latest release](https://github.com/pvn-ptl/partly-lightroom-preset-converter/releases/latest) gets
security fixes. Fixes ship as a new release, so if you're on an older version, update first and check whether the
problem is still there.

## Reporting a vulnerability

Please **don't open a public issue** for a security problem. Report it privately instead:

1. Open **[Report a vulnerability](https://github.com/pvn-ptl/partly-lightroom-preset-converter/security/advisories/new)**
   (the repo's **Security** tab › **Report a vulnerability**).
2. Include the Partly version (**Partly › About Partly**), your macOS version, the steps to reproduce it and what
   happens. A sample file helps a lot. Please make it a small test file rather than a preset you bought.

Partly is a one-person project, so a reply can take a few days. Once a problem is confirmed, the fix goes out in a new
release with a GitHub security advisory describing it. If you'd like to be credited in the advisory, say so in your
report.

## What to report

Partly opens preset files that people download from all over the internet, so a booby-trapped preset is the main
thing to watch for. Please report anything that lets a file, page or link:

- run code or script inside Partly, or have its name or contents shown as HTML rather than plain text
  (`.xmp`, `.lrtemplate` and `.zip` packs);
- make Partly write anywhere other than the folder you chose for new presets and, if you click Install,
  `~/Library/Application Support/Adobe/CameraRaw/Settings/Partly`;
- make Partly change Lightroom's own files or preset folders (it only reads them);
- load another page in Partly's window, or reach the app's native bridge from anything but Partly's own page;
- make Partly send anything over the network (it's built to make no network requests);
- do any of the above through the command-line tool (`cli/partly.mjs`).

Also report a release download whose SHA-256 checksum doesn't match the one in its release notes.

## Not security issues

- **macOS warns the first time you open Partly.** The app isn't notarized by Apple; the README explains
  **Open Anyway**.
- **Bugs in Lightroom, Lightroom Classic or Camera Raw.** Report those to Adobe.
- **Attacks that need someone to already control your Mac** or your user account.
- **A broken preset that converts wrongly or crashes the app** without any of the effects above. Please open a normal
  [issue](https://github.com/pvn-ptl/partly-lightroom-preset-converter/issues).

## How Partly keeps your Mac safe

- **Everything happens on your Mac.** Partly makes no network requests. Links such as **Partly on GitHub** open in
  your browser.
- **The window shows only Partly's own page** (`partly://`). It never loads other pages, and only that page can use
  the native bridge.
- **Preset names and contents are treated as text,** never as HTML.
- **Lightroom's folders are read, never written.** New presets go only to the folder you chose and, if you ask, the
  Camera Raw install folder. File names are checked first, so a preset can't name a path outside them.
- **No third-party code.** The app, the web page and the command-line tool are plain Swift and JavaScript in this repo,
  with no dependencies to install.
- **You can check every download.** Each release lists SHA-256 checksums: compare them with
  `shasum -a 256 ~/Downloads/Partly.dmg`. `codesign --verify --deep --strict /Applications/Partly.app` confirms the
  app hasn't changed since it was built.
