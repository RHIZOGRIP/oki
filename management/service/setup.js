/**
 * The page form of `spore setup` (spore-cli's src/setup.js): the same steps through the same library
 * functions. The credential step, which `spore setup` hands to `mo onboard`, is mohdel's own library
 * functions here: a key checked and saved, or a sign-in whose callback lands on Oki's address.
 */

import {
  addFromMohdex, CONFIG_FILE, defaultModel, doctor, list, loadMohdelEnvironment, modelReadiness,
  modelsOf, mohdexEntries, mohdexRecommended, PROVIDER_INFO, providerReadiness, setDefaultModel,
  tagModel
} from '@rhizogrip/spore'
import { createChatGPT } from 'mohdel/chatgpt'
import { creatorFromModelId } from 'mohdel/creators'
import { finishOpenRouterSignIn, saveKey, startOpenRouterSignIn, verifyKey } from 'mohdel/credentials'
import { mohdexResults } from 'mohdel/mohdex'
import providers from 'mohdel/providers'

import { ADVISED, BAR, baseOf, CHOSEN, entriesOf, FREE, FRONT, readCatalog } from './catalog.js'

export const FOLDERS = '/folders'
const SIGN_IN_MS = 10 * 60 * 1000

export const LOCAL = 'local'

export class Unusable extends Error {
  constructor (message, type) {
    super(message)
    this.type = type
  }
}

const providerOf = (model) => model.split('/')[0]
const keyOf = (provider, id) => `${provider}/${id.replace(/[:@]/g, '-')}`
const basePrice = (price) => (typeof price === 'object' ? price?.default : price) ?? null
const priceOf = (entry) => ({ input: basePrice(entry?.inputPrice), output: basePrice(entry?.outputPrice) })
const marks = (tags = []) => ({ advised: tags.includes(ADVISED), free: tags.includes(FREE) })
const advisedFirst = (a, b) => b.advised - a.advised
const known = (provider) => {
  if (!providers[provider]) throw new Unusable(`${provider} is not a provider mohdel knows`)
}

async function recommendedKeys () {
  return (await mohdexRecommended({ tool: 'spore', bar: BAR })).map(one => one.key)
}

const conformanceOf = (key, recommended, results) => {
  if (recommended.includes(key)) return { conformance: 'recommended' }
  const tasks = results[key]
  if (!tasks) return { conformance: 'unchecked' }
  return { conformance: 'partial', failed: Object.entries(tasks).filter(([, one]) => one.failed > 0).map(([task]) => task) }
}

/** Settled by the image: shown, and any problem stops setup, as it stops `spore setup`. */
export function machine () {
  return doctor().findings
    .filter(one => one.area === 'machine' || (one.subject === CONFIG_FILE && one.severity === 'problem'))
    .map(({ area, subject, severity, problem, fix }) => ({ area, subject, severity, problem, fix }))
}

const NOT_FOR_TALKING = ['embeddings', 'evaluation']

const sporeNames = () => list().workspaces.map(({ ws }) => ws.split('/').at(-1))

/**
 * The providers setup offers by name. Before a model is set, the first-run ones, which cost nothing
 * to try. After, those and every other provider Oki's catalog holds a model of, by label.
 */
function offeredProviders (model) {
  if (!model) return FRONT
  const held = new Set(entriesOf(readCatalog()).filter(([, entry]) => !entry.deprecated).map(([key]) => providerOf(key)))
  const others = [...held].filter(provider => provider !== LOCAL && !FRONT.includes(provider))
  return [...FRONT, ...others.sort((a, b) => PROVIDER_INFO[a].label.localeCompare(PROVIDER_INFO[b].label))]
}

export async function state () {
  loadMohdelEnvironment()
  const { model } = defaultModel()
  const choices = []
  for (const provider of offeredProviders(model)) {
    const { label, description, free, url, hint } = PROVIDER_INFO[provider]
    choices.push({ provider, label, description, free, url, hint, credential: (await providerReadiness(provider)).credential })
  }
  const expert = []
  for (const [provider, { label, description, free, url, hint }] of Object.entries(PROVIDER_INFO)) {
    if (NOT_FOR_TALKING.includes(providers[provider].api)) continue
    expert.push({ provider, label, description, free, url, hint, credential: (await providerReadiness(provider)).credential, signsIn: providers[provider].catalogClient === 'chatgpt' })
  }
  expert.sort((a, b) => a.label.localeCompare(b.label))
  return {
    machine: machine(),
    model,
    spores: sporeNames(),
    choices,
    expert
  }
}

export async function enterKey ({ provider, key, anyway }) {
  known(provider)
  if (!providers[provider].apiKeyEnv) throw new Unusable(`${provider} takes no key`)
  const verdict = await verifyKey(provider, key)
  if (verdict === 'invalid') throw new Unusable(`${PROVIDER_INFO[provider]?.label ?? provider} refused that key — check for a truncated paste`)
  if (verdict === 'unknown' && !anyway) return { saved: false, verdict }
  await saveKey(provider, key)
  return { saved: true, verdict }
}

