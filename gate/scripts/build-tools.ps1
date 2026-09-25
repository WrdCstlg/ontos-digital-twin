<#
.SYNOPSIS
  Builds the gate's driver and oracles into gate/bin, where prothesis.yaml and
  the oracle definitions expect them.
#>
$ErrorActionPreference = "Stop"
$gate = Split-Path -Parent $PSScriptRoot
Push-Location $gate
try {
  foreach ($cmd in "ontosload", "oracle-sync-jobs", "oracle-job-leases") {
    go build -trimpath -o "bin/$cmd$(if ($IsWindows) { '.exe' })" "./cmd/$cmd"
    if ($LASTEXITCODE -ne 0) { throw "go build ./cmd/$cmd failed" }
  }
  Write-Host "built: bin/ontosload, bin/oracle-sync-jobs, bin/oracle-job-leases"
}
finally {
  Pop-Location
}
