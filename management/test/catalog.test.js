import { home } from './home.js'

import assert from 'node:assert/strict'
import { existsSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { after, before, test } from 'node:test'

import { define, defaultModel, setDefaultModel, show } from '@rhizogrip/spore'
import { saveKey } from 'mohdel/credentials'

import { ADVISED, CHOSEN, catalogFile, computed, createRefresh, deprecations, entriesOf, FREE, MARK, merged, readCatalog, readMohdex } from '../service/catalog.js'
import { move } from '../service/spores.js'
import { entry, failing, fixture, startMohdex } from './mohdex.js'

const local = (id) => ({ provider: 'local', sdk: 'openai', model: id, label: id, creator: 'stub', inputFormat: ['text'], baseURL: 'http://127.0.0.1:9/v1' })
const shapeOf = (catalog) => Object.fromEntries(entriesOf(catalog).map(([key, one]) => [key, one.deprecated ? { deprecated: one.deprecated } : one.tags ?? []]))

const OFFERED = {
  'openrouter/oki-test/free-recommended': [FREE, ADVISED],
  'chatgpt/oki-mini': [],
  'chatgpt/oki-large': [ADVISED],
  'gemini/oki-cheap-rec': [ADVISED],
  'gemini/oki-dear-rec': [],
  'gemini/oki-partial': [],
  'gemini/oki-retired': { deprecated: 'gemini/oki-cheap-rec' },
  'gemini/oki-chain': { deprecated: 'gemini/oki-retired' }
}

let mohdex
const said = []
const refresh = () => createRefresh({ base: mohdex.base, say: (line) => said.push(line) })
const writtenAt = () => statSync(catalogFile()).mtimeMs

before(async () => {
  mohdex = await startMohdex()
})

after(() => {
  mohdex.close()
  rmSync(home, { recursive: true, force: true })
})

test('computed: what meets spore\'s bar on mohdex or is near it, from every provider it names, advised and free per provider, and the stubs that lead somewhere', async () => {
  const read = await readMohdex(mohdex.base)
  const offered = computed(read, {})
  assert.deepEqual(shapeOf(offered), OFFERED)
  assert.equal(offered['chatgpt/oki-large'].provider, 'chatgpt', 'a pricesFrom provider\'s entries are its own')
  assert.equal(offered['chatgpt/oki-large'].inputPrice, 3)

  const carried = computed(read, { 'gemini/oki-gone': { deprecated: 'gemini/oki-dear-rec' }, 'gemini/oki-partial': { deprecated: 'gemini/oki-dear-rec' } })
  assert.deepEqual(carried['gemini/oki-gone'], { deprecated: 'gemini/oki-dear-rec' }, 'a retired id stays retired after mohdex stops serving it')
  assert.equal(carried['gemini/oki-partial'].model, 'oki-partial', 'a stub mohdex serves again as a model is the model')
})

test('computed: where nothing meets the bar, advised goes to the near model that failed least, then the cheaper; results alone offer nothing; a priced model is never free', async () => {
  const data = fixture()
  data.recommended = []
  data.entries['gemini/oki-also-near'] = entry('gemini/oki-also-near', 0.05, 0.1)
  data.near['gemini/oki-also-near'] = failing(1)
  data.near['openrouter/oki-test/free-recommended'] = failing(2)
  mohdex.data = data
  const offered = computed(await readMohdex(mohdex.base), {})
  mohdex.data = fixture()
  assert.deepEqual(offered['gemini/oki-also-near'].tags, [ADVISED])
  assert.deepEqual(offered['gemini/oki-partial'].tags ?? [], [])
  assert.deepEqual(offered['openrouter/oki-test/free-recommended'].tags, [FREE, ADVISED])
  assert.equal(offered['gemini/oki-cheap-rec'], undefined, 'spore results do not offer a model that neither meets the bar nor is near it')
  assert.equal(offered['openrouter/oki-test/untested'], undefined)
  assert.ok(entriesOf(offered).every(([, one]) => !one.tags?.includes(FREE) || one.inputPrice === 0), 'free is priced at nothing')
})

test('merged: offered entries over the catalog, the person\'s choices kept, Oki\'s tags only on offered entries', async () => {
  const offered = computed(await readMohdex(mohdex.base), {})
  const current = {
    [MARK]: { from: 'before' },
    'gemini/oki-cheap-rec': { ...offered['gemini/oki-cheap-rec'], inputPrice: 99, tags: [CHOSEN] },
    'local/mine': { ...local('mine'), tags: [CHOSEN] },
    'gemini/gone-model': { ...entry('gemini/gone-model', 1, 1), tags: [FREE, ADVISED, CHOSEN] },
    'gemini/dropped-model': { ...entry('gemini/dropped-model', 1, 1), tags: [FREE] },
    'gemini/oki-retired': { ...entry('gemini/oki-retired', 1, 1), tags: [CHOSEN] }
  }
  const next = merged(current, offered, { from: mohdex.base })
  assert.deepEqual(next[MARK], { from: mohdex.base })
  assert.equal(next['gemini/oki-cheap-rec'].inputPrice, 0.1, 'the offered entry replaces the chosen one')
  assert.deepEqual(next['gemini/oki-cheap-rec'].tags, [ADVISED, CHOSEN])
  assert.deepEqual(next['local/mine'], current['local/mine'])
  assert.deepEqual(next['gemini/gone-model'].tags, [CHOSEN], 'a chosen model Oki stopped offering keeps none of Oki\'s tags')
  assert.equal(next['gemini/dropped-model'], undefined, 'what Oki stopped offering and nobody chose goes')
  assert.deepEqual(next['gemini/oki-retired'], { deprecated: 'gemini/oki-cheap-rec' }, 'a retirement stands over the choice')
})

test('refresh: no catalog until mohdex is read, each failure said once, then exactly the computed set', async () => {
  mohdex.status = 503
  const one = refresh()
  await one.refresh()
  assert.equal(existsSync(catalogFile()), false)
  assert.equal(one.status().installed, null)
  assert.match(one.status().unread, /\/v1\/recommended\?tool=spore&bar=tier%3Acore&bar=tier%3Aidentity&near=2 answered 503$/)
  await one.refresh()
  assert.equal(said.filter(line => line.includes('answered 503')).length, 1, 'the same failure is said once')
  mohdex.status = 500
  await one.refresh()
  assert.equal(said.filter(line => line.includes('answered 500')).length, 1, 'a new reason is said')

  mohdex.status = 200
  await one.refresh()
  const catalog = readCatalog()
  assert.deepEqual(shapeOf(catalog), OFFERED)
  assert.equal(catalog[MARK].from, mohdex.base)
  assert.equal(one.status().failed, null)
  assert.equal(one.status().unread, null)
  assert.ok(one.status().checked)
  const at = writtenAt()
  await one.refresh()
  assert.equal(writtenAt(), at, 'the same computed set is not written again')
})

test('refresh: a failure after an install leaves the catalog as it is', async () => {
  const before = readFileSync(catalogFile(), 'utf8')
  const one = refresh()
  for (const status of [404, 500]) {
    mohdex.status = status
    await one.refresh()
    assert.match(one.status().failed.why, new RegExp(`answered ${status}$`))
    assert.equal(one.status().unread, null)
  }
  mohdex.status = 200
  mohdex.data = { ...fixture(), entries: { 'openrouter/oki-test/broken': 'not an entry' } }
  await one.refresh()
  assert.match(one.status().failed.why, /entries\?provider=openrouter did not answer entries/)
  mohdex.data = fixture()
  assert.equal(readFileSync(catalogFile(), 'utf8'), before)
})

test('refresh: the person\'s choices kept, and a catalog mohdel rejects is refused whole', async () => {
  writeFileSync(catalogFile(), JSON.stringify({ ...readCatalog(), 'local/old': { ...local('old'), tags: [CHOSEN] }, 'local/other': { ...local('other'), tags: [CHOSEN] } }))
  mohdex.data.entries['gemini/oki-partial'] = entry('gemini/oki-partial', 0.2, 1)
  const one = refresh()
  await one.refresh()
  assert.deepEqual(readCatalog()['local/old'].tags, [CHOSEN])
  assert.equal(readCatalog()['gemini/oki-partial'].inputPrice, 0.2)

  const before = { ...readCatalog(), 'gemini/oki-lost': { deprecated: 'gemini/nowhere' } }
  writeFileSync(catalogFile(), JSON.stringify(before))
  await one.refresh()
  assert.match(one.status().failed.why, /mohdel rejects the catalog computed from .* — gemini\/oki-lost: deprecated target 'gemini\/nowhere' not in curated/)
  assert.deepEqual(readCatalog(), before)
  const { 'gemini/oki-lost': lost, ...rest } = before
  writeFileSync(catalogFile(), JSON.stringify(rest))
  mohdex.data = fixture()
})

test('deprecation: offered for every spore and the default on a model mohdex retires, moved only when asked, retired for good', async () => {
  await saveKey('gemini', 'AIza-oki-test')
  await refresh().refresh()
  define({ ws: 'main', model: 'gemini/oki-dear-rec' })
  define({ ws: 'notes', model: 'gemini/oki-dear-rec' })
  define({ ws: 'other', model: 'local/other' })
  setDefaultModel('gemini/oki-dear-rec')
  assert.deepEqual(deprecations(), [])

  mohdex.data.entries['gemini/oki-dear-rec'] = { deprecated: 'gemini/oki-mid' }
  mohdex.data.entries['gemini/oki-mid'] = { deprecated: 'gemini/oki-cheap-rec' }
  await refresh().refresh()
  assert.deepEqual(deprecations(), [{ model: 'gemini/oki-dear-rec', key: 'gemini/oki-dear-rec', spores: ['main', 'notes'], isDefault: true, replacement: 'gemini/oki-cheap-rec', via: ['gemini/oki-mid'], missing: null }])
  assert.equal(show({ ws: 'main' }).model, 'gemini/oki-dear-rec', 'nothing moves by itself')
  assert.equal(defaultModel().model, 'gemini/oki-dear-rec')

  const moved = await move({ from: 'gemini/oki-dear-rec', to: 'gemini/oki-cheap-rec' })
  assert.deepEqual(moved, { from: 'gemini/oki-dear-rec', to: 'gemini/oki-cheap-rec', moved: ['main', 'notes'], refused: [], defaultMoved: true })
  assert.equal(show({ ws: 'main' }).model, 'gemini/oki-cheap-rec')
  assert.deepEqual(show({ ws: 'main' }).models, ['gemini/oki-dear-rec'])
  assert.equal(defaultModel().model, 'gemini/oki-cheap-rec')
  assert.ok(readCatalog()['gemini/oki-cheap-rec'].tags.includes(CHOSEN), 'a model moved to is a choice, kept by later refreshes')
  assert.deepEqual(deprecations(), [])

  delete mohdex.data.entries['gemini/oki-dear-rec']
  delete mohdex.data.entries['gemini/oki-mid']
  await refresh().refresh()
  assert.deepEqual(readCatalog()['gemini/oki-dear-rec'], { deprecated: 'gemini/oki-mid' })
  assert.deepEqual(readCatalog()['gemini/oki-mid'], { deprecated: 'gemini/oki-cheap-rec' })
  assert.deepEqual(readCatalog()['gemini/oki-cheap-rec'].tags, [ADVISED, CHOSEN])
})

test('deprecation: a chain that ends nowhere names what is missing, and the move takes another model', async () => {
  define({ ws: 'lost', model: 'local/other' })
  writeFileSync(catalogFile(), JSON.stringify({ ...readCatalog(), 'local/other': { deprecated: 'local/gone' } }))
  const [offer] = deprecations()
  assert.deepEqual({ ...offer, spores: offer.spores.sort() }, { model: 'local/other', key: 'local/other', spores: ['lost', 'other'], isDefault: false, replacement: null, via: [], missing: 'local/gone' })
  await assert.rejects(move({ from: 'local/other', to: 'gemini/oki-unknown' }), /gemini\/oki-unknown is not ready — it is not in the catalog/)
  assert.deepEqual((await move({ from: 'local/other', to: 'gemini/oki-partial' })).moved.sort(), ['lost', 'other'])
})
