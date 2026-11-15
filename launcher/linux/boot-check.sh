#!/bin/sh
# Starts Oki and checks that it is the appliance image/manifest.json describes, freshly made:
# a PASS or FAIL line per check, and exit 1 when any fails. It sets a password to check the gate,
# then sets up a local model served by a stub it runs in the instance, and talks to the first spore
# through the chat. It undoes all of it only when it was the one to claim the instance.
set -u
here=$(cd "$(dirname "$0")" && pwd)
. "$here/common.sh"

"$here/start.sh" || fail "start.sh failed"

guest () { limactl shell --workdir / "$name" "$@" </dev/null; }
as_oki () { guest sudo -u oki -H env XDG_RUNTIME_DIR=/run/user/1000 "$@"; }
field () { guest jq -er "$1" /opt/oki/manifest.json; }

failures=0
check () {
  label=$1
  shift
  if why=$("$@" 2>&1); then
    echo "PASS  $label"
  else
    echo "FAIL  $label — $why"
    failures=$((failures + 1))
  fi
}
is () { [ "$2" = "$3" ] || { echo "$1 is ${2:-nothing}, expected $3"; return 1; }; }

manifest () {
  provisioned=$(guest jq -S 'del(.built, .computer)' /opt/oki/manifest.json) || return 1
  repo=$(limactl shell --workdir / "$name" jq -S . < "$image/manifest.json") || return 1
  [ "$provisioned" = "$repo" ] || { echo "the instance was provisioned from another manifest — limactl delete -f $name, then start.sh again"; return 1; }
  field .built >/dev/null || { echo "the manifest in the instance has no build date"; return 1; }
  is "the computer in the instance's manifest" "$(field .computer)" "$(hostname)"
}

base () {
  is distribution "$(guest sh -c '. /etc/os-release && echo "$ID $VERSION_ID"')" "$distribution" || return 1
  grep -qF "$digest" "$(limactl list --format '{{.Dir}}' "$name")/lima.yaml" || { echo "the instance was not made from $image_url"; return 1; }
}

held_by_lima () { ss -ltnpH "sport = :$1" | grep -qE '"(limactl|ssh)"'; }

within_a_minute () {
  tries=0
  until "$@"; do
    tries=$((tries + 1))
    [ "$tries" -lt 30 ] || { echo "nothing answers after a minute"; return 1; }
    sleep 2
  done
}

management () {
  is "the management port" "$port" "${management_listen##*:}" || return 1
  within_a_minute curl -fs -o /dev/null "$origin/oki/" || return 1
  held_by_lima "$port" || { echo "port $port on this host is not Lima's forward: $(ss -ltnpH "sport = :$port")"; return 1; }
}

connector () { within_a_minute guest curl -fs -o /dev/null "http://$connector_listen/"; }

not_forwarded () {
  ! held_by_lima "${connector_listen##*:}" || { echo "Lima forwards port ${connector_listen##*:} to this host"; return 1; }
}

jar=$(mktemp)
exports=$(mktemp -d)
trap 'rm -rf "$jar" "$exports"' EXIT
answer () { curl -s -o /dev/null -w '%{http_code} %{redirect_url}' "$@"; }

claiming () {
  is "$origin/" "$(answer "$origin/")" "303 $origin/oki/claim/" || return 1
  curl -fs "$origin/oki/claim/" | grep -q '<title>Claim Oki</title>' || { echo "$origin/oki/claim/ is not the claiming screen"; return 1; }
}

claim () {
  is "claiming with a password" "$(answer -c "$jar" -X POST -H "origin: $origin" -H 'content-type: application/json' -d '{"password":"boot-check"}' "$origin/oki/api/claim")" '200 '
}

gate_refuses () {
  is "/ without the session" "$(answer "$origin/")" "303 $origin/oki/sign-in/" || return 1
  is "/oki/ without the session" "$(answer "$origin/oki/")" "303 $origin/oki/sign-in/" || return 1
  is "/api/me without the session" "$(answer "$origin/api/me")" '401 '
}

gate_serves () {
  is "/ with the session" "$(answer -b "$jar" "$origin/")" '200 ' || return 1
  is "/oki/ with the session" "$(answer -b "$jar" "$origin/oki/")" "$1" || return 1
  is "/api/me with the session" "$(answer -b "$jar" "$origin/api/me")" '200 '
}

forwarded_page () {
  through=$(curl -fs -b "$jar" "$origin/") || { echo "$origin/ does not answer"; return 1; }
  direct=$(guest curl -fs "http://$connector_listen/") || return 1
  [ -n "$direct" ] && [ "$through" = "$direct" ] || { echo "$origin/ is not the page the connector serves at $connector_listen"; return 1; }
}

