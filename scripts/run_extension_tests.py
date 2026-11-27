#!/usr/bin/env python3
"""Discover and run Node test suites and packaging verification across all extensions."""
import glob
import os
import subprocess
import sys

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

    print("✓ All extension test suites and package builds passed.")


if __name__ == "__main__":
    main()
