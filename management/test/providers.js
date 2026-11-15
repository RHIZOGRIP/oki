/** Loaded with --import into the service under test; each provider request is appended to $OKI_TEST_REQUESTS. */

import { createSign, generateKeyPairSync } from 'node:crypto'
import { appendFileSync } from 'node:fs'

const real = globalThis.fetch
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
const KID = 'oki-test'
export const GRANTED = 'granted'
export const LISTED = 'oki-test/listed:free'
export const CHECKED = 'openrouter/oki-test/checked'
export const UNCHECKED = 'openrouter/oki-test/unchecked'

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
const b64 = (value) => Buffer.from(JSON.stringify(value)).toString('base64url')
const mohdexEntry = (model) => ({ provider: 'openrouter', sdk: 'openrouter', model, label: model, creator: 'oki-test', inputFormat: ['text'], contextTokenLimit: 32768, outputTokenLimit: 4096, inputPrice: 0, outputPrice: 0, source: 'https://openrouter.ai/models', sourcedAt: '2026-11-01' })

function idToken ({ audience, nonce }) {
  const now = Math.floor(Date.now() / 1000)
  const head = `${b64({ alg: 'RS256', typ: 'JWT', kid: KID })}.${b64({ iss: 'https://auth.openai.com', aud: audience, sub: 'user-oki-test', email: 'oki-test@example.org', nonce, iat: now, exp: now + 3600 })}`
  return `${head}.${createSign('RSA-SHA256').update(head).sign(privateKey).toString('base64url')}`
}

const routes = {
  'POST https://openrouter.ai/api/v1/auth/keys': ({ body }) => {
    const { code } = JSON.parse(body)
    return code === GRANTED ? json(200, { key: 'sk-or-v1-oki-test', user_id: 'user-oki-test' }) : json(400, { error: { message: 'Invalid code', code: 400 } })
  },
  'GET https://openrouter.ai/api/v1/auth/key': ({ headers }) =>
    headers.get('authorization') === 'Bearer sk-or-v1-oki-test' ? json(200, { data: { label: 'My spores on Oki (oki-test)', limit: null, usage: 0 } }) : json(401, { error: { message: 'No auth credentials found', code: 401 } }),
  'POST https://auth.openai.com/api/accounts/oauth/token': ({ body }) => {
    const form = new URLSearchParams(body)
    const [code, nonce] = form.get('code').split(':')
    if (code !== GRANTED) return json(400, { error: 'invalid_grant' })
    return json(200, {
      access_token: 'at-oki-test',
      refresh_token: 'rt-oki-test',
      id_token: idToken({ audience: form.get('client_id'), nonce }),
      expires_in: 3600,
      token_type: 'Bearer',
      scope: 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct'
    })
  },
  'GET https://auth.openai.com/.well-known/jwks.json': () => json(200, { keys: [{ ...publicKey.export({ format: 'jwk' }), kid: KID, alg: 'RS256', use: 'sig' }] }),
  'GET https://openrouter.ai/api/v1/models': ({ headers }) =>
    headers.get('authorization') === 'Bearer sk-or-v1-oki-test'
      ? json(200, { data: [{ id: LISTED, name: 'Oki test listed', created: 1767225600, context_length: 32768, pricing: { prompt: '0', completion: '0' }, architecture: { input_modalities: ['text'], output_modalities: ['text'] }, top_provider: { context_length: 32768, max_completion_tokens: 4096 } }] })
      : json(401, { error: { message: 'No auth credentials found', code: 401 } }),
  'GET https://mohdex.dev/v1/recommended': () => json(200, { models: [{ key: CHECKED, version: '1.63.0' }], near: [] }),
  'GET https://mohdex.dev/v1/results': ({ query }) => json(200, [null, 'openrouter'].includes(query.get('provider')) ? { [CHECKED]: { 'spore/core/reply': { digest: 'oki-test', latestVersion: '1.63.0', runs: 1, passed: 1, failed: 0, reasons: {} } } } : {}),
  'GET https://mohdex.dev/v1/entries': ({ query }) => json(200, query.get('provider') === 'openrouter' ? { [CHECKED]: mohdexEntry('oki-test/checked'), [UNCHECKED]: mohdexEntry('oki-test/unchecked') } : {}),
  'GET https://generativelanguage.googleapis.com/v1beta/models': ({ headers }) =>
    headers.get('x-goog-api-key') === 'AIza-oki-test'
      ? json(200, { models: [{ name: 'models/oki-test-model', displayName: 'Oki test model' }] })
      : json(400, { error: { code: 400, message: 'API key not valid. Please pass a valid API key.', status: 'INVALID_ARGUMENT' } })
}

globalThis.fetch = async (input, init = {}) => {
  const request = new Request(input, init)
  const url = new URL(request.url)
  if (url.hostname === '127.0.0.1') return real(input, init)
  const name = `${request.method} ${url.origin}${url.pathname}`
  const body = request.body ? await request.text() : ''
  appendFileSync(process.env.OKI_TEST_REQUESTS, `${JSON.stringify({ name, query: url.search, body })}\n`)
  const answer = routes[name]
  if (!answer) throw new TypeError(`fetch failed — ${name} is not faked in test/providers.js`)
  return answer({ body, headers: request.headers, query: url.searchParams })
}
