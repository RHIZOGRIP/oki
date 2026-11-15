/**
 * The one address: /oki/ is management. Until Oki is claimed every other path redirects to the claim
 * screen; once claimed, everything else goes to the web connector as its proxy, with the `user`
 * header naming the Oki person on every request it lets through. Behind a proxy the
 * connector no longer checks Host, so this does: a page on another site rebinding its name to
 * 127.0.0.1 is refused here.
 */

import { createReadStream, statfsSync, statSync } from 'node:fs'
import { createServer, request as ask } from 'node:http'
import { homedir } from 'node:os'
import { dirname, join, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

import { createServices } from '@rhizogrip/spore-cli/src/services.js'
import { diagnose } from '@rhizogrip/spore-cli/src/doctor.js'
import { defaultModel, errorText, SporeError, sporePaths } from '@rhizogrip/spore'

import { COOKIE, Claimed } from './access.js'
import { deprecations, serially } from './catalog.js'
import { createExports, holding, passphraseOf, Refusal } from './export.js'
import { CALLBACKS, catalogOffers, choose, chooseLocal, createSignIns, enterKey, knownOffers, LOCAL, makeDefault, modelState, recommendedOffers, servedModels, state, Unusable } from './setup.js'
import { create, kinds, move, removeSpore, spores } from './spores.js'

const PAGES = join(dirname(fileURLToPath(import.meta.url)), '..', 'build')
const SCREENS = { '/oki/': 'index.html', '/oki/setup/': 'setup/index.html', '/oki/spores/': 'spores/index.html', '/oki/backup/': 'backup/index.html', '/oki/restore/': 'restore/index.html', '/oki/claim/': 'claim/index.html', '/oki/sign-in/': 'sign-in/index.html' }
const TYPES = { html: 'text/html; charset=utf-8', js: 'text/javascript; charset=utf-8', css: 'text/css; charset=utf-8', svg: 'image/svg+xml', json: 'application/json' }
const HOP = ['connection', 'keep-alive', 'proxy-connection', 'transfer-encoding', 'te', 'trailer', 'upgrade']
const MOST_BODY = 4096
const MOST_PASSWORD = 1024
const SECURITY = {
  'content-security-policy': "frame-ancestors 'none'",
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer'
}

class Refused extends Error {
  constructor (status, message, type = null) {
    super(message)
    this.status = status
    this.type = type
  }
}

const cookiesOf = (header = '') => new Map(header.split(';').map(pair => pair.trim().split('=')).filter(([name, value]) => name && value !== undefined))

const without = (headers, names) => Object.fromEntries(Object.entries(headers).filter(([name]) => !names.includes(name)))

async function textOf (request) {
  const chunks = []
  let bytes = 0
  for await (const chunk of request) {
    bytes += chunk.length
    if (bytes > MOST_BODY) throw new Refused(413, `a request carries at most ${MOST_BODY} bytes`)
    chunks.push(chunk)
  }
  return Buffer.concat(chunks).toString('utf8')
}

async function bodyOf (request) {
  const text = await textOf(request)
  let body
  try {
    body = JSON.parse(text)
  } catch (err) {
    throw new Refused(400, `the body is not JSON — ${err.message}`)
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) throw new Refused(400, 'the body is a JSON object')
  return body
}

const textIn = (body, name, most = 2048) => {
  const value = body[name]
  if (typeof value !== 'string' || !value.trim() || value.length > most) throw new Refused(400, `${name} is text of 1 to ${most} characters`)
  return value.trim()
}

const escaped = (text) => text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)

/** A form's fields: the export is a form posted by the page, so the browser downloads its answer to disk. */
async function formOf (request) {
  if (request.headers['content-type'] !== 'application/x-www-form-urlencoded') throw new Refused(415, 'the export is asked for by a form')
  return Object.fromEntries(new URLSearchParams(await textOf(request)))
}

const passphraseHeader = (request) => {
  const header = request.headers['x-oki-passphrase']
  if (header === undefined) return ''
  try {
    return decodeURIComponent(header)
  } catch {
    throw new Refused(400, 'x-oki-passphrase is the passphrase, percent-encoded')
  }
}

const passwordIn = ({ password }) => {
  if (typeof password !== 'string' || !password || password.length > MOST_PASSWORD) throw new Refused(400, `the password is text of 1 to ${MOST_PASSWORD} characters`)
  return password
}

