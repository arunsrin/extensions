#!/usr/bin/env python3
"""Validate modular extension directory structure, MV3 manifests, docs, and registration."""
import glob
import json
import os
import sys

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8")

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
IGNORED_DIRS = {".git", ".github", ".worktrees", "docs", "scripts", "dist", "node_modules"}
REQUIRED_FILES = ("manifest.json", "README.md", "SPEC.md", "PRIVACY.md")


def main():
    errors = []

    readme_path = os.path.join(ROOT_DIR, "README.md")
    spec_path = os.path.join(ROOT_DIR, "SPEC.md")
    readme_text = open(readme_path, "r", encoding="utf-8").read() if os.path.exists(readme_path) else ""
    spec_text = open(spec_path, "r", encoding="utf-8").read() if os.path.exists(spec_path) else ""

    extensions = []
    for entry in sorted(os.listdir(ROOT_DIR)):
        full = os.path.join(ROOT_DIR, entry)
        if not os.path.isdir(full) or entry.startswith(".") or entry in IGNORED_DIRS:
            continue
        extensions.append((entry, full))

    if not extensions:
        errors.append("No extension directories found at repository root.")

    for name, ext_dir in extensions:
        for req in REQUIRED_FILES:
            if not os.path.exists(os.path.join(ext_dir, req)):
                errors.append(f"[{name}] Missing required file: {req}")

        manifest_path = os.path.join(ext_dir, "manifest.json")
        if os.path.exists(manifest_path):
            try:
                manifest = json.load(open(manifest_path, "r", encoding="utf-8"))
                if manifest.get("manifest_version") != 3:
                    errors.append(f"[{name}] manifest.json must use manifest_version 3.")
                for field in ("name", "version", "description"):
                    if not manifest.get(field):
                        errors.append(f"[{name}] manifest.json missing '{field}'.")
            except json.JSONDecodeError as exc:
                errors.append(f"[{name}] Invalid manifest.json: {exc}")

        tests = glob.glob(os.path.join(ext_dir, "tests", "*.test.mjs"))
        if not tests:
            errors.append(f"[{name}] Missing companion automated tests under tests/*.test.mjs")

        for py_file in glob.glob(os.path.join(ext_dir, "scripts", "*.py")):
            py_src = open(py_file, "r", encoding="utf-8").read()
            if 'reconfigure(encoding="utf-8")' not in py_src and "reconfigure(encoding='utf-8')" not in py_src:
                errors.append(f"[{name}] Python script {os.path.basename(py_file)} missing UTF-8 stdout reconfigure guard.")

        if name not in readme_text:
            errors.append(f"[{name}] Extension not registered in root README.md.")
        if name not in spec_text:
            errors.append(f"[{name}] Extension not registered in root SPEC.md.")

    if errors:
        print("❌ Extension structure validation failed:", file=sys.stderr)
        for err in errors:
            print(f"  - {err}", file=sys.stderr)
        sys.exit(1)

    print(f"✓ Extension structure validated ({len(extensions)} extension(s) checked).")


if __name__ == "__main__":
    main()
