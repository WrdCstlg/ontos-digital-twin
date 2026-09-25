<#
.SYNOPSIS
  Builds the two images the PRO-THESIS gate runs against, both tagged with the
  Ontos commit:

    ontos-app:<tag>      the application image, built from ./app
    ontos-gate-db:<tag>  MySQL holding the demo workspace, migrated, seeded and
                         with the gate admin provisioned, produced by running
                         that same app image's bootstrap against a scratch
                         database and dumping the result, plus gate fixtures:
                         three copies of the CSV mapping, and two bulk CSV
                         mappings ("gate-bulk N") whose imports take seconds

.NOTES
  The credentials below exist only inside throwaway containers on a private
  network. They are not secrets, and the gate's driver uses the admin one.
#>
param(
  [string]$Tag = (git rev-parse --short=7 HEAD),
  # Rows in each bulk fixture import; see "gate fixtures: two bulk CSV mappings".
  [int]$BulkRows = 1000
)

$ErrorActionPreference = "Stop"
$root = (git rev-parse --show-toplevel)
$gate = Join-Path $root "gate"
$seedSql = Join-Path $gate "db/seed.sql"

$mysqlImage = "mysql:8.4@sha256:85b9bf2e29cf836ecb8c2a15a935d4ba0c606631dff1dd79531a11983c638f2a"
$net = "ontos-gate-seed-$Tag"
$db = "ontos-gate-seed-db-$Tag"
$dbPassword = "gate-db-password"
$adminEmail = "admin@acme-ontology.com"
$adminPassword = "ontos-gate-admin-password"

function Invoke-Checked([string]$what, [scriptblock]$cmd) {
  & $cmd
  if ($LASTEXITCODE -ne 0) { throw "$what failed (exit $LASTEXITCODE)" }
}

function Remove-Scratch {
  docker rm -f $db 2>$null | Out-Null
  docker network rm $net 2>$null | Out-Null
}

Write-Host "==> ontos-app:$Tag"
Invoke-Checked "app image build" {
  docker build --provenance=false --sbom=false -t "ontos-app:$Tag" (Join-Path $root "app")
}

