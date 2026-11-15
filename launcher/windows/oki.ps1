# The Oki launcher for this Windows account: the notification-area icon, and the same actions as commands.
#   oki.ps1 tray [-Start] [-Open] | start | stop | status | open | folder | backup | restore | diagnostics
#   oki.ps1 startup on|off | use <distribution> | remove <distribution> | uninstall
param(
  [Parameter(Position = 0)][string]$Command = 'tray',
  [Parameter(Position = 1)][string]$Target,
  [switch]$Start,
  [switch]$Open
)

$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'Oki.psm1') -Force

$okiHome = Get-OkiHome
$configFile = Join-Path $okiHome 'oki.json'
$config = Read-OkiConfig -Path $configFile
if (-not $config -and $Command -ne 'uninstall') { throw "Oki is not installed for this Windows account ($configFile is missing): run the installer" }
$origin = "http://127.0.0.1:$($config.port)"
$startup = Get-OkiShortcutPath -Folder Startup
$self = $PSCommandPath

function Wait-Oki {
  $deadline = (Get-Date).AddSeconds(150)
  do {
    $status = Get-OkiStatus -Config $config
    if ($status.State -ne 'starting') { return $status }
    Start-Sleep -Seconds 2
  } while ((Get-Date) -lt $deadline)
  $status
}

function Open-OkiPage {
  Start-Oki -Config $config
  $deadline = (Get-Date).AddSeconds(150)
  do {
    $status = Get-OkiStatus -Config $config
    if ($status.State -eq 'running') {
      Start-Process "$origin/oki/"
      return
    }
    if ($status.State -eq 'error') { break }
    Start-Sleep -Seconds 2
  } while ((Get-Date) -lt $deadline)
  throw $status.Reason
}

function Confirm-Removal ([string]$what, [string]$word) {
  Write-Host $what
  Write-Host "Your shared folder, $($config.folder), is not touched. Backups you saved stay where you saved them."
  (Read-Host "Type $word to go on") -ceq $word
}

function Remove-OkiInstance ([string]$distro) {
  Stop-Oki -Distro $distro
  Invoke-OkiWsl -Arguments '--unregister', $distro
  $instance = Join-Path $okiHome "instances\$distro"
  if (Test-Path -LiteralPath $instance) { Remove-Item -LiteralPath $instance -Recurse -Force }
}

