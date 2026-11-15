# Windows, with WSL 2

Oki in a WSL 2 distribution of the Windows account that installs it, `Oki-<release>`, made from Debian's
WSL image and provisioned with the release. Needs Windows 11 on an x86-64 PC, 8 GB of memory, 10 GB free
on the drive of the user profile, and hardware virtualization; the installer installs WSL when it is
missing, the one step that asks for an administrator. Nothing here is compiled: the installer and the
launcher are Windows PowerShell 5.1 scripts, and the launcher's icon is WinForms, both part of Windows.

A release that `image/release.sh` built holds the installer. Open the release's `.exe`, which unpacks the release and runs its installer. Or, in the release's
folder or its unpacked zip, double-click `Install Oki.cmd`, the only file beside its `files` folder, or from `files`:

```powershell
powershell -ExecutionPolicy Bypass -File install.ps1 [-Folder <shared folder>]
```

Then, from the Start menu entry Oki or the icon in the notification area, or as commands:

```powershell
$oki = "$env:LOCALAPPDATA\Oki\launcher\oki.ps1"
powershell -ExecutionPolicy Bypass -File $oki start      # and stop, status
powershell -ExecutionPolicy Bypass -File $oki open       # Oki, http://127.0.0.1:<port>/oki/
powershell -ExecutionPolicy Bypass -File $oki folder     # the shared folder
powershell -ExecutionPolicy Bypass -File $oki backup     # the backup page; restore, the restore page
powershell -ExecutionPolicy Bypass -File $oki diagnostics
powershell -ExecutionPolicy Bypass -File $oki startup on # start Oki at sign-in; off
```

## What the installer does

1. Checks the PC: Windows 11, x64, memory, disk, virtualization, and WSL 2.0 or later (the version of
   `C:\Program Files\WSL\wsl.exe`).
2. When WSL is missing or older, says what it is and that it changes Windows for every account, asks,
   and runs `wsl --install --no-distribution` (or `wsl --update`) as administrator. Windows then needs a
   restart, and the installer is run again.
3. Checks every file of the release against its `SHA256SUMS`, then downloads the Debian WSL image the
   manifest names as `base.wsl` with `curl.exe`, resuming where a download stopped, and refuses it unless
   it has the manifest's digest.
4. Makes the shared folder, `Oki` in the account's own folder (`C:\Users\<name>\Oki`) unless `-Folder` or an
   earlier install names another, and
   imports `Oki-<release>` into `%LOCALAPPDATA%\Oki\instances\Oki-<release>\ext4.vhdx`, and removes the
   Start menu entry and the Windows Terminal profile WSL makes for a distribution, so that Oki is the
   one entry of that name. `wsl-setup.sh`
   then writes the distribution's `/etc/wsl.conf` and `/etc/fstab`; after a restart of the distribution,
   `provision.sh` runs as on Lima, with this account's address as its origin and the PC's name as its computer. A provisioning that fails
   removes the distribution, which held nothing yet.
5. Writes `%LOCALAPPDATA%\Oki\oki.json` (the distribution, the port, the folder), puts the launcher in
   `%LOCALAPPDATA%\Oki\launcher`, the Start menu entry, and the entry in Settings, Apps; starts Oki, opens
   `http://127.0.0.1:<port>/oki/` and shows the launcher's icon.
6. The page is Oki's first-run screen: claim it and set up a model, or restore a backup.

## One Oki per Windows account

- **Its own distribution.** WSL registers distributions per Windows account, so each account that runs
  the installer gets its own `Oki-<release>`, with its disk in its own profile. Nothing is shared but the
  release it was made from.
- **Its own port.** WSL forwards a port the distribution listens on to `127.0.0.1` on Windows, and
  `127.0.0.1` is the whole PC's: two accounts' Okis on one port would collide, and a browser could reach
  the other account's. The installer gives each account a port of its own in 20000–29999, derived from
  the account's SID, so it is the same at every install and two accounts almost never share it. At the
  first install it passes over a port something listens on or Windows excludes (`netsh interface ipv4 show
  excludedportrange protocol=tcp`); later installs keep the account's port. Before each start the
  launcher refuses while another program holds the port, and names it.
- **The management service listens at that port inside the distribution**, since WSL does not map one
  port to another. `provision.sh` takes it as the origin; the web file holds it, and an import keeps it.
