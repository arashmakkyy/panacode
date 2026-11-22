# Invoke each install order on a fresh GitHub-hosted Windows x64 runner.
param(
    [Parameter(Mandatory)][string]$Installer,
    [Parameter(Mandatory)][ValidateSet('OpenCodeFirst','PanacodeFirst')][string]$Order
)
$ErrorActionPreference = 'Stop'
if (!$IsWindows -or $env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_ENVIRONMENT -ne 'github-hosted') {
    throw 'The dual desktop acceptance check requires a disposable GitHub-hosted Windows runner.'
}
$upstreamVersion = '2.3.2'
# GitHub immutable release asset, GET /repos/anomalyco/opencode/releases/tags/v2.3.2
$upstreamDigest = '1e73b4f49f591971f4ad61c5a39b284bf74d41f50ca1b84e68ccf2ab2be91e8d'
$root = Join-Path $env:RUNNER_TEMP ('dual-desktop-' + [Guid]::NewGuid().ToString('N'))
# OpenCode 2.3.2 discards XDG_STATE_HOME in its Windows GUI startup. Use its genuine default
# for both products on this fresh runner, so the tested state directories share their parent.
$stateBase = Join-Path ([Environment]::GetFolderPath('UserProfile')) '.local/state'
$builds = @{ Panacode = (Resolve-Path -LiteralPath $Installer).Path; OpenCode = (Join-Path $root 'upstream.exe') }
$records = @{}
$windows = @{}
$rules = [Collections.Generic.List[string]]::new()
$shell = New-Object -ComObject WScript.Shell
$handler = [Net.Http.HttpClientHandler]::new()
$handler.UseProxy = $false
$handler.AllowAutoRedirect = $false
$http = [Net.Http.HttpClient]::new($handler)
$http.Timeout = [TimeSpan]::FromSeconds(4)

function Get-UninstallRow([string]$Name) {
    $bases = @('HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall',
               'HKCU:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall')
    $found = @(foreach ($base in $bases) {
        if (Test-Path $base) {
            foreach ($key in Get-ChildItem $base) {
                $row = Get-ItemProperty -LiteralPath $key.PSPath
                if ($row.DisplayName -match ('^' + [regex]::Escape($Name) + '( [0-9][^ ]*)?$')) { $row }
            }
        }
    })
    if ($found.Count -gt 1) { throw "More than one $Name uninstall registration exists." }
    if ($found.Count -eq 1) { return $found[0] }
}

