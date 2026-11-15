# Image

The appliance image definition and the release manifest.

- `manifest.json` is the tested combination: `release`, the name of this release of Oki, the Debian cloud image by date and digest, which Lima starts from, and as `base.wsl` Debian's WSL image by release and digest, which a Windows install imports, Node.js by version and checksum, the exact spore, the mohdel that spore pins, the web connector by version and the sha256 of its package, the management service as the version in `management/package.json`, the units that must run and where the two services listen, `curated`, mohdex's public API (`https://mohdex.dev/v1`), which the management service computes Oki's catalog from, the target architecture and `dataSchema`, the version of the data an export carries.
- `provision.sh` turns a stock Debian 13 into the appliance from a directory holding that manifest, a package of `management/` (`npm pack`), the web connector's package, and the `package.json` and `package-lock.json` `lock.sh` wrote from them, as root, once. It installs with `npm ci`, so every package is the one the lock names, by hash. It refuses a distribution, architecture or installed version the manifest does not name, copies the manifest to `/opt/oki/manifest.json` with the build date as `built` and the host's name, its third argument, as `computer`, and starts the management service last.

- `release.sh <out-dir>` builds a release: from a clean tree whose `HEAD` is the tag `v<release>`, it builds the management service's package and writes it, the manifest, `provision.sh`, the web connector's package, packed from the plugin-web checkout beside this repository (refused unless that checkout is at the tag of the pinned version and the package has the manifest's sha256), the `package.json` and `package-lock.json` of `lock.sh`, the Windows installer and launcher from `launcher/windows/`, and their `SHA256SUMS` to `<out-dir>/files`, the directory a launcher installs from. Beside `files`, `<out-dir>` holds only `Install Oki.cmd`, the one file to double-click on Windows. It also writes `<out-dir>.zip`, the same directory as one file to download, and `<out-dir>.exe`, one file to download and open on Windows: `makensis` (the `nsis` package) builds it from `launcher/windows/installer.nsi`, and it unpacks the directory to a temporary folder and runs `Install Oki.cmd`. The `.exe` is not signed, so Windows SmartScreen warns before it runs. `<out-dir>-linux.tar.gz` is the Linux package: `start.sh`, `stop.sh`, `open.sh`, `common.sh` and `oki.yaml` from `launcher/linux/`, with `files` beside them, which `start.sh` installs from. The pages are built against the same checkout, for the connector's `page/tokens.css`.

## A release

A release is a new image, never an upgrade in place. Making one: set `release` (and the versions that
change) in `manifest.json` and `version` in `management/package.json` to match `management`, commit,
`git tag v<release>`, then `release.sh`. Moving to it is four steps: in the running Oki,
export; install the new release beside it (on Lima, `OKI_INSTANCE=<name> OKI_RELEASE=<out-dir>
./start.sh`, which refuses while the old one holds the port); stop the old one; import the file in the
new one. The image holds nothing for the move: export and import are the management service's, and
the launcher only installs.

## What the image holds

| Where | What |
|---|---|
| `/usr/local` | Node.js, from nodejs.org, checked against the manifest's sha256 |
| `/usr/bin/gpg` | Debian's gnupg, which encrypts and opens exports |
| `/opt/oki` | spore-cli, spore, mohdel, the web connector and the management service, installed by npm from a `package.json` of exact versions; the manifest; the records of what was installed |
| `/usr/local/bin/spore`, `/usr/local/bin/mo` | links into `/opt/oki` |
| `/home/oki` | the state root of the `oki` user: `.config/spore/config.json` naming `~/.spore` as the spores' directory, which the image fixes, the web file `.config/spore/web/oki.json`, the units `spore service` wrote and `oki-management.service`, and, once the management service has read mohdex, mohdel's catalog `.config/mohdel/curated.json`, computed from it; the image carries no catalog; no credentials, password, spores or conversations |
| `/folders` | where the host folder is mounted |

The connector and the tick timer are spore's own services: `spore service define` writes them as systemd user units of `oki`, who lingers, so they run from boot. The management service is Oki's program, not a plugin, so its unit ships with it and `provision.sh` installs it beside them. All name `/usr/local/bin/node` and `/opt/oki/...`, which every image installs at the same place.

The web file puts the connector in its proxy shape and gives it Oki's menu (`shell`: the name Oki and links to the spores, models, backup and system pages, shown at the foot of the chat's sidebar in place of the person's name): `user` is `x-forwarded-user`, the header management names the person in, and `origin` is the address the browser opens, which the management service listens at: `provision.sh`'s second argument, or `http://` and the manifest's `services.management.listen` when it is empty, as on Lima. A host forwards that port as it is, so on Windows, where `127.0.0.1` is the whole PC's, the installer gives each account's Oki a port of its own as the origin. The connector refuses a `user` without an `origin`. An import keeps the appliance's own web file, so the origin stays the host's.

Nothing is installed once the appliance runs: the management service calls the spore and mohdel in `/opt/oki`, and its pages are built before packing. Setup reads mohdex.dev and the providers, as `spore setup` does, and the catalog is computed from mohdex at the manifest's `curated`.

## Size

Measured on Lima, 2026-11-12, release 0.1.0 with spore 1.63.0, set up with one model and one spore.

| What | Size |
|---|---|
| The instance on the host (`~/.lima/oki`) | 1.5 GB |
| Used inside, of a 99 GB disk that grows as it fills | 1.7 GB |
| `/opt/oki`: spore, mohdel, the connector, the management service | 242 MB |
| Node.js (`/usr/local/bin/node`, and npm beside it) | 122 MB, 18 MB |

Oki's own part is about 380 MB; the rest, about 1.3 GB, is Debian's generic image. In `/opt/oki` the
largest are the provider SDKs mohdel brings (`openai` 35 MB, `@opentelemetry` 35 MB, `@anthropic-ai`
26 MB, `@google` 13 MB) and `@rhizogrip` (47 MB). What the install downloads, and a Windows install's
size on Debian's WSL image, are not measured yet.

## Choices

**One npm install in `/opt/oki`, not `npm install -g`.** A global install gives each package its own tree, so the web connector would take its own copy of spore, the newest its peer range allows, not the pinned one. One install from a `package.json` naming spore-cli, spore and the web connector at exact versions leaves one spore that both use, and `provision.sh` refuses a second copy. `lock.sh` writes that `package.json` and, without installing, the `package-lock.json` that fixes the whole tree with each package's hash, when the release is built; `provision.sh` installs exactly that with `npm ci`. Two installs of one release hold the same packages. The lock is made at build time, not kept in git, since it holds the hash of the management package built then: building one tag twice can give two locks.

**A 20 GB disk, fixed.** Lima's default is a 100 GB disk that grows on the host as it fills, so the instance would see free space the host may not have, and spore's free-space floor, which reads the instance's, would not stop a turn in time. With a fixed size the system page's figure is real and the most Oki takes from the host is known. Lima can enlarge a disk later, never shrink it. The size table above was measured before this, on the default disk. Folders are on the host and do not count.

**`oki` is uid 1000.** A host folder shows inside under its host owner's uid: WSL mounts Windows folders as uid 1000, and Lima on Linux passes the host user's uid. The Lima instance therefore moves its own login user to 1001.

**Recorded, not snapshotted.** The base is a dated Debian cloud image with its digest. `apt-cache policy` and `dpkg-query` write the package sources and every installed package to `/opt/oki`. No OS upgrade runs at build, so the packages are the cloud image's plus the few the script adds.

**The management service travels as a package of this repository.** It is built where the repository is, since its pages need the plugin-web checkout, and `provision.sh` installs the `.tgz` into the same `/opt/oki` tree, recorded in its `package-lock.json`.

**The web connector travels as its package, pinned by sha256.** It is not on npm. `provision.sh` takes its package (`npm pack` of the tag's files as `git archive` gives them under umask 022, which gives the same bytes on any machine; packed in a working tree, the bytes follow the modes of its files) and refuses one whose sha256 is not the manifest's, then installs it like the others and refuses any version but the manifest's.
