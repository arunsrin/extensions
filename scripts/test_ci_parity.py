#!/usr/bin/env python3
"""Validate CI parity across local test scripts (test.ps1, test.sh) and .github/workflows/test.yml."""
import glob
import os
import sys

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8")

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WORKFLOW_FILE = os.path.join(ROOT_DIR, ".github", "workflows", "test.yml")
PS_SCRIPT = os.path.join(ROOT_DIR, "scripts", "test.ps1")
SH_SCRIPT = os.path.join(ROOT_DIR, "scripts", "test.sh")


def active_lines(path):
    if not os.path.exists(path):
        return None
    with open(path, "r", encoding="utf-8") as f:
        lines = []
        for raw in f:
            stripped = raw.strip()
            if not stripped or stripped.startswith("#"):
                continue
            lines.append(stripped)
        return "\n".join(lines)


def main():
    targets = {
        ".github/workflows/test.yml": active_lines(WORKFLOW_FILE),
        "scripts/test.ps1": active_lines(PS_SCRIPT),
        "scripts/test.sh": active_lines(SH_SCRIPT),
    }

    for label, content in targets.items():
        if content is None:
            print(f"Error: Required runner file missing: {label}", file=sys.stderr)
            sys.exit(1)

    # Dynamically discover all test/runner scripts under scripts/
    discovered = sorted(
        os.path.basename(p)
        for p in (
            glob.glob(os.path.join(ROOT_DIR, "scripts", "test_*.py"))
            + glob.glob(os.path.join(ROOT_DIR, "scripts", "test_*.js"))
            + glob.glob(os.path.join(ROOT_DIR, "scripts", "run_*.py"))
        )
    )

    if not discovered:
        print("Error: No verification scripts discovered under scripts/", file=sys.stderr)
        sys.exit(1)

    missing = []
    for script_name in discovered:
        for label, content in targets.items():
            if script_name not in content:
                missing.append(f"  - {script_name} missing from active commands in {label}")

    if missing:
        print("❌ CI Parity Failure!", file=sys.stderr)
        for item in missing:
            print(item, file=sys.stderr)
        sys.exit(1)

    print(
        f"✓ CI Parity verified: {len(discovered)} verification script(s) active across CI, test.ps1, and test.sh."
    )


if __name__ == "__main__":
    main()