forwarded_person () {
  me=$(curl -fs -b "$jar" "$origin/api/me") || { echo "$origin/api/me does not answer"; return 1; }
  echo "$me" | grep -q '"person":"operator"' || { echo "$origin/api/me is $me"; return 1; }
  is "the menu $origin/api/me gives the page" "$(printf '%s\n' "$me" | in_guest_jq -c '[.shell.name, [.shell.links[].href]]')" '["Oki",["/oki/spores/","/oki/setup/","/oki/backup/","/oki/"]]'
}

STUB='
const { createServer } = require("node:http")
const { readFile } = require("node:fs")
const [port, model, answer, delay, mohdex, asked, written] = process.argv.slice(2)
const MOHDEX = "/mohdex/v1/"
createServer((request, response) => {
  const url = new URL(request.url, "http://stub")
  if (request.method === "GET" && url.pathname.startsWith(MOHDEX)) {
    readFile(mohdex, "utf8", (err, text) => {
      if (err) return response.writeHead(404).end()
      let data
      try {
        data = JSON.parse(text)
      } catch {
        return response.writeHead(500).end()
      }
      const provider = url.searchParams.get("provider")
      const within = (all) => Object.fromEntries(Object.entries(all).filter(([key]) => provider === null || key.startsWith(`${provider}/`)))
      const route = url.pathname.slice(MOHDEX.length)
      const body = route === "entries" ? within(data.entries) : route === "results" ? within(data.results) : route === "recommended" && url.searchParams.get("near") === "2" ? { models: data.recommended.map(key => ({ key, version: "1.63.0" })), near: data.near } : null
      if (body === null) return response.writeHead(404).end()
      response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(body))
    })
    return
  }
  if (request.method === "GET" && request.url === "/v1/models") {
    response.writeHead(200, { "content-type": "application/json" })
    response.end(JSON.stringify({ object: "list", data: [{ id: model, object: "model", owned_by: "oki-boot-check" }] }))
    return
  }
  if (request.method === "POST" && request.url === "/v1/chat/completions") {
    let body = ""
    request.setEncoding("utf8")
    request.on("data", (piece) => { body += piece })
    request.on("end", () => setTimeout(() => {
      const chunk = (choices, usage) => `data: ${JSON.stringify({ id: "stub", object: "chat.completion.chunk", created: 0, model, choices, ...(usage ? { usage } : {}) })}\n\n`
      const last = JSON.parse(body).messages.at(-1)
      const writes = last.role === "user" && JSON.stringify(last.content).includes(asked)
      response.writeHead(200, { "content-type": "text/event-stream" })
      if (writes) {
        response.write(chunk([{ index: 0, delta: { role: "assistant", tool_calls: [{ index: 0, id: "call_oki_boot_check", type: "function", function: { name: "write", arguments: JSON.stringify({ path: written, content: "oki" }) } }] }, finish_reason: null }]))
        response.write(chunk([{ index: 0, delta: {}, finish_reason: "tool_calls" }]))
      } else {
        response.write(chunk([{ index: 0, delta: { role: "assistant", content: answer }, finish_reason: null }]))
        response.write(chunk([{ index: 0, delta: {}, finish_reason: "stop" }]))
      }
      response.write(chunk([], { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }))
      response.end("data: [DONE]\n\n")
    }, Number(delay)))
    return
  }
  response.writeHead(404).end()
}).listen(Number(port), "127.0.0.1")
'
stub_port=18080
stub_model=oki-boot-check-model
stub_answer='the boot-check stub answers'
stub_asked='oki-boot-check asks for a file in the folder'
stub_written=folder/oki-boot-check-written
stub_address=http://127.0.0.1:$stub_port/v1
stub_delay_ms=4000
stub_mohdex=/tmp/oki-boot-check-mohdex.json
stub_mohdex_base=http://127.0.0.1:$stub_port/mohdex/v1
catalog=/home/oki/.config/mohdel/curated.json

MOHDEX_DATA='
def entry($key; $in; $out):
  ($key | split("/")) as $parts
  | ($parts[1:] | join("/")) as $model
  | { provider: $parts[0], sdk: ({ openrouter: "openrouter", openai: "openai", gemini: "gemini" }[$parts[0]]), model: $model, label: $model, creator: "oki-boot-check", inputFormat: ["text"], contextTokenLimit: 32768, outputTokenLimit: 4096, inputPrice: $in, outputPrice: $out, source: "https://example.org/oki-boot-check", sourcedAt: "2026-11-01" };
