import { home } from './home.js'

import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { dirname, join } from 'node:path'
import { after, before, test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { define } from '@rhizogrip/spore'

import { CHOSEN, entriesOf, MARK } from '../service/catalog.js'
import { startMohdex } from './mohdex.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const port = 20000 + Math.floor(Math.random() * 20000)
const origin = `http://127.0.0.1:${port}`
const LOCAL_ID = 'oki-test-local'
let mohdex
let server
let service
let address

const call = async (path, body) => {
  const answer = await fetch(`${origin}${path}`, body === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json', origin }, body: JSON.stringify(body) })
  return { status: answer.status, body: await answer.json() }
}

before(async () => {
  mohdex = await startMohdex()
  mohdex.status = 503
  server = createServer((request, response) => {
    if (request.url !== '/v1/models') return response.writeHead(404).end()
    response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ object: 'list', data: [{ id: LOCAL_ID, object: 'model' }] }))
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  address = `http://127.0.0.1:${server.address().port}/v1`

  define({ ws: 'notes', model: `local/${LOCAL_ID}` })
  mkdirSync(join(home, '.config', 'spore', 'web'), { recursive: true })
  writeFileSync(join(home, '.config', 'spore', 'web', 'oki.json'), JSON.stringify({ listen: '127.0.0.1:1', origin, user: 'x-forwarded-user', people: { operator: '*' } }))
  const manifest = JSON.parse(readFileSync(join(HERE, '..', '..', 'image', 'manifest.json'), 'utf8'))
  manifest.curated = mohdex.base
  manifest.computer = 'oki-test'
  writeFileSync(join(home, 'manifest.json'), JSON.stringify(manifest))
  writeFileSync(join(home, 'requests.jsonl'), '')
  service = spawn(process.execPath, ['--import', join(HERE, 'providers.js'), join(HERE, '..', 'bin', 'oki-management.js'), join(home, 'manifest.json')], {
    env: { HOME: home, PATH: process.env.PATH, OKI_TEST_REQUESTS: join(home, 'requests.jsonl') },
    stdio: ['ignore', 'pipe', 'inherit']
  })
  await new Promise((resolve, reject) => {
    service.once('exit', (code) => reject(new Error(`oki-management exited with ${code}`)))
    service.stdout.on('data', (chunk) => { if (String(chunk).includes('listening on')) resolve() })
  })
})

after(() => {
  service.kill()
  server.close()
  mohdex.close()
  rmSync(home, { recursive: true, force: true })
})

test('mohdex unreachable at first start: claiming works, no model is listed from the catalog, the local model is chosen', async () => {
  assert.equal((await call('/oki/api/claim', { password: null })).status, 200)
  let catalog = (await call('/oki/api/catalog')).body
  for (let tries = 0; !catalog.failed && tries < 50; tries++) {
    await new Promise(resolve => setTimeout(resolve, 100))
    catalog = (await call('/oki/api/catalog')).body
  }
  assert.equal(catalog.installed, null)
  assert.match(catalog.unread, /answered 503$/)
  assert.equal(existsSync(join(home, '.config', 'mohdel', 'curated.json')), false, 'no catalog is installed from anywhere else')

  for (const path of ['/oki/api/setup/offers?provider=gemini&only=recommended', '/oki/api/setup/offers?provider=openrouter&only=known', '/oki/api/models']) {
    const { status, body } = await call(path)
    assert.equal(status, 409, path)
    assert.deepEqual(body, { error: catalog.unread, type: 'MOHDEX_UNREAD' }, path)
  }

  assert.deepEqual((await call('/oki/api/setup/local', { address })).body, { models: [LOCAL_ID] })
  const chosen = await call('/oki/api/setup/choose', { provider: 'local', address, id: LOCAL_ID })
  assert.equal(chosen.status, 200, chosen.body.error)
  assert.deepEqual([chosen.body.model, chosen.body.readiness.ready], [`local/${LOCAL_ID}`, true])
})

test('retry: refused while mohdex still fails, the catalog installed once it answers, the local choice kept', async () => {
  const again = await call('/oki/api/catalog/refresh', {})
  assert.equal(again.status, 200)
  assert.match(again.body.unread, /answered 503$/)

  mohdex.status = 200
  const read = await call('/oki/api/catalog/refresh', {})
  assert.equal(read.body.unread, null)
  assert.equal(read.body.installed.from, mohdex.base)
  const catalog = JSON.parse(readFileSync(join(home, '.config', 'mohdel', 'curated.json'), 'utf8'))
  assert.equal(catalog[MARK].from, mohdex.base)
  assert.deepEqual(catalog[`local/${LOCAL_ID}`].tags, [CHOSEN])
  assert.ok(entriesOf(catalog).length > 1)

  const models = await call('/oki/api/models')
  assert.equal(models.status, 200)
  assert.deepEqual(models.body.offers.map(one => one.model), [`local/${LOCAL_ID}`], 'only a model a spore can run on now: no front choice has a credential')
})
