# Runs on a disposable GitHub-hosted Windows runner against the installer just built.
param(
    [Parameter(Mandatory)][string]$Installer,
    [string]$SharedXdgRoot,
    [scriptblock]$CheckPeer
)
$ErrorActionPreference = 'Stop'
$installerPath = (Resolve-Path $Installer).Path
$work = Join-Path $env:RUNNER_TEMP ("panacode-installed-" + [guid]::NewGuid().ToString("N"))
$install = Join-Path $work "application"
$logs = Join-Path $env:APPDATA "ai.panacode.desktop\logs"
New-Item -Type Directory -Path $work | Out-Null
$foreignRoot = Join-Path $work 'foreign-tree'
$outside = Join-Path $foreignRoot 'witness.txt'
$null = New-Item -ItemType Directory -Path $foreignRoot
[IO.File]::WriteAllText($outside, [guid]::NewGuid().ToString())
$outsideHash = (Get-FileHash -LiteralPath $outside).Hash
$outsideAcl = @{}
foreach ($path in @($work, $foreignRoot, $outside)) { $outsideAcl[$path] = (Get-Acl -LiteralPath $path).Sddl }
$xdg = if ($SharedXdgRoot) { $SharedXdgRoot } else { $work }
foreach ($kind in "DATA","CONFIG","CACHE","STATE") {
    [Environment]::SetEnvironmentVariable("XDG_${kind}_HOME", (Join-Path $xdg $kind), "Process")
}
$env:PANACODE_DISABLE_MODELS_FETCH = "1"
function Install-Candidate {
    $setup = Start-Process $installerPath -ArgumentList "/S /D=$install" -PassThru
    try {
        if (!$setup.WaitForExit(180000)) { throw "Silent installation exceeded the 180-second deadline." }
        if ($setup.ExitCode -ne 0) {
            $code = $setup.ExitCode
            Write-Host "Panacode installer returned status $code."
            $stages = @(Get-ChildItem -LiteralPath $work -Directory -Filter 'application.staging-*')
            $pinPath = Join-Path $PSScriptRoot '../dist/ai.panacode.desktop-x64.manifest.sha256'
            if ($stages.Count -eq 1 -and (Test-Path -LiteralPath $pinPath -PathType Leaf)) {
                # Hosted job only. Recheck the exact failed stage without writing/deleting anything.
                # Emit the category and status; neither paths nor file contents go to workflow logs.
                $pin = [IO.File]::ReadAllText((Resolve-Path -LiteralPath $pinPath)).Trim()
                $helper = Join-Path $PSScriptRoot '../resources/windows/install-files.ps1'
                $nativePS = Join-Path $env:WINDIR 'SysWOW64/WindowsPowerShell/v1.0/powershell.exe'
                $diagnostic = @(& $nativePS -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $helper -Action Stage -Root $stages[0].FullName -Pin $pin -AppId ai.panacode.desktop -Executable Panacode.exe 2>&1)
                $verifyStatus = $LASTEXITCODE
                $category = @($diagnostic | ForEach-Object { "$_" } | Where-Object { $_ -match '^Panacode file verification: [A-Za-z ]+$' })
                Write-Host "Read-only check of residual stage returned $verifyStatus. $($category -join ' ')"
            } else { Write-Host "Residual private stages: $($stages.Count)." }
            throw "Silent installation failed with status $code."
        }
    } finally { $setup.Dispose() }
}
function Assert-InstallBoundary([string]$Phase) {
    # This test owns a fresh parent. Production deliberately keeps unknown files in an old install.
    # No unknown file was placed in this install before reinstall, so every temporary sibling must be gone.
    $prefix = [regex]::Escape([IO.Path]::GetFileName($install))
    $residue = @(Get-ChildItem -LiteralPath $work -Force | Where-Object { $_.Name -match "^$prefix\.(?:old(?:-.*)?|update-.*|staging-.*)$" })
    if ($residue.Count) { throw "$Phase left an installer stage or backup." }
    foreach ($path in $outsideAcl.Keys) {
        if ((Get-Acl -LiteralPath $path).Sddl -cne $outsideAcl[$path]) { throw "$Phase changed an unrelated ACL." }
    }
    if ((Get-FileHash -LiteralPath $outside).Hash -ne $outsideHash) { throw "$Phase changed the outside witness." }
}

