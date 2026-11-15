# Management service

The one address the browser opens.

A Node program, `bin/oki-management.js`, and its pages, Svelte 5 on the web connector's tokens, built to `build/`
before packing. In the appliance it is `/opt/oki/node_modules/@rhizogrip/oki-management`, run by
`oki-management.service`, a systemd user unit of `oki` that ships beside the program and that
`provision.sh` installs.

It calls spore and mohdel as libraries, the ones already in `/opt/oki`: `@rhizogrip/spore`,
`mohdel` (the version spore pins), and two modules of `@rhizogrip/spore-cli`, `src/doctor.js` and
`src/services.js`, for `spore doctor`'s checks and the service states. They are peer dependencies
at exact versions, so an image whose spore differs refuses to install this package.

```bash
oki-management /opt/oki/manifest.json
```

It reads the web connector's file, `~/.config/spore/web/oki.json`, and listens at its `origin`, the
address the browser opens, which a host forwards as it is: `127.0.0.1:7760` on Lima, the manifest's
`services.management.listen`, and a port of each account's own on Windows. It refuses a manifest that names no `curated`, the
address of mohdex's public API, which Oki's catalog is computed from.

## What it serves

| Path | What |
|---|---|
| `/oki/` | the system page: the default model in one line, the services, `spore doctor`'s checks and boundary, the release from the manifest, where the catalog came from, and the offer for a retired model |
| `/oki/spores/` | the spores: list, make, delete, and the same offer |
| `/oki/backup/` | the backup, called the export below: one file with everything Oki keeps, downloaded by the browser |
| `/oki/restore/` | the restore, called the import below, into an Oki that holds nothing yet; reachable unclaimed, from the claim screen |
| `/oki/setup/` | setup, while no model is set or no spore exists, and `/oki/` leads here then; afterwards the models page: the models a spore can run on, which one is the default, and the way to add others |
| `/oki/setup/openrouter/callback`, `/auth/callback` | where an OpenRouter, a ChatGPT sign-in comes back |
| `/oki/claim/` | the first-run screen, shown while nobody has claimed Oki |
| `/oki/sign-in/` | asked when a password is set and the browser has no session |
| `/oki/api/…` | `claim`, `sign-in`, `sign-out`, `setup/…`, `spores`, `spores/remove`, `models/default`, `catalog/refresh`, `catalog/move`, `export` (a form), `import` (the file as the body) writes (POST from Oki's own origin); `system`, `model`, `doctor`, `setup/…`, `spores`, `models`, `catalog`, `export`, `import` reads |
| everything else | forwarded unchanged to the connector, once Oki is claimed |

An unclaimed appliance serves nothing but the claim screen: until `access.json` exists, every path
outside `/oki/` redirects to `/oki/claim/`.

Each `/oki/` screen redirects to the one the state calls for. A request whose `Host` is not the web
file's `origin` is refused.

## Setup

The page form of `spore setup` (`spore-cli/src/setup.js`): the same steps through the same library
functions. The machine checks setup makes first are settled by the image, shown, and stop the page
only on a problem; the spores' directory and the tick timer are the image's. Then the model:

| Choice | Credential | Models |
|---|---|---|
| OpenRouter | sign-in, `startOpenRouterSignIn` / `finishOpenRouterSignIn`, then `verifyKey` and `saveKey` | the models Oki's catalog holds, then those mohdex has an entry for, each marked as mohdex says: checked against spore, partial spore conformance (with a link to its mohdex page), or not checked |
| ChatGPT | sign-in, `createChatGPT().startLogin` / `finishLogin`, plan usage required | the models mohdex recommends for spore, cheapest first, as setup offers them; then, on asking, every model as for OpenRouter |
| Google | a key from AI Studio, `verifyKey` then `saveKey` | the same |
| Local model | none | what the server's `/models` lists; the entry is `local/<id>` with the address as `baseURL` |
| Expert | a key, or a sign-in for those two | for any provider mohdel knows, the models the catalog holds, then those mohdex has an entry for, marked as for OpenRouter. The provider's own listing is never read for models |

A chosen model goes in the catalog as `spore setup` puts it there: `addFromMohdex` from mohdex's
entry. It is tagged `spore`, and made the default with
`setDefaultModel` only when there is none: later choices add a model and leave the default, which the
models page changes on its own (`models/default`, for a model that is ready). When Oki has no spore yet, the page then asks for the first spore's name, offering
`assistant`, and makes it as the spores page does. `/oki/` leads to setup until that spore exists. Every spore Oki
creates is granted a folder of its own in the host folder, `/folders/<its name>`, which Oki makes:
`writes: ['folder=/folders/<name>']`. A `writes` grant is spore's own, the one `spore here` gives:
the directory is linked into the spore as `folder` and changed in place. Spore tells a spore nothing
about a grant, so Oki appends a paragraph to the new `spore.cmk`: what `folder/` is to the person,
and that a file to keep goes there while `data/out/` is a download in the chat. Deleting a
spore leaves its folder. No model is named in this
code; models, prices and checks are read from mohdex, the providers and the catalog when the page
asks, and the models the catalog tags `advised` are offered first.

A sign-in's callback is at the web file's `origin`, the address the browser opened, so the provider
sends the browser back to Oki the way it came. OpenRouter's is under `/oki/setup/`. ChatGPT's is
`/auth/callback`, outside `/oki/`: a ChatGPT registration made by `mo chatgpt login` accepts only
`http://127.0.0.1:<port>/auth/callback`, and one made elsewhere stays bound to the path it was made
with, so this path keeps every registration usable from both Oki and `mo`. The callback is answered
without the session cookie, which a browser withholds on a navigation from another site; what
stands in for it is the sign-in itself: ChatGPT's `state`, OpenRouter's PKCE verifier, both held in
memory for ten minutes and used once. The callback answers a page that moves the browser on to
setup, a navigation from Oki itself, which carries the session again.

## Spores

The page lists every spore with its kind (the sporangium it was made from), its model and its state
(`show`, `stateWord`). It makes one with `define`: a name, a kind, a model, and its folder
as setup gives the first one. The kinds are `default` and `perennial` (`KINDS` in `service/spores.js`), shown
as General and Long-lived with the descriptions their sporangia carry. The model is the default, or
any model of the catalog a spore can run on now (`modelReadiness`), marked as setup marks them.

Deleting is `remove`, with its refusals shown as spore words them: a spore in a turn is not deleted
(`SPORE_RUNNING`), and one with recorded turns is deleted only once the person confirms
(`SPORE_HAS_TURNS`).

## Oki's catalog

mohdel's catalog, `~/.config/mohdel/curated.json`, holds the models Oki offers and the ones the
person chose. Nobody edits it by hand; the service writes it whole, and only what `mo check` accepts.

mohdex is its source. The image is frozen and the catalog must not be, so nothing is published or
baked in: the manifest's `curated` is mohdex's public API, `https://mohdex.dev/v1`, and the service
reads it at start, when a page asks it to retry (`catalog/refresh`), and behind any signed-in request, page or chat, once the last read is more than two hours old, or more than a minute old while a spore's last turn is a failed one (`stateOf`). No timer runs: an Oki nobody uses asks mohdex nothing.

- It reads two endpoints. `recommended`, asked at setup's bar with `near=2`, gives the models that
  meet spore's bar and those near it: the ones that ran every task of the bar and failed at most
  two, each with the tasks it failed. `entries` is then asked for every provider either list names,
  and for the first-run choices. `service/catalog.js` computes the catalog from them, the only place
  the rules live: a model that meets the bar or is near it is offered, whoever its provider is; one
  further from the bar, or that did not run all of it, is not, nor one mohdex names and has no entry
  for. `NEAR`, beside `BAR`, is how near counts. `advised` marks the cheapest model that meets the
  bar in each provider, else the near one that failed least; `free` a model priced at nothing.
  Retired ids are mohdex's stubs, kept where their chain ends at a model offered, and the stubs
  already in the catalog, so a retired id stays retired after mohdex stops serving it.
- Setup offers providers by name in two ways. Before a model is set, the first-run ones
  (OpenRouter, ChatGPT, Google), which cost nothing to try. After, those and every other provider
  the catalog holds a model of. Expert reaches any provider and any model, checked or not.
- What it computed is installed when it differs from what was installed last: its entries replace
  the catalog's, entries the person chose (tagged `spore`) stay, and the catalog is marked
  `"$oki": { "from", "digest", "at" }` with the address, the sha256 of the computed set and the time.
  A retirement stands over a choice; that is what the offer below is for.
- An address that does not answer, an answer that is not mohdex's shape, or a catalog mohdel
  rejects leaves the catalog as it is. The service says the failure once, and again only when the
  reason changes; the system page shows it.
- Until the first read succeeds the appliance holds no catalog of Oki's. Claiming works; setup's
  model screens, the spores page's model picker and the system page say Oki can't reach mohdex and
  offer to retry (the lists answer 409 `MOHDEX_UNREAD`); no list is shown in the meantime. The local
  model needs no catalog and is set up as ever.

keepoki.com may later redirect an address of its own to mohdex; nothing is served from there.

mohdel reads mohdex only at the address it fixes, so the service reads the two endpoints itself,
at the manifest's, and maps a `pricesFrom` provider's entries (ChatGPT's come from OpenAI's) as
mohdel's `mohdexEntries` does. Setup's own reads of mohdex go through mohdel, at `mohdex.dev`.

## A retired model in use

When the default model or a spore's model is a stub in the catalog, the system page and the spores
page say so, name every spore on it and whether it is the default, and name the replacement the
stub's chain ends at (or the missing model it ends at). They offer two actions: move to the
replacement, or choose another model. Nothing moves until the person picks one. A move adds the model
to each spore's `models:` and calls `switchModel`, which spore refuses for a spore in a turn; that
spore stays and the page says so. The default moves with `setDefaultModel`, and the new model is
tagged `spore`.

## Export and import

The one backup (`service/export.js`). Everything Oki keeps is in `/home/oki`, and the software
is the image's, so an export is that home directory and nothing else.

**What an export holds.** The home as a gzip tar, without `.cache/`: the spores (definitions,
`state.sqlite` with conversations, memory, schedules and their records), the chat's
history (`.local/state/spore/web/`), spore's configuration, mohdel's catalog and credentials (keys in
`.config/mohdel/environment`, the ChatGPT sign-in in `.local/share/mohdel/chatgpt/`), Oki's password
(`.config/oki/access.json`), and the units in the home. It also holds `.config/oki/backup.json`, which
Oki writes just before: the release it came from (release, build date, spore, mohdel, connector,
management, architecture, `dataSchema`) and when. It does not hold the shared folder, which is the
host's; a restore makes again, empty, each spore's folder that is not there.

**Consistent.** Every spore service that runs (the connector, the tick timer, any other) is stopped
with spore's own `spore service` functions, the export is written, and they are started again. A
unit stops only its main process, so a turn in progress would go on writing: the export is refused
while a spore is in a turn (`SPORE_RUNNING`).

**Encrypted with gpg.** `tar | gpg --symmetric --cipher-algo AES256`, OpenPGP's integrity-protected
encryption, with the passphrase the person types, given on a file descriptor; gpg runs in a home of
its own, removed after, with `--no-symkey-cache`, so nothing keeps the passphrase. gpg is Debian's,
installed by `provision.sh`, and opens the file anywhere: `gpg -d oki-….tar.gz.gpg | tar -xz`. Left
blank and confirmed, the export is the gzip tar itself. Nothing is written to disk on the way: the
file streams to the browser, as the answer to a form, so the browser saves it to disk; a failure
after the first byte ends the answer unfinished, and the browser marks the download failed. The
export page sets its referrer policy to `same-origin`, since under Oki's `no-referrer` a browser sends
a form's `Origin` as `null`.

**Import only into an Oki that holds nothing.** An import replaces the home, so it is refused
(`HOLDS_DATA`) where there is a spore, a default model, a mohdel key or a ChatGPT sign-in. Claiming
alone is not data: the import is offered on the claim screen, and from setup before a model is set.
The export's password comes with it, so after an import the person signs in with the password of the
Oki they exported from.

**Checked whole before anything is installed.** The file is unpacked into `~/.oki-import/` and must
pass gpg's integrity check, gzip's and tar's, and hold `backup.json`; a wrong passphrase
(`WRONG_PASSPHRASE`), a missing one (`ENCRYPTED`), a truncated or changed file (`DAMAGED`) or another
file (`NOT_AN_EXPORT`) is refused and the staging directory removed. Then, with the services stopped,
the home's entries are renamed aside and the export's into place, keeping this appliance's own
`.config/systemd/user/` and web file, which name this image's units and this host's address. spore
then reads each spore in a process of its own: it brings an older database to its schema, and
refuses one a newer spore made. A refusal (`SPORE_REFUSED`) renames everything back. Oki has no
version check of its own. After an import the catalog is computed again from mohdex. A staging
directory left by an import cut off (a power cut) stops the next one (`INTERRUPTED`): the appliance
may be incomplete, and the answer is a new one.

## Behind it, the connector

The connector runs in its proxy shape: the web file names `user`, the header the proxy names the
signed-in person in, and `origin`, the address every write must come from. Management sets that
header to `operator` on every request it forwards, replacing any the browser sent. Behind a proxy
the connector no longer checks `Host`, which is why management does.

```json
{ "listen": "127.0.0.1:7761", "origin": "http://127.0.0.1:7760", "user": "x-forwarded-user", "people": { "operator": "*" } }
```

## The password

Optional. On first opening Oki it is claimed: a password is set, or the claim is made without
one. `~/.config/oki/access.json` records it, `{ "password": null }` or the password's scrypt hash
and salt with the key that signs sessions. Its absence means unclaimed. A fresh image has none.

With a password, management forwards nothing until it is entered, the chat
included. A session is a cookie, `oki`, holding its expiry and an HMAC-SHA256 of it under that key,
valid 30 days. Forgetting the password means removing `access.json` from a shell in the appliance,
after which Oki is unclaimed again.

**This is not a security boundary against a determined local attacker.** Anyone who can run code
as `oki`, or as root, in the appliance reads the file, the key and the conversations directly; the
connector itself still answers on its own loopback port inside the appliance, and whether WSL
forwards that port to other Windows accounts is an open question; nothing limits
how fast passwords are tried. The password keeps a browser on the same machine from walking in, and no
more.

## Building

The pages take their colours, type and spacing from the web connector's `page/tokens.css`, so they
look like the chat they sit around, and they follow the light or dark scheme picked
there. The build reads that file from the plugin-web checkout beside this repository
(`../../plugin-web` from here), which must be at the version the manifest pins. What the tokens lack,
a colour for success and one for a warning, is in `src/app.css`; the parts are in `src/lib/ui/`.
`npm ci`, then `npm pack`, which builds first. `launcher/linux/start.sh`
does both when it makes an instance.

## Working on the pages

```bash
npx vite dev --port 4131   # http://localhost:4131/oki/claim/
```

The dev server passes `/oki/api` to a running Oki at the manifest's `services.management.listen`, so the pages show what that Oki holds, and a button pressed here acts on it. It does none of the service's redirects: open each page by its address (`/oki/claim/`, `/oki/setup/`, `/oki/spores/`, `/oki/backup/`, `/oki/restore/`).
