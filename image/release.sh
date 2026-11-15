#!/bin/sh
# Builds the release image/manifest.json names, from its tag. <out-dir> holds "Install Oki.cmd", the one
# file to double-click on Windows, and files/, the directory a launcher installs from: the manifest,
# provision.sh, the management service's package, the web connector's, the package.json and
# package-lock.json lock.sh writes from them, the Windows installer and launcher, and their SHA256SUMS. <out-dir>.zip is the same directory as one file to download, and
# <out-dir>.exe one file to download and open on Windows, which unpacks the directory and runs
# "Install Oki.cmd"; makensis (the nsis package) builds it. <out-dir>-linux.tar.gz is the Linux
# package: the Linux launcher with files/ beside it, which its start.sh installs from.
# The web connector is packed from the tag of the version the manifest pins, in the plugin-web
# checkout beside this repository, which must be at that tag: from git archive under umask 022, since
# npm pack keeps each file's mode, and a working tree's modes follow the umask it was checked out with; the management pages are built against the same checkout.
#   release.sh <out-dir>
set -eu
here=$(cd "$(dirname "$0")" && pwd)
repo=$(cd "$here/.." && pwd)
out=$1
web=$(cd "$repo/../plugin-web" && pwd)

fail () { echo "release: $*" >&2; exit 1; }
field () { jq -er "$1" "$here/manifest.json"; }

release=$(field .release)
tag=v$release
[ -z "$(git -C "$repo" status --porcelain)" ] || fail "$repo has changes — a release is built from a commit"
[ "$(git -C "$repo" rev-parse HEAD)" = "$(git -C "$repo" rev-parse -q --verify "refs/tags/$tag^{commit}" || true)" ] ||
  fail "HEAD is not $tag — tag the commit that names release $release: git tag $tag"
[ "$(jq -r .version "$repo/management/package.json")" = "$(field .management)" ] ||
  fail "management/package.json is $(jq -r .version "$repo/management/package.json"), the manifest says $(field .management)"
web_tag=v$(field .pluginWeb.version)
[ -z "$(git -C "$web" status --porcelain --untracked-files=no)" ] || fail "$web has changes — the web connector is packed from a commit"
[ "$(git -C "$web" rev-parse HEAD)" = "$(git -C "$web" rev-parse -q --verify "refs/tags/$web_tag^{commit}" || true)" ] ||
  fail "$web is not at $web_tag, the web connector the manifest pins: git -C $web checkout $web_tag"
[ ! -e "$out" ] || fail "$out is already there"
[ ! -e "$out.zip" ] || fail "$out.zip is already there"
[ ! -e "$out.exe" ] || fail "$out.exe is already there"
[ ! -e "$out-linux.tar.gz" ] || fail "$out-linux.tar.gz is already there"
command -v makensis >/dev/null || fail "makensis is not installed: it builds $out.exe (the nsis package)"

files=$out/files
mkdir -p "$files"
(cd "$repo/management" && npm ci --no-audit --no-fund && npm pack --pack-destination "$files") || fail "building the management service failed"
mv "$files/rhizogrip-oki-management-$(field .management).tgz" "$files/oki-management.tgz"
cp "$here/manifest.json" "$here/provision.sh" "$files/"
export=$(mktemp -d)
(umask 022 && git -C "$web" archive "$web_tag" | tar -x -C "$export" && cd "$export" && npm pack --pack-destination "$files") || fail "packing the web connector failed"
rm -r "$export"
mv "$files/rhizogrip-spore-plugin-web-$(field .pluginWeb.version).tgz" "$files/spore-plugin-web.tgz"
echo "$(field .pluginWeb.sha256)  $files/spore-plugin-web.tgz" | sha256sum -c --quiet - || fail "the web connector packed from $web is not the one the manifest pins"
sh "$here/lock.sh" "$files" || fail "writing the package-lock.json failed"
cp "$repo/launcher/windows/Install Oki.cmd" "$out/"
set -- install.ps1 oki.ps1 Oki.psm1 oki.ico wsl-setup.sh
for file; do cp "$repo/launcher/windows/$file" "$files/"; done
(cd "$files" && sha256sum manifest.json provision.sh oki-management.tgz spore-plugin-web.tgz package.json package-lock.json "$@" > SHA256SUMS)
(cd "$(dirname "$out")" && zip -qr "$(basename "$out").zip" "$(basename "$out")") || fail "packing $out.zip failed"
makensis -V2 -DRELEASE="$release" -DDIR="$out" -DOUT="$out.exe" "$repo/launcher/windows/installer.nsi" || fail "building $out.exe failed"
stage=$(mktemp -d)
mkdir "$stage/$(basename "$out")"
cp -r "$files" "$stage/$(basename "$out")/files"
for file in start.sh stop.sh open.sh common.sh oki.yaml; do cp "$repo/launcher/linux/$file" "$stage/$(basename "$out")/"; done
tar -czf "$out-linux.tar.gz" -C "$stage" "$(basename "$out")" || fail "packing $out-linux.tar.gz failed"
rm -r "$stage"
echo "release: Oki $release in $out, $out.zip, $out.exe and $out-linux.tar.gz, built from $tag ($(git -C "$repo" rev-parse --short HEAD))"
