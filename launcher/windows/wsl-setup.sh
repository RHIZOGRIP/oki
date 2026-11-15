#!/bin/sh
# Readies a WSL distribution freshly imported from Debian's WSL image for provision.sh: systemd as init,
# no Windows drive mounted but the shared folder at /folders, and no Windows program run from inside.
# Run once, as root, by install.ps1, before the distribution's restart.
#   wsl-setup.sh <the /etc/fstab line of the shared folder>
set -eu
fail () { echo "wsl-setup: $*" >&2; exit 1; }

[ "$(id -u)" = 0 ] || fail "runs as root"
[ -f /usr/lib/systemd/systemd ] || fail "the image has no systemd: it is not Debian's WSL image the manifest names"
case $1 in
  *' /folders drvfs '*) ;;
  *) fail "not a /folders line: $1" ;;
esac
! grep -q ' /folders ' /etc/fstab 2>/dev/null || fail "/etc/fstab already mounts /folders: this distribution was set up before"

cat > /etc/wsl.conf <<'EOF'
[boot]
systemd = true

[automount]
enabled = false
mountFsTab = true

[interop]
enabled = false
appendWindowsPath = false
EOF
mkdir -p /folders
printf '%s\n' "$1" >> /etc/fstab