- **The connector's own port, 7761, is forwarded too.** WSL forwards a listener on `127.0.0.1`, and a
  program of any account on the PC can reach it there and name itself as Oki's person; a browser is
  refused, for it sends no `x-forwarded-user`. The password does not stand in front of it. Moving the
  connector to `127.0.0.2`, which WSL does not forward, needs the web connector to accept that address.

## The shared folder

The shared folder, `C:\Users\<name>\Oki` unless `-Folder` named another, is mounted at
`/folders` by one line of the distribution's `/etc/fstab`, a `drvfs` mount of that Windows path owned by
uid 1000, `oki`. No other Windows drive is mounted (`[automount] enabled = false`), and nothing in the
distribution can run a Windows program (`[interop] enabled = false`). Every spore Oki makes is granted
a folder of its own in it, `/folders/<its name>`, and can change and delete what is in that one.

`drvfs` is 9p, on which a spore before 1.66.0 was refused the folder its definition grants, with
"permission denied" for listing as for writing: spore's agent now keeps what it was granted open,
which that share needs. Checked on one PC, WSL 3.0.5 with kernel 6.18.

Stopping, removing, replacing and uninstalling never delete the folder.

The installer asks nothing about the folder. The default is outside `Documents` because OneDrive often
backs `Documents` up: OneDrive uploads what Oki writes there, and how a file kept online only reads
through WSL is not known yet. When `-Folder` names a folder inside OneDrive, the installer says so and asks.

## The launcher

The Start menu entry Oki opens Oki's page: it shows the icon if it is not there, starts Oki if it is
stopped, and opens the page once Oki answers. A click on the icon does the same.

The icon is green when Oki answers, yellow while it starts, grey when stopped, red on an error, which a
notification explains. Its menu opens Oki, starts and stops it, opens the shared folder, the backup and
restore pages, writes the diagnostics to `%LOCALAPPDATA%\Oki\diagnostics.txt` and opens them, and turns on
or off the start at sign-in (a shortcut in the account's Startup folder that starts Oki and shows the icon).

- **Starting** runs `wsl.exe -d Oki-<release> --cd / --exec sleep infinity`, hidden. WSL stops a
  distribution a few seconds after the last Windows program using it ends, systemd or not; this one keeps
  it up. Closing the browser changes nothing.
- **Stopping** stops `oki`'s services (`systemctl stop user@1000.service`), then `wsl --terminate` on Oki's
  distribution only. It never runs `wsl --shutdown`, which would stop every distribution of the account.
- **Quitting the launcher** leaves Oki running, and the menu item says so: `Quit the launcher - Oki keeps
  running`. `Stop Oki and quit the launcher` does both. Signing out of Windows stops Oki; sleep suspends
  it.

## Moving to a new release

```powershell
# in the running Oki: Export, keep the file
powershell -ExecutionPolicy Bypass -File $oki stop
# double-click Install Oki.cmd in the new release: Oki-0.2.0 starts empty, on the same port and folder
# in the browser, Restore a backup
powershell -ExecutionPolicy Bypass -File $oki remove Oki-0.1.0   # once the new one works
```

The installer refuses while another Oki of the account runs, as two would both act. Going back, while the
old one is there: `stop`, `use Oki-0.1.0`, then open the launcher again. What the new one did after the
import is not in the old one.

## Removing

`remove <distribution>` deletes one Oki and everything it holds; it asks for the distribution's name to be
typed. `uninstall`, which Settings, Apps, Oki runs, deletes every Oki distribution of the account, the
launcher, its entries and `%LOCALAPPDATA%\Oki`, after a yes in a Windows dialog; it runs even when
`oki.json` is gone, so that what is left of an Oki can always be removed. Neither touches the
shared folder, nor the exports, which are where the browser saved them.

## Checking

The parts that need no Windows are tested on Linux with PowerShell 7 and Pester 5 or later, and the
scripts checked against Windows PowerShell 5.1 with PSScriptAnalyzer:

```bash
pwsh -c 'Invoke-Pester ./test'
pwsh -c 'Invoke-ScriptAnalyzer -Path . -Settings ./PSScriptAnalyzerSettings.psd1'
```

The analyzer's remaining warnings are the WinForms types, which the launcher loads before using, and
`-Start` and `-Open`, which the tray reads.
