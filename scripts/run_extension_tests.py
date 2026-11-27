#!/usr/bin/env python3
"""Discover and run Node test suites and packaging verification across all extensions."""
import glob
import json
import os
import subprocess
import sys
import zipfile

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8")

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
IGNORED_DIRS = {".git", ".github", ".worktrees", "docs", "scripts", "dist", "node_modules"}


def discover_extensions():
    extensions = []
    for entry in sorted(os.listdir(ROOT_DIR)):
        full = os.path.join(ROOT_DIR, entry)
        if not os.path.isdir(full) or entry.startswith(".") or entry in IGNORED_DIRS:
            continue
        if os.path.exists(os.path.join(full, "manifest.json")):
            extensions.append((entry, full))
    return extensions


def verify_zip_archive(ext_dir, name):
    with open(os.path.join(ext_dir, "manifest.json"), "r", encoding="utf-8") as f:
        manifest = json.load(f)
    version = manifest.get("version", "0.0.0")
    zip_path = os.path.join(ext_dir, "dist", f"{name}-v{version}.zip")
    if not os.path.exists(zip_path):
        zips = sorted(glob.glob(os.path.join(ext_dir, "dist", "*.zip")))
        if not zips:
            print(f"Error: Expected packaged zip under {ext_dir}/dist/", file=sys.stderr)
            sys.exit(1)
        zip_path = zips[-1]

    with zipfile.ZipFile(zip_path, "r") as zf:
        names = set(zf.namelist())

    required_entries = {"manifest.json"}
    sw = manifest.get("background", {}).get("service_worker")
    if sw:
        required_entries.add(sw)
    popup = manifest.get("action", {}).get("default_popup")
    if popup:
        required_entries.add(popup)
    for icon_path in manifest.get("icons", {}).values():
        required_entries.add(icon_path)

    missing = sorted(required_entries - names)
    if missing:
        print(f"Error: Zip archive {zip_path} is missing entries: {missing}", file=sys.stderr)
        sys.exit(1)


def main():
    extensions = discover_extensions()
    if not extensions:
        print("Error: No extensions with manifest.json found.", file=sys.stderr)
        sys.exit(1)

    for name, ext_dir in extensions:
        test_files = sorted(glob.glob(os.path.join(ext_dir, "tests", "*.test.mjs")))
        if not test_files:
            print(f"Error: {name} has no tests/*.test.mjs files.", file=sys.stderr)
            sys.exit(1)

        print(f"Running tests for {name} ({len(test_files)} suite(s))...")
        res = subprocess.run(["node", "--test", *test_files], cwd=ext_dir)
        if res.returncode != 0:
            sys.exit(res.returncode)

        pkg_script = os.path.join(ext_dir, "scripts", "package.py")
        if os.path.exists(pkg_script):
            print(f"Verifying packaging for {name}...")
            pkg_res = subprocess.run([sys.executable, pkg_script], cwd=ext_dir)
            if pkg_res.returncode != 0:
                sys.exit(pkg_res.returncode)
            verify_zip_archive(ext_dir, name)

    print("✓ All extension test suites and package builds passed.")


if __name__ == "__main__":
    main()
