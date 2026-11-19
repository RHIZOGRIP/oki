# Shared by install.ps1 and oki.ps1. Windows PowerShell 5.1, which reads a script without a BOM in the
# ANSI code page: these files stay ASCII.
Set-StrictMode -Version 2.0

# wsl.exe writes UTF-16 to a pipe unless WSL_UTF8 is set; PowerShell decodes it with the console's encoding.
$env:WSL_UTF8 = '1'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false

$PortBase = 20000
$PortSpan = 10000
$PortTries = 20
$StartingSeconds = 120
$OkiUid = 1000

function Get-OkiHome { Join-Path $env:LOCALAPPDATA 'Oki' }

function Get-OkiDistroName {
  param([Parameter(Mandatory)][string]$Release)
  if ($Release -notmatch '^[0-9][0-9A-Za-z.-]*$') { throw "release '$Release' is not a release name like 0.1.0" }
  "Oki-$Release"
}

function Test-OkiDistroName {
  param([Parameter(Mandatory)][AllowEmptyString()][string]$Name)
  $Name -cmatch '^Oki-[0-9][0-9A-Za-z.-]*$'
}

function Get-OkiPortCandidate {
  param([Parameter(Mandatory)][string]$Sid)
  $sha = [System.Security.Cryptography.SHA256]::Create()
  $bytes = $sha.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($Sid))
  $sha.Dispose()
  [long]$h = 0
  foreach ($b in $bytes[0..3]) { $h = $h * 256 + $b }
  foreach ($k in 0..($PortTries - 1)) { $PortBase + (($h + $k) % $PortSpan) }
}

function ConvertFrom-OkiExcludedPort {
  param([Parameter(Mandatory)][AllowEmptyString()][string]$Text)
  foreach ($line in $Text -split "`r?`n") {
    if ($line -match '^\s*(\d+)\s+(\d+)\b') { [pscustomobject]@{ Start = [int]$Matches[1]; End = [int]$Matches[2] } }
  }
}

function Select-OkiPort {
  param(
    [Parameter(Mandatory)][string]$Sid,
    [Parameter(Mandatory)][AllowEmptyCollection()][object[]]$Excluded,
    [Parameter(Mandatory)][AllowEmptyCollection()][int[]]$Listening
  )
  foreach ($port in Get-OkiPortCandidate -Sid $Sid) {
    $inRange = @($Excluded | Where-Object { $port -ge $_.Start -and $port -le $_.End }).Count -gt 0
    if (-not $inRange -and $Listening -notcontains $port) { return $port }
  }
  throw "none of this account's $PortTries ports is free; diagnostics: netsh interface ipv4 show excludedportrange protocol=tcp"
}

function ConvertFrom-OkiChecksum {
  param([Parameter(Mandatory)][AllowEmptyString()][string]$Text)
  $sums = [ordered]@{}
  foreach ($line in $Text -split "`r?`n") {
    if ($line -eq '') { continue }
    if ($line -notmatch '^([0-9a-f]{64}) [ *](\S.*)$') { throw "SHA256SUMS has a line that is not '<sha256>  <file>': $line" }
    $sums[$Matches[2]] = $Matches[1]
  }
  $sums
}