def tasks($failed):
  $failed | to_entries | map({ key: "spore/conformance/core/task-\(.key)", value: { digest: "oki-boot-check", latestVersion: "1.63.0", runs: 1, passed: (if .value > 0 then 0 else 1 end), failed: .value, reasons: {} } }) | from_entries;
{
  entries: ({
    "openrouter/oki-boot-check/free": entry("openrouter/oki-boot-check/free"; 0; 0),
    "openrouter/oki-boot-check/untested": entry("openrouter/oki-boot-check/untested"; 1; 2),
    "openai/oki-boot-check-plan": entry("openai/oki-boot-check-plan"; 1; 4),
    "gemini/oki-boot-check-b": entry("gemini/oki-boot-check-b"; 0.1; 0.4),
    "gemini/oki-boot-check-gone": { deprecated: "gemini/oki-boot-check-elsewhere" }
  } + (if $variant == "offered" then { "gemini/oki-boot-check-a": entry("gemini/oki-boot-check-a"; 0.5; 2) }
    elif $variant == "retired" then { "gemini/oki-boot-check-a": { deprecated: "gemini/oki-boot-check-b" } }
    else {} end)),
  results: {
    "openrouter/oki-boot-check/free": tasks([0, 0]),
    "chatgpt/oki-boot-check-plan": tasks([0, 1]),
    "gemini/oki-boot-check-a": tasks([0, 0]),
    "gemini/oki-boot-check-b": tasks([0, 0])
  },
  recommended: ["openrouter/oki-boot-check/free", "gemini/oki-boot-check-a", "gemini/oki-boot-check-b"],
  near: [{ key: "chatgpt/oki-boot-check-plan", version: "1.63.0", failed: [{ taskId: "spore/conformance/core/task-1", reasons: {} }] }]
}
'

in_guest_jq () { limactl shell --workdir / "$name" jq "$@"; }
write () { curl -fsS -b "$jar" -H "origin: $origin" -H 'content-type: application/json' -d "$2" "$origin$1"; }

setup_first () {
  is "/oki/ with no model set" "$(answer -b "$jar" "$origin/oki/")" "303 $origin/oki/setup/" || return 1
  curl -fs -b "$jar" "$origin/oki/setup/" | grep -q '<title>Oki — models</title>' || { echo "$origin/oki/setup/ is not the setup screen"; return 1; }
}

stub () {
  printf '%s' "$STUB" | limactl shell --workdir / "$name" sh -c 'cat > /tmp/oki-boot-check-stub.js' || return 1
  guest sh -c "setsid -f node /tmp/oki-boot-check-stub.js $stub_port $stub_model '$stub_answer' $stub_delay_ms $stub_mohdex '$stub_asked' $stub_written > /tmp/oki-boot-check-stub.log 2>&1 < /dev/null" || return 1
  within_a_minute guest curl -fs -o /dev/null "$stub_address/models"
}

