# Sourced by the launcher scripts, after they set $here to their directory.
name=${OKI_INSTANCE:-oki}
folder=${OKI_FOLDER:-$HOME/Documents/Oki}
port=7760
image=$here/../../image
management=$here/../../management

fail () { echo "oki: $*" >&2; exit 1; }

with_apt () { ! command -v apt-get >/dev/null || echo " (sudo apt install $*)"; }

command -v limactl >/dev/null || fail "Oki runs in Lima, and this shell does not find limactl. Install Lima as https://lima-vm.io/docs/installation/ says, or add its folder to your PATH, then start Oki again"
command -v qemu-system-x86_64 >/dev/null || fail "Oki needs QEMU, which is not installed$(with_apt qemu-system-x86). Install it, then start Oki again"
virtiofsd_known () {
  for dir in "$HOME/.local/share/qemu/vhost-user" "$(dirname "$(dirname "$(command -v qemu-system-x86_64)")")/share/qemu/vhost-user" /usr/share/qemu/vhost-user; do
    ! grep -qsE '"type"[[:space:]]*:[[:space:]]*"fs"' "$dir"/*.json || return 0
  done
  return 1
}
virtiofsd_known || fail "Oki shares your folder through virtiofsd, which is not installed$(with_apt virtiofsd). Install it, then start Oki again"
[ ! -e /dev/kvm ] || { [ -r /dev/kvm ] && [ -w /dev/kvm ]; } ||
  fail "Oki needs /dev/kvm, which $(id -un) may not open. Join the kvm group (sudo usermod -aG kvm $(id -un)), log out and in again, then start Oki again"

status_of () { limactl list --format '{{.Name}} {{.Status}}' | awk -v name="$name" '$1 == name { print $2 }'; }

port_free () {
  held=$(ss -ltnpH "sport = :$port")
  [ -z "$held" ] || fail "port $port is held, by another Oki or something else — stop it first (OKI_INSTANCE=<its name> ./stop.sh); two Okis running would both act: $held"
}
