#!/usr/bin/env bash
# Strict test suite for Extensions repository (Linux / macOS / WSL)
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
ROOT_DIR="$(cd "$DIR/.." >/dev/null 2>&1 && pwd)"
cd "$ROOT_DIR"

PYTHON_CMD="python3"
if ! command -v python3 &>/dev/null; then
    PYTHON_CMD="python"
fi

echo "=== 1. Extension Test Suites & Packaging ==="
"$PYTHON_CMD" "$DIR/run_extension_tests.py"

echo -e "\n=== 2. Extension Structure, Manifests & Specs ==="
"$PYTHON_CMD" "$DIR/test_extensions_structure.py"

echo -e "\n=== 3. CI Parity Validation ==="
"$PYTHON_CMD" "$DIR/test_ci_parity.py"

echo -e "\n==============================================="
echo " All extension checks passed (100% green)"
echo "==============================================="