local_listed () {
  is "what $origin/oki/api/setup/local lists" "$(write /oki/api/setup/local "{\"address\":\"$stub_address\"}")" "{\"models\":[\"$stub_model\"]}"
}

local_chosen () {
  chosen=$(write /oki/api/setup/choose "{\"provider\":\"local\",\"address\":\"$stub_address\",\"id\":\"$stub_model\"}") || return 1
  is "the model chosen, and no spore made" "$(printf '%s\n' "$chosen" | in_guest_jq -c '[.model, .spores]')" "[\"local/$stub_model\",[]]" || return 1
  is "/oki/ with a model and no spore" "$(answer -b "$jar" "$origin/oki/")" "303 $origin/oki/setup/"
}

first_spore_named () {
  made=$(write /oki/api/spores "{\"name\":\"main\",\"kind\":\"default\",\"model\":\"local/$stub_model\"}") || return 1
  is "the spore made" "$(printf '%s\n' "$made" | in_guest_jq -c '[.name, .kind, .model]')" "[\"main\",\"default\",\"local/$stub_model\"]"
}

main_granted_folder () {
  granted=$(guest sudo grep '^writes:' /home/oki/.spore/main/spore.cmk) || { echo "main's spore.cmk grants no writes"; return 1; }
  is "main's writes grant" "$granted" 'writes: [folder=/folders/main]' || return 1
  guest sudo grep -qF 'folder/' /home/oki/.spore/main/spore.cmk || { echo "main's spore.cmk does not say what folder/ is"; return 1; }
  guest sudo grep -qF 'You run inside Oki' /home/oki/.spore/main/spore.cmk || { echo "main's spore.cmk does not say it runs inside Oki"; return 1; }
  [ -d "$folder/main" ] || { echo "$folder/main is not on this host"; return 1; }
}

main_listed () {
  is "/oki/ with a model set" "$(answer -b "$jar" "$origin/oki/")" '200 ' || return 1
  me=$(curl -fs -b "$jar" "$origin/api/me") || return 1
  is "the spores $origin/api/me lists" "$(printf '%s\n' "$me" | in_guest_jq -c '[.spores[].name]')" '["main"]'
}

said_back () { curl -fs -b "$jar" "$origin/api/history" | grep -qF "$stub_answer"; }

answers () {
  write /api/messages '{"id":"oki-boot-check","to":"main","text":"hello"}' >/dev/null || return 1
  within_a_minute said_back
}

said_more () { [ "$(said_count)" -gt "$1" ]; }

writes_its_folder () {
  made=$folder/main/${stub_written#folder/}
  said=$(said_count)
  write /api/messages "{\"id\":\"oki-boot-check-folder\",\"to\":\"main\",\"text\":\"$stub_asked\"}" >/dev/null || return 1
  within_a_minute test -f "$made" || { echo "main's write tool was asked for $stub_written, and $made is not on this host — $(guest sudo sh -c 'cat /home/oki/.spore/main/calls/*/*/err' 2>&1 | tail -3)"; return 1; }
  is "what main wrote in its folder" "$(cat "$made")" oki || return 1
  rm "$made" || return 1
  within_a_minute said_more "$said"
}

model_state () {
  model=$(curl -fs -b "$jar" "$origin/oki/api/model") || return 1
  is "the model the system page shows" "$(printf '%s\n' "$model" | in_guest_jq -c '[.model.model, .model.ready, .model.conformance]')" "[\"local/$stub_model\",true,\"unchecked\"]"
}

setup_undone () {
  guest pkill -f 'oki-boot-check-stu[b]'
  as_oki systemctl --user stop "$connector_unit" || return 1
  guest sudo rm -rf /home/oki/.spore /home/oki/.config/mohdel /home/oki/.config/spore/sporangia /home/oki/.local/state/spore/web/oki || return 1
  for made in main boot-check retiring; do
    [ ! -d "$folder/$made" ] || rmdir "$folder/$made" || return 1
  done
  as_oki systemctl --user start "$connector_unit" || return 1
  connector || return 1
  management_restarted
}

unclaim () {
  guest sudo rm -r /home/oki/.config/oki || return 1
  blank || return 1
  claiming
}

folders_mounted () {
  guest mountpoint -q /folders || { echo "/folders is not a mount"; return 1; }
  probe=.oki-boot-check
  as_oki sh -c "echo oki > /folders/$probe" || return 1
  [ -f "$folder/$probe" ] || { echo "written as oki to /folders/$probe, and not in $folder/$probe on this host"; return 1; }
  as_oki rm "/folders/$probe"
}

SAID='
const { existsSync, readdirSync } = require("node:fs")
const { DatabaseSync } = require("node:sqlite")
const dir = `${process.env.HOME}/.local/state/spore/web`
let said = 0
for (const page of existsSync(dir) ? readdirSync(dir) : []) {
  const log = `${dir}/${page}/log.sqlite`
  if (existsSync(log)) said += new DatabaseSync(log, { readOnly: true }).prepare("select count(*) as n from events").get().n
}
console.log(said)
'

management_restarted () {
  as_oki systemctl --user restart "$management_unit" || return 1
  within_a_minute curl -fs -o /dev/null "$origin/oki/sign-in/"
}

catalog_oki () {
  guest sudo test -f $catalog || return 0
  is "where the catalog came from" "$(guest sudo jq -r '."$oki".from' $catalog)" "$(field .curated)"
}

api () { curl -fsS -b "$jar" "$origin/oki/api/$1"; }
refused_as () { answer=$(curl -sS -b "$jar" -H "origin: $origin" -H 'content-type: application/json' -d "$2" "$origin$1") || return 1; is "the refusal of $2" "$(printf '%s\n' "$answer" | in_guest_jq -r '.type // .error')" "$3"; }

spores_listed () {
  spores=$(api spores) || return 1
  is "the kinds offered" "$(printf '%s\n' "$spores" | in_guest_jq -c '[.kinds[].name]')" '["default","perennial"]' || return 1
  is "the spores listed" "$(printf '%s\n' "$spores" | in_guest_jq -c '[.spores[] | [.name, .kind, .model, .folder]]')" "[[\"main\",\"default\",\"local/$stub_model\",true]]"
}

spore_made () {
  made=$(write /oki/api/spores "{\"name\":\"boot-check\",\"kind\":\"perennial\",\"model\":\"local/$stub_model\"}") || return 1
  is "the spore made" "$(printf '%s\n' "$made" | in_guest_jq -c '[.name, .kind, .model]')" "[\"boot-check\",\"perennial\",\"local/$stub_model\"]" || return 1
  is "its writes grant" "$(guest sudo grep '^writes:' /home/oki/.spore/boot-check/spore.cmk)" 'writes: [folder=/folders/boot-check]' || return 1
  mkdir "$folder/held" && : > "$folder/held/kept" || return 1
  refused_as /oki/api/spores "{\"name\":\"held\",\"kind\":\"default\",\"model\":\"local/$stub_model\"}" FOLDER_HOLDS_FILES || return 1
  rm "$folder/held/kept" && rmdir "$folder/held" || return 1
  refused_as /oki/api/spores "{\"name\":\"other\",\"kind\":\"code\",\"model\":\"local/$stub_model\"}" 'a spore made here is one of default, perennial' || return 1
  refused_as /oki/api/spores "{\"name\":\"../other\",\"kind\":\"default\",\"model\":\"local/$stub_model\"}" "a spore's name is letters, digits, ., _ and -, starting with a letter or digit, at most 64"
}

spore_removed () {
  write /oki/api/spores/remove '{"name":"boot-check"}' >/dev/null || return 1
  is "the spores listed" "$(api spores | in_guest_jq -c '[.spores[].name]')" '["main"]'
}

main_running () { [ "$(api spores | in_guest_jq -r '.spores[] | select(.name == "main") | .running')" = true ]; }
main_idle () { [ "$(api spores | in_guest_jq -r '.spores[] | select(.name == "main") | .running')" = false ]; }

running_refused () {
  write /api/messages '{"id":"oki-boot-check-running","to":"main","text":"again"}' >/dev/null || return 1
  within_a_minute main_running || return 1
  refused_as /oki/api/spores/remove '{"name":"main","yes":true}' SPORE_RUNNING || return 1
  refused=$(answer -b "$jar" -H "origin: $origin" -d "passphrase=$passphrase&again=$passphrase" "$origin/oki/api/export")
  case "$refused" in "303 $origin/oki/backup/?error=main%20is%20in%20a%20turn"*) ;; *) echo "the export while main is in a turn answered $refused"; return 1 ;; esac
  connector || return 1
  within_a_minute main_idle || return 1
  refused_as /oki/api/spores/remove '{"name":"main"}' SPORE_HAS_TURNS
}

