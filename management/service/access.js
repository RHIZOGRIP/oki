/**
 * Who may use Oki: unclaimed until someone opens /oki/ and sets a password or goes without one.
 * `access.json` records the choice: `{ "password": null }`, or the password's scrypt hash with the
 * key that signs session cookies. A session is a cookie holding its expiry and an HMAC of it.
 */

import { createHmac, randomBytes, scrypt, timingSafeEqual } from 'node:crypto'
import { linkSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'

const derive = promisify(scrypt)
const COST = { N: 16384, r: 8, p: 1 }
const LENGTH = 64
const SESSION_MS = 30 * 24 * 60 * 60 * 1000
export const COOKIE = 'oki'

const hashOf = async (password, { salt, N, r, p }) => derive(password, Buffer.from(salt, 'base64'), LENGTH, { N, r, p })

const signed = (key, payload) => createHmac('sha256', Buffer.from(key, 'base64')).update(payload).digest('base64url')

export class Claimed extends Error {}

export function openAccess (dir) {
  const file = join(dir, 'access.json')

  return {
    file,

    read () {
      let text
      try {
        text = readFileSync(file, 'utf8')
      } catch (err) {
        if (err.code === 'ENOENT') return null
        throw err
      }
      return JSON.parse(text)
    },

    /** Records the claim, or throws Claimed when someone was first: the file is linked into place, so it appears whole and once. */
    async claim (password) {
      let record = { password: null }
      if (password !== null) {
        const salt = randomBytes(16).toString('base64')
        const hash = (await hashOf(password, { salt, ...COST })).toString('base64')
        record = { password: { scheme: 'scrypt', ...COST, salt, hash }, key: randomBytes(32).toString('base64') }
      }
      mkdirSync(dir, { recursive: true, mode: 0o700 })
      const draft = `${file}.${process.pid}.${randomBytes(4).toString('hex')}`
      writeFileSync(draft, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 })
      try {
        linkSync(draft, file)
      } catch (err) {
        if (err.code === 'EEXIST') throw new Claimed('Oki is already claimed')
        throw err
      } finally {
        unlinkSync(draft)
      }
      return record
    },

    async matches (record, password) {
      const hash = await hashOf(password, record.password)
      return timingSafeEqual(hash, Buffer.from(record.password.hash, 'base64'))
    },

    session (record) {
      const until = String(Date.now() + SESSION_MS)
      return { value: `${until}.${signed(record.key, until)}`, maxAge: SESSION_MS / 1000 }
    },

    signedIn (record, cookies) {
      const value = cookies.get(COOKIE)
      if (value === undefined) return false
      const [until, mac] = value.split('.')
      if (!until || !mac || !(Number(until) > Date.now())) return false
      const expected = Buffer.from(signed(record.key, until))
      const given = Buffer.from(mac)
      return given.length === expected.length && timingSafeEqual(given, expected)
    }
  }
}
