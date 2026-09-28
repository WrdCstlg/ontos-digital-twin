# Counts, over every Gate run whose bundles CI still keeps, the worlds whose
# outcome was a harness error, and says which. Needs gh signed in.
#
#   pwsh -File count.ps1 -Into <empty dir>
param([Parameter(Mandatory)][string]$Into, [string]$Repo = "WrdCstlg/ontos-digital-twin")

$runs = gh run list --repo $Repo --workflow gate.yml --limit 100 --json databaseId,headSha,conclusion,createdAt | ConvertFrom-Json
$worlds = 0
foreach ($run in $runs | Sort-Object createdAt) {
  $dir = Join-Path $Into $run.databaseId
  $artifacts = gh api "repos/$Repo/actions/runs/$($run.databaseId)/artifacts" --jq '.artifacts[] | select(.expired == false) | .name' 2>$null
  foreach ($name in $artifacts | Where-Object { $_ -like "gate-runs-*" }) {
    gh run download $run.databaseId --repo $Repo -n $name -D $dir 2>$null | Out-Null
  }
  if (-not (Test-Path $dir)) { continue }
  foreach ($file in Get-ChildItem $dir -Recurse -Filter result.json) {
    $worlds++
    $result = Get-Content $file.FullName -Raw | ConvertFrom-Json
    if ($result.outcome -eq "harness_error") {
      $verdict = Get-Content (Join-Path $file.Directory.Parent.FullName "verdict.json") -Raw | ConvertFrom-Json
      $notOk = ($result.oracles | Where-Object { $_.status -ne "ok" }).Count
      "harness error: run $($run.databaseId) ($($run.createdAt), $($run.headSha.Substring(0, 7))), $($file.Directory.Parent.Name) profile $($verdict.profile), oracles not ok: $notOk"
    }
  }
}
"worlds read: $worlds, in $(@($runs).Count) Gate runs listed"
