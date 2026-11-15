# Linux, with Lima

Oki in a Lima instance named `oki`, for development. Needs Lima 1.0 or later (for `user:` and `--set`) with QEMU, a host user of uid 1000, and npm with the plugin-web checkout beside this repository, to build the management service when the instance is made.

```bash
./start.sh        # the first start makes the instance and provisions it, a few minutes
./open.sh         # Oki, http://127.0.0.1:7760/oki/
./open.sh folder  # the shared folder
./stop.sh
./boot-check.sh   # starts Oki and checks it against image/manifest.json
```

- `OKI_INSTANCE` names the Lima instance, `oki` when unset; another name makes another Oki beside it, for a new release. Only one runs at a time: `start.sh` refuses while port 7760 is held, since two Okis running the same spores would both act.
- `OKI_RELEASE` is the `files` directory of a release `image/release.sh` built; the instance is made from it, checked against its `SHA256SUMS`. Unset, it is the `files` directory beside `start.sh`, as in a release's Linux package (`oki-<release>-linux.tar.gz`); with none there, the instance is made from this checkout and `OKI_PLUGIN_WEB_TGZ`.
- `OKI_FOLDER` is the host folder shared as `/folders`, `~/Documents/Oki` when unset. Each spore Oki makes has a folder of its own in it. It is fixed when the instance is made.
- The folder is shared over virtiofs, which needs `virtiofsd` on this host (`apt install virtiofsd` on Debian). Over Lima's 9p share, a spore before 1.66.0 was refused the writes its definition grants in `/folders`; virtiofs stays, as the one this launcher is checked with. `start.sh` refuses an instance where `/folders` is not mounted.
- The instance uses KVM. `start.sh` refuses a host user who may not open `/dev/kvm`, and a host without the device, where Lima would run the instance without KVM, very slowly; `start.sh --no-kvm` makes it anyway. The option matters only when the instance is made.
- `OKI_PLUGIN_WEB_TGZ` is the web connector's package (`npm pack` in plugin-web), which `provision.sh` refuses unless it is the one the manifest pins.
- Port 7760, the management service, is the one port forwarded. The web connector listens on 7761 inside the instance and is reached only through management.
- `boot-check.sh` sets a password to check the gate, then sets up a local model, served by a stub OpenAI-compatible server it runs in the instance on port 18080, names the first spore `main`, and checks that it answers through `/`, and that its write tool, called by the stub, leaves a file in its folder on this host. It checks the spores page: the kinds, making a Long-lived spore granted `/folders`, the refusals, deleting, and spore's refusals while `main` is in a turn and once it has turns. The stub also serves mohdex's `/v1` endpoints (`entries`, `results`, `recommended`) at `/mohdex/v1`, from a data file the check rewrites: it points the manifest's `curated` there and checks that the catalog is exactly the set computed from it, plus the local choice; it saves a Google key without asking Google, makes a model mohdex serves the default and a spore's model, has mohdex retire it, and checks the offer, the move, that the retired id stays retired once mohdex stops serving it, and that mohdex answering 500 and then 404 leaves the catalog as it is with the failure shown; then it puts the manifest back. A fresh instance must hold nothing in `.config/mohdel` but Oki's catalog, computed from the manifest's `curated` once mohdex is reached. Then it exports through the export form with a passphrase, checks that gpg opens the file with that passphrase only and that it holds the home without caches, and that this Oki refuses to import it. It removes the setup and the password, checks that the instance is fresh again, refuses the export with a wrong or no passphrase, truncated and tampered, and checks the instance is still fresh; then imports it unclaimed and checks that `main` is back, the export's password is asked, the instance's own web file kept, and `main` answers again with what it said before the export still on the page. While `main` is in a turn, an export is refused. Then it undoes all of it. It undoes only what it set: on an instance someone has claimed, the fresh-instance checks fail, and the setup checks are not run.
- The sign-ins (OpenRouter, ChatGPT, Google's key) need real accounts, so `boot-check.sh` does not run them; `npm test` in `management/` covers their wiring against the providers' answers.
- Starting again from nothing is `limactl delete -f oki`, then `./start.sh`. The shared folder stays.

## Moving to a new release

```bash
# in the running Oki: /oki/backup/, keep the file
./stop.sh
OKI_INSTANCE=oki-0.2.0 OKI_RELEASE=<release dir>/files ./start.sh   # starts empty
# open http://127.0.0.1:7760/oki/, Restore a backup
limactl delete -f oki                                          # once the new one works
```

Going back is `OKI_INSTANCE=oki-0.2.0 ./stop.sh`, then `./start.sh`, while the old instance is there.
What the new one did after the import is not in it.
