# Oki

A named, self-hosted personal agent delivered as an installable appliance, built on
[spore](https://github.com/RHIZOGRIP/spore). Downloads are at [keepoki.com](https://keepoki.com/);
what changed in each release is in [CHANGELOG.md](CHANGELOG.md).

## Layout

| Directory | What it holds |
|---|---|
| `management/` | the management service: the one address the browser opens, `/oki/…` for setup, system, export and import, the optional password, and `/` forwarded to the web connector |
| `image/` | the appliance image definition: the Debian base, Node.js, the pinned spore and web connector, the systemd units, and the release manifest naming the tested combination |
| `plugin/` | the Oki plugin: spore material not in the upstream packages, sporangia to begin with; empty for now |
| `launcher/` | host-side installers and launchers, one directory per host, Lima on Linux for development, `launcher/windows/` for WSL 2; a launcher installs an image and starts, stops and opens it |

Spore and the web connector (`@rhizogrip/spore-plugin-web`) are not in this repo. The image pulls
them in at pinned versions.

## Releases

Releases are on this repository's [releases page](https://github.com/RHIZOGRIP/oki/releases).
Questions and discussion: https://discord.gg/gpumegdhR

Each release holds:

- `oki-<version>.exe`: the Windows installer. Download it and open it.
- `oki-<version>-linux.tar.gz`: the Linux package, which `https://keepoki.com/install.sh` installs.
- `oki-<version>.zip`: the same release as a folder, for a manual install on Windows.
- `SHA256SUMS` and `SHA256SUMS.minisig`: the checksums of the three files, signed.

### Checking a download

In PowerShell, compare with the line in `SHA256SUMS`:

    Get-FileHash oki-<version>.exe -Algorithm SHA256

To check the signature of `SHA256SUMS` with [minisign](https://jedisct1.github.io/minisign/):

    minisign -Vm SHA256SUMS -P RWTqgYgvih8mgn6Xm9lx32sKVG6Fz5pFYcCHvOPFZy72Le/ftnTJsjoW

## Licences

Oki is AGPL-3.0-only. See [LICENSING.md](LICENSING.md); the AGPL text is in [LICENSE](LICENSE).

Oki is put together from several works, each under its own licence:

- **Oki itself** (its management pages and service, its installer and launcher) and **the web
  connector**, `@rhizogrip/spore-plugin-web`: AGPL-3.0-only.
- **spore**, the agent runtime Oki runs: Apache License 2.0.
- **mohdel**, which spore calls AI models through: MIT License.
- **Everything else**: Node.js, the Debian system Oki runs in, and several hundred npm and Debian
  packages, each under its own open-source licence.

Where to find them once Oki is installed, inside Oki:

- each npm package, with its licence file, is under `/opt/oki/node_modules`, and
  `/opt/oki/package-lock.json` lists them all with their versions;
- each Debian package has its licence at `/usr/share/doc/<package>/copyright`, and
  `/opt/oki/dpkg.txt` lists them all with their versions.
