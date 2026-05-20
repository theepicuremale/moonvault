# tools/reset-incoming.ps1
# Force-reset `incoming` to a clean placeholder containing the workflow file.
# Run this once after fixing the workflow file. Future workflow runs handle
# the reset automatically.

$ErrorActionPreference = 'Stop'
$env:Path = [System.Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' +
            [System.Environment]::GetEnvironmentVariable('Path', 'User')

$repoRoot = Split-Path -Parent $PSScriptRoot
$remoteUrl = & git -C $repoRoot remote get-url origin
$wfSrc = Join-Path $repoRoot ".github\workflows\process-incoming.yml"

$tmp = Join-Path $env:TEMP ("moonvault-incoming-reset-" + [Guid]::NewGuid().ToString('N').Substring(0,8))
New-Item -ItemType Directory -Force -Path $tmp | Out-Null

Push-Location $tmp
try {
    & git init -q
    & git remote add origin $remoteUrl
    & git checkout --orphan incoming-reset

    @'
# incoming

Throwaway branch. The phone (or admin UI) pushes original photos here under
`photos/<Album Title>/`. A GitHub Actions workflow processes them onto
`main` and force-resets this branch back to this placeholder so originals
never accumulate in any branch's history.

The workflow file lives here intentionally -- GitHub Actions reads workflow
definitions from the branch being pushed, so removing it would silently
disable processing of future uploads.
'@ | Out-File "README.md" -Encoding utf8

    New-Item -ItemType Directory -Force ".github\workflows" | Out-Null
    Copy-Item $wfSrc ".github\workflows\process-incoming.yml"

    & git add README.md .github/workflows/process-incoming.yml
    & git -c user.name='theepicuremale' -c user.email='theepicuremale@users.noreply.github.com' commit -q -m 'Reset incoming after manual processing'
    & git push --force origin HEAD:incoming
    Write-Host 'OK: incoming branch reset.' -ForegroundColor Green
} finally {
    Pop-Location
    Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
}
