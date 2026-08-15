#!/usr/bin/env python3
"""Validate and optionally archive the HACS custom integration package."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile

ROOT = Path(__file__).resolve().parents[1]
COMPONENT = ROOT / "custom_components" / "sky_control"
REQUIRED = {
    "__init__.py",
    "climate.py",
    "config_flow.py",
    "const.py",
    "coordinator.py",
    "diagnostics.py",
    "entity.py",
    "manifest.json",
    "translations/en.json",
    "swm100/__init__.py",
    "swm100/client.py",
    "swm100/codec.py",
    "swm100/discovery.py",
    "swm100/exceptions.py",
    "swm100/models.py",
}
FORBIDDEN_SUFFIXES = {".pyc", ".pyo"}


def package_files() -> list[Path]:
    """Return distributable files while excluding local runtime artifacts."""
    files = sorted(
        path
        for path in COMPONENT.rglob("*")
        if path.is_file()
        and "__pycache__" not in path.parts
        and path.suffix not in FORBIDDEN_SUFFIXES
    )
    relative = {path.relative_to(COMPONENT).as_posix() for path in files}
    missing = REQUIRED - relative
    if missing:
        raise SystemExit(f"Missing package files: {', '.join(sorted(missing))}")
    return files


def validate_metadata() -> str:
    """Validate the local HACS and Home Assistant manifests."""
    manifest = json.loads((COMPONENT / "manifest.json").read_text(encoding="utf-8"))
    expected = {
        "domain": "sky_control",
        "name": "Sky Control (SWM100)",
        "config_flow": True,
        "iot_class": "local_polling",
        "integration_type": "device",
    }
    for key, value in expected.items():
        if manifest.get(key) != value:
            raise SystemExit(f"manifest.json has invalid {key!r}")
    if not manifest.get("version"):
        raise SystemExit("manifest.json requires a custom-integration version")
    hacs = json.loads((ROOT / "hacs.json").read_text(encoding="utf-8"))
    if hacs.get("name") != expected["name"]:
        raise SystemExit("hacs.json name does not match manifest.json")
    json.loads((COMPONENT / "translations" / "en.json").read_text(encoding="utf-8"))
    return str(manifest["version"])


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--archive", action="store_true", help="create a local manual-install ZIP"
    )
    args = parser.parse_args()
    version = validate_metadata()
    files = package_files()
    print(f"Validated {len(files)} Sky Control integration files (version {version}).")
    if not args.archive:
        return
    destination = ROOT / "dist" / f"sky-control-home-assistant-{version}.zip"
    destination.parent.mkdir(parents=True, exist_ok=True)
    with ZipFile(destination, "w", ZIP_DEFLATED) as archive:
        for path in files:
            archive.write(path, path.relative_to(ROOT))
    print(f"Created {destination.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