function Assert-SandboxAcl {
    # Same well-known SID and (OI)(CI)(RX) grant as customInstallStagedApp. Check the effective
    # on-disk entries without parsing locale-specific icacls account names or abbreviated rights.
    $rx = [int][Security.AccessControl.FileSystemRights]::ReadAndExecute
    $permitted = $rx -bor [int][Security.AccessControl.FileSystemRights]::Synchronize
    $inherit = [Security.AccessControl.InheritanceFlags]'ContainerInherit, ObjectInherit'
    foreach ($path in @($install, $app, $cli, (Join-Path $install 'resources/app.asar'))) {
        $rootEntry = $path -eq $install
        $acl = Get-Acl -LiteralPath $path
        $entries = @($acl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier]) | Where-Object {
            $_.IdentityReference.Value -eq 'S-1-15-2-2'
        })
        foreach ($entry in $entries) {
            if (($entry.AccessControlType -eq 'Deny' -and ([int]$entry.FileSystemRights -band $rx)) -or
                ($entry.AccessControlType -eq 'Allow' -and ([int]$entry.FileSystemRights -band (-bnot $permitted)))) {
                throw 'Restricted AppContainer has an unexpected grant or denial on installed files.'
            }
        }
        $rules = @($entries | Where-Object {
            $_.AccessControlType -eq 'Allow' -and
            $_.IsInherited -eq (!$rootEntry) -and (!$rootEntry -or $_.InheritanceFlags -eq $inherit) -and
            $_.PropagationFlags -eq 'None' -and ([int]$_.FileSystemRights -band $rx) -eq $rx -and
            ([int]$_.FileSystemRights -band (-bnot $permitted)) -eq 0
        })
        if (!$rules.Count) { throw 'Installed payload did not inherit the restricted AppContainer read/execute grant.' }
    }
}

$app = Join-Path $install "Panacode.exe"
$cli = Join-Path $install "resources\panacode-cli.exe"
Install-Candidate
Assert-InstallBoundary 'Fresh install'
Assert-SandboxAcl
Write-Host 'Fresh install verified the restricted AppContainer RX grant on the payload and left no installer stage.'
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
        $dirs = @(Get-ChildItem $logs -Directory -ErrorAction SilentlyContinue | Where-Object { $_.FullName -notin $before })
        foreach ($dir in $dirs) {
            foreach ($line in @(Get-Content (Join-Path $dir.FullName "diagnostics.jsonl") -Tail 12 -ErrorAction SilentlyContinue)) {
                try { $item = $line | ConvertFrom-Json } catch { continue }
                if ($item.event -in @("app.start","app.error","service.start","service.boot","service.ready","service.error")) {
                    Write-Host ("Observed event={0}, stage={1}, status={2}, code={3}" -f $item.event,$item.stage,$item.status,$item.errorCode)
                }
            }
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
    if ($CheckPeer) { & $CheckPeer }
    $warm = Read-Launch "warm"
    if ($CheckPeer) { & $CheckPeer }
    if ($cold.Instance -ne $warm.Instance -or $cold.ProcessId -ne $warm.ProcessId) {
        throw "Warm desktop launch replaced the healthy background service"
    }
} finally {
    & $cli service stop | Out-Null
}
if ($LASTEXITCODE -ne 0) { throw "Could not stop the verified service" }
$status = (& $cli service status | Select-Object -Last 1)
if ($LASTEXITCODE -ne 0 -or $status -ne 'stopped') { throw "Service still registered after stop" }
if ($CheckPeer) { & $CheckPeer }
# Resolve the native Downloads known folder even when the Windows profile redirects it.
$shell = New-Object -ComObject Shell.Application
$folder = $shell.NameSpace('shell:Downloads')
if (!$folder) { throw 'Windows did not resolve the Downloads known folder.' }
$downloads = $folder.Self.Path
if (![IO.Path]::IsPathFullyQualified($downloads) -or !(Test-Path -LiteralPath $downloads -PathType Container)) {
    throw 'The Windows Downloads known folder is missing.'
}
& node "$PSScriptRoot/windows-installed-export.mjs" $app $downloads
if ($LASTEXITCODE -ne 0) { throw 'Installed port conflict or Export Logs check failed.' }
& node "$PSScriptRoot/installed-tool-calls.mjs" $cli
if ($LASTEXITCODE -ne 0) { throw 'Installed PanaAI tool-call recovery check failed.' }
if ($CheckPeer) { & $CheckPeer }

# Reinstall with an existing profile. It must survive both this replacement and default uninstall.
$profileWitness = Join-Path $env:XDG_DATA_HOME 'panacode/installed-smoke-witness.txt'
$null = New-Item -ItemType Directory -Path (Split-Path $profileWitness) -Force
[IO.File]::WriteAllText($profileWitness, [guid]::NewGuid().ToString())
$profileHash = (Get-FileHash -LiteralPath $profileWitness).Hash
Install-Candidate
Assert-InstallBoundary 'Reinstall'
Assert-SandboxAcl
Write-Host 'Reinstall preserved external ACLs and removed the previous owned installation and its stage.'
if ((Get-FileHash -LiteralPath $profileWitness).Hash -ne $profileHash) { throw 'Reinstall changed the Panacode profile.' }
if ($CheckPeer) { & $CheckPeer }

