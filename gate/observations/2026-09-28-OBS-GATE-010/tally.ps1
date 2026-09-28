# Tallies what each world of one Gate run showed about pre-registration 10:
# its fault, verdict, whether sync_jobs.settle judged, the driver's sync counts,
# the anchor import's line in driver.log, and for the api worlds how many reads
# api.read_your_writes judged.
#
#   gh run download <run> --repo WrdCstlg/ontos-digital-twin -D <dir>
#   pwsh -File tally.ps1 -Bundles <dir>
param([Parameter(Mandatory)][string]$Bundles)

$worlds = Get-ChildItem $Bundles -Recurse -Filter result.json | Sort-Object {
  (Get-Content (Join-Path $_.Directory.FullName "phases.jsonl") -TotalCount 1 | ConvertFrom-Json).t_ns
}
foreach ($file in $worlds) {
  $world = $file.Directory
  $result = Get-Content $file.FullName -Raw | ConvertFrom-Json
  $verdict = Get-Content (Join-Path $world.Parent.FullName "verdict.json") -Raw | ConvertFrom-Json
  $thesis = Get-Content (Join-Path $world.FullName "world.thesis") -Raw | ConvertFrom-Json
  $fault = ($thesis.fault_schedule.planned -join ", ")
  if (-not $fault) { $fault = "none" }
  $settle = $result.oracles | Where-Object oracle -eq "sync_jobs.settle"
  $syncs = [regex]::Match($settle.explanation, "The driver recorded \d+ sync operations \([^)]*\)").Value
  $anchor = (Select-String -Path (Join-Path $world.FullName "driver.log") -Pattern "anchor import" | Select-Object -First 1).Line -replace "^\S+\s+", ""
  $reads = ""
  if ($thesis.driver_profile -eq "api") {
    $api = $result.oracles | Where-Object oracle -eq "api.read_your_writes"
    $reads = [regex]::Match($api.explanation, "\d+ judged by the client's next read").Value
  }
  $notOk = ($result.oracles | Where-Object { $_.status -ne "ok" } | ForEach-Object { "$($_.oracle)=$($_.status)" }) -join ", "
  if (-not $notOk) { $notOk = "none" }
  "$($world.Parent.Name)/$($world.Name) | $($thesis.driver_profile) | fault: $fault | $($verdict.verdict) | settle: $($settle.status) | $syncs | $anchor | $reads | not ok: $notOk"
}