/** ChatGPT accepts a registration made by `mo chatgpt login` only at http://127.0.0.1:<port>/auth/callback. */
export const CALLBACKS = { openrouter: '/oki/setup/openrouter/callback', chatgpt: '/auth/callback' }

/** Pending sign-ins live in memory only: a restart forgets them, and the person starts again. */
export function createSignIns ({ origin, computer }) {
  const label = `My spores on Oki (${computer})`
  const callbackOf = (provider) => `${origin}${CALLBACKS[provider]}`
  let openrouter = null
  const chatgpt = new Map()

  const live = (pending) => pending !== null && pending.until > Date.now()

  return {
    startOpenRouter () {
      const { url, verifier } = startOpenRouterSignIn({ label, callbackUrl: callbackOf('openrouter') })
      openrouter = { verifier, until: Date.now() + SIGN_IN_MS }
      return { url }
    },

    async finishOpenRouter (params) {
      const code = params.get('code')
      if (!code) throw new Unusable('OpenRouter sent no code — the sign-in was not authorised')
      if (!live(openrouter)) throw new Unusable('no OpenRouter sign-in is waiting here — start it again from setup')
      const { verifier } = openrouter
      openrouter = null
      const key = await finishOpenRouterSignIn({ code, verifier })
      if (await verifyKey('openrouter', key) === 'invalid') throw new Unusable('OpenRouter refused the key it just made — sign in again')
      await saveKey('openrouter', key)
    },

    async startChatGPT () {
      const { url, pending } = await createChatGPT().startLogin({ redirectUri: callbackOf('chatgpt'), name: label, timeoutMs: SIGN_IN_MS })
      chatgpt.set(pending.state, pending)
      for (const [state, one] of chatgpt) if (one.expiresAt < Date.now()) chatgpt.delete(state)
      return { url }
    },

    async finishChatGPT (params) {
      const pending = chatgpt.get(params.get('state'))
      if (!pending) throw new Unusable('no ChatGPT sign-in is waiting here — start it again from setup')
      chatgpt.delete(pending.state)
      const account = await createChatGPT().finishLogin(pending, params)
      if (!account.planUsage) throw new Unusable('ChatGPT signed in without plan usage — sign in again and allow it')
    }
  }
}

const offerOfEntry = (key, entry, readiness, mark) => ({
  model: key,
  label: entry?.label ?? key,
  billing: readiness.billing,
  price: priceOf(entry),
  inCatalog: readiness.inCatalog,
  ...mark
})

/** `spore setup`'s recommended path, cheapest first. */
export async function recommendedOffers (provider) {
  known(provider)
  loadMohdelEnvironment()
  const recommended = (await recommendedKeys()).filter(key => providerOf(key) === provider)
  const entries = await mohdexEntries(provider)
  const held = new Map((await modelsOf(provider)).map(one => [one.model, one.tags]))
  const offers = []
  for (const key of recommended.filter(one => entries[one] || held.has(one))) {
    offers.push(offerOfEntry(key, entries[key], await modelReadiness(key), { conformance: 'recommended', ...marks(held.get(key)) }))
  }
  const cost = (one) => [one.price.input ?? Infinity, one.price.output ?? Infinity]
  return offers.sort((a, b) => advisedFirst(a, b) || cost(a)[0] - cost(b)[0] || cost(a)[1] - cost(b)[1])
}

async function checks (provider) {
  try {
    return { recommended: await recommendedKeys(), results: await mohdexResults({ tool: 'spore', provider }), mohdex: null }
  } catch (err) {
    return { recommended: [], results: {}, mohdex: err.message }
  }
}

async function heldOffers (provider, { recommended, results }) {
  const catalog = readCatalog()
  return (await modelsOf(provider)).filter(each => each.type === 'model').map(each => ({ ...each, ...marks(each.tags) })).sort(advisedFirst)
    .map(one => ({ model: one.model, label: catalog[one.model].label ?? one.model, billing: one.billing, price: priceOf(catalog[one.model]), inCatalog: true, chosenBefore: one.tags.includes(CHOSEN), advised: one.advised, free: one.free, ...conformanceOf(one.model, recommended, results) }))
}

async function credentialed (provider) {
  known(provider)
  loadMohdelEnvironment()
  if (!(await providerReadiness(provider)).credential) throw new Unusable(`${provider} has no credential yet`)
}

/** A provider's models: the catalog's, then the others mohdex has an entry for. `mohdex` is why mohdex could not be read, or null. */
export async function knownOffers (provider) {
  await credentialed(provider)
  const checked = await checks(provider)
  let { mohdex } = checked
  const offers = await heldOffers(provider, checked)
  if (mohdex === null) {
    try {
      const held = new Set(offers.map(one => one.model))
      for (const [key, entry] of Object.entries(await mohdexEntries(provider))) {
        if (held.has(key) || entry.deprecated || (entry.type ?? 'model') !== 'model') continue
        offers.push(offerOfEntry(key, entry, await modelReadiness(key), conformanceOf(key, checked.recommended, checked.results)))
      }
    } catch (err) {
      mohdex = err.message
    }
  }
  return { mohdex, offers }
}

