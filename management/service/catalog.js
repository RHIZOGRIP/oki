/**
 * The appliance's mohdel catalog belongs to Oki: the management service writes it whole, from what
 * mohdex serves at the manifest's `curated` address plus the models the person chose in setup, the
 * ones carrying mohdel's reserved `spore` tag. mohdex is read at start, and again when Oki is used
 * and the last read is more than two hours old, or a minute old while a spore's last turn is a
 * failed one; the catalog is computed from it, and installed when
 * it changed. An Oki nobody uses asks mohdex nothing. Until the first read succeeds the
 * appliance holds no catalog of Oki's and lists no model from it. A catalog Oki wrote holds a `$oki`
 * meta key, which mohdel keeps on every write of its own, saying where its entries came from.
 */

import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { promisify } from 'node:util'

import { defaultModel, grantOf, MO, sporePaths, stateOf } from '@rhizogrip/spore'
import providers from 'mohdel/providers'

export const MARK = '$oki'
export const CHOSEN = 'spore'
export const ADVISED = 'advised'
export const FREE = 'free'
export const FRONT = ['openrouter', 'chatgpt', 'gemini']
export const BAR = ['tier:core', 'tier:identity']
export const NEAR = 2
const TOOL = 'spore'
const OKI_TAGS = [ADVISED, FREE]
const ROUTE_FIELDS = ['speeds', 'rpmLimit', 'tpmLimit', 'inpmLimit', 'rateLimitScope']
const STALE_MS = 2 * 60 * 60 * 1000
const STALE_AFTER_FAILURE_MS = 60 * 1000
const FETCH_MS = 15000
const FIRST_READ = 'the first read is still under way'

const run = promisify(execFile)

/** Where mohdel reads its catalog, as its env-paths dependency places it on Linux. */
export const catalogFile = () => join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'mohdel', 'curated.json')

const isMeta = (key) => key.startsWith('$') || key.startsWith('_')
export const entriesOf = (catalog) => Object.entries(catalog).filter(([key]) => !isMeta(key))
export const baseOf = (model) => model.split(/[:@]/)[0]
const providerOf = (key) => key.split('/')[0]
const isObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value)

export class Uninstallable extends Error {}

export function readCatalog () {
  let text
  try {
    text = readFileSync(catalogFile(), 'utf8')
  } catch (err) {
    if (err.code === 'ENOENT') return {}
    throw err
  }
  return JSON.parse(text)
}

function writeCatalog (catalog) {
  const file = catalogFile()
  mkdirSync(dirname(file), { recursive: true })
  const temporary = `${file}.${process.pid}.tmp`
  writeFileSync(temporary, `${JSON.stringify(catalog, null, 2)}\n`)
  renameSync(temporary, file)
}

