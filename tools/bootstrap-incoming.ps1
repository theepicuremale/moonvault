# tools/bootstrap-incoming.ps1
#
# One-time setup: creates the `incoming` branch on GitHub with a single
# README placeholder. Phone uploads will PUT into this branch.
# The Actions workflow processes uploads onto `main` and force-resets this
# branch back to the placeholder so originals never linger.
#
# Safe to re-run: if the branch already exists, this script just exits.

$ErrorActionPreference = 'Stop'

$env:Path = [System.Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' +
            [System.Environment]::GetEnvironmentVariable('Path', 'User')

$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot

# Does the branch already exist on origin?
$existing = & git ls-remote --heads origin incoming 2>$null
if ($existing) {
    Write-Host "✓ Branch 'incoming' already exists on origin. Nothing to do." -ForegroundColor Green
    exit 0
}

Write-Host '==> Creating orphan incoming branch with a placeholder README...'

# Work in a temp directory so we don't touch the main checkout.
$tmp = Join-Path $env:TEMP "moonvault-incoming-$([Guid]::NewGuid().ToString('N').Substring(0,8))"
New-Item -ItemType Directory -Force -Path $tmp | Out-Null
try {
    Set-Location $tmp

    & git init -q
    # Copy origin URL from the real repo so we can push back.
    Set-Location $repoRoot
    $remoteUrl = (& git remote get-url origin).Trim()
    Set-Location $tmp
    & git remote add origin $remoteUrl
    & git checkout --orphan incoming

    @"
# incoming

Throwaway branch. The phone (or admin UI) PUTs original photos here under
``photos/<Album Title>/``. A GitHub Actions workflow processes them onto
``main`` and force-resets this branch back to this placeholder so originals
never accumulate in any branch's history.
"@ | Out-File -FilePath "README.md" -Encoding utf8

    & git add README.md
    & git -c user.name='theepicuremale' -c user.email='theepicuremale@users.noreply.github.com' commit -q -m 'Bootstrap incoming branch'
    & git push origin incoming

    Write-Host '✓ incoming branch created.' -ForegroundColor Green
} finally {
    Set-Location $repoRoot
    Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
}
