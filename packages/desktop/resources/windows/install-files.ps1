# Operates only on entries of a manifest pinned by the installer or its product-specific receipt.
param(
    [Parameter(Mandatory)][ValidateSet('Stage', 'Remove', 'Image', 'DeleteAppData')][string]$Action,
    [Parameter(Mandatory)][string]$Root,
    [Parameter(Mandatory)][string]$Pin,
    [Parameter(Mandatory)][string]$AppId,
    [Parameter(Mandatory)][string]$Executable
)
$ErrorActionPreference = 'Stop'

function Assert-LocalPath([string]$Path) {
    $full = [IO.Path]::GetFullPath($Path)
    if ($full -notmatch '^[a-z]:\\' -or $full.Length -le 3) { throw 'Expected a private local path' }
    for ($p = $full; $p; $p = [IO.Path]::GetDirectoryName($p)) {
        try { $attr = [IO.File]::GetAttributes($p) }
        catch [IO.FileNotFoundException] { continue }
        catch [IO.DirectoryNotFoundException] { continue }
        if ($attr -band [IO.FileAttributes]::ReparsePoint) { throw 'Linked or reparse-point path' }
    }
}

# Read link count on the open file handle. Checking only its name would allow access grants on a
# staged hard link to apply to another file. GetFileInformationByHandle is available on Win x64/ARM64.
Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;
public static class PanacodeFileInfo {
    [StructLayout(LayoutKind.Sequential)]
    private struct Information {
        public uint attributes;
        public System.Runtime.InteropServices.ComTypes.FILETIME created, accessed, written;
        public uint volume, sizeHigh, sizeLow, links, indexHigh, indexLow;
    }
    [DllImport("kernel32.dll", SetLastError=true)]
    private static extern bool GetFileInformationByHandle(SafeFileHandle file, out Information data);
    public static void AssertSingleLink(SafeFileHandle file) {
        Information info;
        if (!GetFileInformationByHandle(file, out info)) throw new Win32Exception();
        if (info.links != 1) throw new InvalidOperationException("Linked file");
    }
}
'@

function Get-Digest([string]$Path) {
    $stream = [IO.File]::OpenRead($Path)
    try {
        [PanacodeFileInfo]::AssertSingleLink($stream.SafeFileHandle)
        $algorithm = [Security.Cryptography.SHA256]::Create()
        try { return [BitConverter]::ToString($algorithm.ComputeHash($stream)).Replace('-', '') }
        finally { $algorithm.Dispose() }
    } finally { $stream.Dispose() }
}

function Read-Manifest([string]$Path) {
    Assert-LocalPath $Path
    if ($Pin -notmatch '^[a-fA-F0-9]{64}$') { throw 'Missing ownership receipt' }
    # Hash and parse the same bytes.
    $stream = [IO.File]::OpenRead($Path)
    try {
        [PanacodeFileInfo]::AssertSingleLink($stream.SafeFileHandle)
        $memory = [IO.MemoryStream]::new()
        try { $stream.CopyTo($memory); $bytes = $memory.ToArray() } finally { $memory.Dispose() }
    } finally { $stream.Dispose() }
    $sha = [Security.Cryptography.SHA256]::Create()
    try { $actual = [BitConverter]::ToString($sha.ComputeHash($bytes)).Replace('-', '') }
    finally { $sha.Dispose() }
    if ($actual -ne $Pin) { throw 'Ownership receipt mismatch' }
    $lines = [Text.Encoding]::ASCII.GetString($bytes).TrimEnd([char]10).Split([char]10)
    if ($lines.Count -lt 5 -or $lines[0] -cne 'panacode-install 2' -or $lines[1] -cne "app=$AppId" -or
        $lines[2] -notmatch '^version=.+$' -or $lines[3] -cne "exe=$Executable") { throw 'Invalid package identity' }
    $files = @{}
    foreach ($line in $lines[4..($lines.Count - 1)]) {
        $pair = $line.Split([char]9)
        if ($pair.Count -ne 2 -or $pair[0] -notmatch '^[a-f0-9]{64}$') { throw 'Invalid manifest entry' }
        $name = $pair[1]
        if ($files.ContainsKey($name) -or $name -eq '.panacode-install') { throw 'Duplicate manifest entry' }
        foreach ($part in $name.Split([char]92)) {
            if (!$part -or $part -match '[<>:"/|?*\x00-\x1f]|[. ]$|^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)') {
                throw 'Invalid Windows relative path'
            }
        }
        $files[$name] = $pair[0]
    }
    if (!$files.ContainsKey($Executable)) { throw 'Missing packaged executable' }
    return $files
}

