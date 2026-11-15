/**
 * mohdex's public API as the catalog reads it, `/v1/entries`, `/v1/results` and `/v1/recommended`
 * with its `near` list, filtered by `provider` as mohdex filters, answering what `serving` holds.
 */

import { createServer } from 'node:http'

const SDK = { openrouter: 'openrouter', openai: 'openai', gemini: 'gemini' }

export const entry = (key, input, output) => {
  const [provider, ...rest] = key.split('/')
  const model = rest.join('/')
  return { provider, sdk: SDK[provider], model, label: model, creator: 'oki-test', inputFormat: ['text'], contextTokenLimit: 32768, outputTokenLimit: 4096, inputPrice: input, outputPrice: output, source: 'https://example.org/prices', sourcedAt: '2026-11-01' }
}

const task = (failed) => ({ digest: 'oki-test', latestVersion: '1.63.0', runs: 1, passed: failed ? 0 : 1, failed, reasons: failed ? { 'tool call malformed': 1 } : {} })
export const tasks = (...failed) => Object.fromEntries(failed.map((one, at) => [`spore/conformance/core/task-${at}`, task(one)]))
export const failing = (count) => Array.from({ length: count }, (_, at) => ({ taskId: `spore/conformance/core/task-${at}`, reasons: { 'tool call malformed': 1 } }))

export const fixture = () => ({
  entries: {
    'openrouter/oki-test/free-recommended': entry('openrouter/oki-test/free-recommended', 0, 0),
    'openrouter/oki-test/untested': entry('openrouter/oki-test/untested', 1, 2),
    'openai/oki-mini': entry('openai/oki-mini', 0.5, 2),
    'openai/oki-large': entry('openai/oki-large', 3, 12),
    'openai/oki-unrun': entry('openai/oki-unrun', 0.1, 0.2),
    'gemini/oki-cheap-rec': entry('gemini/oki-cheap-rec', 0.1, 0.4),
    'gemini/oki-dear-rec': entry('gemini/oki-dear-rec', 2, 10),
    'gemini/oki-partial': entry('gemini/oki-partial', 0.3, 1),
    'gemini/oki-retired': { deprecated: 'gemini/oki-cheap-rec' },
    'gemini/oki-chain': { deprecated: 'gemini/oki-retired' },
    'gemini/oki-nowhere': { deprecated: 'gemini/oki-unknown' }
  },
  results: {
    'openrouter/oki-test/free-recommended': tasks(0, 0),
    'chatgpt/oki-mini': tasks(0, 1),
    'chatgpt/oki-large': tasks(0, 0),
    'gemini/oki-cheap-rec': tasks(0, 0),
    'gemini/oki-dear-rec': tasks(0, 0),
    'gemini/oki-partial': tasks(1, 1, 0),
    'gemini/oki-no-entry': tasks(0, 0)
  },
  recommended: ['openrouter/oki-test/free-recommended', 'chatgpt/oki-large', 'gemini/oki-cheap-rec', 'gemini/oki-dear-rec', 'anthropic/oki-elsewhere'],
  near: { 'chatgpt/oki-mini': failing(1), 'gemini/oki-partial': failing(2), 'gemini/oki-no-entry': failing(1) }
})

const within = (provider) => ([key]) => provider === null || key.startsWith(`${provider}/`)

export async function startMohdex () {
  const mohdex = { status: 200, data: fixture() }
  const server = createServer((request, response) => {
    const url = new URL(request.url, 'http://mohdex')
    const json = (body) => response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(body))
    if (mohdex.status !== 200) return response.writeHead(mohdex.status).end()
    const { entries, results, recommended, near } = mohdex.data
    const provider = url.searchParams.get('provider')
    if (url.pathname === '/v1/entries') return json(Object.fromEntries(Object.entries(entries).filter(within(provider))))
    if (url.pathname === '/v1/results' && url.searchParams.get('tool') === 'spore') return json(Object.fromEntries(Object.entries(results).filter(within(provider))))
    if (url.pathname === '/v1/recommended' && url.searchParams.get('tool') === 'spore' && url.searchParams.getAll('bar').length && url.searchParams.get('near') === '2') return json({ models: recommended.map(key => ({ key, version: '1.63.0' })), near: Object.entries(near).map(([key, failed]) => ({ key, version: '1.63.0', failed })) })
    response.writeHead(404).end()
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  mohdex.base = `http://127.0.0.1:${server.address().port}/v1`
  mohdex.close = () => server.close()
  return mohdex
}
