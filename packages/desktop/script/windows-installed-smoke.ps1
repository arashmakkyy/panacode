# Runs on a disposable GitHub-hosted Windows runner against the installer just built.
param([Parameter(Mandatory)][string]$Installer)
$ErrorActionPreference = 'Stop'
$installerPath = (Resolve-Path $Installer).Path
$work = Join-Path $env:RUNNER_TEMP ("panacode-installed-" + [guid]::NewGuid().ToString("N"))
$install = Join-Path $work "application"
$logs = Join-Path $env:APPDATA "ai.panacode.desktop\logs"
New-Item -Type Directory -Path $work | Out-Null
foreach ($kind in "DATA","CONFIG","CACHE","STATE") {
    [Environment]::SetEnvironmentVariable("XDG_${kind}_HOME", (Join-Path $work $kind), "Process")
}
$env:PANACODE_DISABLE_MODELS_FETCH = "1"
$setup = Start-Process $installerPath -ArgumentList "/S /D=$install" -PassThru
if (!$setup.WaitForExit(180000) -or $setup.ExitCode -ne 0) { throw "Silent installation failed" }
$app = Join-Path $install "Panacode.exe"
$cli = Join-Path $install "resources\panacode-cli.exe"
if (!(Test-Path $app -PathType Leaf) -or !(Test-Path $cli -PathType Leaf)) { throw "Installed executable missing" }
function Read-Launch([string]$Kind) {
    $before = @(Get-ChildItem $logs -Directory -ErrorAction SilentlyContinue | ForEach-Object FullName)
    $desktop = Start-Process $app -PassThru
    $clock = [Diagnostics.Stopwatch]::StartNew()
    try {
        while ($clock.Elapsed.TotalSeconds -lt 150) {
            if ($desktop.HasExited) { throw "Installed desktop exited during $Kind launch" }
            $dirs = @(Get-ChildItem $logs -Directory -ErrorAction SilentlyContinue | Where-Object { $_.FullName -notin $before })
            foreach ($dir in $dirs) {
                $diagnostics = Join-Path $dir.FullName "diagnostics.jsonl"
                foreach ($line in @(Get-Content $diagnostics -ErrorAction SilentlyContinue)) {
                    try { $record = $line | ConvertFrom-Json } catch { continue }
                    if ($record.event -eq "service.ready" -and $record.status -eq "ready") {
                        $connection = & $cli service status --connection-json
                        if ($LASTEXITCODE -ne 0 -or !$connection) { throw "Installed CLI could not verify the service" }
                        try { $info = $connection | ConvertFrom-Json } catch { throw "Invalid installed service status" }
                        if ($info.product -ne 'panacode' -or !$info.id -or $info.pid -le 0 -or
                            $info.url -notmatch '^http://(127\.0\.0\.1|localhost|\[::1\]):[0-9]+/?$') {
                            throw "Installed CLI returned an unexpected service identity"
                        }
                        Write-Host ("Installed {0} launch reached verified ready in {1:N1}s" -f $Kind,$clock.Elapsed.TotalSeconds)
                        return [pscustomobject]@{ Instance = $info.id; ProcessId = $info.pid }
                    }
                    if ($record.event -eq "service.error") { throw ("Desktop startup failed with " + $record.errorCode) }
                }
            }
            Start-Sleep -Milliseconds 500
        }
        throw "Installed desktop never reported a ready local service on $Kind launch"
    } finally {
        if (!$desktop.HasExited) {
            $null = $desktop.CloseMainWindow()
            if (!$desktop.WaitForExit(5000)) { $desktop.Kill(); $desktop.WaitForExit() }
        }
    }
}
try {
    $cold = Read-Launch "cold"
    $warm = Read-Launch "warm"
    if ($cold.Instance -ne $warm.Instance -or $cold.ProcessId -ne $warm.ProcessId) {
        throw "Warm desktop launch replaced the healthy background service"
    }
} finally {
    & $cli service stop | Out-Null
}
if ($LASTEXITCODE -ne 0) { throw "Could not stop the verified service" }
$status = (& $cli service status | Select-Object -Last 1)
if ($LASTEXITCODE -ne 0 -or $status -ne 'stopped') { throw "Service still registered after stop" }
$uninstallers = @(Get-ChildItem $install -File -Filter "Uninstall*.exe")
if ($uninstallers.Count -ne 1) { throw "Missing unique registered uninstaller" }
$uninstall = Start-Process $uninstallers[0].FullName -ArgumentList "/S" -PassThru -Wait
if ($uninstall.ExitCode -ne 0) { throw "Installed uninstaller failed" }
$deadline = [DateTime]::UtcNow.AddSeconds(90)
while ((Test-Path $app) -and [DateTime]::UtcNow -lt $deadline) { Start-Sleep -Milliseconds 500 }
if (Test-Path $app) { throw "Uninstall left the owned desktop executable" }
Write-Host "Installed cold and warm launch, verified CLI status, and uninstall passed."