try {
    Assert-LocalPath $Root
    if ($Action -eq 'DeleteAppData') {
        $profileRoot = [Environment]::GetFolderPath([Environment+SpecialFolder]::ApplicationData)
        if ($Root -ne [IO.Path]::Combine($profileRoot, $AppId)) { throw 'Unexpected desktop profile' }
        if (![IO.Directory]::Exists($Root)) { exit 0 }
        $pending = [Collections.Generic.Stack[string]]::new()
        $dirs = [Collections.Generic.Stack[string]]::new()
        $leaves = [Collections.Generic.List[string]]::new()
        $pending.Push($Root)
        while ($pending.Count) {
            $dir = $pending.Pop()
            Assert-LocalPath $dir
            $dirs.Push($dir)
            foreach ($p in [IO.Directory]::EnumerateFileSystemEntries($dir)) {
                Assert-LocalPath $p
                if ([IO.Directory]::Exists($p)) { $pending.Push($p) } else { $leaves.Add($p) }
            }
        }
        foreach ($p in $leaves) { Assert-LocalPath $p; [IO.File]::Delete($p) }
        while ($dirs.Count) { $p = $dirs.Pop(); Assert-LocalPath $p; [IO.Directory]::Delete($p, $false) }
        exit 0
    }
    $manifest = [IO.Path]::Combine($Root, '.panacode-install')
    $files = Read-Manifest $manifest

    if ($Action -eq 'Image') {
        $path = [IO.Path]::Combine($Root, $Executable)
        Assert-LocalPath $path
        if ((Get-Digest $path) -ne $files[$Executable]) { throw 'Installed image changed' }
    } elseif ($Action -eq 'Stage') {
        $pending = [Collections.Generic.Stack[string]]::new()
        $pending.Push($Root)
        $count = 0
        while ($pending.Count) {
            foreach ($path in [IO.Directory]::EnumerateFileSystemEntries($pending.Pop())) {
                Assert-LocalPath $path
                if ([IO.Directory]::Exists($path)) { $pending.Push($path); continue }
                if ($path -eq $manifest) { continue }
                $name = $path.Substring($Root.Length + 1)
                if (!$files.ContainsKey($name) -or (Get-Digest $path) -ne $files[$name]) { throw 'Changed staged file' }
                $count++
            }
        }
        if ($count -ne $files.Count) { throw 'Incomplete staged payload' }
    } else {
        foreach ($name in $files.Keys) {
            $path = [IO.Path]::Combine($Root, $name)
            # A substituted directory, link or inaccessible file stays exactly where it is.
            try {
                Assert-LocalPath $path
                if (![IO.File]::Exists($path) -or (Get-Digest $path) -ne $files[$name]) { continue }
                [IO.File]::Delete($path)
                for ($p = [IO.Path]::GetDirectoryName($path); $p -ne $Root; $p = [IO.Path]::GetDirectoryName($p)) {
                    Assert-LocalPath $p
                    [IO.Directory]::Delete($p, $false)
                }
            } catch [IO.IOException] { continue }
              catch [UnauthorizedAccessException] { continue }
              catch { continue }
        }
        Assert-LocalPath $manifest
        if ((Get-Digest $manifest) -eq $Pin) { [IO.File]::Delete($manifest) }
    }
    exit 0
} catch {
    # Report only fixed categories. Native exception messages can contain the user's profile path.
    $known = @(
        'Expected a private local path', 'Linked or reparse-point path', 'Missing ownership receipt',
        'Ownership receipt mismatch', 'Invalid package identity', 'Invalid manifest entry',
        'Duplicate manifest entry', 'Invalid Windows relative path', 'Missing packaged executable',
        'Unexpected desktop profile', 'Installed image changed', 'Changed staged file',
        'Incomplete staged payload', 'Linked file'
    )
    $message = $known -eq $_.Exception.GetBaseException().Message
    if (!$message) { $message = $_.Exception.GetBaseException().GetType().Name }
    [Console]::Error.WriteLine("Panacode file verification: $message")
    exit 1
}