Remove-Scratch
try {
  Write-Host "==> scratch database"
  Invoke-Checked "network create" { docker network create $net | Out-Null }
  Invoke-Checked "mysql start" {
    docker run -d --name $db --network $net `
      -e MYSQL_DATABASE=ontos -e MYSQL_USER=ontos `
      -e MYSQL_PASSWORD=$dbPassword -e MYSQL_ROOT_PASSWORD=$dbPassword `
      $mysqlImage | Out-Null
  }

  # TCP ping, not the socket: first-boot initialisation runs a temporary server
  # with networking off, and only the real one should count as ready.
  $ready = $false
  for ($i = 0; $i -lt 90; $i++) {
    docker exec $db mysqladmin ping --host=127.0.0.1 --silent 2>$null | Out-Null
    if ($LASTEXITCODE -eq 0) { $ready = $true; break }
    Start-Sleep -Seconds 2
  }
  if (-not $ready) { throw "scratch MySQL did not become ready within 180s" }

  Write-Host "==> bootstrap (migrate, seed, provision admin) with ontos-app:$Tag"
  Invoke-Checked "bootstrap" {
    docker run --rm --network $net `
      -e NODE_ENV=production `
      -e "DATABASE_URL=mysql://ontos:$dbPassword@${db}:3306/ontos" `
      -e APP_SECRET=gate-only-app-secret-not-used-at-runtime `
      -e "ADMIN_EMAIL=$adminEmail" -e "ADMIN_PASSWORD=$adminPassword" `
      "ontos-app:$Tag" node dist/db/bootstrap.js
  }

  Write-Host "==> gate fixtures: three more CSV mappings"
  # Imports of one mapping are deduplicated (a second request follows the first),
  # so more mappings are what let two workers be busy at the same moment. These
  # copies of the seeded CSV mapping are gate fixture data, not Ontos's seed.
  $fixtureSql = "INSERT INTO mappings (connectorId, moduleId, name, sourceTable, classIri, columnMapJson, status) " +
    "SELECT m.connectorId, m.moduleId, CONCAT(m.name, ' (gate copy ', k.n, ')'), m.sourceTable, m.classIri, m.columnMapJson, m.status " +
    "FROM mappings m CROSS JOIN (SELECT 2 AS n UNION ALL SELECT 3 UNION ALL SELECT 4) k " +
    "WHERE m.id = (SELECT MIN(x.id) FROM (SELECT mm.id FROM mappings mm JOIN connectors c ON c.id = mm.connectorId WHERE c.type = 'csv') x);"
  Invoke-Checked "gate fixtures" { docker exec -e "MYSQL_PWD=$dbPassword" $db mysql -uroot ontos -e $fixtureSql }

  Write-Host "==> gate fixtures: two bulk CSV mappings of $BulkRows rows"
  # Imports long enough that a worker is almost always holding one, so a fault
  # on a worker lands on a held lease. Each mapping writes its own subjects,
  # so two workers importing at once never upsert the same rows.
  $bulkSql = @'
SET SESSION cte_max_recursion_depth = 100000;
SET SESSION group_concat_max_len = 67108864;
SET @rows = __ROWS__;
SET @csv = (
  WITH RECURSIVE seq (n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM seq WHERE n < @rows)
  SELECT GROUP_CONCAT(
    CONCAT_WS(',', CONCAT('GATE-', LPAD(n, 5, '0')), CONCAT('Gate Person ', n), CONCAT('gate.person.', n, '@acme.com'),
      '', '', DATE_FORMAT(DATE_SUB('2025-06-30', INTERVAL MOD(n, 2000) DAY), '%Y-%m-%d'), 'B2', 'active')
    ORDER BY n SEPARATOR '\n')
  FROM seq);
INSERT INTO connectors (workspaceId, name, type, configJson, status)
SELECT c.workspaceId, 'gate-bulk HRIS export', 'csv',
  JSON_OBJECT('filename', 'gate-bulk.csv', 'rows', @rows,
    'csvText', CONCAT('emp_id,full_name,email,manager_id,dept_code,hire_date,band,status', CHAR(10), @csv)),
  'connected'
FROM connectors c WHERE c.id = (SELECT MIN(x.id) FROM (SELECT id FROM connectors WHERE type = 'csv') x);
SET @bulk = LAST_INSERT_ID();
INSERT INTO mappings (connectorId, moduleId, name, sourceTable, classIri, columnMapJson, status)
SELECT @bulk, m.moduleId, CONCAT('gate-bulk ', k.n), 'gate-bulk.csv', m.classIri,
  JSON_SET(m.columnMapJson, '$.subject', CONCAT('hr:Person/gate-bulk-', k.n, '-{emp_id}')), m.status
FROM mappings m CROSS JOIN (SELECT 1 AS n UNION ALL SELECT 2) k
WHERE m.id = (SELECT MIN(x.id) FROM (SELECT mm.id FROM mappings mm JOIN connectors c ON c.id = mm.connectorId WHERE c.type = 'csv') x);
'@ -replace '__ROWS__', $BulkRows
  $bulkFile = Join-Path ([System.IO.Path]::GetTempPath()) "ontos-gate-bulk-$Tag.sql"
  Set-Content -Path $bulkFile -Value $bulkSql -Encoding utf8NoBOM
  try {
    Invoke-Checked "copy bulk fixture" { docker cp $bulkFile "${db}:/tmp/bulk.sql" }
    Invoke-Checked "bulk fixtures" {
      docker exec -e "MYSQL_PWD=$dbPassword" $db sh -c "mysql -uroot ontos < /tmp/bulk.sql"
    }
  }
  finally {
    Remove-Item $bulkFile -ErrorAction SilentlyContinue
  }

  Write-Host "==> dump"
  # Written inside the container and copied out, so no shell re-encodes it.
  Invoke-Checked "mysqldump" {
    docker exec $db mysqldump -uroot "-p$dbPassword" --single-transaction `
      --skip-comments --no-tablespaces --set-gtid-purged=OFF `
      --result-file=/tmp/seed.sql ontos
  }
  Invoke-Checked "copy dump" { docker cp "${db}:/tmp/seed.sql" $seedSql }
}
finally {
  Remove-Scratch
}

Write-Host "==> ontos-gate-db:$Tag"
Invoke-Checked "db image build" {
  docker build --provenance=false --sbom=false -t "ontos-gate-db:$Tag" (Join-Path $gate "db")
}

$size = [math]::Round((Get-Item $seedSql).Length / 1MB, 1)
Write-Host "done: ontos-app:$Tag, ontos-gate-db:$Tag (seed dump $size MB)"
