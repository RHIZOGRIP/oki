import { home } from './home.js'

import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { after, before, test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { define, send } from '@rhizogrip/spore'
import { renderUnits } from '@rhizogrip/spore-cli/src/services.js'

import { callsIn, installSystemctl } from './systemctl.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const SPORE = join(HERE, '..', 'node_modules', '@rhizogrip', 'spore-cli', 'bin', 'spore.js')
const MANIFEST = JSON.parse(readFileSync(join(HERE, '..', '..', 'image', 'manifest.json'), 'utf8'))
const PASSPHRASE = 'a passphrase, été 🌱'
const PASSWORD = 'export-test'
const SAID = 'hello from before the move'
const bin = installSystemctl()
const running = []

const homes = dirname(home)

function prepare (dir, mark) {
  mkdirSync(join(dir, '.config', 'spore', 'web'), { recursive: true })
  writeFileSync(join(dir, '.config', 'spore', 'config.json'), '{ "home": "~/.spore" }\n')
  const units = join(dir, '.config', 'systemd', 'user')
  mkdirSync(units, { recursive: true })
  for (const [file, text] of Object.entries(renderUnits('tick'))) writeFileSync(join(units, file), text)
  writeFileSync(join(units, 'oki-management.service'), `# ${mark}\n`)
  mkdirSync(join(dir, '.config', 'mohdel'), { recursive: true })
  for (const file of ['curated.json', 'curated.json.prev', 'curated.json.daily']) writeFileSync(join(dir, '.config', 'mohdel', file), '{}\n')
  writeFileSync(`${dir}.systemctl.json`, JSON.stringify({ units: { 'spore-tick.timer': { active: true, pid: 0 } }, calls: [] }))
}

async function start (dir) {
  const port = 20000 + Math.floor(Math.random() * 20000)
  const origin = `http://127.0.0.1:${port}`
  writeFileSync(join(dir, '.config', 'spore', 'web', 'oki.json'), JSON.stringify({ listen: '127.0.0.1:1', origin, user: 'x-forwarded-user', people: { operator: '*' } }))
  const manifest = { ...MANIFEST, built: '2026-11-12T00:00:00Z', computer: 'oki-test', curated: 'http://127.0.0.1:9/v1' }
  const file = join(mkdtempSync(join(tmpdir(), 'oki-manifest-')), 'manifest.json')
  writeFileSync(file, JSON.stringify(manifest))
  const service = spawn(process.execPath, [join(HERE, '..', 'bin', 'oki-management.js'), file], {
    env: { HOME: dir, PATH: `${bin}:${process.env.PATH}`, OKI_TEST_SYSTEMCTL: `${dir}.systemctl.json` },
    stdio: ['ignore', 'pipe', 'inherit']
  })
  running.push(service)
  await new Promise((resolve, reject) => {
    service.once('exit', (code) => reject(new Error(`oki-management exited with ${code}`)))
    service.stdout.on('data', (chunk) => { if (String(chunk).includes('listening on')) resolve() })
  })
  return { dir, origin }
}

const form = (fields) => new URLSearchParams(fields).toString()

async function exported (oki, cookie, fields) {
  const answer = await fetch(`${oki.origin}/oki/api/export`, { method: 'POST', redirect: 'manual', headers: { cookie, origin: oki.origin, 'content-type': 'application/x-www-form-urlencoded' }, body: form(fields) })
  return { status: answer.status, headers: answer.headers, body: Buffer.from(await answer.arrayBuffer()) }
}

async function imported (oki, body, passphrase, cookie) {
  const headers = { origin: oki.origin, 'content-type': 'application/octet-stream', ...(passphrase === undefined ? {} : { 'x-oki-passphrase': encodeURIComponent(passphrase) }), ...(cookie ? { cookie } : {}) }
  const answer = await fetch(`${oki.origin}/oki/api/import`, { method: 'POST', headers, body })
  return { status: answer.status, body: await answer.json() }
}

function snapshot (dir) {
  const seen = {}
  const walk = (at) => {
    for (const name of readdirSync(at)) {
      const path = join(at, name)
      const found = statSync(path)
      seen[relative(dir, path)] = found.isDirectory() ? 'dir' : createHash('sha256').update(readFileSync(path)).digest('hex')
      if (found.isDirectory()) walk(path)
    }
  }
  walk(dir)
  return seen
}

const decrypted = (bytes, passphrase) => {
  const gnupg = mkdtempSync(join(tmpdir(), 'oki-test-gpg-'))
  try {
    writeFileSync(join(gnupg, 'export.gpg'), bytes)
    return execFileSync('gpg', ['--homedir', gnupg, '--batch', '--quiet', '--pinentry-mode', 'loopback', '--passphrase-fd', '0', '--decrypt', '--output', '-', join(gnupg, 'export.gpg')], { input: `${passphrase}\n`, stdio: 'pipe', maxBuffer: 1 << 28 })
  } finally {
    execFileSync('gpgconf', ['--homedir', gnupg, '--kill', 'gpg-agent'])
    rmSync(gnupg, { recursive: true, force: true })
  }
}

const listed = (tarGz) => execFileSync('tar', ['-tz'], { input: tarGz, maxBuffer: 1 << 26 }).toString().trim().split('\n')
const shown = (dir, name) => execFileSync(process.execPath, [SPORE, 'show', name], { env: { HOME: dir, PATH: process.env.PATH } }).toString()

let source, fresh, cookie, encrypted, plain

before(async () => {
  prepare(home, 'the Oki exported from')
  define({ ws: 'main', model: 'local/oki-test' })
  send(join(home, '.spore', 'main'), SAID, { start: false })
  mkdirSync(join(home, '.cache', 'spore'), { recursive: true })
  writeFileSync(join(home, '.cache', 'spore', 'junk'), 'disposable')
  source = await start(home)
  const claimed = await fetch(`${source.origin}/oki/api/claim`, { method: 'POST', headers: { origin: source.origin, 'content-type': 'application/json' }, body: JSON.stringify({ password: PASSWORD }) })
  assert.equal(claimed.status, 200)
  cookie = claimed.headers.get('set-cookie').split(';')[0]

  const target = mkdtempSync(join(homes, 'oki-import-'))
  prepare(target, 'the Oki imported into')
  fresh = await start(target)
})

after(() => {
  for (const service of running) service.kill()
  for (const dir of [home, fresh.dir, bin]) rmSync(dir, { recursive: true, force: true })
  for (const dir of [home, fresh.dir]) for (const file of [`${dir}.systemctl.json`, `${dir}.systemctl.json.log`]) rmSync(file, { force: true })
})

test('an export: written with the services stopped, encrypted with the passphrase, the home inside without its caches', async () => {
  const { status, headers, body } = await exported(source, cookie, { passphrase: PASSPHRASE, again: PASSPHRASE })
  assert.equal(status, 200)
  assert.match(headers.get('content-disposition'), new RegExp(`^attachment; filename="oki-${MANIFEST.release}-backup-[0-9-]+\\.tar\\.gz\\.gpg"$`))
  assert.notDeepEqual([...body.subarray(0, 2)], [0x1f, 0x8b], 'not a plain gzip')
  assert.equal(body.includes(Buffer.from('"release"')), false)
  encrypted = body

  const tar = decrypted(body, PASSPHRASE)
  const names = listed(tar)
  for (const name of ['./.spore/main/spore.cmk', './.spore/main/state.sqlite', './.config/oki/access.json', './.config/oki/backup.json']) assert.ok(names.includes(name), name)
  assert.equal(names.some(name => name.startsWith('./.cache')), false, 'caches are left out')
  const record = JSON.parse(execFileSync('tar', ['-xzO', './.config/oki/backup.json'], { input: tar }))
  assert.deepEqual([record.release, record.spore, record.connector, record.management], [MANIFEST.release, MANIFEST.spore, MANIFEST.pluginWeb.version, MANIFEST.management])

  const calls = callsIn(`${home}.systemctl.json`).filter(([verb]) => verb === 'stop' || verb === 'start')
  assert.deepEqual(calls, [['stop', 'spore-tick.timer'], ['start', 'spore-tick.timer']])
  const status2 = await (await fetch(`${source.origin}/oki/api/export`, { headers: { cookie } })).json()
  assert.deepEqual([status2.busy, status2.last.encrypted, status2.last.bytes], [null, true, body.length])
})

test('a wrong passphrase does not open the export', () => {
  assert.throws(() => decrypted(encrypted, 'not it'), /Bad session key/)
})

test('an export refused: passphrases that differ, a blank one not confirmed; a blank one confirmed is a plain gzip', async () => {
  const differ = await exported(source, cookie, { passphrase: 'one', again: 'two' })
  assert.equal(differ.status, 303)
  assert.equal(new URL(differ.headers.get('location'), source.origin).searchParams.get('error'), 'the two passphrases differ')
  const blank = await exported(source, cookie, { passphrase: '', again: '' })
  assert.equal(blank.status, 303)
  assert.match(new URL(blank.headers.get('location'), source.origin).searchParams.get('error'), /not encrypted — confirm/)
  const confirmed = await exported(source, cookie, { passphrase: '', again: '', unencrypted: 'yes' })
  assert.equal(confirmed.status, 200)
  assert.match(confirmed.headers.get('content-disposition'), /\.tar\.gz"$/)
  assert.deepEqual([...confirmed.body.subarray(0, 2)], [0x1f, 0x8b])
  assert.ok(listed(confirmed.body).includes('./.spore/main/spore.cmk'))
  plain = confirmed.body
})

test('an export is not imported into an Oki that holds data', async () => {
  const { status, body } = await imported(source, encrypted, PASSPHRASE, cookie)
  assert.equal(status, 409)
  assert.equal(body.type, 'HOLDS_DATA')
  assert.match(body.error, /spores \(main\)/)
})

test('into a fresh Oki, each bad import is refused whole and changes nothing', async () => {
  const before = snapshot(fresh.dir)
  const tampered = Buffer.from(encrypted)
  tampered[Math.floor(tampered.length / 2)] ^= 0x01
  const cases = [
    ['a wrong passphrase', encrypted, 'not it', 'WRONG_PASSPHRASE'],
    ['no passphrase', encrypted, undefined, 'ENCRYPTED'],
    ['a truncated export', encrypted.subarray(0, Math.floor(encrypted.length * 0.8)), PASSPHRASE, 'DAMAGED'],
    ['an export cut by one byte', encrypted.subarray(0, encrypted.length - 1), PASSPHRASE, 'DAMAGED'],
    ['a tampered export', tampered, PASSPHRASE, 'DAMAGED'],
    ['a truncated plain export', plain.subarray(0, Math.floor(plain.length / 2)), undefined, 'DAMAGED'],
    ['a tar of something else', execFileSync('tar', ['-cz', '-C', HERE, 'home.js']), undefined, 'NOT_AN_EXPORT'],
    ['an empty file', Buffer.alloc(0), undefined, 'NOT_AN_EXPORT']
  ]
  for (const [what, body, passphrase, type] of cases) {
    const answer = await imported(fresh, body, passphrase)
    assert.equal(answer.status, 409, `${what}: ${JSON.stringify(answer.body)}`)
    assert.equal(answer.body.type, type, `${what}: ${answer.body.error}`)
    assert.deepEqual(snapshot(fresh.dir), before, `${what} changed the home`)
  }
})

test('a database a newer spore made: spore refuses it, and the home is put back as it was', async () => {
  const before = snapshot(fresh.dir)
  const unpacked = mkdtempSync(join(homes, 'oki-newer-'))
  try {
    execFileSync('tar', ['-xz', '-C', unpacked], { input: plain })
    const db = new DatabaseSync(join(unpacked, '.spore', 'main', 'state.sqlite'))
    db.exec('UPDATE t_workspace SET schemaVersion = schemaVersion + 1')
    db.close()
    const newer = execFileSync('tar', ['-cz', '-C', unpacked, '.'], { maxBuffer: 1 << 26 })
    const answer = await imported(fresh, newer)
    assert.equal(answer.status, 409, JSON.stringify(answer.body))
    assert.equal(answer.body.type, 'SPORE_REFUSED')
    assert.match(answer.body.error, /a newer spore made it/)
  } finally {
    rmSync(unpacked, { recursive: true, force: true })
  }
  assert.deepEqual(snapshot(fresh.dir), before)
})

test('an import into a fresh Oki: the home installed, the appliance\'s own wiring kept, the export\'s password asked', async () => {
  const web = readFileSync(join(fresh.dir, '.config', 'spore', 'web', 'oki.json'), 'utf8')
  const { status, body } = await imported(fresh, encrypted, PASSPHRASE)
  assert.equal(status, 200, JSON.stringify(body))
  assert.deepEqual([body.record.release, body.encrypted, body.spores], [MANIFEST.release, true, ['main']])

  assert.match(shown(fresh.dir, 'main'), /\(1 waiting\)/, 'the message sent before the export is in main\'s inbox')
  assert.equal(readFileSync(join(fresh.dir, '.config', 'spore', 'web', 'oki.json'), 'utf8'), web)
  assert.equal(readFileSync(join(fresh.dir, '.config', 'systemd', 'user', 'oki-management.service'), 'utf8'), '# the Oki imported into\n')
  assert.equal(readFileSync(join(fresh.dir, '.config', 'oki', 'access.json'), 'utf8'), readFileSync(join(home, '.config', 'oki', 'access.json'), 'utf8'))
  assert.equal(existsSync(join(fresh.dir, '.cache')), false)
  assert.equal(existsSync(join(fresh.dir, '.oki-import')), false)
  const calls = callsIn(`${fresh.dir}.systemctl.json`).filter(([verb]) => verb === 'stop' || verb === 'start')
  assert.deepEqual(calls, [['stop', 'spore-tick.timer'], ['start', 'spore-tick.timer'], ['stop', 'spore-tick.timer'], ['start', 'spore-tick.timer']], 'the import spore refused, then this one')

  const asked = await fetch(`${fresh.origin}/oki/`, { redirect: 'manual' })
  assert.equal(asked.headers.get('location'), '/oki/sign-in/')
  const signedIn = await fetch(`${fresh.origin}/oki/api/sign-in`, { method: 'POST', headers: { origin: fresh.origin, 'content-type': 'application/json' }, body: JSON.stringify({ password: PASSWORD }) })
  assert.equal(signedIn.status, 200)

  const again = await imported(fresh, encrypted, PASSPHRASE, signedIn.headers.get('set-cookie').split(';')[0])
  assert.equal(again.body.type, 'HOLDS_DATA')
})

test('a ChatGPT sign-in or a saved key is data: an Oki holding either refuses an import', async () => {
  for (const credential of [['.local', 'share', 'mohdel', 'chatgpt', 'accounts.json'], ['.config', 'mohdel', 'environment']]) {
    const target = mkdtempSync(join(homes, 'oki-signed-in-'))
    prepare(target, 'signed in')
    mkdirSync(join(target, ...credential.slice(0, -1)), { recursive: true })
    writeFileSync(join(target, ...credential), '{}\n')
    const oki = await start(target)
    try {
      const answer = await imported(oki, encrypted, PASSPHRASE)
      assert.equal(answer.body.type, 'HOLDS_DATA', credential.join('/'))
      assert.match(answer.body.error, /model access/)
    } finally {
      rmSync(target, { recursive: true, force: true })
      for (const file of [`${target}.systemctl.json`, `${target}.systemctl.json.log`]) rmSync(file, { force: true })
    }
  }
})

test('the copy left by an interrupted import stops the next one', async () => {
  const target = mkdtempSync(join(homes, 'oki-interrupted-'))
  prepare(target, 'interrupted')
  const oki = await start(target)
  try {
    mkdirSync(join(target, '.oki-import', 'previous'), { recursive: true })
    cpSync(join(target, '.config', 'spore', 'config.json'), join(target, '.oki-import', 'previous', 'config.json'))
    const answer = await imported(oki, encrypted, PASSPHRASE)
    assert.equal(answer.body.type, 'INTERRUPTED')
    assert.ok(existsSync(join(target, '.oki-import', 'previous', 'config.json')), 'what it left is not removed')
  } finally {
    rmSync(target, { recursive: true, force: true })
    for (const file of [`${target}.systemctl.json`, `${target}.systemctl.json.log`]) rmSync(file, { force: true })
  }
})