# electron-builder's stable production app GUID for ai.panacode.desktop. The installer stores
# the three SHA-256 pins in one registry value, separately from the files it owns.
$guid = 'db0dfd4d-fc6c-534b-b1bc-ca31ad2b6748'
$installKey = "HKCU:\Software\$guid"
$uninstallKey = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\$guid"
$registration = Get-ItemProperty -LiteralPath $installKey -ErrorAction Stop
$receipt = @($registration.PanacodeInstallReceipt -split '/', 3)
$manifestFile = Join-Path $install '.panacode-install'
if ($receipt.Count -ne 3 -or $receipt[0] -ne (Get-FileHash -LiteralPath $manifestFile).Hash) {
    throw 'Installed manifest does not match the registered ownership receipt.'
}
$registeredCommand = (Get-ItemProperty -LiteralPath $uninstallKey -ErrorAction Stop).UninstallString
if ($registeredCommand -notmatch '^"([^"]+)"(?:\s|$)') { throw 'Invalid registered uninstall command.' }
$uninstallerPath = $Matches[1]
$expectedUninstaller = Join-Path $registration.InstallLocation 'Uninstall Panacode.exe'
if ($uninstallerPath -ne $expectedUninstaller -or
    $receipt[1] -ne (Get-FileHash -LiteralPath (Join-Path $install 'Uninstall Panacode.exe')).Hash -or
    $receipt[1] -ne (Get-FileHash -LiteralPath $uninstallerPath).Hash) {
    throw 'Registered uninstaller does not match the installed executable.'
}
if ($receipt[2] -and $receipt[2] -ne (Get-FileHash -LiteralPath (Join-Path $install 'uninstallerIcon.ico')).Hash) {
    throw 'Installed icon does not match the ownership receipt.'
}
$manifest = [IO.File]::ReadAllLines($manifestFile)
if ($manifest[0] -cne 'panacode-install 2' -or $manifest[1] -cne 'app=ai.panacode.desktop' -or
    $manifest[2] -notmatch '^version=.+' -or $manifest[3] -cne 'exe=Panacode.exe') {
    throw 'Installed ownership manifest has an unexpected identity.'
}
foreach ($ownedFile in @($app,$cli)) {
    $relative = [IO.Path]::GetRelativePath($install,$ownedFile)
    $digest = (Get-FileHash -LiteralPath $ownedFile).Hash
    if ($manifest -notcontains "$digest`t$relative") { throw "Receipt did not verify installed $relative." }
    Write-Host "Installed $relative SHA-256 $digest"
}
# An unrelated file and junction inside the install directory must survive uninstall.
$foreignFile = Join-Path $install 'foreign-witness.txt'
$junction = Join-Path $install 'foreign-junction'
[IO.File]::WriteAllText($foreignFile, [guid]::NewGuid().ToString())
$insideHash = (Get-FileHash -LiteralPath $foreignFile).Hash
$null = New-Item -ItemType Junction -Path $junction -Target $foreignRoot
$uninstall = Start-Process $uninstallerPath -ArgumentList '/S' -PassThru -Wait
if ($uninstall.ExitCode -ne 0) { throw "Installed uninstaller failed" }
# NSIS can relaunch the actual uninstaller from TEMP. The first launcher exiting and the
# first owned file disappearing both precede registry cleanup.
$ownedPaths = @($app, $cli, $manifestFile, $uninstallerPath, $installKey, $uninstallKey)
$deadline = [DateTime]::UtcNow.AddSeconds(90)
do {
    $remaining = @($ownedPaths | Where-Object { Test-Path -LiteralPath $_ })
    if (!$remaining.Count) { break }
    Start-Sleep -Milliseconds 500
} while ([DateTime]::UtcNow -lt $deadline)
if ($remaining.Count) { throw "Uninstall left owned files or a product registration." }
Assert-InstallBoundary 'Uninstall'
# Inspect just the top-level entries to avoid traversing the deliberately foreign junction.
$expected = @([IO.Path]::GetFileName($foreignFile), [IO.Path]::GetFileName($junction))
$retained = @(Get-ChildItem -LiteralPath $install -Force | ForEach-Object Name)
if (Compare-Object -ReferenceObject $expected -DifferenceObject $retained) {
    throw 'Uninstall left an unexpected payload entry or removed an unrelated entry.'
}
if ((Get-FileHash -LiteralPath $foreignFile).Hash -ne $insideHash -or
    (Get-FileHash -LiteralPath $outside).Hash -ne $outsideHash -or
    (Get-FileHash -LiteralPath $profileWitness).Hash -ne $profileHash -or
    (Get-Item -LiteralPath $junction -Force).LinkType -ne 'Junction' -or
    (Get-FileHash -LiteralPath (Join-Path $junction 'witness.txt')).Hash -ne $outsideHash) {
    throw 'Uninstall changed an unrelated file, junction or user profile.'
}
if ($CheckPeer) { & $CheckPeer }
Write-Host "Installed cold and warm launch, verified service, reinstall and manifest-scoped uninstall passed."
