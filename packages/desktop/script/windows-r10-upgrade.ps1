# Exercises the shipped r10 installer and production CLI on a clean, disposable Windows VM.
param([Parameter(Mandatory)][string]$Installer)
$ErrorActionPreference = 'Stop'
if (!$IsWindows -or $env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_ENVIRONMENT -ne 'github-hosted') {
    throw 'This test requires a fresh GitHub-hosted Windows runner.'
}
$candidate = (Resolve-Path -LiteralPath $Installer).Path
$registry = 'HKCU:\Software\db0dfd4d-fc6c-534b-b1bc-ca31ad2b6748'
if (Test-Path -LiteralPath $registry) { throw 'The runner already has a registered Panacode installation.' }
$work = Join-Path $env:RUNNER_TEMP ("panacode-r10-" + [Guid]::NewGuid().ToString('N'))
$project = Join-Path $work 'project'
$port = 28844
$base = "http://127.0.0.1:$port"
$old = $null
$desktop = $null
$cli = $null
$firewall = $null
New-Item -Type Directory -Path $project | Out-Null

function Install-Checked([string]$Executable, [string]$Label) {
    $setup = Start-Process -FilePath $Executable -ArgumentList '/S' -PassThru
    try {
        if (!$setup.WaitForExit(180000)) { throw "$Label installer timed out." }
        if ($setup.ExitCode -ne 0) { throw ("{0} installer returned {1}." -f $Label,$setup.ExitCode) }
    } finally { $setup.Dispose() }
}

function Test-OwnedListener([int]$ProcessId) {
    $found = @(Get-NetTCPConnection -State Listen -LocalPort $port -LocalAddress '127.0.0.1' -ErrorAction SilentlyContinue)
    return $found.Count -eq 1 -and $found[0].OwningProcess -eq $ProcessId
}

function Local-Request([string]$Route,[string]$Password,[string]$Payload) {
    $headers = @{ Authorization = 'Basic ' + [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes("opencode:$Password")) }
    $params = @{Uri = "$base$Route"; Headers = $headers; NoProxy = $true; MaximumRedirection = 0; TimeoutSec = 8}
    if ($Payload) { return Invoke-RestMethod @params -Method Post -ContentType 'application/json' -Body $Payload }
    return Invoke-RestMethod @params -Method Get
}

