# Used by the dual-install job on a disposable Windows runner. The ordinary zero-based
# native PTY identifiers can overlap between applications; bind every check to its session and PID.
function New-TerminalWitness([string]$Name, $Session) {
    $connection = Read-Health $records[$Name].Product -Connection
    $marker = 'PTY_' + [Guid]::NewGuid().ToString('N')
    $project = Join-Path $root 'shared-project'
    $body = @{
        command=(Join-Path $env:SystemRoot 'System32/cmd.exe')
        args=@('/D','/Q','/K',('echo ' + $marker))
        title=$marker
        cwd=$project
        env=@{}
        size=@{ cols=100; rows=24 }
    } | ConvertTo-Json -Depth 4 -Compress
    $route = '/api/experimental/session/' + [Uri]::EscapeDataString($Session.ID) + '/terminal'
    $created = (Invoke-LocalRequest $connection $route 200 $body).data
    if (!$created.id -or $created.sessionID -cne $Session.ID -or $created.pid -le 0 -or $created.status -ne 'running') {
        throw "$Name did not start the expected fixture terminal."
    }
    return [pscustomobject]@{ Owner=$Name; Session=$Session.ID; ID=$created.id; ProcessId=$created.pid; Marker=$marker }
}

function Assert-TerminalWitness($Witness, $Other) {
    $connection = Read-Health $records[$Witness.Owner].Product -Connection
    $route = '/api/experimental/persistent-pty/' + [Uri]::EscapeDataString($Witness.ID) + '/snapshot'
    $deadline = [DateTime]::UtcNow.AddSeconds(20)
    do {
        $screen = (Invoke-LocalRequest $connection $route).data
        if ($screen.info.id -cne $Witness.ID -or $screen.info.pid -ne $Witness.ProcessId -or
            $screen.info.sessionID -cne $Witness.Session -or $screen.info.status -ne 'running') {
            throw 'Terminal identity changed before its screen could be read.'
        }
        if ($screen.text -and $screen.text.Contains($Witness.Marker)) { break }
        Start-Sleep -Milliseconds 250
    } while ([DateTime]::UtcNow -lt $deadline)
    if (!$screen.text -or !$screen.text.Contains($Witness.Marker)) { throw 'Missing terminal output marker.' }
    if ($Other) {
        if ($screen.text.Contains($Other.Marker)) { throw 'A terminal screen included output from the other product.' }
        # The session-scoped native list filters by group ID; the other application's unique group must be empty.
        $foreignRoute = '/api/experimental/session/' + [Uri]::EscapeDataString($Other.Session) + '/terminal'
        $foreignList = Invoke-LocalRequest $connection $foreignRoute
        if ($null -eq $foreignList.data -or @($foreignList.data).Count -ne 0) { throw 'Foreign session terminals were visible.' }
    }
}

function Remove-TerminalWitness($Witness) {
    $connection = Read-Health $records[$Witness.Owner].Product -Connection
    $route = '/api/experimental/persistent-pty/' + [Uri]::EscapeDataString($Witness.ID)
    $current = (Invoke-LocalRequest $connection $route).data
    if ($current.sessionID -cne $Witness.Session -or $current.id -cne $Witness.ID -or $current.pid -ne $Witness.ProcessId) {
        throw 'The fixture terminal changed before cleanup.'
    }
    Invoke-LocalRequest $connection $route 204 -Remove
}

function Read-UserPathBytes {
    # RegistryKey.GetValue may expand variables and normalize a string's terminator. Compare the
    # actual HKCU type and bytes, including the difference between a missing and an empty value.
    if (!('DualDesktopRegistry' -as [type])) {
        Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;
public static class DualDesktopRegistry {
    [DllImport("advapi32.dll", CharSet=CharSet.Unicode, ExactSpelling=true)]
    public static extern int RegQueryValueExW(SafeRegistryHandle key, string name, IntPtr reserved,
        out uint type, [Out] byte[] data, ref uint size);
}
'@
    }
    $key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Environment')
    if (!$key) { return 'missing' }
    try {
        [uint32]$bytes = 0
        [uint32]$kind = 0
        $result = [DualDesktopRegistry]::RegQueryValueExW($key.Handle, 'Path', [IntPtr]::Zero, [ref]$kind, $null, [ref]$bytes)
        if ($result -eq 2) { return 'missing' }
        if ($result -ne 0) { throw 'Cannot read the user PATH registry type and length.' }
        $data = [byte[]]::new($bytes)
        $result = [DualDesktopRegistry]::RegQueryValueExW($key.Handle, 'Path', [IntPtr]::Zero, [ref]$kind, $data, [ref]$bytes)
        if ($result -ne 0) { throw 'Cannot read the user PATH registry bytes.' }
        return ([string]$kind + '/' + [Convert]::ToBase64String($data, 0, $bytes))
    } finally { $key.Dispose() }
}