mohdex_serves () {
  printf '%s' "$MOHDEX_DATA" | limactl shell --workdir / "$name" sh -c 'cat > /tmp/oki-boot-check-mohdex.jq' || return 1
  guest sh -c "jq -n --arg variant $1 -f /tmp/oki-boot-check-mohdex.jq > $stub_mohdex"
}

catalog_read () { write /oki/api/catalog/refresh '{}' >/dev/null; }
shape () { guest sudo jq -c '[to_entries[] | select(.key | startswith("$") | not) | [.key, (.value.deprecated // (.value.tags // []))]] | sort' $catalog; }
spore_model () { guest sudo grep '^model:' "/home/oki/.spore/$1/spore.cmk"; }

mohdex_computed () {
  mohdex_serves offered || return 1
  guest sudo cp /opt/oki/manifest.json /opt/oki/manifest.json.boot-check || return 1
  guest sudo sh -c "jq '.curated = \"$stub_mohdex_base\"' /opt/oki/manifest.json.boot-check > /opt/oki/manifest.json" || return 1
  management_restarted || return 1
  within_a_minute guest sudo sh -c "[ \"\$(jq -r '.\"\$oki\".from' $catalog)\" = '$stub_mohdex_base' ]" || return 1
  is "the catalog" "$(shape)" "[[\"chatgpt/oki-boot-check-plan\",[\"advised\"]],[\"gemini/oki-boot-check-a\",[]],[\"gemini/oki-boot-check-b\",[\"advised\"]],[\"local/$stub_model\",[\"spore\"]],[\"openrouter/oki-boot-check/free\",[\"free\",\"advised\"]]]" || return 1
  is "the catalog's state" "$(api catalog | in_guest_jq -c '[.url, .unread, .failed]')" "[\"$stub_mohdex_base\",null,null]"
}

mohdex_model_used () {
  is "a Google key saved without asking Google" "$(write /oki/api/setup/key '{"provider":"gemini","key":"AIza-oki-boot-check","anyway":true}' | in_guest_jq -c .saved)" true || return 1
  is "the model added, the default kept" "$(write /oki/api/setup/choose '{"provider":"gemini","model":"gemini/oki-boot-check-a"}' | in_guest_jq -c '[.added, .model]')" "[\"gemini/oki-boot-check-a\",\"local/$stub_model\"]" || return 1
  is "the default made" "$(write /oki/api/models/default '{"model":"gemini/oki-boot-check-a"}' | in_guest_jq -r .model)" gemini/oki-boot-check-a || return 1
  is "the spore made" "$(write /oki/api/spores '{"name":"retiring","kind":"default","model":"gemini/oki-boot-check-a"}' | in_guest_jq -r .model)" gemini/oki-boot-check-a
}

retired_offered () {
  mohdex_serves retired || return 1
  catalog_read || return 1
  is "what the catalog says of gemini/oki-boot-check-a" "$(guest sudo jq -c '."gemini/oki-boot-check-a"' $catalog)" '{"deprecated":"gemini/oki-boot-check-b"}' || return 1
  is "the offer" "$(api catalog | in_guest_jq -c '[.deprecations[] | [.model, .spores, .isDefault, .replacement]]')" '[["gemini/oki-boot-check-a",["retiring"],true,"gemini/oki-boot-check-b"]]' || return 1
  is "retiring's model, before anyone moves it" "$(spore_model retiring)" "model: gemini/oki-boot-check-a"
}

