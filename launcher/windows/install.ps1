# Installs Oki for this Windows account from the release this script came with: a directory
# image/release.sh built. Six steps: check the PC, install WSL with permission if it is
# missing, verify the release and download the Debian base it names, import a WSL distribution of this
# account's own and provision it, start Oki and open it. Claiming or restoring is Oki's own first page.
#   powershell -ExecutionPolicy Bypass -File install.ps1 [-Folder <shared folder>]
param([string]$Folder)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
Import-Module (Join-Path $PSScriptRoot 'Oki.psm1') -Force

$release = $PSScriptRoot
$okiHome = Get-OkiHome
$configFile = Join-Path $okiHome 'oki.json'
$launcher = Join-Path $okiHome 'launcher'
$need = 'manifest.json', 'provision.sh', 'oki-management.tgz', 'spore-plugin-web.tgz', 'package.json', 'package-lock.json', 'wsl-setup.sh', 'oki.ps1', 'Oki.psm1', 'oki.ico'

function Stop-Install ([string]$message) {
  Write-Host ''
  Write-Host "Oki is not installed: $message" -ForegroundColor Red
  exit 1
}

function Confirm-Step ([string]$question) {
  (Read-Host "$question [y/N]") -match '^(y|yes)$'
}

Write-Host 'Oki installer' -ForegroundColor Cyan
Write-Host ''

# 1. The PC.
$os = Get-CimInstance Win32_OperatingSystem
$cpu = @(Get-CimInstance Win32_Processor)[0]
$system = Get-CimInstance Win32_ComputerSystem
$architecture = switch ($cpu.Architecture) { 9 { 'x64' } 12 { 'arm64' } default { "architecture $($cpu.Architecture)" } }
$drive = Get-PSDrive -Name ($env:LOCALAPPDATA.Substring(0, 1))
$check = Test-OkiRequirement -Build ([int]$os.BuildNumber) -Architecture $architecture `
  -MemoryGB ($system.TotalPhysicalMemory / 1GB) -FreeGB ($drive.Free / 1GB) `
  -Virtualization ($system.HypervisorPresent -or $cpu.VirtualizationFirmwareEnabled) -Wsl (Get-OkiWslVersion)
if ($check.Problems.Count -gt 0) {
  $check.Problems | ForEach-Object { Write-Host "  - $_" -ForegroundColor Red }
  Stop-Install 'this PC does not meet what Oki needs.'
}
Write-Host "Windows build $($os.BuildNumber), $architecture, $('{0:N0}' -f ($system.TotalPhysicalMemory / 1GB)) GB memory: fine."

# 2. WSL, the one machine-wide change, with permission.
if ($check.Wsl) {
  Write-Host ''
  Write-Host 'Oki runs in WSL 2, the Windows Subsystem for Linux, which is not installed or is too old here.'
  Write-Host 'Installing it changes Windows for every account on this PC: it asks for administrator approval,'
  Write-Host 'and Windows usually needs a restart afterwards. Nothing else Oki does needs an administrator.'
  if (-not (Confirm-Step 'Install WSL now?')) { Stop-Install 'WSL is needed. Install it with "wsl --install --no-distribution" as an administrator, then run this installer again.' }
  $arguments = if ($check.Wsl -eq 'install') { '--install --no-distribution' } else { '--update' }
  $elevated = Start-Process -FilePath 'wsl.exe' -ArgumentList $arguments -Verb RunAs -Wait -PassThru
  if ($elevated.ExitCode -ne 0) { Stop-Install "wsl $arguments failed with exit code $($elevated.ExitCode)." }
  Write-Host ''
  Write-Host 'WSL is installed. Restart Windows, then run this installer again.' -ForegroundColor Green
  exit 0
}
Write-Host "WSL $(Get-OkiWslVersion): fine."

# 3. The release, checked whole, and the Debian base it names.
$problems = @(Test-OkiRelease -Directory $release -Need $need)
if ($problems.Count -gt 0) {
  $problems | ForEach-Object { Write-Host "  - $_" -ForegroundColor Red }
  Stop-Install "$release is not a whole Oki release. Download it again."
}
$manifest = [System.IO.File]::ReadAllText((Join-Path $release 'manifest.json')) | ConvertFrom-Json
$distro = Get-OkiDistroName -Release $manifest.release
Write-Host "Oki $($manifest.release): every file matches its checksum."