export async function servedModels (address) {
  const root = addressIn(address)
  const url = `${root.replace(/\/$/, '')}/models`
  let answer
  try {
    answer = await fetch(url, { signal: AbortSignal.timeout(10000) })
  } catch (err) {
    throw new Unusable(`nothing answers at ${url} — ${err.cause?.code ?? err.message}`)
  }
  if (!answer.ok) throw new Unusable(`${url} answered ${answer.status} — is ${root} the server's OpenAI-compatible address, ending in /v1?`)
  let body
  try {
    body = await answer.json()
  } catch {
    throw new Unusable(`${url} did not answer with JSON — is ${root} the server's OpenAI-compatible address, ending in /v1?`)
  }
  if (!Array.isArray(body?.data)) throw new Unusable(`${url} answered without a model list`)
  return body.data.map(one => one.id).filter(id => typeof id === 'string')
}

function addressIn (address) {
  let url
  try {
    url = new URL(address)
  } catch {
    throw new Unusable(`${address} is not an address — it looks like http://<host>:<port>/v1`)
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Unusable(`${address} is not an http or https address`)
  return address
}

/** A chosen model joins the person's models; it becomes the default for new spores only when there is none. */
async function settle (model) {
  await tagModel(model, CHOSEN)
  if (!defaultModel().model) setDefaultModel(model)
  return { model: defaultModel().model, added: model, spores: sporeNames(), readiness: await modelReadiness(model) }
}

export async function makeDefault (model) {
  loadMohdelEnvironment()
  const readiness = await modelReadiness(model)
  if (!readiness.ready) throw new Unusable(`${model} is not ready — ${readiness.credential ? 'it is not in the catalog' : 'its provider has no credential'}`)
  setDefaultModel(model)
  return { model }
}

export async function choose ({ provider, model }) {
  known(provider)
  if (provider === LOCAL) throw new Unusable('a local model is chosen with its server\'s address')
  if (providerOf(model) !== provider) throw new Unusable(`${model} is not a ${provider} model`)
  loadMohdelEnvironment()
  const readiness = await modelReadiness(model)
  if (!readiness.credential) throw new Unusable(`${provider} has no credential yet`)
  if (!readiness.inCatalog) {
    const entries = await mohdexEntries(provider)
    if (!entries[model]) throw new Unusable(`mohdex has no entry for ${model}`)
    await addFromMohdex([{ key: model, entry: entries[model] }])
  }
  return settle(model)
}

export async function chooseLocal ({ address, id }) {
  const served = await servedModels(address)
  if (!served.includes(id)) throw new Unusable(`the server at ${address} does not serve ${id}`)
  const key = keyOf(LOCAL, id)
  const entry = { provider: LOCAL, sdk: providers[LOCAL].sdk, model: id, label: id, creator: creatorFromModelId(id) ?? id.split('/')[0], inputFormat: ['text'], baseURL: address }
  await addFromMohdex([{ key, entry }])
  return settle(key)
}

export async function modelState () {
  loadMohdelEnvironment()
  const { model } = defaultModel()
  if (!model) return null
  const provider = providerOf(model)
  const readiness = await modelReadiness(model)
  const entry = readCatalog()[baseOf(model)]
  let checked
  try {
    checked = conformanceOf(baseOf(model), await recommendedKeys(), await mohdexResults({ tool: 'spore', key: baseOf(model) }))
  } catch (err) {
    checked = { conformance: null, mohdex: err.message }
  }
  return { model, name: entry?.label ?? model, provider, label: PROVIDER_INFO[provider]?.label ?? provider, ...readiness, ...checked, ...marks(entry?.tags), retired: Boolean(entry?.deprecated) }
}

/** The catalog's models a spore can run on now, offered as setup offers a provider's, the ones Oki advises first. */
export async function catalogOffers () {
  loadMohdelEnvironment()
  const catalog = readCatalog()
  let recommended = []
  let results = {}
  let mohdex = null
  try {
    recommended = await recommendedKeys()
    results = await mohdexResults({ tool: 'spore' })
  } catch (err) {
    mohdex = err.message
  }
  const offers = []
  for (const [key, entry] of entriesOf(catalog)) {
    if (entry.deprecated || (entry.type ?? 'model') !== 'model') continue
    const readiness = await modelReadiness(key)
    if (!readiness.ready) continue
    offers.push({ ...offerOfEntry(key, entry, readiness, mohdex === null ? conformanceOf(key, recommended, results) : {}), chosenBefore: entry.tags?.includes(CHOSEN) ?? false, ...marks(entry.tags) })
  }
  return { mohdex, offers: offers.sort((a, b) => advisedFirst(a, b) || b.free - a.free || a.label.localeCompare(b.label)) }
}