retired_moved () {
  moved=$(write /oki/api/catalog/move '{"from":"gemini/oki-boot-check-a","to":"gemini/oki-boot-check-b"}') || return 1
  is "the move" "$(printf '%s\n' "$moved" | in_guest_jq -c '[.moved, .refused, .defaultMoved]')" '[["retiring"],[],true]' || return 1
  is "retiring's model" "$(spore_model retiring)" "model: gemini/oki-boot-check-b" || return 1
  is "main's model" "$(spore_model main)" "model: local/$stub_model" || return 1
  is "the default for new spores" "$(api model | in_guest_jq -r '.model.model')" gemini/oki-boot-check-b || return 1
  is "the offers left" "$(api catalog | in_guest_jq -c '.deprecations')" '[]'
}

retired_kept () {
  mohdex_serves forgotten || return 1
  catalog_read || return 1
  is "what the catalog says of gemini/oki-boot-check-a" "$(guest sudo jq -c '."gemini/oki-boot-check-a"' $catalog)" '{"deprecated":"gemini/oki-boot-check-b"}'
}

unreachable_kept () {
  before=$(guest sudo sha256sum $catalog) || return 1
  guest sh -c "echo broken > $stub_mohdex" || return 1
  catalog_read || return 1
  api catalog | grep -q 'answered 500"' || { echo "the system page does not show the 500: $(api catalog)"; return 1; }
  guest rm $stub_mohdex || return 1
  catalog_read || return 1
  api catalog | grep -q 'answered 404"' || { echo "the system page does not show the 404: $(api catalog)"; return 1; }
  is "the catalog" "$(guest sudo sha256sum $catalog)" "$before"
}

manifest_restored () {
  guest sudo mv /opt/oki/manifest.json.boot-check /opt/oki/manifest.json || return 1
  management_restarted || return 1
  manifest
}

blank () {
  found=$(guest sudo sh -c 'cd /home/oki && for path in .config/oki .config/spore/environment .config/spore/ssh .config/spore/sluice .ssh; do [ ! -e "$path" ] || echo "$path"; done; [ ! -d .spore ] || find .spore -mindepth 1 -maxdepth 1') || return 1
  [ -z "$found" ] || { echo "/home/oki holds" $found; return 1; }
  is "spore's config.json" "$(guest sudo jq -cS . /home/oki/.config/spore/config.json)" '{"home":"~/.spore"}' || return 1
  held=$(guest sudo sh -c 'ls -A /home/oki/.config/mohdel 2>/dev/null' | tr '\n' ' ')
  case "$held" in
    '') ;;
    'curated.json ') is "the models in the catalog chosen by someone" "$(guest sudo jq -c '[to_entries[] | select(.value.tags? // [] | index("spore")) | .key]' $catalog)" '[]' || return 1 ;;
    *) echo "/home/oki/.config/mohdel holds $held"; return 1 ;;
  esac
  is "what the web connector's log holds" "$(as_oki node -e "$SAID")" 0
}

exported () {
  status=$(curl -s -b "$jar" -H "origin: $origin" -d "passphrase=$passphrase&again=$passphrase" -D "$exports/headers" -o "$exports/oki.tar.gz.gpg" -w '%{http_code}' "$origin/oki/api/export") || return 1
  is "the export's answer" "$status" 200 || return 1
  grep -qi "^content-disposition: attachment; filename=\"oki-$release-backup-[0-9-]*\.tar\.gz\.gpg\"" "$exports/headers" || { echo "the export is $(grep -i '^content-disposition' "$exports/headers")"; return 1; }
  is "the last export" "$(api export | in_guest_jq -c '[.busy, .last.encrypted]')" '[null,true]' || return 1
  connector
}

in_guest_gpg () {
  printf '%s\n' "$1" | limactl shell --workdir / "$name" sh -c 'home=$(mktemp -d); gpg --homedir "$home" --batch --quiet --pinentry-mode loopback --passphrase-fd 0 --decrypt --output - /tmp/oki-boot-check-export.gpg | tar -tz; status=$?; gpgconf --homedir "$home" --kill gpg-agent; rm -rf "$home"; exit $status'
}