function Get-Install([string]$Name) {
    $row = Get-UninstallRow $Name
    if (!$row -or $row.UninstallString -notmatch '^"([^"]+\.exe)"(?: |$)') {
        throw "Missing registered $Name uninstaller."
    }
    $uninstaller = (Resolve-Path -LiteralPath $Matches[1]).Path
    $directory = Split-Path -Parent $uninstaller
    $exe = (Resolve-Path -LiteralPath (Join-Path $directory "$Name.exe")).Path
    if ((Split-Path -Leaf $uninstaller) -ne "Uninstall $Name.exe" -or
        !($directory + '\').StartsWith($env:LOCALAPPDATA + '\', [StringComparison]::OrdinalIgnoreCase)) {
        throw "Unexpected $Name installation."
    }
    if ($Name -eq 'OpenCode' -and $row.DisplayVersion -ne $upstreamVersion) { throw 'Unexpected upstream desktop version.' }
    $sidecar = $Name.ToLowerInvariant() + '-cli'
    $cli = (Resolve-Path -LiteralPath (Join-Path $directory "resources/$sidecar.exe")).Path
    $cliVersion = [IO.File]::ReadAllText((Join-Path $directory "resources/$sidecar.version")).Trim()
    if (!$cliVersion) { throw 'The bundled CLI has no version.' }
    return [pscustomobject]@{ Name=$Name; Directory=$directory; Exe=$exe; Uninstaller=$uninstaller; Row=$row; Cli=$cli; CliVersion=$cliVersion; CliDigest=(Get-FileHash -LiteralPath $cli).Hash }
}

function Read-ShellState($Product) {
    $row = Get-UninstallRow $Product.Name
    $state = [ordered]@{ Key=$row.PSPath; Command=$row.UninstallString; Quiet=$row.QuietUninstallString; Version=$row.DisplayVersion }
    $scheme = $Product.Name.ToLowerInvariant()
    $key = Get-Item "HKCU:\Software\Classes\$scheme"
    $command = (Get-Item "HKCU:\Software\Classes\$scheme\shell\open\command").GetValue('')
    if ($key.GetValueNames() -notcontains 'URL Protocol' -or
        $command -notmatch ('^"' + [regex]::Escape($Product.Exe) + '"\s+.*%1')) {
        throw "$scheme links do not target the installed executable."
    }
    $state.Protocol = $command
    $links = @()
    foreach ($folder in 'Programs','DesktopDirectory') {
        $base = [Environment]::GetFolderPath($folder)
        foreach ($link in Get-ChildItem -LiteralPath $base -Recurse -Filter ($Product.Name + '.lnk') -File) {
            $target = $shell.CreateShortcut($link.FullName)
            if ($target.TargetPath -ne $Product.Exe) { throw "Unexpected $scheme shortcut destination." }
            $links += [ordered]@{ Path=$link.FullName; Target=$target.TargetPath; Args=$target.Arguments }
        }
    }
    if (!($links | Where-Object { $_.Path.StartsWith([Environment]::GetFolderPath('Programs') + '\', [StringComparison]::OrdinalIgnoreCase) })) {
        throw "Missing $scheme Start Menu shortcut."
    }
    $state.Links = @($links | Sort-Object { $_.Path })
    return ($state | ConvertTo-Json -Depth 5 -Compress)
}

function Invoke-OwnedCli($Product, [string[]]$Command) {
    $start = [Diagnostics.ProcessStartInfo]::new()
    $start.FileName = $Product.Cli
    $start.UseShellExecute = $false
    $start.RedirectStandardOutput = $true
    $start.RedirectStandardError = $true
    foreach ($arg in $Command) { $start.ArgumentList.Add($arg) }
    $proc = [Diagnostics.Process]::Start($start)
    try {
        $output = $proc.StandardOutput.ReadToEndAsync()
        $errors = $proc.StandardError.ReadToEndAsync()
        if (!$proc.WaitForExit(20000)) { $proc.Kill(); throw 'Installed Panacode CLI timed out.' }
        if ($proc.ExitCode -ne 0) { throw 'Installed Panacode CLI service check failed.' }
        $null = $errors.GetAwaiter().GetResult()
        return $output.GetAwaiter().GetResult()
    } finally { $proc.Dispose() }
}

function Invoke-LocalRequest($Record, [string]$Route, [int]$Expected = 200, [string]$Body) {
    $method = if ($Body) { [Net.Http.HttpMethod]::Post } else { [Net.Http.HttpMethod]::Get }
    $request = [Net.Http.HttpRequestMessage]::new($method, ($Record.url.TrimEnd('/') + $Route))
    $auth = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes('opencode:' + $Record.password))
    $request.Headers.Authorization = [Net.Http.Headers.AuthenticationHeaderValue]::new('Basic', $auth)
    if ($Body) { $request.Content = [Net.Http.StringContent]::new($Body, [Text.Encoding]::UTF8, 'application/json') }
    try {
        $reply = $http.SendAsync($request).GetAwaiter().GetResult()
        try {
            if ([int]$reply.StatusCode -ne $Expected) { throw "Expected HTTP $Expected, got $([int]$reply.StatusCode)." }
            return ($reply.Content.ReadAsStringAsync().GetAwaiter().GetResult() | ConvertFrom-Json)
        } finally { $reply.Dispose() }
    } finally { $request.Dispose() }
}

function Read-Health($Product, [switch]$Connection) {
    $name = $Product.Name.ToLowerInvariant()
    $port = if ($name -eq 'opencode') { 28894 } else { 28844 }
    $record = Get-Content -Raw -LiteralPath (Join-Path $stateBase "$name/service.json") | ConvertFrom-Json
    if (!$record.id -or !$record.password -or $record.pid -le 0 -or $record.version -ne $Product.CliVersion -or
        $record.url.TrimEnd('/') -cne "http://127.0.0.1:$port") { throw "$name service registration is unexpected." }
    $socket = @(Get-NetTCPConnection -State Listen -LocalPort $port -LocalAddress '127.0.0.1' -ErrorAction SilentlyContinue)
    if ($socket.Count -ne 1 -or $socket[0].OwningProcess -ne $record.pid) { throw "$name listener has another owner." }
    if ($name -eq 'panacode') {
        $private = Invoke-OwnedCli $Product @('service','status','--connection-json')
        if (!$private) { throw 'The installed Panacode CLI could not prove its service.' }
        $identity = $private | ConvertFrom-Json
        if ($identity.product -ne $name -or !$identity.proofKey -or $identity.id -cne $record.id -or
            $identity.pid -ne $record.pid -or $identity.version -ne $Product.CliVersion -or
            $identity.url -cne $record.url -or $identity.password -cne $record.password) {
            throw 'The installed Panacode CLI returned another service.'
        }
        if ($Connection) { return $identity }
        return "$($record.id)/$($record.pid)"
    }
    $image = (Get-Process -Id $record.pid).Path
    $stage = Join-Path $env:APPDATA 'ai.opencode.desktop/cli'
    if ((Split-Path -Leaf $image) -ne 'opencode-cli.exe' -or
        ($image -ne $Product.Cli -and !$image.StartsWith($stage + '\', [StringComparison]::OrdinalIgnoreCase)) -or
        (Get-FileHash -LiteralPath $image).Hash -ne $Product.CliDigest) { throw 'The upstream listener does not run the bundled CLI.' }
    $info = Invoke-LocalRequest $record '/api/info'
    if ($info.pid -ne $record.pid -or $info.version -ne $record.version) { throw "$name HTTP identity mismatch." }
    if ($Connection) { return $record }
    return "$($record.id)/$($record.pid)"
}

function New-SessionWitness([string]$Name) {
    $connection = Read-Health $records[$Name].Product -Connection
    $title = $Name + '-offline-' + [Guid]::NewGuid().ToString('N')
    $body = @{ title=$title; location=@{ directory=(Join-Path $root 'shared-project') } } | ConvertTo-Json -Compress
    $session = (Invoke-LocalRequest $connection '/api/session' 200 $body).data
    if (!$session.id -or $session.title -cne $title) { throw "Failed to create the $Name offline session." }
    return [pscustomobject]@{ ID=$session.id; Title=$title; Owner=$Name }
}

function Assert-SessionWitness([string]$Name, $Witness) {
    $connection = Read-Health $records[$Name].Product -Connection
    $route = '/api/session/' + [Uri]::EscapeDataString($Witness.ID)
    if ($Name -eq $Witness.Owner) {
        $session = (Invoke-LocalRequest $connection $route).data
        if ($session.id -cne $Witness.ID -or $session.title -cne $Witness.Title) { throw "$Name lost its session." }
    } else {
        $missing = Invoke-LocalRequest $connection $route 404
        if ($missing._tag -cne 'SessionNotFoundError' -or $missing.sessionID -cne $Witness.ID) {
            throw "$Name returned an unexpected result for the other product's session."
        }
    }
}

function Start-Desktop($Product) {
    $runner = [Diagnostics.ProcessStartInfo]::new()
    $runner.FileName = $Product.Exe
    $runner.UseShellExecute = $false
    $runner.Environment.Clear()
    foreach ($entry in 'SystemRoot','WINDIR','ComSpec','PATH','PATHEXT','PROCESSOR_ARCHITECTURE','NUMBER_OF_PROCESSORS',
        'ProgramFiles','ProgramFiles(x86)','ProgramData','APPDATA','LOCALAPPDATA','USERPROFILE','HOMEDRIVE','HOMEPATH','TEMP','TMP') {
        $value = [Environment]::GetEnvironmentVariable($entry)
        if ($value) { $runner.Environment[$entry] = $value }
    }
    foreach ($kind in 'DATA','CONFIG','CACHE') { $runner.Environment["XDG_${kind}_HOME"] = Join-Path $root $kind }
    $runner.Environment['XDG_STATE_HOME'] = $stateBase
    $prefix = $Product.Name.ToUpperInvariant()
    $runner.Environment[$prefix + '_DISABLE_MODELS_FETCH'] = '1'
    $runner.Environment[$prefix + '_DISABLE_AUTOUPDATE'] = '1'
    $runner.Environment['NO_PROXY'] = 'localhost,127.0.0.1,::1'
    $runner.WorkingDirectory = $Product.Directory
    $proc = [Diagnostics.Process]::Start($runner)
    $windows[$Product.Name] = $proc
    $watch = [Diagnostics.Stopwatch]::StartNew()
    $stage = 'window'
    while ($watch.Elapsed.TotalSeconds -lt 180) {
        $proc.Refresh()
        if ($proc.HasExited) { throw "$($Product.Name) desktop exited before readiness." }
        if ($proc.MainWindowHandle -ne [IntPtr]::Zero -and $proc.Responding) {
            $stage = 'service'
            try { return (Read-Health $Product) } catch { }
        }
        Start-Sleep -Milliseconds 600
    }
    throw "Timed out waiting for $($Product.Name) $stage."
}

function Check-Desktop([string]$Name) {
    $view = $records[$Name]
    $proc = $windows[$Name]
    $proc.Refresh()
    if ($proc.HasExited -or $proc.MainModule.FileName -ne $view.Product.Exe -or
        $proc.MainWindowHandle -eq [IntPtr]::Zero -or !$proc.Responding) { throw "$Name desktop was replaced or stopped." }
    if ((Read-Health $view.Product) -ne $view.Health -or (Read-ShellState $view.Product) -cne $view.Shell) {
        throw "$Name service, registration, protocol or shortcuts changed."
    }
    foreach ($pair in $view.Files.GetEnumerator()) {
        if (!(Test-Path -LiteralPath $pair.Key -PathType Leaf) -or
            (Get-FileHash -LiteralPath $pair.Key).Hash -ne $pair.Value) { throw "$Name owned files or cache changed." }
    }
}

function Install-Desktop([string]$Name) {
    $setup = Start-Process -FilePath $builds[$Name] -ArgumentList '/S' -PassThru
    if (!$setup.WaitForExit(240000) -or $setup.ExitCode -ne 0) { throw "$Name silent installation failed." }
    $product = Get-Install $Name
    if ($Name -eq 'OpenCode') {
        # The pinned peer must stay on its installed build while its live GUI does its normal update check.
        $ruleName = 'Panacode-dual-' + [Guid]::NewGuid().ToString('N')
        $null = New-NetFirewallRule -Name $ruleName -DisplayName $ruleName -Program $product.Exe -Direction Outbound -Action Block -Profile Any `
            -RemoteAddress @('0.0.0.0-126.255.255.255','128.0.0.0-255.255.255.255','::2-ffff:ffff:ffff:ffff:ffff:ffff:ffff:ffff')
        $rules.Add($ruleName)
    }
    $health = Start-Desktop $product
    $files = @{}
    foreach ($file in @($product.Exe,$product.Uninstaller,(Join-Path $product.Directory 'resources/app.asar'))) {
        $files[$file] = (Get-FileHash -LiteralPath $file).Hash
    }
    if ($Name -eq 'OpenCode') {
        $metadata = Join-Path $product.Directory 'resources/app-update.yml'
        $files[$metadata] = (Get-FileHash -LiteralPath $metadata).Hash
        $match = [regex]::Match([IO.File]::ReadAllText($metadata), '(?m)^updaterCacheDirName:\s*[''"]?([a-zA-Z0-9_.@-]+)[''"]?\s*$')
        if (!$match.Success) { throw 'Missing upstream updater cache identity.' }
        $cache = Join-Path $env:LOCALAPPDATA $match.Groups[1].Value
        $file = Join-Path $cache 'installer.exe'
        if ((Get-FileHash -LiteralPath $file).Hash -ne $upstreamDigest) { throw 'The upstream cached installer is missing or changed.' }
        $files[$file] = $upstreamDigest
        $marker = Join-Path $cache ('acceptance-' + [Guid]::NewGuid().ToString('N') + '.txt')
        [IO.File]::WriteAllText($marker, 'upstream updater cache witness')
        $files[$marker] = (Get-FileHash -LiteralPath $marker).Hash
    }
    $records[$Name] = @{Product=$product; Health=$health; Shell=(Read-ShellState $product); Files=$files}
}

try {
    foreach ($name in 'OpenCode','Panacode') { if (Get-UninstallRow $name) { throw 'Expected a fresh runner.' } }
    $null = New-Item -ItemType Directory -Path $root
    $null = New-Item -ItemType Directory -Path (Join-Path $root 'shared-project')
    foreach ($kind in 'DATA','CONFIG','CACHE') { [Environment]::SetEnvironmentVariable("XDG_${kind}_HOME", (Join-Path $root $kind), 'Process') }
    $env:XDG_STATE_HOME = $stateBase
    Invoke-WebRequest -Uri "https://github.com/anomalyco/opencode/releases/download/v$upstreamVersion/opencode-desktop-win-x64.exe" `
        -OutFile $builds.OpenCode -TimeoutSec 180 -MaximumRetryCount 1
    if ((Get-FileHash -LiteralPath $builds.OpenCode).Hash -ne $upstreamDigest) { throw 'Upstream installer SHA-256 mismatch.' }
    $sequence = if ($Order -eq 'OpenCodeFirst') { 'OpenCode','Panacode' } else { 'Panacode','OpenCode' }
    Install-Desktop $sequence[0]
    $sessions = @{}
    $sessions[$sequence[0]] = New-SessionWitness $sequence[0]
    Install-Desktop $sequence[1]
    $sessions[$sequence[1]] = New-SessionWitness $sequence[1]
    if ($sessions.Panacode.ID -ceq $sessions.OpenCode.ID) { throw 'The session fixtures unexpectedly share an ID.' }
    foreach ($name in $sequence) {
        foreach ($session in $sessions.Values) { Assert-SessionWitness $name $session }
    }
    Check-Desktop 'OpenCode'
    Check-Desktop 'Panacode'
    $ours = $records.Panacode.Product
    if ($ours.Directory -eq $records.OpenCode.Product.Directory) { throw 'The two installations share an install directory.' }
    $target = $windows.Panacode
    $null = $target.CloseMainWindow()
    if (!$target.WaitForExit(15000)) { $target.Kill(); if (!$target.WaitForExit(5000)) { throw 'Panacode did not close before uninstall.' } }
    # Use the same XDG state as the desktop; stop goes through the installed CLI's ownership proof.
    $null = Invoke-OwnedCli $ours @('service','stop')
    $installKey = 'HKCU:\Software\' + $ours.Row.PSChildName
    $installed = Get-ItemProperty -LiteralPath $installKey
    $receipt = @($installed.PanacodeInstallReceipt -split '/', 3)
    $manifest = Join-Path $ours.Directory '.panacode-install'
    if ($installed.InstallLocation -ne $ours.Directory -or $receipt.Count -ne 3 -or
        $receipt[0] -ne (Get-FileHash -LiteralPath $manifest).Hash -or
        $receipt[1] -ne (Get-FileHash -LiteralPath $ours.Uninstaller).Hash -or
        (Get-FileHash -LiteralPath $ours.Exe).Hash -ne $records.Panacode.Files[$ours.Exe]) {
        throw 'Panacode registered uninstaller, executable or ownership receipt changed.'
    }
    $uninstall = Start-Process -FilePath $ours.Uninstaller -ArgumentList '/S /currentuser' -PassThru
    if (!$uninstall.WaitForExit(180000) -or $uninstall.ExitCode -ne 0) { throw 'Panacode uninstall failed.' }
    # The registered uninstaller hands off to a temporary child; registry cleanup follows file removal.
    $ownedPaths = @($ours.Exe, $ours.Cli, $ours.Uninstaller, $manifest, $installKey, $ours.Row.PSPath)
    $deadline = [DateTime]::UtcNow.AddSeconds(90)
    do {
        $remaining = @($ownedPaths | Where-Object { Test-Path -LiteralPath $_ })
        if ($remaining.Count -eq 0) { break }
        Start-Sleep -Milliseconds 500
    } while ([DateTime]::UtcNow -lt $deadline)
    if ($remaining.Count) { throw ('Panacode uninstall left: ' + ($remaining -join ', ')) }
    if (Get-UninstallRow 'Panacode') { throw 'A Panacode uninstall registration remains.' }
    Check-Desktop 'OpenCode'
    Assert-SessionWitness 'OpenCode' $sessions.OpenCode
    Write-Host "$Order passed with both desktop windows and isolated sessions; the original upstream GUI, session, registry, shortcuts and cache survived Panacode uninstall."
} finally {
    foreach ($proc in $windows.Values) {
        if (!$proc.HasExited) { $null = $proc.CloseMainWindow(); if (!$proc.WaitForExit(5000)) { $proc.Kill() } }
        $proc.Dispose()
    }
    foreach ($rule in $rules) { Remove-NetFirewallRule -Name $rule }
    $http.Dispose()
    # Leave the genuine upstream installation on this ephemeral runner; never run its uninstaller from a discovered string.
}
