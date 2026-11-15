#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { openAccess } from '../service/access.js'
import { createRefresh } from '../service/catalog.js'
import { serve } from '../service/serve.js'

const PERSON = 'operator'

const refuse = (message) => {
  console.error(`oki-management: ${message}`)
  process.exit(2)
}

const addressOf = (text) => {
  const at = text.lastIndexOf(':')
  return { text, host: text.slice(0, at), port: Number(text.slice(at + 1)) }
}

const manifestFile = process.argv[2]
if (!manifestFile) refuse('oki-management <manifest.json> — the release manifest, /opt/oki/manifest.json in the appliance')

const webFile = join(homedir(), '.config', 'spore', 'web', 'oki.json')
let manifest, web
try {
  manifest = JSON.parse(readFileSync(manifestFile, 'utf8'))
  web = JSON.parse(readFileSync(webFile, 'utf8'))
} catch (err) {
  refuse(err.message)
}
if (typeof web.listen !== 'string' || typeof web.origin !== 'string' || typeof web.user !== 'string') {
  refuse(`${webFile} has no listen, origin or user — management forwards to the connector as the proxy that names the signed-in person, { "listen", "origin", "user", "people" }`)
}

const origin = URL.parse(web.origin)
if (origin?.protocol !== 'http:' || !origin.port) refuse(`${webFile} has origin ${web.origin} — the management service listens at its origin, http://<address>:<port>, the address the browser opens`)

if (typeof manifest.computer !== 'string' || !manifest.computer) refuse(`${manifestFile} names no computer — the host's name, which provision.sh records`)
if (typeof manifest.curated !== 'string') refuse(`${manifestFile} names no curated — the address of mohdex's public API, which Oki's catalog is computed from`)

const say = (line) => console.log(line)
const refresh = createRefresh({ base: manifest.curated, say })
refresh.start()

await serve({
  listen: { text: origin.host, host: origin.hostname, port: Number(origin.port) },
  connector: addressOf(web.listen),
  origin: web.origin,
  user: web.user,
  person: PERSON,
  manifest,
  access: openAccess(join(homedir(), '.config', 'oki')),
  refresh,
  say
})
