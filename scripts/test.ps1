#!/usr/bin/env pwsh
# Strict test suite for Extensions repository (Windows PowerShell)
$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$pythonCmd = if (Get-Command python -ErrorAction SilentlyContinue) { "python" } elseif (Get-Command python3 -ErrorAction SilentlyContinue) { "python3" } else { "py" }

Write-Host "=== 1. Extension Test Suites & Packaging ===" -ForegroundColor Cyan
& $pythonCmd "$PSScriptRoot/run_extension_tests.py"
if ($LASTEXITCODE -ne 0) {
    Write-Error "Extension tests or packaging failed!"
    exit $LASTEXITCODE
}

Write-Host "`n=== 2. Extension Structure, Manifests & Specs ===" -ForegroundColor Cyan
& $pythonCmd "$PSScriptRoot/test_extensions_structure.py"
if ($LASTEXITCODE -ne 0) {
    Write-Error "Extension structure validation failed!"
    exit $LASTEXITCODE
}

Write-Host "`n=== 3. CI Parity Validation ===" -ForegroundColor Cyan
& $pythonCmd "$PSScriptRoot/test_ci_parity.py"
if ($LASTEXITCODE -ne 0) {
    Write-Error "CI parity validation failed!"
    exit $LASTEXITCODE
}

Write-Host "`n===============================================" -ForegroundColor Green
Write-Host " All extension checks passed (100% green)" -ForegroundColor Green
Write-Host "===============================================" -ForegroundColor Green
