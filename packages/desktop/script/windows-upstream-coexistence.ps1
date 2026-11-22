# Runs a pinned portable peer against the same XDG base directories on a disposable runner.
param([Parameter(Mandatory)][string]$Installer)
$ErrorActionPreference = 'Stop'
if (!$IsWindows -or $env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_ENVIRONMENT -ne 'github-hosted') {
    throw 'The coexistence smoke requires a GitHub-hosted Windows runner.'
}
$installerPath = (Resolve-Path -LiteralPath $Installer).Path
$root = Join-Path $env:RUNNER_TEMP ("upstream-peer-" + [Guid]::NewGuid().ToString('N'))
$version = '2.3.2'
# digest from the publisher's releases/tags/v2.3.2 metadata for this exact archive
$sha256 = '8ad59f1992a0594d8bd72b5ed3be1f5bfffcd9d1756853eec7e5d3141c25be1f'
$url = "https://github.com/anomalyco/opencode/releases/download/v$version/opencode-windows-x64.zip"
$port = 28894 # upstream v2 stable managed Windows service default
$stateFile = Join-Path $root 'STATE/opencode/service.json'
$configFile = Join-Path $root 'CONFIG/opencode/service.json'
$db = Join-Path $root 'DATA/opencode/opencode.db'

function Assert-UpstreamPeer {
    if ($peer.HasExited) { throw 'The portable upstream process stopped.' }
    $listeners = @(Get-NetTCPConnection -State Listen -LocalPort $port -LocalAddress '127.0.0.1' -ErrorAction SilentlyContinue)
    if ($listeners.Count -ne 1 -or $listeners[0].OwningProcess -ne $peer.Id) {
        throw 'The original upstream PID no longer owns its loopback endpoint.'
    }
    foreach ($entry in $witnesses.GetEnumerator()) {
        if (!(Test-Path -LiteralPath $entry.Key -PathType Leaf) -or
            (Get-FileHash -LiteralPath $entry.Key -Algorithm SHA256).Hash -ne $entry.Value) {
            throw ('An upstream witness changed: ' + [IO.Path]::GetFileName($entry.Key))
        }
    }
    if (!(Test-Path -LiteralPath $db -PathType Leaf)) { throw 'The real upstream database disappeared.' }
    $result = $http.GetAsync("http://127.0.0.1:$port/api/info").GetAwaiter().GetResult()
    try {
        if ([int]$result.StatusCode -ne 200) { throw 'The upstream service is not ready.' }
        $info = $result.Content.ReadAsStringAsync().GetAwaiter().GetResult() | ConvertFrom-Json
        if ($info.version -ne $version -or $info.pid -ne $peer.Id) { throw 'Upstream health returned the wrong version or PID.' }
    } finally { $result.Dispose() }
}