/** `mo check` reads the catalog where mohdel keeps it, so it is pointed at a copy of the candidate instead. */
export async function catalogProblems (catalog) {
  const scratch = mkdtempSync(join(tmpdir(), 'oki-catalog-'))
  try {
    mkdirSync(join(scratch, 'mohdel'))
    writeFileSync(join(scratch, 'mohdel', 'curated.json'), JSON.stringify(catalog))
    let stdout
    try {
      ({ stdout } = await run(process.execPath, [MO, 'check', '--json'], { env: { ...process.env, XDG_CONFIG_HOME: scratch } }))
    } catch (err) {
      if (err.code !== 1 || !err.stdout) throw new Error(`mo check failed — ${err.stderr || err.message}`)
      stdout = err.stdout
    }
    return JSON.parse(stdout).errors
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
}

async function read (url, expected, shape) {
  let answer
  try {
    answer = await fetch(url, { signal: AbortSignal.timeout(FETCH_MS), cache: 'no-store' })
  } catch (err) {
    throw new Uninstallable(`${url} does not answer — ${err.cause?.code ?? err.message}`)
  }
  if (!answer.ok) throw new Uninstallable(`${url} answered ${answer.status}`)
  let body
  try {
    body = await answer.json()
  } catch (err) {
    throw new Uninstallable(`${url} did not answer JSON — ${err.message}`)
  }
  if (!shape(body)) throw new Uninstallable(`${url} did not answer ${expected}`)
  return body
}

/**
 * mohdel's `mohdexEntries`, `pricesFrom` mapping included, at the manifest's address: mohdel reads
 * mohdex only at the one it fixes.
 */
async function entriesFor (base, provider) {
  const from = providers[provider].pricesFrom
  const served = await read(`${base}/entries?provider=${encodeURIComponent(from ?? provider)}`, 'entries: a JSON object of catalog entries', body => isObject(body) && Object.values(body).every(isObject))
  if (!from) return served
  const entries = {}
  for (const [key, entry] of Object.entries(served)) {
    const carried = { ...entry, provider }
    for (const field of ROUTE_FIELDS) delete carried[field]
    entries[`${provider}/${key.slice(from.length + 1)}`] = carried
  }
  return entries
}

/**
 * What mohdex says of spore's bar: the models that meet it, and those that ran every task of it and
 * failed at most `NEAR`, each with the tasks it failed. Then mohdex's entries for every provider
 * either list names and for the first-run choices; a provider this mohdel does not know is left out.
 */
export async function readMohdex (base) {
  const bar = new URLSearchParams([['tool', TOOL], ...BAR.map(one => ['bar', one]), ['near', NEAR]])
  const keyed = (list) => Array.isArray(list) && list.every(one => typeof one?.key === 'string')
  const { models, near } = await read(`${base}/recommended?${bar}`, 'recommendations: { models: [{ key }], near: [{ key, failed: [{ taskId }] }] }',
    body => keyed(body?.models) && keyed(body?.near) && body.near.every(one => Array.isArray(one.failed) && one.failed.every(task => typeof task?.taskId === 'string')))
  const named = [...models, ...near].map(one => providerOf(one.key)).filter(provider => providers[provider])
  const served = {}
  for (const provider of new Set([...FRONT, ...named])) served[provider] = await entriesFor(base, provider)
  return { recommended: models.map(one => one.key), near: Object.fromEntries(near.map(one => [one.key, one.failed.map(task => task.taskId)])), served }
}

const basePrice = (price) => (isObject(price) ? price.default : price)
const cost = (entry) => [basePrice(entry.inputPrice) ?? Infinity, basePrice(entry.outputPrice) ?? Infinity]
const cheaper = ([, a], [, b]) => cost(a)[0] - cost(b)[0] || cost(a)[1] - cost(b)[1]

/**
 * `free`: priced at nothing. A provider's free tier on a priced model is a fact mohdex does not
 * carry; when it does, it is read here.
 */
const isFree = (entry) => basePrice(entry.inputPrice) === 0 && basePrice(entry.outputPrice) === 0

/**
 * The catalog Oki offers, computed from what `readMohdex` read and the catalog in use: mohdex's
 * entries for the models that meet spore's bar and for those near it. A model further from the bar,
 * or that did not run all of it, is left out, and so is one mohdex names but has no entry for. In
 * each provider, `advised` goes to the cheapest model that meets the bar, or, where none does, to
 * the near one that failed least; `free` as `isFree` says. Retired ids are mohdex's stubs, kept where
 * their chain ends at a model offered, and the stubs of the catalog in use, so a retired id stays
 * retired when mohdex stops serving it; a stub mohdex serves again as a model is not kept.
 */
export function computed ({ recommended, near, served }, current) {
  const offered = {}
  const tags = new Map()
  const stubs = new Map(entriesOf(current).filter(([, entry]) => entry.deprecated).map(([key, entry]) => [key, { to: entry.deprecated, carried: true }]))
  for (const entries of Object.values(served)) {
    for (const [key, entry] of Object.entries(entries)) {
      if (entry.deprecated) stubs.set(key, { to: entry.deprecated, carried: false })
      else if (recommended.includes(key) || near[key]) {
        offered[key] = entry
        tags.set(key, isFree(entry) ? [FREE] : [])
      }
    }
  }
  for (const provider of Object.keys(served)) {
    const own = Object.entries(offered).filter(([key]) => providerOf(key) === provider)
    const advised = own.filter(([key]) => recommended.includes(key)).sort(cheaper)[0] ??
      own.sort((a, b) => near[a[0]].length - near[b[0]].length || cheaper(a, b))[0]
    if (advised) tags.get(advised[0]).push(ADVISED)
  }
  const next = {}
  for (const [key, entry] of Object.entries(offered)) {
    const all = [...new Set([...(entry.tags ?? []), ...tags.get(key)])]
    next[key] = all.length ? { ...entry, tags: all } : entry
  }
  const endsOffered = (key, seen) => {
    if (offered[key]) return true
    if (!stubs.has(key) || seen.includes(key)) return false
    return endsOffered(stubs.get(key).to, [...seen, key])
  }
  for (const [key, { to, carried }] of stubs) {
    if (offered[key]) continue
    if (carried || endsOffered(to, [key])) next[key] = { deprecated: to }
  }
  return next
}

/**
 * The catalog `offered` makes of the one in use: every offered entry, then each model the person
 * chose. A chosen model Oki offers takes the offered entry and keeps its `spore` tag; one Oki retired
 * takes the stub, which the deprecation offer then names; one Oki does not offer stays as it is,
 * without the tags only an offered entry carries.
 */
export function merged (current, offered, mark) {
  const next = {}
  for (const [key, entry] of entriesOf(offered)) next[key] = entry
  for (const [key, entry] of entriesOf(current)) {
    if (!entry.tags?.includes(CHOSEN)) continue
    if (next[key]?.deprecated) continue
    next[key] = next[key]
      ? { ...next[key], tags: [...new Set([...(next[key].tags ?? []), CHOSEN])] }
      : { ...entry, tags: entry.tags.filter(tag => !OKI_TAGS.includes(tag)) }
  }
  next[MARK] = mark
  return next
}

export async function install (read, from) {
  const current = readCatalog()
  const offered = computed(read, current)
  const digest = createHash('sha256').update(JSON.stringify(offered)).digest('hex')
  if (current[MARK]?.digest === digest) return null
  const next = merged(current, offered, { from, digest, at: new Date().toISOString() })
  const problems = await catalogProblems(next)
  if (problems.length) throw new Uninstallable(`mohdel rejects the catalog computed from ${from} — ${problems.join('; ')}`)
  writeCatalog(next)
  return next[MARK]
}

let queue = Promise.resolve()

/** Catalog writes from this process in turn, so a refresh never overwrites what setup is writing. */
export function serially (act) {
  const done = queue.then(act)
  queue = done.then(() => {}, () => {})
  return done
}

const summary = (catalog) => {
  const entries = entriesOf(catalog)
  const models = entries.filter(([, entry]) => !entry.deprecated && !entry.tags?.includes(CHOSEN))
  return `${models.length} model(s), advised ${models.filter(([, entry]) => entry.tags?.includes(ADVISED)).map(([key]) => key).join(', ') || 'none'}, ${entries.filter(([, entry]) => entry.deprecated).length} retired id(s)`
}

/**
 * The refresh. `failed` is the latest failure, cleared by a success; each new reason is said once,
 * and the same one again is not, so an address that stays unreachable fills no log.
 */
export function createRefresh ({ base, say }) {
  let checked = null
  let failed = null
  let said = null
  let asked = 0
  let reading = null

  const fail = (why) => {
    failed = { at: new Date().toISOString(), why }
    if (why !== said) say(`catalog: ${why} — the catalog stays as it is`)
    said = why
  }

  async function refresh () {
    asked = Date.now()
    try {
      const served = await readMohdex(base)
      await serially(async () => {
        const mark = await install(served, base)
        if (mark) say(`catalog: computed from ${base} and installed (${mark.digest.slice(0, 12)}) — ${summary(readCatalog())}`)
      })
      checked = new Date().toISOString()
      failed = null
      said = null
    } catch (err) {
      if (!(err instanceof Uninstallable)) throw err
      fail(err.message)
    }
  }

  const stale = () => sporePaths().some(ws => stateOf(ws).state === 'failed') ? STALE_AFTER_FAILURE_MS : STALE_MS

  const refreshing = () => {
    reading ??= refresh().catch(err => say(`catalog: the refresh failed — ${err.stack}`)).finally(() => { reading = null })
    return reading
  }

  return {
    refresh,
    start: refreshing,
    /**
     * Oki is being used: mohdex is read again, behind the request, when the last read is old. Old is
     * two hours, and a minute while a spore's last turn is a failed one, which a model mohdex has
     * changed or retired is one cause of.
     */
    used () {
      if (Date.now() - asked > stale()) refreshing()
    },
    status () {
      const installed = readCatalog()[MARK] ?? null
      return { url: base, stale: STALE_MS, installed, checked, failed, unread: installed ? null : failed ? failed.why : FIRST_READ }
    }
  }
}

function replacementOf (catalog, key) {
  const via = []
  let at = key
  while (catalog[at]?.deprecated) {
    if (via.includes(at)) return { replacement: null, via, missing: `a loop at ${at}` }
    via.push(at)
    at = catalog[at].deprecated
  }
  return catalog[at] ? { replacement: at, via: via.slice(1), missing: null } : { replacement: null, via: via.slice(1), missing: at }
}

export function deprecations () {
  const catalog = readCatalog()
  const inUse = new Map()
  const use = (model) => {
    if (!inUse.has(model)) inUse.set(model, { model, spores: [], isDefault: false })
    return inUse.get(model)
  }
  const { model } = defaultModel()
  if (model) use(model).isDefault = true
  for (const ws of sporePaths()) use(grantOf(ws).model).spores.push(basename(ws))
  const offers = []
  for (const one of inUse.values()) {
    const key = baseOf(one.model)
    if (!catalog[key]?.deprecated) continue
    offers.push({ ...one, key, ...replacementOf(catalog, key) })
  }
  return offers
}