export_encrypted () {
  [ "$(od -An -tx1 -N2 "$exports/oki.tar.gz.gpg" | tr -d ' ')" != 1f8b ] || { echo "the export is a plain gzip"; return 1; }
  limactl copy "$exports/oki.tar.gz.gpg" "$name:/tmp/oki-boot-check-export.gpg" || return 1
  ! in_guest_gpg not-the-passphrase >/dev/null 2>&1 || { echo "gpg opens the export with another passphrase"; return 1; }
  listed=$(in_guest_gpg "$passphrase") || { echo "gpg does not open the export with its passphrase"; return 1; }
  for path in ./.spore/main/spore.cmk ./.config/oki/access.json ./.config/oki/backup.json ./.local/state/spore/web; do
    echo "$listed" | grep -qxF "$path/" || echo "$listed" | grep -qxF "$path" || { echo "the export holds no $path"; return 1; }
  done
  ! echo "$listed" | grep -q '^\./\.cache/' || { echo "the export holds caches"; return 1; }
}

import_refused_as () {
  refused=$(curl -sS -H "origin: $origin" -H 'content-type: application/octet-stream' -H "x-oki-passphrase: $2" --data-binary "@$1" -b "$jar" "$origin/oki/api/import") || return 1
  is "the refusal of $(basename "$1")" "$(printf '%s\n' "$refused" | in_guest_jq -r '.type // .error')" "$3"
}

imports_refused () {
  head -c "$(( $(wc -c < "$exports/oki.tar.gz.gpg") * 4 / 5 ))" "$exports/oki.tar.gz.gpg" > "$exports/truncated" || return 1
  cp "$exports/oki.tar.gz.gpg" "$exports/tampered" || return 1
  dd if=/dev/zero of="$exports/tampered" bs=1 count=16 seek="$(( $(wc -c < "$exports/tampered") / 2 ))" conv=notrunc 2>/dev/null || return 1
  is "/oki/restore/, unclaimed" "$(answer "$origin/oki/restore/")" '200 ' || return 1
  import_refused_as "$exports/oki.tar.gz.gpg" not-the-passphrase WRONG_PASSPHRASE || return 1
  import_refused_as "$exports/oki.tar.gz.gpg" '' ENCRYPTED || return 1
  import_refused_as "$exports/truncated" "$passphrase" DAMAGED || return 1
  import_refused_as "$exports/tampered" "$passphrase" DAMAGED || return 1
  blank || return 1
  claiming
}

imported () {
  done=$(curl -sS -H "origin: $origin" -H 'content-type: application/octet-stream' -H "x-oki-passphrase: $passphrase" --data-binary "@$exports/oki.tar.gz.gpg" "$origin/oki/api/import") || return 1
  is "the import" "$(printf '%s\n' "$done" | in_guest_jq -c '[.record.release, .encrypted, .spores]')" "[\"$release\",true,[\"main\",\"retiring\"]]" || return 1
  for restored in main retiring; do
    [ -d "$folder/$restored" ] || { echo "the import did not make $folder/$restored again"; return 1; }
  done
  is "/ after the import, without the session" "$(answer "$origin/")" "303 $origin/oki/sign-in/" || return 1
  gate_serves '200 ' || return 1
  is "the web file's origin" "$(guest sudo jq -r .origin /home/oki/.config/spore/web/oki.json)" "$origin"
}

said_count () { curl -fs -b "$jar" "$origin/api/history" | grep -oF "$stub_answer" | wc -l; }
said_more () { [ "$(said_count)" -gt "$1" ]; }

answers_after_import () {
  before=$(said_count) || return 1
  [ "$before" -ge 1 ] || { echo "what main said before the export is not in $origin/api/history"; return 1; }
  write /api/messages '{"id":"oki-boot-check-imported","to":"main","text":"still there?"}' >/dev/null || return 1
  within_a_minute said_more "$before"
}

no_failed_units () {
  failed_units=$(as_oki systemctl --user list-units --state=failed --plain --no-legend) || return 1
  [ -z "$failed_units" ] || { echo "$failed_units"; return 1; }
}

distribution=$(field .base.distribution)
digest=$(field .base.digest)
image_url=$(field .base.image)
spore=$(field .spore)
mohdel=$(field .mohdel)
plugin_web=$(field .pluginWeb.version)
management_version=$(field .management)
node=$(field .node.version)
management_listen=$(field .services.management.listen)
management_unit=$(field .services.management.unit)
connector_listen=$(field .services.connector.listen)
connector_unit=$(field .services.connector.unit)
tick_unit=$(field .services.tick.unit)
release=$(field .release)
passphrase=boot-check-passphrase
origin=http://127.0.0.1:$port