try {
    $oldSetup = Join-Path $work 'r10.exe'
    $release = 'https://github.com/arashmakkyy/panacode/releases/download/panacode-desktop-win-x64-r10/panacode-desktop-win-x64.exe'
    Invoke-WebRequest -Uri $release -OutFile $oldSetup -TimeoutSec 140 -MaximumRetryCount 1
    if ((Get-FileHash -LiteralPath $oldSetup).Hash -ne 'e2e5b937c76bf4bccc229d65c9bc8f599c7977fd854dfd16fc8fd7dadfbe6f5a') {
        throw 'Historical release digest mismatch.'
    }
    foreach ($kind in 'DATA','CONFIG','CACHE','STATE') {
        [Environment]::SetEnvironmentVariable("XDG_${kind}_HOME",(Join-Path $work $kind),'Process')
    }
    $env:PANACODE_DISABLE_MODELS_FETCH = $env:OPENCODE_DISABLE_MODELS_FETCH = 'true'
    $env:HTTP_PROXY = $env:HTTPS_PROXY = $env:ALL_PROXY = 'http://127.0.0.1:1'
    $env:NO_PROXY = 'localhost,127.0.0.1,::1'
    Install-Checked $oldSetup 'r10'
    $install = (Get-ItemProperty -LiteralPath $registry -Name InstallLocation).InstallLocation
    if (!$install -or (Split-Path -Path $install -Leaf) -ne 'ai.panacode.desktop') { throw 'Unexpected registered r10 location.' }
    $oldCli = Join-Path $install 'resources/opencode-cli.exe'
    if (Test-Path (Join-Path $install '.panacode-install')) { throw 'Expected a pre-manifest installation.' }
    $foreign = 'local-file.txt'
    [IO.File]::WriteAllText((Join-Path $install $foreign),[Guid]::NewGuid().ToString())
    $kept = @{}
    $uninstallers = @(Get-ChildItem -LiteralPath $install -File -Filter 'Uninstall*.exe')
    if ($uninstallers.Count -ne 1) { throw 'Expected one historical uninstaller.' }
    foreach ($relative in 'Panacode.exe','resources/opencode-cli.exe',$uninstallers[0].Name,$foreign) {
        $kept[$relative] = (Get-FileHash -LiteralPath (Join-Path $install $relative)).Hash
    }

    # Desktop r10 staged and launched a copy of the bundled image outside the install tree,
    # explicitly passing port 28844. Launch the actual installed bytes with those same flags.
    $staged = Join-Path $work 'opencode-cli.exe'
    Copy-Item -LiteralPath $oldCli -Destination $staged
    if ((Get-FileHash -LiteralPath $staged).Hash -ne $kept['resources/opencode-cli.exe']) { throw 'Staged r10 binary changed.' }
    $ruleName = "Panacode-r10-" + [Guid]::NewGuid().ToString('N')
    $firewall = New-NetFirewallRule -Name $ruleName -DisplayName $ruleName -Program $staged -Direction Outbound -Action Block -Profile Any `
        -RemoteAddress @('0.0.0.0-126.255.255.255','128.0.0.0-255.255.255.255','::2-ffff:ffff:ffff:ffff:ffff:ffff:ffff:ffff')
    $old = Start-Process $staged -ArgumentList @('serve','--service','--hostname','127.0.0.1','--port',"$port") -WorkingDirectory $project -PassThru
    $oldFile = Join-Path $work 'STATE/panacode/service-prod.json'
    $oldConfig = Join-Path $work 'CONFIG/panacode/service-prod.json'
    $deadline = [DateTime]::UtcNow.AddSeconds(90)
    while ($true) {
        if ($old.HasExited) { throw 'The historical service stopped during startup.' }
        if ((Test-Path -LiteralPath $oldFile) -and (Test-OwnedListener $old.Id)) {
            $record = [IO.File]::ReadAllText($oldFile) | ConvertFrom-Json
            if ($record.pid -ne $old.Id -or !$record.id -or !$record.password -or $record.url.TrimEnd('/') -ne $base) {
                throw 'Unexpected historical registration.'
            }
            try {
                $health = Local-Request '/api/info' $record.password
                if ($health.pid -eq $old.Id) { break }
            } catch { if ([DateTime]::UtcNow -ge $deadline) { throw 'The historical service did not become ready.' } }
        }
        if ([DateTime]::UtcNow -ge $deadline) { throw 'The historical registration or ready service is missing.' }
        Start-Sleep -Milliseconds 400
    }
    $oldStateHash = (Get-FileHash -LiteralPath $oldFile).Hash
    $oldConfigHash = (Get-FileHash -LiteralPath $oldConfig).Hash
    $sessionTitle = 'upgrade-' + [Guid]::NewGuid().ToString('N')
    $payload = @{ title = $sessionTitle; location = @{directory = $project} } | ConvertTo-Json -Compress
    $session = (Local-Request '/api/session' $record.password $payload).data
    if (!$session.id -or $session.title -ne $sessionTitle) { throw 'Failed to seed the real historical session.' }

    Install-Checked $candidate 'Candidate'
    $newLocation = (Get-ItemProperty -LiteralPath $registry -Name InstallLocation).InstallLocation
    if ($newLocation -ne $install -or !(Test-Path -LiteralPath (Join-Path $install '.panacode-install'))) {
        throw 'Candidate did not activate over the registered r10 installation.'
    }
    $cli = Join-Path $install 'resources/panacode-cli.exe'
    foreach ($entry in $kept.GetEnumerator()) {
        if ((Get-FileHash -LiteralPath (Join-Path "$install.old" $entry.Key)).Hash -ne $entry.Value) {
            throw 'Candidate changed files from the pre-manifest installation.'
        }
    }
    if ($old.HasExited -or !(Test-OwnedListener $old.Id)) { throw 'Installation stopped the unverified r10 listener.' }
    $errFile = Join-Path $work 'conflict.err'
    $contender = Start-Process $cli -ArgumentList @('serve','--service') -RedirectStandardError $errFile -PassThru
    try {
        if (!$contender.WaitForExit(60000)) { $contender.Kill(); throw 'The port conflict exceeded its deadline.' }
        if ($contender.ExitCode -eq 0 -or !(Select-String -LiteralPath $errFile -Pattern '28844.*already in use' -Quiet)) {
            throw 'The candidate failed to report the actual r10 port conflict.'
        }
    } finally { $contender.Dispose() }
    if ($old.HasExited -or !(Test-OwnedListener $old.Id) -or (Local-Request '/api/info' $record.password).pid -ne $old.Id) {
        throw 'Candidate contacted or displaced the historical listener.'
    }
    $newFile = Join-Path $work 'STATE/panacode/service.json'
    if ((Test-Path -LiteralPath $newFile) -or (Get-FileHash -LiteralPath $oldFile).Hash -ne $oldStateHash) {
        throw 'The ambiguous registration was replaced or promoted.'
    }
    Write-Host 'The historical service and unverified registration survived installation and the bounded port conflict.'

    # Only this explicitly started disposable child is terminated, leaving an authentic stale r10 record.
    $old.Kill()
    if (!$old.WaitForExit(10000)) { throw 'The historical fixture did not exit.' }
    $desktop = Start-Process (Join-Path $install 'Panacode.exe') -PassThru
    $deadline = [DateTime]::UtcNow.AddSeconds(150)
    while ($true) {
        if ($desktop.HasExited) { throw 'Upgraded desktop exited before the session was recovered.' }
        if (Test-Path -LiteralPath $newFile) {
            $output = & $cli service status --connection-json
            if ($LASTEXITCODE -eq 0 -and $output) {
                $current = $output | ConvertFrom-Json
                if ($current.product -ne 'panacode' -or !$current.id -or $current.id -eq $record.id -or
                    $current.url.TrimEnd('/') -ne $base -or $current.password -cne $record.password -or
                    !(Test-OwnedListener $current.pid)) { throw 'Upgraded service identity or migrated credential is incorrect.' }
                $sessionID = [Uri]::EscapeDataString($session.id)
                try {
                    $recovered = (Local-Request "/api/session/$sessionID" $current.password).data
                    if ($recovered.id -eq $session.id -and $recovered.title -ceq $sessionTitle) { break }
                } catch { if ([DateTime]::UtcNow -ge $deadline) { throw 'The historical session was not recovered.' } }
            }
        }
        if ([DateTime]::UtcNow -ge $deadline) { throw 'The installed desktop did not recover the r10 session in time.' }
        Start-Sleep -Milliseconds 500
    }
    if ((Get-FileHash -LiteralPath $oldConfig).Hash -ne $oldConfigHash -or (Get-FileHash -LiteralPath $oldFile).Hash -ne $oldStateHash) {
        throw 'A legacy registration or configuration was mutated.'
    }
    Write-Host 'The installed candidate recovered the genuine r10 session and password with a fresh verified service.'
} finally {
    try {
        if ($desktop) {
            if (!$desktop.HasExited) {
                $null = $desktop.CloseMainWindow()
                if (!$desktop.WaitForExit(5000)) { $desktop.Kill(); $null = $desktop.WaitForExit(5000) }
            }
            $desktop.Dispose()
        }
        if ($cli -and (Test-Path -LiteralPath $cli) -and $old -and $old.HasExited) { & $cli service stop | Out-Null }
        if ($old) {
            if (!$old.HasExited) { $old.Kill(); $null = $old.WaitForExit(5000) }
            $old.Dispose()
        }
    } finally {
        if ($firewall) { Remove-NetFirewallRule -Name $ruleName }
    }
}
# Keep the historical backup and registry intact on this ephemeral VM. Never invoke its uninstaller.