function Test-OkiRelease {
  param(
    [Parameter(Mandatory)][string]$Directory,
    [Parameter(Mandatory)][string[]]$Need
  )
  $sumsFile = Join-Path $Directory 'SHA256SUMS'
  if (-not (Test-Path -LiteralPath $sumsFile -PathType Leaf)) { return @("$Directory has no SHA256SUMS: it is not a release image/release.sh built") }
  $sums = ConvertFrom-OkiChecksum -Text ([System.IO.File]::ReadAllText($sumsFile))
  $problems = @()
  foreach ($name in $Need) {
    if (-not $sums.Contains($name)) { $problems += "SHA256SUMS does not list $name" }
  }
  foreach ($name in $sums.Keys) {
    $file = Join-Path $Directory $name
    if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { $problems += "$name is missing"; continue }
    if ((Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant() -ne $sums[$name]) { $problems += "$name differs from its SHA256SUMS line" }
  }
  $problems
}

function Test-OkiDigest {
  param(
    [Parameter(Mandatory)][string]$Path,
    [Parameter(Mandatory)][string]$Digest
  )
  if ($Digest -notmatch '^(sha256|sha512):([0-9a-f]+)$') { throw "digest '$Digest' is not sha256:<hex> or sha512:<hex>" }
  $algorithm = $Matches[1].ToUpperInvariant()
  $expected = $Matches[2]
  (Get-FileHash -LiteralPath $Path -Algorithm $algorithm).Hash.ToLowerInvariant() -eq $expected
}

function ConvertTo-OkiFstabLine {
  param([Parameter(Mandatory)][string]$Folder)
  if ($Folder -notmatch '^[A-Za-z]:\\') { throw "the shared folder must be on a local drive, like C:\Users\you\Documents\Oki, not '$Folder'" }
  $field = New-Object System.Text.StringBuilder
  foreach ($byte in [System.Text.Encoding]::UTF8.GetBytes($Folder.TrimEnd('\'))) {
    if ($byte -gt 32 -and $byte -lt 127 -and $byte -ne 92) { [void]$field.Append([char]$byte) }
    else { [void]$field.Append('\' + [Convert]::ToString($byte, 8).PadLeft(3, '0')) }
  }
  "$field /folders drvfs uid=$OkiUid,gid=$OkiUid 0 0"
}

function Test-OkiOneDrive {
  param(
    [Parameter(Mandatory)][string]$Path,
    [Parameter(Mandatory)][AllowEmptyCollection()][AllowEmptyString()][string[]]$Root
  )
  foreach ($r in $Root) {
    if (-not $r) { continue }
    $prefix = $r.TrimEnd('\') + '\'
    if (($Path.TrimEnd('\') + '\').StartsWith($prefix, [System.StringComparison]::OrdinalIgnoreCase)) { return $true }
  }
  $false
}

function Initialize-OkiFolder {
  param([Parameter(Mandatory)][string]$Path)
  [void](New-Item -ItemType Directory -Force -Path $Path)
}

function Test-OkiRequirement {
  param(
    [Parameter(Mandatory)][int]$Build,
    [Parameter(Mandatory)][string]$Architecture,
    [Parameter(Mandatory)][double]$MemoryGB,
    [Parameter(Mandatory)][double]$FreeGB,
    [Parameter(Mandatory)][bool]$Virtualization,
    [AllowNull()][version]$Wsl
  )
  $problems = @()
  if ($Build -lt 22000) { $problems += "Oki needs Windows 11; this is Windows build $Build" }
  if ($Architecture -ne 'x64') { $problems += "Oki needs an x86-64 (x64) PC; this one is $Architecture" }
  if ($MemoryGB -lt 3.5) { $problems += ('Oki needs 4 GB of memory; this PC has {0:N1} GB' -f $MemoryGB) }
  if ($FreeGB -lt 10) { $problems += ('Oki needs 10 GB free on the drive of your user profile; it has {0:N1} GB' -f $FreeGB) }
  if (-not $Virtualization) { $problems += 'hardware virtualization is off: turn it on in the PC firmware (BIOS/UEFI) settings, often named Intel VT-x, AMD-V or SVM' }
  $wslAction = $null
  if ($null -eq $Wsl) { $wslAction = 'install' }
  elseif ($Wsl -lt [version]'2.0.0') { $wslAction = 'update' }
  [pscustomobject]@{ Problems = $problems; Wsl = $wslAction }
}

function Get-OkiState {
  param(
    [Parameter(Mandatory)][int]$Port,
    [Parameter(Mandatory)][bool]$Running,
    [Parameter(Mandatory)][bool]$Answering,
    [AllowNull()][AllowEmptyString()][string]$HeldBy,
    [AllowNull()][Nullable[double]]$KeptSeconds
  )
  $url = "http://127.0.0.1:$Port/oki/"
  if (-not $Running) {
    if ($HeldBy) { return [pscustomobject]@{ State = 'error'; Reason = "port $Port, this Windows account's Oki port, is held by $HeldBy (another account's Oki, or another program): Oki cannot start until it is free" } }
    return [pscustomobject]@{ State = 'stopped'; Reason = 'Oki is stopped' }
  }
  if ($Answering) { return [pscustomobject]@{ State = 'running'; Reason = "Oki is running at $url" } }
  if ($null -ne $KeptSeconds -and $KeptSeconds -lt $StartingSeconds) { return [pscustomobject]@{ State = 'starting'; Reason = 'Oki is starting' } }
  [pscustomobject]@{ State = 'error'; Reason = "Oki's distribution runs but nothing answers at $url; Diagnostics says why" }
}

function Read-OkiConfig {
  param([Parameter(Mandatory)][string]$Path)
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return $null }
  [System.IO.File]::ReadAllText($Path) | ConvertFrom-Json
}

function Write-OkiConfig {
  param(
    [Parameter(Mandatory)][string]$Path,
    [Parameter(Mandatory)][AllowNull()][AllowEmptyString()][string]$Distro,
    [Parameter(Mandatory)][int]$Port,
    [Parameter(Mandatory)][string]$Folder
  )
  $json = [pscustomobject]@{ distro = $Distro; port = $Port; folder = $Folder } | ConvertTo-Json
  [System.IO.File]::WriteAllText($Path, $json + "`n", (New-Object System.Text.UTF8Encoding $false))
}

function Test-OkiAnswering {
  param([Parameter(Mandatory)][int]$Port)
  $request = [System.Net.WebRequest]::Create("http://127.0.0.1:$Port/oki/")
  $request.AllowAutoRedirect = $false
  $request.Timeout = 1500
  try {
    $request.GetResponse().Close()
    $true
  } catch [System.Net.WebException] {
    if ($null -eq $_.Exception.Response) { return $false }
    $_.Exception.Response.Close()
    $true
  }
}

# Below: Windows only, through wsl.exe and the Windows networking cmdlets.

function Invoke-OkiWsl {
  param([Parameter(Mandatory)][string[]]$Arguments)
  & wsl.exe @Arguments
  if ($LASTEXITCODE -ne 0) { throw "wsl.exe $($Arguments -join ' ') failed with exit code $LASTEXITCODE" }
}

function Get-OkiWslOutput {
  param([Parameter(Mandatory)][string[]]$Arguments)
  $ErrorActionPreference = 'Continue'
  $out = & wsl.exe @Arguments 2>&1 | ForEach-Object { "$_".Trim() } | Where-Object { $_ -ne '' }
  if ($LASTEXITCODE -ne 0) { throw "wsl.exe $($Arguments -join ' ') failed with exit code ${LASTEXITCODE}: $($out -join ' ')" }
  $out
}

function Get-OkiDistribution {
  param([switch]$Running)
  if (-not $Running) {
    $lxss = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Lxss'
    if (-not (Test-Path -LiteralPath $lxss)) { return @() }
    return @(Get-ChildItem -LiteralPath $lxss | ForEach-Object { $_.GetValue('DistributionName') } | Where-Object { $_ })
  }
  $ErrorActionPreference = 'Continue'
  $out = @(& wsl.exe --list --running --quiet 2>&1 | ForEach-Object { "$_".Trim() } | Where-Object { $_ -ne '' })
  # wsl --list --running exits non-zero, with a sentence, when no distribution runs.
  if ($LASTEXITCODE -ne 0) { return @() }
  $out
}

function Get-OkiWslVersion {
  $exe = Join-Path $env:ProgramFiles 'WSL\wsl.exe'
  if (-not (Test-Path -LiteralPath $exe)) { return $null }
  [version](Get-Item -LiteralPath $exe).VersionInfo.ProductVersion
}

function Get-OkiPortHolder {
  param([Parameter(Mandatory)][int]$Port)
  # No listener on the port is the usual case; Get-NetTCPConnection reports it as an error.
  $held = @(Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue)
  if ($held.Count -eq 0) { return $null }
  $owner = $held[0].OwningProcess
  $process = Get-Process -Id $owner -ErrorAction SilentlyContinue
  if ($process) { "$($process.ProcessName) (pid $owner)" } else { "pid $owner" }
}

function Get-OkiListeningPort {
  @(Get-NetTCPConnection -State Listen -ErrorAction Stop | ForEach-Object { [int]$_.LocalPort } | Sort-Object -Unique)
}

function Get-OkiKeeper {
  param([Parameter(Mandatory)][string]$Distro)
  Get-CimInstance Win32_Process -Filter "Name = 'wsl.exe'" |
    Where-Object { $_.CommandLine -and $_.CommandLine.Contains("-d $Distro --cd / --exec sleep infinity") } |
    Select-Object -First 1
}

function Get-OkiStatus {
  param([Parameter(Mandatory)]$Config)
  if (-not $Config.distro) { return [pscustomobject]@{ State = 'error'; Reason = 'no Oki is installed for this Windows account: run the installer' } }
  if ((Get-OkiDistribution) -notcontains $Config.distro) { return [pscustomobject]@{ State = 'error'; Reason = "$($Config.distro) is not a WSL distribution of this Windows account any more: run the installer" } }
  $running = (Get-OkiDistribution -Running) -contains $Config.distro
  $keeper = $null
  $heldBy = $null
  if ($running) { $keeper = Get-OkiKeeper -Distro $Config.distro } else { $heldBy = Get-OkiPortHolder -Port $Config.port }
  $kept = $null
  if ($keeper) { $kept = ((Get-Date) - $keeper.CreationDate).TotalSeconds }
  $answering = $running -and (Test-OkiAnswering -Port $Config.port)
  Get-OkiState -Port $Config.port -Running $running -Answering $answering -HeldBy $heldBy -KeptSeconds $kept
}

function Start-Oki {
  param([Parameter(Mandatory)]$Config)
  $distro = $Config.distro
  if ((Get-OkiDistribution) -notcontains $distro) { throw "$distro is not installed for this Windows account: run the installer" }
  $running = Get-OkiDistribution -Running
  $other = @($running | Where-Object { (Test-OkiDistroName -Name $_) -and $_ -ne $distro })
  if ($other.Count -gt 0) { throw "$($other -join ', ') is running: stop it first; two Okis running the same spores would both act" }
  if ($running -notcontains $distro) {
    $holder = Get-OkiPortHolder -Port $Config.port
    if ($holder) { throw "port $($Config.port), this Windows account's Oki port, is held by $holder (another account's Oki, or another program): Oki cannot start until it is free" }
  }
  if (-not (Get-OkiKeeper -Distro $distro)) {
    Start-Process -FilePath 'wsl.exe' -ArgumentList '-d', $distro, '--cd', '/', '--exec', 'sleep', 'infinity' -WindowStyle Hidden
  }
}

function Stop-Oki {
  param([Parameter(Mandatory)][string]$Distro)
  if ((Get-OkiDistribution -Running) -notcontains $Distro) { return }
  & wsl.exe -d $Distro -u root --cd / --exec systemctl stop "user@$OkiUid.service"
  $graceful = $LASTEXITCODE
  & wsl.exe --terminate $Distro
  if ($LASTEXITCODE -ne 0) { throw "wsl --terminate $Distro failed with exit code $LASTEXITCODE" }
  if ($graceful -ne 0) { throw "Oki's services did not stop cleanly (systemctl exit code $graceful); $Distro was terminated anyway" }
}

# WSL gives a distribution it imports a Start menu entry and a Windows Terminal profile of its own, each
# opening a shell in it, and records where under the distribution's registry key.
function Remove-OkiWslEntry {
  param([Parameter(Mandatory)][string]$Distro)
  $key = Get-ChildItem -LiteralPath 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Lxss' | Where-Object { $_.GetValue('DistributionName') -eq $Distro }
  foreach ($name in 'ShortcutPath', 'TerminalProfilePath') {
    $path = $key.GetValue($name)
    if ($path -and (Test-Path -LiteralPath $path)) { Remove-Item -LiteralPath $path }
  }
}

function Get-OkiShortcutPath {
  param([Parameter(Mandatory)][ValidateSet('Startup', 'Programs')][string]$Folder)
  Join-Path ([Environment]::GetFolderPath($Folder)) 'Oki.lnk'
}

function New-OkiShortcut {
  param(
    [Parameter(Mandatory)][string]$Path,
    [Parameter(Mandatory)][string]$Launcher,
    [Parameter(Mandatory)][string]$Arguments
  )
  $shell = New-Object -ComObject WScript.Shell
  $link = $shell.CreateShortcut($Path)
  $link.TargetPath = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
  $link.Arguments = "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$Launcher`" $Arguments"
  $link.IconLocation = "$(Join-Path (Split-Path -Parent $Launcher) 'oki.ico'),0"
  $link.WindowStyle = 7
  $link.Description = 'Oki'
  $link.Save()
}

function Write-OkiDiagnostic {
  param(
    [Parameter(Mandatory)]$Config,
    [Parameter(Mandatory)][string]$Path
  )
  $report = New-Object System.Collections.Generic.List[string]
  $section = {
    param($title, $command)
    $report.Add('')
    $report.Add("== $title")
    try { foreach ($line in (& $command)) { $report.Add("$line") } } catch { $report.Add("FAILED: $($_.Exception.Message)") }
  }
  & $section 'when' { Get-Date -Format o }
  & $section 'Windows' { $os = Get-CimInstance Win32_OperatingSystem; "$($os.Caption) $($os.Version) build $($os.BuildNumber) $($os.OSArchitecture)" }
  & $section 'launcher config' { $Config | ConvertTo-Json }
  & $section 'status' { Get-OkiStatus -Config $Config | Format-List | Out-String }
  & $section "port $($Config.port)" { Get-OkiPortHolder -Port $Config.port }
  & $section "port $($Config.port) in a range Windows excludes" {
    $ranges = @(ConvertFrom-OkiExcludedPort -Text ((& netsh.exe interface ipv4 show excludedportrange protocol=tcp) -join "`n"))
    @($ranges | Where-Object { $Config.port -ge $_.Start -and $Config.port -le $_.End } | ForEach-Object { "$($_.Start)-$($_.End)" })
  }
  & $section 'wsl --version' { Get-OkiWslOutput -Arguments '--version' }
  & $section 'wsl --list --verbose' { Get-OkiWslOutput -Arguments '--list', '--verbose' }
  if ($Config.distro -and (Get-OkiDistribution -Running) -contains $Config.distro) {
    $d = $Config.distro
    & $section 'release' { Get-OkiWslOutput -Arguments '-d', $d, '-u', 'root', '--cd', '/', '--exec', 'cat', '/opt/oki/manifest.json' }
    & $section '/folders' { Get-OkiWslOutput -Arguments '-d', $d, '-u', 'root', '--cd', '/', '--exec', 'findmnt', '/folders' }
    & $section 'failed system units' { Get-OkiWslOutput -Arguments '-d', $d, '-u', 'root', '--cd', '/', '--exec', 'systemctl', '--failed', '--no-pager' }
    & $section "oki's units" { Get-OkiWslOutput -Arguments '-d', $d, '-u', 'oki', '--cd', '/', '--exec', 'env', "XDG_RUNTIME_DIR=/run/user/$OkiUid", 'systemctl', '--user', '--no-pager', '--all', 'list-units', 'oki-*', 'spore-*' }
    & $section "oki's log, last 150 lines" { Get-OkiWslOutput -Arguments '-d', $d, '-u', 'root', '--cd', '/', '--exec', 'journalctl', '--no-pager', '-n', '150', "_UID=$OkiUid" }
  } else {
    $report.Add('')
    $report.Add('== inside the distribution: not read, Oki is not running (reading would start it)')
  }
  [System.IO.File]::WriteAllLines($Path, $report)
}

