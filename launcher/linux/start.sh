#!/bin/sh
# Starts Oki. The first start makes the Lima instance $OKI_INSTANCE (oki when unset) from oki.yaml,
# sharing $OKI_FOLDER (~/Documents/Oki when unset) as /folders, and provisions it with the release
# $OKI_RELEASE names, the files directory of a release image/release.sh built. Unset, it is the files
# directory beside this script, as in a release's Linux package; with none there, Oki is made from
# this checkout: image/, a package of management/ built here, which needs the plugin-web checkout
# beside this repository, and $OKI_PLUGIN_WEB_TGZ, the web connector's package.
set -eu
here=$(cd "$(dirname "$0")" && pwd)
. "$here/common.sh"
slow=
case $# in
  0) ;;
  1) [ "$1" = --no-kvm ] || fail "start.sh takes --no-kvm, or nothing"; slow=yes ;;
  *) fail "start.sh takes --no-kvm, or nothing" ;;
esac
[ -n "${OKI_RELEASE:-}" ] || [ ! -d "$here/files" ] || OKI_RELEASE=$here/files

shared () {
  limactl shell --workdir / "$name" mountpoint -q /folders ||
    fail "$name started without $folder mounted as /folders, so what a spore writes there would stay inside the instance — limactl shell $name sudo dmesg says why"
}

refused () {
  log=${LIMA_HOME:-$HOME/.lima}/$name/ha.stderr.log
  why=
  for wait in 0 1 1 1; do
    sleep "$wait"
    [ ! -f "$log" ] || why=$(sed -n 's/.*"level":"fatal","msg":"\([^"]*\)".*/\1/p' "$log")
    [ -z "$why" ] || break
  done
  [ -n "$why" ] || [ ! -f "$log" ] || why=$(sed -n 's/.*"msg":"\([a-z0-9-]*\[stderr\]: [^"]*\).*/\1/p' "$log" | tail -n 5)
  [ "$1" = kept ] || limactl delete -f "$name"
  case $why in
    'failed to locate virtiofsd') fail "Oki shares your folder through virtiofsd, which is not installed$(with_apt virtiofsd). Install it, then run $here/start.sh" ;;
    '') fail "Lima could not start Oki's instance, and its log gives no reason. Once that is fixed, run $here/start.sh" ;;
  esac
  fail "Lima could not start Oki's instance. Its log says:
$why
Once that is fixed, run $here/start.sh"
}

status=$(status_of)
if [ -z "$status" ]; then
  [ -e /dev/kvm ] || [ -n "$slow" ] ||
    fail "this computer has no /dev/kvm, so Oki would run very slowly. Turn on virtualisation (Intel VT-x or AMD-V) in the computer's firmware settings; or, to install Oki anyway, run $here/start.sh --no-kvm"
  [ "$(id -u)" = 1000 ] || fail "the appliance's user is uid 1000, and the shared folder is writable inside only when the host user is uid 1000 too — this one is $(id -u)"
  port_free
  if [ -n "${OKI_RELEASE:-}" ]; then
    files=$OKI_RELEASE
    (cd "$files" && sha256sum -c --quiet SHA256SUMS) || fail "$files is not a whole release: its files differ from its SHA256SUMS"
  else
    [ -n "${OKI_PLUGIN_WEB_TGZ:-}" ] || fail "OKI_PLUGIN_WEB_TGZ names the web connector's package (npm pack in plugin-web), or OKI_RELEASE a release image/release.sh built"
    files=$(mktemp -d)
    (cd "$management" && npm ci --no-audit --no-fund && npm pack --pack-destination "$files") ||
      fail "building the management service failed"
    mv "$files"/*.tgz "$files/oki-management.tgz"
    cp "$image/provision.sh" "$image/manifest.json" "$files/"
    cp "$OKI_PLUGIN_WEB_TGZ" "$files/spore-plugin-web.tgz"
    sh "$image/lock.sh" "$files" || fail "writing the package-lock.json failed"
  fi
  mkdir -p "$folder"
  limactl start --name="$name" --tty=false --set ".mounts[0].location = \"$folder\"" "$here/oki.yaml" || refused removed
  shared
  limactl shell --workdir / "$name" mkdir /tmp/oki-release
  limactl copy "$files/provision.sh" "$files/manifest.json" "$files/oki-management.tgz" "$files/spore-plugin-web.tgz" "$files/package.json" "$files/package-lock.json" "$name:/tmp/oki-release/"
  [ -n "${OKI_RELEASE:-}" ] || rm -r "$files"
  limactl shell --workdir / "$name" sudo sh /tmp/oki-release/provision.sh /tmp/oki-release "" "$(hostname)" ||
    fail "provisioning failed — limactl delete -f $name, then start.sh again"
elif [ "$status" != Running ]; then
  port_free
  limactl start --tty=false "$name" || refused kept
  shared
fi

limactl shell --workdir / "$name" test -f /opt/oki/manifest.json ||
  fail "$name was never provisioned — limactl delete -f $name, then start.sh again"
echo "oki: running — http://127.0.0.1:$port/oki/"
