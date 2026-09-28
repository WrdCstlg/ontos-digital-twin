# Recount of pre-registrations 8 and 9 from the gate's kept run bundles.
# Downloads every gate-runs-* artifact on WrdCstlg not already here, then prints
# one row per world of the sessions and api profiles.
param([int]$Limit = 60)
$ErrorActionPreference = "Stop"
$repo = "WrdCstlg/ontos-digital-twin"
$root = Join-Path $PSScriptRoot "bundles\recount"
New-Item -ItemType Directory -Force -Path $root | Out-Null

$artifacts = gh api "repos/$repo/actions/artifacts?per_page=100" --jq '.artifacts[] | select(.name | startswith("gate-runs-")) | select(.expired | not) | "\(.name) \(.workflow_run.id) \(.workflow_run.head_sha) \(.workflow_run.head_branch)"'
$rows = @()
foreach ($line in ($artifacts | Select-Object -First $Limit)) {
  $name, $runId, $sha, $branch = $line -split ' ', 4
  $dest = Join-Path $root $name
  if (-not (Test-Path $dest)) {
    gh run download $runId --repo $repo --name $name --dir $dest 2>&1 | Out-Null
  }
  foreach ($run in Get-ChildItem $dest -Directory) {
    $w = Join-Path $run.FullName "world-0001"
    if (-not (Test-Path "$w\plan.json")) { continue }
    $profile = (Get-Content "$w\plan.json" -Raw | ConvertFrom-Json).profile
    if ($profile -notin @("sessions", "api")) { continue }
    $world = Get-Content "$w\world.thesis" -Raw | ConvertFrom-Json
    $fault = $world.fault_schedule.realized | Select-Object -First 1
    $verdict = (Get-Content "$($run.FullName)\verdict.json" -Raw | ConvertFrom-Json).verdict
    $oracles = (Get-Content "$w\result.json" -Raw | ConvertFrom-Json).oracles
    $ryw = $oracles | Where-Object { $_.oracle -eq "api.read_your_writes" }
    $judged = if ($ryw.explanation -match '(\d+) judged') { [int]$Matches[1] } else { 0 }
    $sess = ($oracles | Where-Object { $_.oracle -eq "session.honoured" }).status
    $history = Get-Content "$w\history.jsonl" | ForEach-Object { $_ | ConvertFrom-Json }
    $drive = ($history | Where-Object { $_.event -eq "phase" -and $_.phase -eq "DRIVE" } | Select-Object -First 1).t_ns
    $done = $history | Where-Object { $_.type -in @("ok", "fail", "info") -and $_.f }
    $inOutage = 0; $answered503 = 0; $answered401 = 0
    if ($fault) {
      foreach ($op in $done) {
        $ms = ($op.t_ns - $drive) / 1e6
        if ($ms -ge $fault.start_ms -and $ms -le $fault.end_ms) {
          $inOutage++
          if ($op.error -match 'HTTP 503') { $answered503++ }
          if ($op.error -match 'HTTP 401') { $answered401++ }
        }
      }
    }
    $e500 = @($done | Where-Object { $_.error -match 'HTTP 500' }).Count
    $deadlocks = @(Select-String -Path "$w\logs\app.log" -Pattern "ER_LOCK_DEADLOCK" -ErrorAction SilentlyContinue).Count
    $rows += [pscustomobject]@{
      run = "$runId/$($run.Name)"; branch = $branch; sha = $sha.Substring(0, 7); profile = $profile
      fault = if ($fault) { $fault.fault } else { "-" }; verdict = $verdict
      ops = @($done).Count; inOutage = $inOutage; a503 = $answered503; a401 = $answered401
      rywJudged = $judged; ryw = $ryw.status; session = $sess; http500 = $e500; deadlocks = $deadlocks
    }
  }
}
$rows | Sort-Object profile, fault, run | Format-Table -AutoSize | Out-String -Width 250
