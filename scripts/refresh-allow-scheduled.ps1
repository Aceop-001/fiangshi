# Scheduled ALLOW-only census refresh (Windows Task Scheduler, every 36 h; installed 2026-11-24).
# Runs scripts/refresh-allow.ts with a 60-credit budget and a 100-credit floor; it commits only when the test suite is
# green and pushes main, which redeploys the API and the site. Every run appends to data\refresh-allow-scheduled.log.
# Refuses to run (and changes nothing) unless the repository is on a clean main branch.
$ErrorActionPreference = "Stop"
$repo = Split-Path -Parent $PSScriptRoot
Set-Location $repo
$log = Join-Path $repo "data\refresh-allow-scheduled.log"
New-Item -ItemType Directory -Force (Split-Path $log) | Out-Null
function Write-Log([string]$m) { Add-Content -Path $log -Value ("{0} {1}" -f (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ"), $m) }

Write-Log "start"
$branch = (git branch --show-current).Trim()
$dirty = git status --porcelain --untracked-files=no
if ($branch -ne "main") { Write-Log "skipped: on branch '$branch', not main"; exit 2 }
if ($dirty) { Write-Log "skipped: uncommitted changes in tracked files"; exit 2 }
git pull --ff-only origin main 2>&1 | ForEach-Object { Write-Log "git: $_" }
if ($LASTEXITCODE -ne 0) { Write-Log "skipped: git pull failed"; exit 2 }
npx tsx scripts/refresh-allow.ts --budget 60 --floor 100 --commit --push *>> $log
$code = $LASTEXITCODE
Write-Log "exit $code"
exit $code