export function serve ({ listen, connector, origin, user, person, manifest, access, refresh, say }) {
  const host = new URL(origin).host
  const signIns = createSignIns({ origin, computer: manifest.computer })
  const backups = createExports({ manifest, refresh, say })

  const json = (response, status, body, headers = {}) => response.writeHead(status, { ...SECURITY, 'content-type': 'application/json', 'cache-control': 'no-store', ...headers }).end(JSON.stringify(body))
  const redirect = (response, where) => response.writeHead(303, { ...SECURITY, location: where, 'cache-control': 'no-store' }).end()
  const sessionCookie = ({ value, maxAge }) => `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}`

  const page = (response, path) => {
    const full = join(PAGES, path)
    if (!full.startsWith(PAGES + sep)) throw new Refused(404, 'no such page')
    let found
    try {
      found = statSync(full)
    } catch (err) {
      if (err.code === 'ENOENT') throw new Refused(404, 'no such page')
      throw err
    }
    if (!found.isFile()) throw new Refused(404, 'no such page')
    const type = TYPES[path.slice(path.lastIndexOf('.') + 1)]
    if (!type) throw new Error(`${full} has no content type in TYPES`)
    const cache = path.startsWith('_app/immutable/') ? 'public, max-age=31536000, immutable' : 'no-cache'
    response.writeHead(200, { ...SECURITY, 'content-type': type, 'content-length': found.size, 'cache-control': cache })
    createReadStream(full).on('error', () => response.destroy()).pipe(response)
  }

  const answering = async () => {
    try {
      const answer = await fetch(`http://${connector.text}/`, { signal: AbortSignal.timeout(2000) })
      return { answering: answer.ok, detail: `HTTP ${answer.status}` }
    } catch (err) {
      return { answering: false, detail: err.cause?.code ?? err.message }
    }
  }

  const system = async (record) => ({
    release: {
      release: manifest.release,
      built: manifest.built,
      spore: manifest.spore,
      mohdel: manifest.mohdel,
      connector: manifest.pluginWeb.version,
      management: manifest.management,
      node: manifest.node.version,
      arch: manifest.arch,
      dataSchema: manifest.dataSchema
    },
    connector: { unit: manifest.services.connector.unit, listen: connector.text, ...(await answering()) },
    services: services(),
    space: space(),
    password: record.password !== null
  })

  const space = () => {
    const { blocks, bfree, bsize } = statfsSync(homedir())
    return { used: (blocks - bfree) * bsize, size: blocks * bsize }
  }

  const services = () => {
    try {
      return { rows: createServices().list().services.filter(row => row.defined).map(({ name, enabled, active, sub }) => ({ name, enabled, active, sub })) }
    } catch (err) {
      if (err.type !== 'SERVICE_NO_SYSTEMD') throw err
      return { rows: [], none: err.message }
    }
  }

  const doctor = async () => {
    const { findings, boundary } = await diagnose()
    return { findings: findings.map(({ area, subject, severity, problem, fix }) => ({ area, subject, severity, problem, fix })), boundary }
  }

  const catalogRead = () => {
    const { unread } = refresh.status()
    if (unread) throw new Refused(409, unread, 'MOHDEX_UNREAD')
  }

  const setupApi = async (request, path, url) => {
    if (request.method === 'GET') {
      if (path === '/oki/api/setup') return state()
      if (path === '/oki/api/setup/offers') {
        catalogRead()
        const provider = url.searchParams.get('provider')
        if (!provider) throw new Refused(400, 'provider names the provider whose models are listed')
        const only = url.searchParams.get('only')
        if (only === 'recommended') return { offers: await recommendedOffers(provider) }
        if (only === 'known') return knownOffers(provider)
        throw new Refused(400, 'only is recommended or known')
      }
      return null
    }
    if (path === '/oki/api/setup/key') {
      const body = await bodyOf(request)
      return enterKey({ provider: textIn(body, 'provider', 64), key: textIn(body, 'key'), anyway: body.anyway === true })
    }
    if (path === '/oki/api/setup/sign-in') {
      const { provider } = await bodyOf(request)
      if (provider === 'openrouter') return signIns.startOpenRouter()
      if (provider === 'chatgpt') return signIns.startChatGPT()
      throw new Refused(400, 'provider is openrouter or chatgpt')
    }
    if (path === '/oki/api/setup/local') return { models: await servedModels(textIn(await bodyOf(request), 'address')) }
    if (path === '/oki/api/setup/choose') {
      const body = await bodyOf(request)
      const provider = textIn(body, 'provider', 64)
      if (provider === LOCAL) return serially(() => chooseLocal({ address: textIn(body, 'address'), id: textIn(body, 'id', 512) }))
      return serially(() => choose({ provider, model: textIn(body, 'model', 512) }))
    }
    return null
  }

  const sporesApi = async (request, path) => {
    if (request.method === 'GET') {
      if (path === '/oki/api/spores') return { spores: spores(), kinds: kinds(), model: defaultModel().model, deprecations: deprecations() }
      if (path === '/oki/api/models') {
        catalogRead()
        return catalogOffers()
      }
      if (path === '/oki/api/catalog') return { ...refresh.status(), deprecations: deprecations() }
      return null
    }
    if (path === '/oki/api/spores') {
      const body = await bodyOf(request)
      return serially(() => create({ name: textIn(body, 'name', 64), kind: textIn(body, 'kind', 64), model: textIn(body, 'model', 512), adopt: body.adopt === true }))
    }
    if (path === '/oki/api/models/default') {
      const body = await bodyOf(request)
      return serially(() => makeDefault(textIn(body, 'model', 512)))
    }
    if (path === '/oki/api/spores/remove') {
      const body = await bodyOf(request)
      return removeSpore({ name: textIn(body, 'name', 64), yes: body.yes })
    }
    if (path === '/oki/api/catalog/refresh') {
      await refresh.refresh()
      return refresh.status()
    }
    if (path === '/oki/api/catalog/move') {
      const body = await bodyOf(request)
      return serially(() => move({ from: textIn(body, 'from', 512), to: textIn(body, 'to', 512) }))
    }
    return null
  }

  const callback = async (response, provider, url) => {
    let back = `/oki/setup/?provider=${provider}`
    try {
      if (provider === 'openrouter') await signIns.finishOpenRouter(url.searchParams)
      else await signIns.finishChatGPT(url.searchParams)
      say(`signed in to ${provider}`)
    } catch (err) {
      if (!(err instanceof Unusable)) say(`signing in to ${provider} failed — ${err.stack}`)
      back += `&error=${encodeURIComponent(err.message)}`
    }
    const html = `<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="0; url=${escaped(back)}"><title>Oki</title><p><a href="${escaped(back)}">Back to Oki's setup</a></p>`
    response.writeHead(200, { ...SECURITY, 'content-type': TYPES.html, 'cache-control': 'no-store' }).end(html)
  }

  const api = async (request, response, path, url, { record, signedIn }) => {
    const gated = () => {
      if (record === null) throw new Refused(409, 'Oki is not claimed yet — open /oki/')
      if (!signedIn) throw new Refused(401, 'sign in at /oki/')
    }
    if (request.method === 'POST' && request.headers.origin !== origin) throw new Refused(403, 'a write comes from Oki\'s own pages')
    if (request.method === 'GET' && path === '/oki/api/system') {
      gated()
      return json(response, 200, await system(record))
    }
    if (request.method === 'GET' && path === '/oki/api/model') {
      gated()
      return json(response, 200, { model: await modelState() })
    }
    if (request.method === 'GET' && path === '/oki/api/doctor') {
      gated()
      return json(response, 200, await doctor())
    }
    if (path === '/oki/api/export') {
      gated()
      if (request.method === 'GET') return json(response, 200, backups.status())
      try {
        return await backups.write({ passphrase: passphraseOf(await formOf(request)), response })
      } catch (err) {
        if (response.headersSent || !(err instanceof Refusal || err instanceof Refused || err instanceof SporeError)) throw err
        return redirect(response, `/oki/backup/?error=${encodeURIComponent(err instanceof SporeError ? errorText(err) : err.message)}`)
      }
    }
    if (path === '/oki/api/import') {
      if (record !== null && !signedIn) throw new Refused(401, 'sign in at /oki/')
      if (request.method === 'GET') return json(response, 200, { held: holding(), ...backups.status() })
      try {
        return json(response, 200, await backups.read({ input: request, passphrase: passphraseHeader(request) }))
      } catch (err) {
        if (err instanceof Refusal) throw new Refused(409, err.message, err.type)
        if (err instanceof SporeError) throw new Refused(409, errorText(err), err.type)
        throw err
      }
    }
    const routed = path.startsWith('/oki/api/setup') ? setupApi : ['/oki/api/spores', '/oki/api/models', '/oki/api/catalog'].some(one => path === one || path.startsWith(`${one}/`)) ? sporesApi : null
    if (routed) {
      gated()
      let answer
      try {
        answer = await routed(request, path, url)
      } catch (err) {
        if (err instanceof Unusable) throw new Refused(409, err.message, err.type)
        if (err instanceof SporeError) throw new Refused(409, errorText(err), err.type)
        throw err
      }
      if (answer === null) throw new Refused(404, 'no such route')
      return json(response, 200, answer)
    }
    if (request.method !== 'POST') throw new Refused(404, 'no such route')
    if (path === '/oki/api/claim') {
      if (record !== null) throw new Refused(409, 'Oki is already claimed')
      const { password } = await bodyOf(request)
      try {
        const claimed = await access.claim(password === null ? null : passwordIn({ password }))
        say(claimed.password === null ? 'claimed, without a password' : 'claimed, with a password')
        return json(response, 200, {}, claimed.password === null ? {} : { 'set-cookie': sessionCookie(access.session(claimed)) })
      } catch (err) {
        if (err instanceof Claimed) throw new Refused(409, err.message)
        throw err
      }
    }
    if (path === '/oki/api/sign-in') {
      if (record === null || record.password === null) throw new Refused(409, 'Oki has no password to sign in with')
      if (!(await access.matches(record, passwordIn(await bodyOf(request))))) throw new Refused(401, 'that is not the password')
      return json(response, 200, {}, { 'set-cookie': sessionCookie(access.session(record)) })
    }
    if (path === '/oki/api/sign-out') return json(response, 200, {}, { 'set-cookie': `${COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0` })
    throw new Refused(404, 'no such route')
  }

  const management = async (request, response, path, url, access) => {
    if (path.startsWith('/oki/api/')) return api(request, response, path, url, access)
    if (request.method !== 'GET' && request.method !== 'HEAD') throw new Refused(405, 'management pages are read')
    if (!SCREENS[path]) return page(response, path.slice('/oki/'.length))
    const screen = access.record === null ? (path === '/oki/restore/' ? path : '/oki/claim/') : !access.signedIn ? '/oki/sign-in/' : ['/oki/setup/', '/oki/restore/'].includes(path) ? path : !defaultModel().model || !sporePaths().length ? '/oki/setup/' : ['/oki/spores/', '/oki/backup/'].includes(path) ? path : '/oki/'
    if (path !== screen) return redirect(response, screen)
    page(response, SCREENS[path])
  }

  const forward = (request, response) => {
    const upstream = ask({
      host: connector.host,
      port: connector.port,
      method: request.method,
      path: request.url,
      headers: { ...without(request.headers, HOP), [user]: person }
    }, (answer) => {
      response.writeHead(answer.statusCode, without(answer.headers, HOP))
      answer.pipe(response)
    })
    upstream.on('error', (err) => {
      if (response.headersSent) return response.destroy()
      json(response, 502, { error: `the chat does not answer at ${connector.text} — ${err.message}` })
    })
    response.on('close', () => {
      if (!response.writableFinished) upstream.destroy()
    })
    request.pipe(upstream)
  }

  const route = async (request, response) => {
    if (request.headers.host !== host) throw new Refused(403, `Oki answers at ${origin}`)
    const url = new URL(request.url, origin)
    const { pathname } = url
    if (pathname === '/oki') return redirect(response, '/oki/')
    const record = access.read()
    const signingIn = Object.keys(CALLBACKS).find(provider => pathname === CALLBACKS[provider])
    if (signingIn) {
      if (request.method !== 'GET' && request.method !== 'HEAD') throw new Refused(405, 'a sign-in comes back with a GET')
      if (record === null) return redirect(response, '/oki/claim/')
      return callback(response, signingIn, url)
    }
    const signedIn = record !== null && (record.password === null || access.signedIn(record, cookiesOf(request.headers.cookie)))
    if (signedIn) refresh.used()
    if (pathname.startsWith('/oki/')) return management(request, response, pathname, url, { record, signedIn })
    if (record === null) return redirect(response, '/oki/claim/')
    if (signedIn) return forward(request, response)
    if (pathname === '/') return redirect(response, '/oki/sign-in/')
    throw new Refused(401, 'Oki has a password — sign in at /oki/')
  }

  const server = createServer(async (request, response) => {
    try {
      await route(request, response)
    } catch (err) {
      if (response.headersSent) return response.destroy()
      if (err instanceof Refused) return json(response, err.status, { error: err.message, ...(err.type ? { type: err.type } : {}) })
      say(`${request.method} ${request.url} failed — ${err.stack}`)
      json(response, 500, { error: err.detail ? `${err.message} — ${err.detail}` : err.message })
    }
  })

  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(listen.port, listen.host, () => {
      say(`oki-management · ${origin} · listening on ${listen.text} · forwarding to ${connector.text} as "${person}" in ${user}`)
      for (const signal of ['SIGTERM', 'SIGINT']) {
        process.once(signal, () => {
          server.close(() => resolve())
          server.closeAllConnections()
        })
      }
    })
  })
}