function Show-OkiTray {
  Add-Type -AssemblyName System.Windows.Forms, System.Drawing
  $first = $false
  $script:mutex = New-Object System.Threading.Mutex($true, 'Local\OkiLauncher', [ref]$first)
  if (-not $first) {
    if ($Open) {
      try { Open-OkiPage } catch { [void][System.Windows.Forms.MessageBox]::Show($_.Exception.Message, 'Oki') }
    }
    return
  }
  $script:opening = $false

  $colors = @{ running = 'SeaGreen'; starting = 'Goldenrod'; stopped = 'Gray'; error = 'Firebrick' }
  $script:icons = @{}
  $script:shown = $null
  $logo = New-Object System.Drawing.Icon (Join-Path $PSScriptRoot 'oki.ico'), 32, 32
  foreach ($state in $colors.Keys) {
    $bitmap = $logo.ToBitmap()
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    $graphics.SmoothingMode = 'AntiAlias'
    $brush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromName($colors[$state]))
    $graphics.FillEllipse([System.Drawing.Brushes]::White, 17, 17, 15, 15)
    $graphics.FillEllipse($brush, 19, 19, 11, 11)
    $brush.Dispose()
    $graphics.Dispose()
    $script:icons[$state] = [System.Drawing.Icon]::FromHandle($bitmap.GetHicon())
  }

  $script:notify = New-Object System.Windows.Forms.NotifyIcon
  $script:menu = New-Object System.Windows.Forms.ContextMenuStrip
  $script:notify.ContextMenuStrip = $script:menu
  $script:stateItem = $script:menu.Items.Add('')
  $script:stateItem.Enabled = $false
  [void]$script:menu.Items.Add('-')
  $script:openItem = Add-TrayItem 'Open Oki' { Request-OkiPage }
  $script:openItem.Font = New-Object System.Drawing.Font($script:openItem.Font, [System.Drawing.FontStyle]::Bold)
  $script:startItem = Add-TrayItem 'Start Oki' { Start-Oki -Config $config }
  $script:stopItem = Add-TrayItem 'Stop Oki' { $script:opening = $false; Set-TrayState 'stopping'; Stop-Oki -Distro $config.distro }
  [void](Add-TrayItem 'Open the shared folder' { Invoke-Item -LiteralPath $config.folder })
  [void](Add-TrayItem 'Back up...' { Start-Process "$origin/oki/backup/" })
  [void](Add-TrayItem 'Restore a backup...' { Start-Process "$origin/oki/restore/" })
  [void](Add-TrayItem 'Diagnostics' {
    $file = Join-Path $okiHome 'diagnostics.txt'
    Write-OkiDiagnostic -Config $config -Path $file
    Start-Process notepad.exe -ArgumentList "`"$file`""
  })
  $script:startupItem = Add-TrayItem 'Start Oki when I sign in' {
    if (Test-Path -LiteralPath $startup) { Remove-Item -LiteralPath $startup }
    else { New-OkiShortcut -Path $startup -Launcher $self -Arguments 'tray -Start' }
  }
  [void]$script:menu.Items.Add('-')
  $script:quitItem = Add-TrayItem 'Quit the launcher' { Exit-Tray }
  $script:stopQuitItem = Add-TrayItem 'Stop Oki and quit the launcher' { Set-TrayState 'stopping'; Stop-Oki -Distro $config.distro; Exit-Tray }

  $script:notify.add_MouseClick({
    param($clicked, $click)
    if ($click.Button -eq [System.Windows.Forms.MouseButtons]::Left) { Invoke-TrayAction { Request-OkiPage } }
  })
  $script:timer = New-Object System.Windows.Forms.Timer
  $script:timer.Interval = 5000
  $script:timer.add_Tick({ Update-Tray })
  $script:timer.Start()
  $script:notify.Visible = $true
  Update-Tray
  if ($Open) { Invoke-TrayAction { Request-OkiPage } }
  elseif ($Start) { Invoke-TrayAction { Start-Oki -Config $config } }
  [System.Windows.Forms.Application]::Run()
}

function Request-OkiPage {
  if ((Get-OkiStatus -Config $config).State -eq 'running') {
    Start-Process "$origin/oki/"
    return
  }
  Start-Oki -Config $config
  $script:opening = $true
  $script:timer.Interval = 1000
  $script:notify.ShowBalloonTip(5000, 'Oki', 'Oki is starting. Its page opens when it is ready.', 'Info')
}

function Add-TrayItem ([string]$text, [scriptblock]$action) {
  $entry = $script:menu.Items.Add($text)
  $entry.Tag = $action
  $entry.add_Click({ param($clicked) Invoke-TrayAction $clicked.Tag })
  $entry
}

function Invoke-TrayAction ([scriptblock]$action) {
  $script:timer.Stop()
  try { & $action } catch { [void][System.Windows.Forms.MessageBox]::Show($_.Exception.Message, 'Oki') }
  if ($script:notify.Visible) {
    Update-Tray
    $script:timer.Start()
  }
}

function Set-TrayState ([string]$word) {
  $script:stateItem.Text = "Oki $($config.distro -replace '^Oki-', '') - $word"
  $script:notify.Text = "Oki - $word"
  [System.Windows.Forms.Application]::DoEvents()
}

function Update-Tray {
  try { $status = Get-OkiStatus -Config $config }
  catch { $status = [pscustomobject]@{ State = 'error'; Reason = $_.Exception.Message } }
  $state = $status.State
  $script:notify.Icon = $script:icons[$state]
  $script:notify.Text = "Oki - $state"
  $script:stateItem.Text = "Oki $($config.distro -replace '^Oki-', '') - $state"
  $script:stateItem.ToolTipText = $status.Reason
  $script:openItem.Enabled = $state -ne 'error'
  $script:startItem.Enabled = $state -eq 'stopped'
  $script:stopItem.Enabled = $state -ne 'stopped'
  $script:startupItem.Checked = Test-Path -LiteralPath $startup
  $script:stopQuitItem.Visible = $state -ne 'stopped'
  $script:quitItem.Text = if ($state -eq 'stopped') { 'Quit the launcher' } else { 'Quit the launcher - Oki keeps running' }
  if ($state -eq 'error' -and $script:shown -ne 'error') { $script:notify.ShowBalloonTip(15000, 'Oki', $status.Reason, 'Warning') }
  if ($script:opening -and $state -in 'running', 'error') {
    $script:opening = $false
    $script:timer.Interval = 5000
    if ($state -eq 'running') { Start-Process "$origin/oki/" }
  }
  $script:shown = $state
}

function Exit-Tray {
  $script:timer.Stop()
  $script:notify.Visible = $false
  $script:notify.Dispose()
  [System.Windows.Forms.Application]::Exit()
}

switch ($Command) {
  'tray' { Show-OkiTray }
  'start' {
    Start-Oki -Config $config
    $status = Wait-Oki
    Write-Host $status.Reason
    if ($status.State -ne 'running') { exit 1 }
  }
  'stop' { Stop-Oki -Distro $config.distro; Write-Host 'Oki is stopped' }
  'status' {
    $status = Get-OkiStatus -Config $config
    Write-Host "$($config.distro): $($status.State) - $($status.Reason)"
    if ($status.State -eq 'error') { exit 1 }
  }
  'open' { Start-Process "$origin/oki/" }
  'folder' { Invoke-Item -LiteralPath $config.folder }
  'backup' { Start-Process "$origin/oki/backup/" }
  'restore' { Start-Process "$origin/oki/restore/" }
  'diagnostics' {
    $file = Join-Path $okiHome 'diagnostics.txt'
    Write-OkiDiagnostic -Config $config -Path $file
    Write-Host "Written to $file"
  }
  'startup' {
    switch ($Target) {
      'on' { New-OkiShortcut -Path $startup -Launcher $self -Arguments 'tray -Start' }
      'off' { if (Test-Path -LiteralPath $startup) { Remove-Item -LiteralPath $startup } }
      default { throw 'oki.ps1 startup on|off' }
    }
  }
  'use' {
    if (-not ((Test-OkiDistroName -Name $Target) -and (Get-OkiDistribution) -contains $Target)) { throw "$Target is not an Oki distribution of this Windows account" }
    if ($config.distro -and (Get-OkiDistribution -Running) -contains $config.distro) { throw "$($config.distro) is running: stop it first" }
    Write-OkiConfig -Path $configFile -Distro $Target -Port $config.port -Folder $config.folder
    Write-Host "The launcher now starts and opens $Target. Quit the launcher and open it again from the Start menu."
  }
  'remove' {
    if (-not ((Test-OkiDistroName -Name $Target) -and (Get-OkiDistribution) -contains $Target)) { throw "$Target is not an Oki distribution of this Windows account" }
    if (-not (Confirm-Removal "Removing $Target deletes everything it holds: conversations, spores, keys and settings. Back up first to keep them." $Target)) { exit 1 }
    Remove-OkiInstance $Target
    if ($config.distro -eq $Target) { Write-OkiConfig -Path $configFile -Distro '' -Port $config.port -Folder $config.folder }
    Write-Host "$Target is removed."
  }
  'uninstall' {
    Add-Type -AssemblyName System.Windows.Forms
    $instances = @(Get-OkiDistribution | Where-Object { Test-OkiDistroName -Name $_ })
    $kept = if ($config) { "Your Oki folder, $($config.folder), is not touched. " } else { '' }
    $question = "Uninstalling Oki deletes everything it holds for this Windows account: conversations, spores, keys and settings. Back up first to keep them.`n`n${kept}Backups you saved stay where you saved them.`n`nUninstall Oki?"
    if ([System.Windows.Forms.MessageBox]::Show($question, 'Oki', 'YesNo', 'Warning', 'Button2') -ne 'Yes') { exit 1 }
    foreach ($distro in $instances) { Remove-OkiInstance $distro; Write-Host "$distro is removed." }
    Get-CimInstance Win32_Process -Filter "Name = 'powershell.exe'" |
      Where-Object { $_.ProcessId -ne $PID -and $_.CommandLine -and $_.CommandLine.Contains($self) } |
      ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
    foreach ($link in $startup, (Get-OkiShortcutPath -Folder Programs)) { if (Test-Path -LiteralPath $link) { Remove-Item -LiteralPath $link } }
    $entry = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\Oki'
    if (Test-Path -LiteralPath $entry) { Remove-Item -LiteralPath $entry -Recurse -Force }
    Remove-Item -LiteralPath $okiHome -Recurse -Force
    [void][System.Windows.Forms.MessageBox]::Show("Oki is uninstalled.$(if ($config) { " $($config.folder) is still there." })", 'Oki')
  }
  default { throw "oki.ps1 has no command '$Command'" }
}
