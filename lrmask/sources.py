"""Find presets on this Mac. Everything here is read-only: Lightroom's own files are never modified."""
from __future__ import annotations

import hashlib
import io
import threading
import zipfile
from dataclasses import dataclass, field
from pathlib import Path

from .xmp import Preset, PresetError, parse_preset

HOME = Path.home()
MAX_ZIP_BYTES = 50 * 1024 * 1024


@dataclass
class Source:
    key: str
    label: str
    roots: list = field(default_factory=list)


@dataclass
class Entry:
    id: str
    source: str
    preset: Preset
    path: Path | None = None


def default_sources(extra=()) -> list:
    return [
        # Lightroom (cloud) keeps its synced presets inside the local library, one file per preset.
        Source("lightroom", "Your Lightroom presets", sorted(HOME.glob("Pictures/*.lrlibrary/*/cr_settings"))),
        Source("cameraraw", "Camera Raw", [HOME / "Library/Application Support/Adobe/CameraRaw/Settings"]),
        Source("adobe", "Adobe built-in", [Path("/Library/Application Support/Adobe/CameraRaw/Settings")]),
        Source("folder", "Other folders", [Path(p).expanduser() for p in extra]),
    ]


class Catalog:
    def __init__(self, sources: list):
        self.sources = sources
        self.entries: dict = {}
        self.skipped: list = []
        self._cache: dict = {}
        self._uploads: dict = {}
        self._lock = threading.Lock()

    def refresh(self) -> None:
        entries, skipped = {}, []
        for source in self.sources:
            for root in source.roots:
                for path in sorted(Path(root).rglob("*.xmp")) if Path(root).is_dir() else []:
                    preset = self._load(path, skipped)
                    if preset is not None and preset.preset_type == "Normal":
                        entry = Entry(_digest(str(path)), source.key, preset, path)
                        entries[entry.id] = entry
        with self._lock:
            entries.update(self._uploads)
            self.entries, self.skipped = entries, skipped

    def add_upload(self, filename: str, data: bytes) -> tuple:
        """Parse an uploaded .xmp or .zip of presets; returns (added entries, errors)."""
        added, errors = [], []
        for name, blob in _unpack(filename, data, errors):
            try:
                preset = parse_preset(blob, fallback_name=Path(name).stem)
            except PresetError as exc:
                errors.append(f"{name}: {exc}")
                continue
            if preset.preset_type not in ("Normal", ""):
                errors.append(f"{name}: this is a profile, not a preset")
                continue
            added.append(Entry(_digest(name + hashlib.sha1(blob).hexdigest()), "uploaded", preset))
        with self._lock:
            for entry in added:
                self._uploads[entry.id] = entry
                self.entries[entry.id] = entry
        return added, errors

    def get(self, entry_id: str) -> Entry | None:
        return self.entries.get(entry_id)

    def all(self) -> list:
        return list(self.entries.values())

    def _load(self, path: Path, skipped: list) -> Preset | None:
        try:
            stamp = path.stat().st_mtime_ns
            cached = self._cache.get(path)
            if cached and cached[0] == stamp:
                return cached[1]
            preset = parse_preset(path.read_bytes(), fallback_name=path.stem)
        except (OSError, PresetError) as exc:
            skipped.append(f"{path}: {exc}")
            return None
        self._cache[path] = (stamp, preset)
        return preset


def load_paths(paths) -> tuple:
    """Presets from files, folders (searched recursively) and .zip archives; returns (entries, errors)."""
    entries, errors = [], []
    for path in map(Path, paths):
        files = sorted(path.rglob("*.xmp")) + sorted(path.rglob("*.zip")) if path.is_dir() else [path]
        for file in files:
            try:
                data = file.read_bytes()
            except OSError as exc:
                errors.append(f"{file}: {exc}")
                continue
            for name, blob in _unpack(str(file), data, errors):
                try:
                    preset = parse_preset(blob, fallback_name=Path(name).stem)
                except PresetError as exc:
                    errors.append(f"{name}: {exc}")
                    continue
                if preset.preset_type in ("Normal", ""):
                    entries.append(Entry(_digest(name), "folder", preset, file))
    return entries, errors


def _unpack(filename: str, data: bytes, errors: list):
    if not filename.lower().endswith(".zip"):
        yield filename, data
        return
    if len(data) > MAX_ZIP_BYTES:
        errors.append(f"{filename}: zip is larger than 50 MB")
        return
    try:
        archive = zipfile.ZipFile(io.BytesIO(data))
    except zipfile.BadZipFile:
        errors.append(f"{filename}: not a valid zip")
        return
    total = 0
    for info in archive.infolist():
        name = info.filename
        if info.is_dir() or not name.lower().endswith(".xmp") or "__MACOSX" in name or Path(name).name.startswith("."):
            continue
        total += info.file_size
        if total > MAX_ZIP_BYTES:
            errors.append(f"{filename}: unpacks to more than 50 MB; stopped early")
            return
        yield f"{filename}/{name}", archive.read(info)


def _digest(text: str) -> str:
    return hashlib.sha1(text.encode()).hexdigest()[:12]
