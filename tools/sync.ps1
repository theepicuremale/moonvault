# tools/sync.ps1
# One-shot: npm run build -> git add -> git commit -> git push
#
# Usage:
#   .\tools\sync.ps1                  # auto-detects new items and commits with a default message
#   .\tools\sync.ps1 -Message "..."   # use a custom commit message
#   .\tools\sync.ps1 -Prune           # also removes orphaned albums from the manifest
#
# Run from anywhere; the script cd's to its own repo root.

[CmdletBinding()]
param(
    [string] $Message,
    [switch] $Prune
)

$ErrorActionPreference = 'Stop'

# Make sure PATH picks up Node / npm / git installed at machine or user level
# (so the script works whether or not the parent shell already has them).
$env:Path = [System.Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' +
            [System.Environment]::GetEnvironmentVariable('Path', 'User')

# Repo root is the parent of this script's directory (tools/).
$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot

function Write-Step($text) {
    Write-Host ''
    Write-Host "==> $text" -ForegroundColor Cyan
}

function Fail($text) {
    Write-Host "✗ $text" -ForegroundColor Red
    exit 1
}

# --- 1) build -----------------------------------------------------------------

Write-Step 'npm run build'
$buildCmd = if ($Prune) { 'build:prune' } else { 'build' }
& npm run $buildCmd
if ($LASTEXITCODE -ne 0) { Fail "npm run $buildCmd failed (exit $LASTEXITCODE)." }

# --- 2) stage assets ----------------------------------------------------------

Write-Step 'git add assets'
& git add assets
if ($LASTEXITCODE -ne 0) { Fail 'git add failed.' }

# --- 3) check for changes -----------------------------------------------------

$staged = & git diff --cached --name-only
if (-not $staged) {
    Write-Host ''
    Write-Host '✓ Nothing new to commit. Manifest + assets/ are up to date.' -ForegroundColor Green
    exit 0
}

$count = ($staged | Measure-Object).Count
Write-Host "  $count file(s) staged."

# --- 4) commit ----------------------------------------------------------------

if (-not $Message -or [string]::IsNullOrWhiteSpace($Message)) {
    $stamp = Get-Date -Format 'yyyy-MM-dd HH:mm'
    $Message = "Sync photos ($stamp)"
}

Write-Step "git commit -m `"$Message`""
& git commit -m $Message -m 'Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>'
if ($LASTEXITCODE -ne 0) { Fail 'git commit failed.' }

# --- 5) push ------------------------------------------------------------------

Write-Step 'git push'
& git push
if ($LASTEXITCODE -ne 0) { Fail 'git push failed.' }

Write-Host ''
Write-Host '✓ Sync complete. GitHub Pages will rebuild in ~30s.' -ForegroundColor Green