$registered = Get-OkiDistribution
if ($registered -contains $distro) { Stop-Install "Oki $($manifest.release) is already installed as $distro. To install it again from nothing, remove it first: $launcher\oki.ps1 remove $distro" }
$running = @(Get-OkiDistribution -Running | Where-Object { Test-OkiDistroName -Name $_ })
if ($running.Count -gt 0) { Stop-Install "$($running -join ', ') is running. If you are moving to this release, export your data in it first (Oki, Export), then stop it from the Oki launcher, and run this installer again." }

$staging = Join-Path $okiHome "releases\$($manifest.release)"
[void](New-Item -ItemType Directory -Force -Path $staging)
$rootfs = Join-Path $staging 'debian-wsl.tar.gz'
if (-not ((Test-Path -LiteralPath $rootfs) -and (Test-OkiDigest -Path $rootfs -Digest $manifest.base.wsl.digest))) {
  Write-Host "Downloading the Debian base, $($manifest.base.wsl.image)"
  & curl.exe --fail --location --http1.1 --retry 10 --continue-at - --output $rootfs $manifest.base.wsl.image
  if ($LASTEXITCODE -ne 0) { Stop-Install "downloading the Debian base failed (curl exit code $LASTEXITCODE). Run the installer again: it goes on from where the download stopped." }
  if (-not (Test-OkiDigest -Path $rootfs -Digest $manifest.base.wsl.digest)) {
    Remove-Item -LiteralPath $rootfs
    Stop-Install "the Debian base downloaded from $($manifest.base.wsl.image) is not the one the release names ($($manifest.base.wsl.digest))."
  }
}
Write-Host 'The Debian base matches the release.'

# 4. This account's own distribution, its port and the shared folder.
$config = Read-OkiConfig -Path $configFile
$given = [bool]$Folder
if (-not $given) {
  $Folder = if ($config) { $config.folder } else { Join-Path ([Environment]::GetFolderPath('UserProfile')) 'Oki' }
}
$Folder = [System.IO.Path]::GetFullPath($Folder)
$fstab = ConvertTo-OkiFstabLine -Folder $Folder
Write-Host ''
Write-Host "Oki works in one folder of yours: $Folder"
Write-Host 'Each spore, as Oki calls its agents, has a folder of its own in it.'
Write-Host 'Oki can change and delete what is in this folder. Removing Oki never deletes it.'
if ($given -and (Test-OkiOneDrive -Path $Folder -Root @($env:OneDrive, $env:OneDriveConsumer, $env:OneDriveCommercial))) {
  Write-Host ''
  Write-Host "$Folder is in OneDrive: what Oki writes there is uploaded, and files kept online only may not open for Oki." -ForegroundColor Yellow
  if (-not (Confirm-Step 'Use it anyway?')) { Stop-Install 'run the installer again and give a folder outside OneDrive, for example C:\Oki.' }
}
Initialize-OkiFolder -Path $Folder

if ($config) {
  $port = [int]$config.port
  $holder = Get-OkiPortHolder -Port $port
  if ($holder) { Stop-Install "port $port, this account's Oki port, is held by $holder. Stop that program and run the installer again." }
} else {
  $sid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
  $excluded = @(ConvertFrom-OkiExcludedPort -Text ((& netsh.exe interface ipv4 show excludedportrange protocol=tcp) -join "`n"))
  $port = Select-OkiPort -Sid $sid -Excluded $excluded -Listening (Get-OkiListeningPort)
}
$origin = "http://127.0.0.1:$port"