New-Item -ItemType Directory -Path $root | Out-Null
$peer = $null
$http = $null
$rule = $null
try {
    $zip = Join-Path $root 'release.zip'
    Invoke-WebRequest -Uri $url -OutFile $zip -TimeoutSec 100 -MaximumRetryCount 1
    if ((Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash -ne $sha256) { throw 'Upstream release SHA-256 mismatch.' }
    $bin = Join-Path $root 'portable'
    Expand-Archive -LiteralPath $zip -DestinationPath $bin
    $executables = @(Get-ChildItem -LiteralPath $bin -Filter 'opencode.exe' -Recurse -File)
    if ($executables.Count -ne 1) { throw 'Expected one upstream executable in the pinned archive.' }
    $exe = $executables[0].FullName

    # The peer only serves incoming loopback requests. Block outbound connections to all
    # non-loopback addresses for this image and supply a dead HTTP proxy in its clean environment.
    $ruleName = "Panacode-peer-" + [Guid]::NewGuid().ToString('N')
    $rule = New-NetFirewallRule -Name $ruleName -DisplayName $ruleName -Program $exe -Direction Outbound -Action Block -Profile Any `
        -RemoteAddress @('0.0.0.0-126.255.255.255','128.0.0.0-255.255.255.255','::2-ffff:ffff:ffff:ffff:ffff:ffff:ffff:ffff')
    $psi = [Diagnostics.ProcessStartInfo]::new()
    $psi.FileName = $exe
    $psi.UseShellExecute = $false
    $psi.Environment.Clear()
    foreach ($key in 'SystemRoot','WINDIR','ComSpec','PATH','PATHEXT','PROCESSOR_ARCHITECTURE','NUMBER_OF_PROCESSORS','ProgramFiles','ProgramFiles(x86)','ProgramData') {
        $value = [Environment]::GetEnvironmentVariable($key)
        if ($value) { $psi.Environment[$key] = $value }
    }
    foreach ($kind in 'DATA','CONFIG','CACHE','STATE') {
        $dir = Join-Path $root $kind
        New-Item -ItemType Directory -Path (Join-Path $dir 'opencode') | Out-Null
        $psi.Environment["XDG_${kind}_HOME"] = $dir
    }
    foreach ($key in 'TEMP','TMP','APPDATA','LOCALAPPDATA','USERPROFILE','HOME','OPENCODE_TEST_HOME') {
        $dir = Join-Path $root $(if ($key -in 'HOME','USERPROFILE','OPENCODE_TEST_HOME') { 'home' } elseif ($key -in 'TEMP','TMP') { 'tmp' } else { $key })
        [IO.Directory]::CreateDirectory($dir) | Out-Null
        $psi.Environment[$key] = $dir
    }
    $psi.WorkingDirectory = $psi.Environment['HOME']
    $psi.Environment['OPENCODE_DISABLE_MODELS_FETCH'] = 'true'
    $psi.Environment['OPENCODE_CONFIG_PROJECT_DISABLE'] = 'true'
    $psi.Environment['HTTP_PROXY'] = $psi.Environment['HTTPS_PROXY'] = $psi.Environment['ALL_PROXY'] = 'http://127.0.0.1:1'
    $psi.Environment['NO_PROXY'] = 'localhost,127.0.0.1,::1'
    foreach ($arg in 'serve','--service','--hostname','127.0.0.1') { $psi.ArgumentList.Add($arg) }

    # The key authenticates only a disposable per-run peer; never write it to the CI log.
    $secret = [Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(32))
    [IO.File]::WriteAllText($configFile,(@{password=$secret}|ConvertTo-Json -Compress))
    $witnesses = @{}
    foreach ($kind in 'DATA','CONFIG','CACHE','STATE') {
        $file = Join-Path $root "$kind/opencode/coexistence-witness.txt"
        [IO.File]::WriteAllText($file,[Guid]::NewGuid().ToString())
        $witnesses[$file] = (Get-FileHash -LiteralPath $file).Hash
    }
    $witnesses[$configFile] = (Get-FileHash -LiteralPath $configFile).Hash
    $handler = [Net.Http.HttpClientHandler]::new()
    $handler.UseProxy = $false
    $handler.AllowAutoRedirect = $false
    $http = [Net.Http.HttpClient]::new($handler)
    $http.Timeout = [TimeSpan]::FromSeconds(4)
    $credential = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes("opencode:$secret"))
    $http.DefaultRequestHeaders.Authorization = [Net.Http.Headers.AuthenticationHeaderValue]::new('Basic',$credential)
    $peer = [Diagnostics.Process]::Start($psi)
    $deadline = [DateTime]::UtcNow.AddSeconds(90)
    while ($true) {
        if ($peer.HasExited) { throw 'Portable upstream exited during startup.' }
        if (Test-Path -LiteralPath $stateFile -PathType Leaf) {
            $record = [IO.File]::ReadAllText($stateFile) | ConvertFrom-Json
            if ($record.pid -ne $peer.Id -or !$record.id -or $record.version -ne $version -or
                $record.password -cne $secret -or $record.url.TrimEnd('/') -cne "http://127.0.0.1:$port") {
                throw 'Unexpected upstream managed registration.'
            }
            try { Assert-UpstreamPeer; break } catch {
                if ([DateTime]::UtcNow -ge $deadline) { throw }
            }
        }
        if ([DateTime]::UtcNow -ge $deadline) { throw 'Portable upstream readiness deadline expired.' }
        Start-Sleep -Milliseconds 400
    }
    $witnesses[$stateFile] = (Get-FileHash -LiteralPath $stateFile).Hash
    # The live database can legitimately change during housekeeping. Keep byte witnesses for
    # inactive legacy credentials and configuration and check the live database exists each time.
    foreach ($relative in 'DATA/opencode/auth.json','CONFIG/opencode/opencode.json') {
        $file = Join-Path $root $relative
        if (!(Test-Path -LiteralPath $file)) { [IO.File]::WriteAllText($file,"{}`n") }
        $witnesses[$file] = (Get-FileHash -LiteralPath $file).Hash
    }
    Assert-UpstreamPeer
    Write-Host "Official portable OpenCode $version is ready on its default Windows port."
    & "$PSScriptRoot/windows-installed-smoke.ps1" -Installer $installerPath -SharedXdgRoot $root -CheckPeer { Assert-UpstreamPeer }
    Assert-UpstreamPeer
    Write-Host 'The same upstream process, endpoint and private witnesses survived the installed Panacode smoke.'
} finally {
    try {
        if ($peer) {
            try {
                if (!$peer.HasExited) {
                    $peer.Kill()
                    if (!$peer.WaitForExit(10000)) { throw 'The disposable portable process did not exit.' }
                }
            } finally { $peer.Dispose() }
        }
    } finally {
        if ($http) { $http.Dispose() }
        if ($rule) { Remove-NetFirewallRule -Name $ruleName }
        Remove-Item -LiteralPath $root -Force -Recurse
    }
}
