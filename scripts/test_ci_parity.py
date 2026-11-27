#!/usr/bin/env python3
"""Validate CI parity between local test scripts and .github/workflows/test.yml."""
import os
import sys

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8")

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WORKFLOW_FILE = os.path.join(ROOT_DIR, ".github", "workflows", "test.yml")


def main():
    if not os.path.exists(WORKFLOW_FILE):
        print(f"Error: CI workflow not found at {WORKFLOW_FILE}", file=sys.stderr)
        sys.exit(1)

    with open(WORKFLOW_FILE, "r", encoding="utf-8") as f:
        workflow_content = f.read()

    required_checks = [
        ("run_extension_tests.py", "Extension unit tests and package verification"),
        ("test_extensions_structure.py", "Extension directory structure, manifest, and spec validation"),
        ("test_ci_parity.py", "CI parity check"),
    ]

    missing = []
    for snippet, desc in required_checks:
        if snippet not in workflow_content:
            missing.append(f"  - Missing {desc} ('{snippet}')")

    if missing:
        print("❌ CI Parity Failure! Missing from .github/workflows/test.yml:", file=sys.stderr)
        for item in missing:
            print(item, file=sys.stderr)
        sys.exit(1)

    print("✓ CI Parity verified: All local validation steps are present in GitHub Actions CI.")


if __name__ == "__main__":
    main()
