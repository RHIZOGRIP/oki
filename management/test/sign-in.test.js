import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { after, before, test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { CHECKED, GRANTED, UNCHECKED } from './providers.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const home = mkdtempSync(join(tmpdir(), 'oki-sign-in-'))
const requests = join(home, 'requests.jsonl')
const port = 20000 + Math.floor(Math.random() * 20000)
const origin = `http://127.0.0.1:${port}`
let service
let cookie

const providerRequests = () => readFileSync(requests, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line))

async function call (path, { method = 'GET', body, session = true, from = origin } = {}) {
  const headers = { ...(session ? { cookie } : {}), ...(body ? { 'content-type': 'application/json', origin: from } : {}) }
  return fetch(`${origin}${path}`, { method, headers, body: body && JSON.stringify(body), redirect: 'manual' })
}

const backTo = async (answer) => {
  const html = await answer.text()
  const found = /url=([^"]+)"/.exec(html)
  assert.ok(found, `a hand-off page, not ${html}`)
  return new URL(found[1].replaceAll('&#38;', '&'), origin)
}

before(async () => {
  mkdirSync(join(home, '.config', 'spore', 'web'), { recursive: true })
  writeFileSync(join(home, '.config', 'spore', 'config.json'), '{ "home": "~/.spore" }\n')
  writeFileSync(join(home, '.config', 'spore', 'web', 'oki.json'), JSON.stringify({ listen: '127.0.0.1:1', origin, user: 'x-forwarded-user', people: { operator: '*' } }))
  const manifest = JSON.parse(readFileSync(join(HERE, '..', '..', 'image', 'manifest.json'), 'utf8'))
  manifest.curated = 'https://mohdex.dev/v1'
  manifest.computer = 'oki-test'
  writeFileSync(join(home, 'manifest.json'), JSON.stringify(manifest))
  writeFileSync(requests, '')
  service = spawn(process.execPath, ['--import', join(HERE, 'providers.js'), join(HERE, '..', 'bin', 'oki-management.js'), join(home, 'manifest.json')], {
    env: { HOME: home, PATH: process.env.PATH, OKI_TEST_REQUESTS: requests },
    stdio: ['ignore', 'pipe', 'inherit']
  })
  await new Promise((resolve, reject) => {
    service.once('exit', (code) => reject(new Error(`oki-management exited with ${code}`)))
    service.stdout.on('data', (chunk) => { if (String(chunk).includes('listening on')) resolve() })
  })
  const claimed = await call('/oki/api/claim', { method: 'POST', body: { password: 'sign-in-test' }, session: false })
  assert.equal(claimed.status, 200)
  cookie = claimed.headers.get('set-cookie').split(';')[0]
  const read = await (await call('/oki/api/catalog/refresh', { method: 'POST', body: {} })).json()
  assert.equal(read.unread, null, `the catalog is read from the faked mohdex — ${read.unread}`)
})

after(() => {
  service.kill()
  rmSync(home, { recursive: true, force: true })
})

test('a sign-in starts only from a session on Oki\'s own pages', async () => {
  assert.equal((await call('/oki/api/setup/sign-in', { method: 'POST', body: { provider: 'openrouter' }, session: false })).status, 401)
  assert.equal((await call('/oki/api/setup/sign-in', { method: 'POST', body: { provider: 'openrouter' }, from: 'http://elsewhere.example' })).status, 403)
})

test('OpenRouter: the callback lands on /oki/, without the session, and its code becomes a saved key', async () => {
  const started = await (await call('/oki/api/setup/sign-in', { method: 'POST', body: { provider: 'openrouter' } })).json()
  const url = new URL(started.url)
  assert.equal(url.origin + url.pathname, 'https://openrouter.ai/auth')
  assert.equal(url.searchParams.get('callback_url'), `${origin}/oki/setup/openrouter/callback`)
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256')

  const refused = await call('/oki/setup/openrouter/callback?code=forged', { session: false })
  const failed = await backTo(refused)
  assert.equal(failed.pathname, '/oki/setup/')
  assert.match(failed.searchParams.get('error'), /OpenRouter refused the code/)
  assert.match((await backTo(await call(`/oki/setup/openrouter/callback?code=${GRANTED}`, { session: false }))).searchParams.get('error'), /no OpenRouter sign-in is waiting/)

  await call('/oki/api/setup/sign-in', { method: 'POST', body: { provider: 'openrouter' } })
  const challenge = new URL((await (await call('/oki/api/setup/sign-in', { method: 'POST', body: { provider: 'openrouter' } })).json()).url).searchParams.get('code_challenge')
  const back = await backTo(await call(`/oki/setup/openrouter/callback?code=${GRANTED}`, { session: false }))
  assert.equal(back.search, '?provider=openrouter')

  const exchange = providerRequests().filter(one => one.name === 'POST https://openrouter.ai/api/v1/auth/keys').at(-1)
  const sent = JSON.parse(exchange.body)
  assert.equal(createHash('sha256').update(sent.code_verifier).digest('base64url'), challenge, 'the verifier is the one the latest sign-in began with')
  assert.match(readFileSync(join(home, '.config', 'mohdel', 'environment'), 'utf8'), /^OPENROUTER_API_SK=sk-or-v1-oki-test$/m)
  const setup = await (await call('/oki/api/setup')).json()
  assert.equal(setup.choices.find(one => one.provider === 'openrouter').credential, true)
})

test('ChatGPT: the callback lands on /auth/callback, outside /oki/, its state must match, and the account is signed in with plan usage', async () => {
  const started = await (await call('/oki/api/setup/sign-in', { method: 'POST', body: { provider: 'chatgpt' } })).json()
  const url = new URL(started.url)
  assert.equal(url.origin + url.pathname, 'https://auth.openai.com/api/accounts/authorize')
  assert.equal(url.searchParams.get('redirect_uri'), `${origin}/auth/callback`)
  assert.equal(url.searchParams.get('agent_name_hint'), 'My spores on Oki (oki-test)')
  const state = url.searchParams.get('state')
  const nonce = url.searchParams.get('nonce')

  const before = providerRequests().length
  const old = await call(`/oki/setup/chatgpt/callback/?state=${state}&code=${GRANTED}:${nonce}&client_id=app-oki-test`, { session: false })
  assert.equal(old.status, 404, 'the old callback path serves nothing')
  assert.match((await backTo(await call(`/auth/callback?state=forged&code=${GRANTED}:${nonce}&client_id=app-oki-test`, { session: false }))).searchParams.get('error'), /no ChatGPT sign-in is waiting/)
  assert.equal(providerRequests().length, before, 'a forged state reaches no provider')

  const back = await backTo(await call(`/auth/callback?state=${state}&code=${GRANTED}:${nonce}&client_id=app-oki-test`, { session: false }))
  assert.equal(back.search, '?provider=chatgpt')
  const token = new URLSearchParams(providerRequests().find(one => one.name === 'POST https://auth.openai.com/api/accounts/oauth/token').body)
  assert.equal(token.get('redirect_uri'), `${origin}/auth/callback`)
  assert.equal(token.get('client_id'), 'app-oki-test')
  const setup = await (await call('/oki/api/setup')).json()
  assert.equal(setup.choices.find(one => one.provider === 'chatgpt').credential, true)

  assert.match((await backTo(await call(`/auth/callback?state=${state}&code=${GRANTED}:${nonce}`, { session: false }))).searchParams.get('error'), /no ChatGPT sign-in is waiting/, 'a callback is used once')
})

test('Google: a key Google takes is saved; one it refuses is not, and mohdel 4.11.0 reads that refusal as unknown', async () => {
  const unknown = await (await call('/oki/api/setup/key', { method: 'POST', body: { provider: 'gemini', key: 'AIza-wrong' } })).json()
  assert.deepEqual(unknown, { saved: false, verdict: 'unknown' })
  const saved = await (await call('/oki/api/setup/key', { method: 'POST', body: { provider: 'gemini', key: 'AIza-oki-test' } })).json()
  assert.deepEqual(saved, { saved: true, verdict: 'valid' })
  assert.match(readFileSync(join(home, '.config', 'mohdel', 'environment'), 'utf8'), /^GEMINI_API_SK=AIza-oki-test$/m)
  const setup = await (await call('/oki/api/setup')).json()
  assert.equal(setup.choices.find(one => one.provider === 'gemini').credential, true)
})

test('OpenRouter: a key it refuses is refused', async () => {
  const refused = await call('/oki/api/setup/key', { method: 'POST', body: { provider: 'openrouter', key: 'sk-or-wrong' } })
  assert.equal(refused.status, 409)
  assert.match((await refused.json()).error, /OpenRouter refused that key/)
})

test('setup: a front choice lists the catalog\'s models and mohdex\'s, never the provider\'s listing', async () => {
  const listing = () => providerRequests().filter(one => one.name === 'GET https://openrouter.ai/api/v1/models').length
  const before = listing()
  const front = await (await call('/oki/api/setup/offers?provider=openrouter&only=known')).json()
  assert.equal(front.mohdex, null)
  assert.deepEqual(front.offers.map(({ model, inCatalog, conformance }) => ({ model, inCatalog, conformance })), [
    { model: CHECKED, inCatalog: true, conformance: 'recommended' },
    { model: UNCHECKED, inCatalog: false, conformance: 'unchecked' }
  ], 'Oki offers the model mohdex has results for; the untested one is mohdex\'s alone')
  assert.deepEqual([front.offers[0].advised, front.offers[0].free], [true, true])
  assert.ok(front.offers.every(one => one.id === undefined))
  assert.equal(listing(), before, 'OpenRouter is not asked for its listing')

  assert.equal((await call('/oki/api/setup/offers?provider=openrouter&only=any')).status, 400)
})