$instances = Join-Path $okiHome 'instances'
[void](New-Item -ItemType Directory -Force -Path $instances)
$instance = Join-Path $instances $distro
Write-Host ''
Write-Host "Making $distro, this account's Oki, in $instance"
try {
  Invoke-OkiWsl -Arguments '--import', $distro, $instance, $rootfs, '--version', '2'
} catch {
  Stop-Install "WSL could not make the distribution: $($_.Exception.Message). WSL's own message is above; if it names virtualization or the Virtual Machine Platform, restart Windows after installing WSL, or turn virtualization on in the firmware."
}
Remove-OkiWslEntry -Distro $distro
try {
  Invoke-OkiWsl -Arguments '-d', $distro, '-u', 'root', '--cd', $release, '--exec', 'cp', '-r', '.', '/var/tmp/oki-release'
  Invoke-OkiWsl -Arguments '-d', $distro, '-u', 'root', '--cd', '/', '--exec', 'sh', '/var/tmp/oki-release/wsl-setup.sh', $fstab
  Invoke-OkiWsl -Arguments '--terminate', $distro
  Write-Host 'Provisioning: Node.js, spore, the web connector and the management service. A few minutes.'
  Invoke-OkiWsl -Arguments '-d', $distro, '-u', 'root', '--cd', '/', '--exec', 'sh', '/var/tmp/oki-release/provision.sh', '/var/tmp/oki-release', $origin, $env:COMPUTERNAME
  Invoke-OkiWsl -Arguments '-d', $distro, '-u', 'root', '--cd', '/', '--exec', 'rm', '-r', '/var/tmp/oki-release'
} catch {
  Write-Host $_.Exception.Message -ForegroundColor Red
  & wsl.exe --unregister $distro
  if ($LASTEXITCODE -ne 0) { Stop-Install "provisioning failed, and removing $distro failed too. The messages above say why; remove it with: wsl --unregister $distro" }
  Stop-Install "provisioning failed, and $distro, which held nothing yet, was removed. The messages above say why; when they speak of a signature or 'Not live until', this PC's date or time is wrong: set it in Settings, Time & language, and run the installer again."
}
Remove-Item -LiteralPath $staging -Recurse

# The launcher, this account's Start menu entry and its entry in Settings, Apps.
[void](New-Item -ItemType Directory -Force -Path $launcher)
Copy-Item -LiteralPath (Join-Path $release 'oki.ps1'), (Join-Path $release 'Oki.psm1'), (Join-Path $release 'oki.ico') -Destination $launcher -Force
$okiScript = Join-Path $launcher 'oki.ps1'
Write-OkiConfig -Path $configFile -Distro $distro -Port $port -Folder $Folder
New-OkiShortcut -Path (Get-OkiShortcutPath -Folder Programs) -Launcher $okiScript -Arguments 'tray -Open'
$uninstall = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\Oki'
[void](New-Item -Path $uninstall -Force)
$powershell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$values = @{
  DisplayName = 'Oki'
  DisplayVersion = $manifest.release
  DisplayIcon = Join-Path $launcher 'oki.ico'
  Publisher = 'Rhizogrip'
  InstallLocation = $okiHome
  UninstallString = "`"$powershell`" -NoProfile -ExecutionPolicy Bypass -File `"$okiScript`" uninstall"
}
foreach ($name in $values.Keys) { [void](New-ItemProperty -Path $uninstall -Name $name -Value $values[$name] -PropertyType String -Force) }
foreach ($name in 'NoModify', 'NoRepair') { [void](New-ItemProperty -Path $uninstall -Name $name -Value 1 -PropertyType DWord -Force) }

# 5. Start Oki, open it, and show the launcher.
$config = Read-OkiConfig -Path $configFile
Start-Oki -Config $config
$deadline = (Get-Date).AddSeconds(120)
do {
  Start-Sleep -Seconds 2
  $status = Get-OkiStatus -Config $config
} while ($status.State -eq 'starting' -and (Get-Date) -lt $deadline)
if ($status.State -ne 'running') { Stop-Install "Oki was installed but does not answer: $($status.Reason). Open the Oki launcher from the Start menu, then Diagnostics." }
Start-Process "$origin/oki/"
Start-Process -FilePath $powershell -ArgumentList '-NoProfile', '-WindowStyle', 'Hidden', '-ExecutionPolicy', 'Bypass', '-File', "`"$okiScript`"", 'tray' -WindowStyle Hidden

Write-Host ''
Write-Host "Oki $($manifest.release) is running at $origin/oki/" -ForegroundColor Green
Write-Host "Shared folder: $Folder"
Write-Host 'To open Oki again: Oki in the Start menu, or its icon in the notification area.'
Write-Host 'In the browser: claim Oki and set up a model, or restore a backup of your data.'
$older = @(Get-OkiDistribution | Where-Object { (Test-OkiDistroName -Name $_) -and $_ -ne $distro })
if ($older.Count -gt 0) {
  Write-Host ''
  Write-Host "Also installed: $($older -join ', '). Once this release works with your data, remove each:"
  $older | ForEach-Object { Write-Host "  powershell -ExecutionPolicy Bypass -File `"$okiScript`" remove $_" }
}
