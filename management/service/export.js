/**
 * Export and import of the oki user's home directory, the one backup: everything Oki keeps
 * lives there, and the software comes from the image. An export is the home as a gzip tar, without
 * caches, written with Oki's services stopped so it is consistent, and encrypted by gpg with the
 * passphrase the person types; left blank and confirmed, it is not encrypted. An import installs
 * such a file as the home of an Oki that holds nothing yet, and only once gpg, tar and spore have
 * each accepted the whole of it.
 */

import { spawn } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { homedir, tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'

import { createServices } from '@rhizogrip/spore-cli/src/services.js'
import { defaultModel, sporePaths } from '@rhizogrip/spore'

import { catalogFile, serially } from './catalog.js'
import { makeFolders, spores } from './spores.js'

const HOME = homedir()
const STAGING = '.oki-import'
const LEFT_OUT = ['./.cache', `./${STAGING}`]
/** The appliance's own wiring, kept from the Oki importing: the units the image wrote and the web file naming this host's address. */
const KEPT = ['.config/systemd/user', '.config/spore/web/oki.json']
const RECORD = '.config/oki/backup.json'
/** Where mohdel keeps keys and the ChatGPT sign-in, as its env-paths dependency places them on Linux; beside the keys it keeps only its catalog and backups of it. */
const CREDENTIALS = () => [
  join(dirname(catalogFile()), 'environment'),
  join(process.env.XDG_DATA_HOME || join(HOME, '.local', 'share'), 'mohdel', 'chatgpt', 'accounts.json')
]
const MOST_PASSPHRASE = 1024
const MOST_STDERR = 4096
const GZIP = [0x1f, 0x8b]
const SPORE_CLI = join(dirname(createRequire(import.meta.url).resolve('@rhizogrip/spore-cli/package.json')), 'bin', 'spore.js')

export class Refusal extends Error {
  constructor (message, type) {
    super(message)
    this.type = type
  }
}

export function passphraseOf ({ passphrase, again, unencrypted }) {
  if (typeof passphrase !== 'string' || passphrase.length > MOST_PASSPHRASE || /[\r\n]/.test(passphrase)) throw new Refusal(`a passphrase is one line of at most ${MOST_PASSPHRASE} characters`, 'PASSPHRASE')
  if (again !== passphrase) throw new Refusal('the two passphrases differ', 'PASSPHRASE')
  if (passphrase === '' && unencrypted !== 'yes') throw new Refusal('with no passphrase the backup is not encrypted — confirm that, or type a passphrase', 'PASSPHRASE')
  return passphrase
}

function started (command, args, { fd3 } = {}) {
  const child = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe', ...(fd3 === undefined ? [] : ['pipe'])] })
  let stderr = ''
  child.stderr.setEncoding('utf8').on('data', (text) => {
    if (stderr.length < MOST_STDERR) stderr += text
  })
  child.stdin.on('error', () => {})
  if (fd3 !== undefined) child.stdio[3].on('error', () => {}).end(`${fd3}\n`)
  const ended = new Promise((resolve) => {
    child.once('error', (err) => resolve({ ok: false, why: `${command} could not run — ${err.message}` }))
    child.once('close', (code, signal) => resolve({ ok: code === 0, stderr: stderr.trim(), why: `${command} ${signal ? `was stopped by ${signal}` : `exited ${code}`}${stderr.trim() ? ` — ${stderr.trim()}` : ''}` }))
  })
  return { child, ended }
}

/** With `--no-symkey-cache` gpg's agent keeps no passphrase, and its home is removed after. */
async function withGpg (act) {
  const dir = mkdtempSync(join(tmpdir(), 'oki-gpg-'))
  const gpg = (args, passphrase) => started('gpg', ['--homedir', dir, '--batch', '--no-tty', '--quiet', '--pinentry-mode', 'loopback', '--passphrase-fd', '3', '--no-symkey-cache', ...args], { fd3: passphrase })
  try {
    return await act(gpg)
  } finally {
    await started('gpgconf', ['--homedir', dir, '--kill', 'gpg-agent']).ended
    rmSync(dir, { recursive: true, force: true })
  }
}

function opening (input) {
  return new Promise((resolve, reject) => {
    const done = () => {
      input.off('readable', readable)
      input.off('end', ended)
      input.off('error', reject)
    }
    const readable = () => {
      const chunk = input.read()
      if (chunk === null) return
      done()
      input.unshift(chunk)
      resolve(chunk)
    }
    const ended = () => {
      done()
      resolve(Buffer.alloc(0))
    }
    input.on('readable', readable)
    input.once('end', ended)
    input.once('error', reject)
  })
}

const drained = (input) => (input.readableEnded ? Promise.resolve() : new Promise((resolve) => input.once('end', resolve).once('close', resolve).resume()))

/**
 * Every spore service that runs, stopped while `act` runs and started again after, so nothing writes
 * in the home meanwhile. A spore in a turn is not cut short: stopping a unit stops only its main
 * process, and the export or import is refused until the turn ends.
 */
async function stopped (act) {
  const services = createServices()
  const running = services.list().services.filter(row => row.defined && row.active === 'active').map(row => row.name)
  const halted = []
  try {
    for (const name of running) {
      services.act('stop', name)
      halted.push(name)
    }
    const busy = spores().filter(one => one.running).map(one => one.name)
    if (busy.length) throw new Refusal(`${busy.join(', ')} ${busy.length > 1 ? 'are' : 'is'} in a turn — try again once it has finished`, 'SPORE_RUNNING')
    return await act()
  } finally {
    for (const name of halted) services.act('start', name)
  }
}

/** What stops an import: anything a person put in this Oki. Claiming alone is not data; the import replaces the claim with the export's. */
export function holding () {
  const held = []
  const names = sporePaths().map(ws => basename(ws))
  if (names.length) held.push(`spores (${names.join(', ')})`)
  const { model } = defaultModel()
  if (model) held.push(`a default model (${model})`)
  if (CREDENTIALS().some(path => existsSync(path))) held.push('model access')
  return held
}

const release = (manifest) => ({
  release: manifest.release,
  built: manifest.built,
  spore: manifest.spore,
  mohdel: manifest.mohdel,
  connector: manifest.pluginWeb.version,
  management: manifest.management,
  arch: manifest.arch,
  dataSchema: manifest.dataSchema
})

/**
 * Each spore read by spore itself: an older database is brought to this spore's schema, and one a
 * newer spore made is refused. In a process of its own, since spore migrates a database once per
 * process and an import that was put back may be followed by another.
 */
async function sporeRefusals () {
  const refused = []
  for (const ws of sporePaths()) {
    const { ended } = started(process.execPath, [SPORE_CLI, 'show', basename(ws)])
    const { ok, why } = await ended
    if (!ok) refused.push(`${basename(ws)}: ${why}`)
  }
  return refused
}

/**
 * Renames, each recorded so `undo` puts back exactly what moved. A rename that fails part way, or an
 * undo that does, leaves the staging directory in place for whoever looks, never removed.
 */
function moves () {
  const done = []
  return {
    all (from, to, skip = null) {
      for (const name of readdirSync(from)) {
        if (name === skip) continue
        renameSync(join(from, name), join(to, name))
        done.push([join(from, name), join(to, name)])
      }
    },
    undo () {
      for (const [from, to] of done.reverse()) renameSync(to, from)
      done.length = 0
    }
  }
}

export function createExports ({ manifest, refresh, say }) {
  let busy = null
  let last = null

  const alone = async (what, act) => {
    if (busy) throw new Refusal(`a ${busy === 'export' ? 'backup' : 'restore'} is under way`, 'BUSY')
    busy = what
    try {
      return await act()
    } finally {
      busy = null
    }
  }

  /**
   * The export, written to `response` as it is made: the home, stopped, archived and encrypted,
   * nothing of it written to disk on the way. A failure after the first byte ends the response
   * unfinished, so the browser marks the download failed rather than keeping a short file.
   */
  const write = ({ passphrase, response }) => alone('export', () => serially(() => stopped(async () => {
    const at = new Date().toISOString()
    const encrypted = passphrase !== ''
    const file = `oki-${manifest.release}-backup-${at.slice(0, 16).replace(/[:T]/g, '-')}.tar.gz${encrypted ? '.gpg' : ''}`
    mkdirSync(dirname(join(HOME, RECORD)), { recursive: true, mode: 0o700 })
    writeFileSync(join(HOME, RECORD), `${JSON.stringify({ ...release(manifest), exported: at }, null, 2)}\n`)
    const run = async (gpg) => {
      const tar = started('tar', ['--create', '--gzip', '--file=-', '--directory', HOME, '--anchored', ...LEFT_OUT.map(path => `--exclude=${path}`), '--warning=no-file-ignored', '.'])
      const encrypt = encrypted ? gpg(['--symmetric', '--cipher-algo', 'AES256', '--compress-algo', 'none', '--output', '-'], passphrase) : null
      const out = encrypt ? encrypt.child.stdout : tar.child.stdout
      if (encrypt) tar.child.stdout.pipe(encrypt.child.stdin)
      let bytes = 0
      out.on('data', (chunk) => { bytes += chunk.length })
      response.writeHead(200, { 'content-type': 'application/octet-stream', 'content-disposition': `attachment; filename="${file}"`, 'cache-control': 'no-store' })
      out.pipe(response, { end: false })
      const gone = new Promise((resolve) => response.once('close', () => resolve({ ok: response.writableFinished, why: 'the browser stopped the download' })))
      const ends = [tar.ended, ...(encrypt ? [encrypt.ended] : [])]
      const failed = (await Promise.race([Promise.all(ends), gone.then(one => [one])])).find(one => !one.ok)
      if (failed) {
        tar.child.kill()
        encrypt?.child.kill()
        await Promise.all(ends)
        response.destroy()
        last = { at, file, failed: failed.why }
        say(`export: ${file} failed — ${failed.why}`)
        return
      }
      await new Promise((resolve) => response.end(resolve))
      last = { at, file, bytes, encrypted }
      say(`export: ${file}, ${bytes} bytes, ${encrypted ? 'encrypted' : 'not encrypted'}`)
    }
    return encrypted ? withGpg(run) : run(null)
  })))

  /**
   * The import: `input` read into a staging directory in the home and checked whole (gpg's
   * integrity check, tar's, the export's record) before anything is installed. Then the home is
   * swapped for it, with this appliance's own wiring kept, and spore reads each spore; one it
   * refuses puts the home back as it was.
   */
  const read = async ({ input, passphrase }) => {
    input.on('error', () => {})
    try {
      return await importing({ input, passphrase })
    } finally {
      await drained(input)
    }
  }

  const importing = ({ input, passphrase }) => alone('import', async () => {
    const staging = join(HOME, STAGING)
    const answer = await serially(async () => {
      if (existsSync(staging)) throw new Refusal(`an earlier restore was cut off and left ${staging} — this Oki may be incomplete: install it again, and restore into that`, 'INTERRUPTED')
      const held = holding()
      if (held.length) throw new Refusal(`this Oki already holds ${held.join(', ')} — a backup is restored only into a new Oki, so nothing is replaced`, 'HOLDS_DATA')
      const staged = join(staging, 'home')
      const previous = join(staging, 'previous')
      mkdirSync(staged, { recursive: true, mode: 0o700 })
      mkdirSync(previous, { mode: 0o700 })
      let tidy = true
      try {
        const head = await opening(input)
        if (head.length === 0) throw new Refusal('the file is empty', 'NOT_AN_EXPORT')
        const encrypted = !(head[0] === GZIP[0] && head[1] === GZIP[1])
        if (encrypted && passphrase === '') throw new Refusal('this backup is encrypted — type the passphrase it was made with', 'ENCRYPTED')
        const unpack = async (gpg) => {
          const tar = started('tar', ['--extract', '--gzip', '--file=-', '--directory', staged, '--same-permissions'])
          const decrypt = encrypted ? gpg(['--decrypt', '--output', '-'], passphrase) : null
          const first = decrypt ? decrypt.child.stdin : tar.child.stdin
          input.once('close', () => {
            if (!input.readableEnded) first.destroy()
          })
          input.pipe(first)
          if (decrypt) decrypt.child.stdout.pipe(tar.child.stdin)
          const [unpacked, decrypted] = await Promise.all([tar.ended, decrypt?.ended])
          if (!input.readableEnded) throw new Refusal('the upload stopped before the end of the file', 'DAMAGED')
          if (decrypted && !decrypted.ok) {
            if (/bad session key/i.test(decrypted.stderr)) throw new Refusal('that is not the passphrase this backup was made with', 'WRONG_PASSPHRASE')
            throw new Refusal(`the file is damaged or was changed — ${decrypted.why}`, 'DAMAGED')
          }
          if (!unpacked.ok) throw new Refusal(`the file is incomplete or damaged — ${unpacked.why}`, 'DAMAGED')
        }
        await (encrypted ? withGpg(unpack) : unpack(null))
        let record
        try {
          record = JSON.parse(readFileSync(join(staged, RECORD), 'utf8'))
        } catch (err) {
          throw new Refusal(`the file is not a backup of Oki — it holds no readable ${RECORD} (${err.message})`, 'NOT_AN_EXPORT')
        }
        for (const path of KEPT) {
          rmSync(join(staged, path), { recursive: true, force: true })
          if (existsSync(join(HOME, path))) cpSync(join(HOME, path), join(staged, path), { recursive: true, verbatimSymlinks: true })
        }
        return await stopped(async () => {
          const swap = moves()
          try {
            swap.all(HOME, previous, STAGING)
            swap.all(staged, HOME)
            const refused = await sporeRefusals()
            if (refused.length) throw new Refusal(`spore refuses what this backup holds, and the home is as it was — ${refused.join('; ')}`, 'SPORE_REFUSED')
            makeFolders()
          } catch (err) {
            try {
              swap.undo()
            } catch (undone) {
              tidy = false
              throw new Error(`the home could not be put back after ${err.message} — ${undone.message}; what it held is in ${previous}`)
            }
            throw err
          }
          return { record, encrypted, spores: sporePaths().map(ws => basename(ws)) }
        })
      } finally {
        if (tidy) rmSync(staging, { recursive: true, force: true })
      }
    })
    say(`import: an export of Oki ${answer.record.release}, made ${answer.record.exported}, installed — ${answer.spores.join(', ') || 'no spore'}`)
    await refresh.refresh()
    return answer
  })

  return {
    write,
    read,
    status: () => ({ busy, last, release: manifest.release })
  }
}
