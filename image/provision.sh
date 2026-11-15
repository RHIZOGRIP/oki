#!/bin/sh
# Turns a stock Debian 13 into the Oki appliance, as the release manifest says. Run once, as root.
#   provision.sh <directory> <origin> <computer>
# <directory> holds the release's manifest.json, oki-management.tgz and spore-plugin-web.tgz, and the
# package.json and package-lock.json lock.sh wrote from them.
# <origin>, http://127.0.0.1:<port>, is the address the browser opens and the management service listens
# at; a host forwards that port as it is. Empty, it is the manifest's services.management.listen, as on
# Lima; on Windows each account's Oki has a port of its own. <computer> is the host's name, which Oki
# puts in the label of the keys and sign-ins it asks providers for.
set -eu
release=$1
origin=$2
computer=$3
manifest=$release/manifest.json
web_tgz=$release/spore-plugin-web.tgz
app=/opt/oki
home=/home/oki
uid=1000

fail () { echo "provision: $*" >&2; exit 1; }
same () { [ "$2" = "$3" ] || fail "$1 is $2, the manifest says $3"; }

[ "$(id -u)" = 0 ] || fail "runs as root"
[ -n "$computer" ] || fail "the third argument is the name of the computer this Oki runs on"
[ ! -e "$app" ] || fail "$app is already there — provision a fresh Debian"

export DEBIAN_FRONTEND=noninteractive
apt-get update -q
apt-get install -yq --no-install-recommends ca-certificates curl git gnupg jq xz-utils

field () { jq -er "$1" "$manifest"; }

[ -n "$origin" ] || origin=http://$(field .services.management.listen)
case $origin in
  http://127.0.0.1:[1-9]*) ;;
  *) fail "the origin is http://127.0.0.1:<port>, not $origin" ;;
esac

. /etc/os-release
same distribution "$ID $VERSION_ID" "$(field .base.distribution)"
same architecture "$(uname -m)" "$(field .arch)"

tarball=$(field .node.tarball)
curl -fsSL -o "/tmp/$tarball" "https://nodejs.org/dist/$(field .node.version)/$tarball"
echo "$(field .node.sha256)  /tmp/$tarball" | sha256sum -c --quiet -
tar -xJf "/tmp/$tarball" -C /usr/local --strip-components=1 --exclude=CHANGELOG.md --exclude=README.md --exclude=LICENSE
rm "/tmp/$tarball"
same node "$(node --version)" "$(field .node.version)"

spore=$(field .spore)
web=$(field .pluginWeb.version)
echo "$(field .pluginWeb.sha256)  $web_tgz" | sha256sum -c --quiet - || fail "$web_tgz is not the web connector the manifest pins"
mkdir -p "$app"
cp "$release/oki-management.tgz" "$web_tgz" "$release/package.json" "$release/package-lock.json" "$app/"
(cd "$app" && npm ci --no-audit --no-fund)

version () { jq -r .version "$app/node_modules/$1/package.json"; }
same @rhizogrip/spore-cli "$(version @rhizogrip/spore-cli)" "$spore"
same @rhizogrip/spore "$(version @rhizogrip/spore)" "$spore"
same @rhizogrip/spore-plugin-web "$(version @rhizogrip/spore-plugin-web)" "$web"
same @rhizogrip/oki-management "$(version @rhizogrip/oki-management)" "$(field .management)"
same "the mohdel spore pins" "$(jq -r .dependencies.mohdel "$app/node_modules/@rhizogrip/spore/package.json")" "$(field .mohdel)"
same mohdel "$(version mohdel)" "$(field .mohdel)"
same "copies of @rhizogrip/spore" "$(find "$app/node_modules" -path '*/@rhizogrip/spore/package.json' | wc -l)" 1

ln -s "$app/node_modules/.bin/spore" /usr/local/bin/spore
ln -s "$app/node_modules/.bin/mo" /usr/local/bin/mo

useradd --uid "$uid" --user-group --create-home --home-dir "$home" --shell /bin/bash oki
mkdir -p /folders

loginctl enable-linger oki
systemctl start "user@$uid.service"
as_oki () {
  runuser -u oki -- env -i HOME="$home" USER=oki LOGNAME=oki PATH=/usr/local/bin:/usr/bin:/bin XDG_RUNTIME_DIR="/run/user/$uid" "$@"
}

as_oki spore config set home '~/.spore'
as_oki mkdir -p "$home/.config/spore/web"
jq -n --arg listen "$(field .services.connector.listen)" --arg origin "$origin" \
  '{ listen: $listen, origin: $origin, user: "x-forwarded-user", people: { operator: "*" },
     shell: { name: "Oki", links: [
       { label: "Spores", href: "/oki/spores/" },
       { label: "Models", href: "/oki/setup/" },
       { label: "Back up", href: "/oki/backup/" },
       { label: "System", href: "/oki/" } ] } }' |
  as_oki sh -c "cat > $home/.config/spore/web/oki.json"

for service in tick web@oki; do
  as_oki spore service define "$service"
  as_oki spore service enable "$service"
  as_oki spore service start "$service"
done

apt-cache policy > "$app/apt-policy.txt"
dpkg-query -W -f '${Package} ${Version} ${Architecture}\n' > "$app/dpkg.txt"
jq --arg built "$(date -u +%Y-%m-%dT%H:%M:%SZ)" --arg computer "$computer" '. + { built: $built, computer: $computer }' "$manifest" > "$app/manifest.json"

unit=$(field .services.management.unit)
as_oki mkdir -p "$home/.config/systemd/user"
install -o oki -g oki -m 644 "$app/node_modules/@rhizogrip/oki-management/$unit" "$home/.config/systemd/user/$unit"
as_oki systemctl --user daemon-reload
as_oki systemctl --user enable --now "$unit"
echo "provision: Oki $(field .release) ready — spore $spore, mohdel $(field .mohdel), web connector $web, management $(field .management)"