check "the instance was provisioned from image/manifest.json" manifest
check "base: $distribution, $image_url" base
check "management answers at $origin" management
check "the connector answers at $connector_listen in the instance" connector
check "the connector's port ${connector_listen##*:} is not forwarded to this host" not_forwarded
check "unclaimed, $origin/ redirects to the claiming screen" claiming
check "spore $spore" is spore "$(as_oki spore --version)" "$spore"
check "mohdel $mohdel" is mohdel "$(as_oki mo --version)" "$mohdel"
check "web connector $plugin_web" is "the web connector" "$(guest jq -r .version /opt/oki/node_modules/@rhizogrip/spore-plugin-web/package.json)" "$plugin_web"
check "management $management_version" is "the management service" "$(guest jq -r .version /opt/oki/node_modules/@rhizogrip/oki-management/package.json)" "$management_version"
check "node $node" is node "$(as_oki node --version)" "$node"
check "$tick_unit enabled" is "$tick_unit" "$(as_oki systemctl --user is-enabled "$tick_unit")" enabled
check "$management_unit enabled" is "$management_unit" "$(as_oki systemctl --user is-enabled "$management_unit")" enabled
check "/folders mounted and writable by oki" folders_mounted
check "no credentials, password, spores or conversations in /home/oki, and nothing but Oki's catalog in mohdel's" blank
check "the catalog, once mohdex is reached, is computed from $(field .curated)" catalog_oki
check "a password set at $origin/oki/api/claim" claim
check "with the password set, /, /oki/ and /api/me refuse without the session" gate_refuses
check "with the password set, / and /api/me serve with the session, and /oki/ leads to setup" gate_serves "303 $origin/oki/setup/"
check "claimed, $origin/ is the connector's page" forwarded_page
check "claimed, $origin/api/me is operator's, named by management, with Oki's menu" forwarded_person
if awk '$6 == "oki" { found = 1 } END { exit !found }' "$jar"; then
  check "claimed with no model, $origin/oki/ opens setup" setup_first
  check "a stub OpenAI-compatible server answers at $stub_address in the instance" stub
  check "setup lists the models it serves" local_listed
  check "setup makes local/$stub_model the default and no spore, and /oki/ still opens setup" local_chosen
  check "the first spore, named main on the setup page" first_spore_named
  check "main's definition grants it its own folder, $folder/main, and says what it is" main_granted_folder
  check "with a model, /oki/ is the system page and /api/me lists main" main_listed
  check "main answers through $origin/, on the local model" answers
  check "main, asked through $origin/, writes a file in its folder, and it is in $folder/main on this host" writes_its_folder
  check "the system page's model is local/$stub_model, ready, not checked against spore" model_state
  check "the spores page lists main, granted its folder, and offers default and perennial" spores_listed
  check "a perennial spore made through the spores page is granted its own folder; another kind or a path is refused" spore_made
  check "a spore with no turns is deleted through the spores page" spore_removed
  check "main in a turn: deleting it is refused as running; after the turn, asked for its recorded turns" running_refused
  check "the manifest pointed at the stub's mohdex: the catalog is exactly the set computed from it, and the local choice" mohdex_computed
  check "a Google key saved, gemini/oki-boot-check-a made the default and a spore's model" mohdex_model_used
  check "mohdex retiring gemini/oki-boot-check-a: the offer names the spore and the default, and nothing moved by itself" retired_offered
  check "moving to the replacement moves the spore and the default, and the offer is gone" retired_moved
  check "mohdex no longer serving the retired id: it stays retired" retired_kept
  check "mohdex answering 500, then 404: the catalog stays as it is and the failure is shown" unreachable_kept
  check "the manifest restored, and management restarted on it" manifest_restored
  check "an export, with a passphrase: a download named for Oki $release, the services started again after" exported
  check "the export is encrypted: gpg opens it with its passphrase only, and it holds the home without caches" export_encrypted
  check "an Oki that holds spores refuses an import" import_refused_as "$exports/oki.tar.gz.gpg" "$passphrase" HOLDS_DATA
  check "the setup this check made undone: no credentials, spores or conversations in /home/oki again" setup_undone
  check "the password this check set removed: /home/oki as a fresh image has it, and $origin/ redirects to the claiming screen" unclaim
  check "unclaimed, an import with a wrong or no passphrase, truncated or tampered, is refused and leaves /home/oki fresh" imports_refused
  check "the stub answers again at $stub_address" stub
  check "the export imported while unclaimed: its spores and their folders are back, the export's password is asked, this instance's web file kept" imported
  check "main answers after the import, and what it said before the export is still on the page" answers_after_import
  check "the import undone: no credentials, spores or conversations in /home/oki again" setup_undone
  check "the password the import brought removed, $origin/ redirects to the claiming screen again" unclaim
fi
check "$management_unit active" is "$management_unit" "$(as_oki systemctl --user is-active "$management_unit")" active
check "$connector_unit active" is "$connector_unit" "$(as_oki systemctl --user is-active "$connector_unit")" active
check "$tick_unit active" is "$tick_unit" "$(as_oki systemctl --user is-active "$tick_unit")" active
check "user@1000.service active" is user@1000.service "$(guest systemctl is-active user@1000.service)" active
check "no failed unit in oki's user manager" no_failed_units

if [ "$failures" -gt 0 ]; then
  echo "boot-check: $failures failed"
  exit 1
fi
echo "boot-check: all passed"
