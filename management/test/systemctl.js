/**
 * `systemctl --user` as spore's services and Oki's export and import call it, for a machine with no
 * systemd user manager: each unit's state is kept in the JSON file $OKI_TEST_SYSTEMCTL with every
 * call made, and a service's `ExecStart` is run when it starts and sent SIGTERM when it stops.
 * `installSystemctl` puts it first on a PATH, as a program named `systemctl`.
 */

import { spawn } from 'node:child_process'
import { chmodSync, existsSync, mkdtempSync, openSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

export function installSystemctl () {
  const bin = mkdtempSync(join(tmpdir(), 'oki-systemctl-'))
  writeFileSync(join(bin, 'systemctl'), `#!/bin/sh\nexec "${process.execPath}" "${fileURLToPath(import.meta.url)}" "$@"\n`)
  chmodSync(join(bin, 'systemctl'), 0o755)
  return bin
}

export const callsIn = (file) => JSON.parse(readFileSync(file, 'utf8')).calls

const alive = (pid) => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function main ([scope, verb, ...rest]) {
  const file = process.env.OKI_TEST_SYSTEMCTL
  if (scope !== '--user' || !file) {
    console.error('systemctl: only --user, with OKI_TEST_SYSTEMCTL naming the state file')
    return 1
  }
  const state = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : { units: {}, calls: [] }
  state.calls.push([verb, ...rest])
  const unitDir = join(homedir(), '.config', 'systemd', 'user')
  const unitFile = (name) => (name.includes('@') ? `${name.slice(0, name.indexOf('@') + 1)}${name.slice(name.lastIndexOf('.'))}` : name)
  const active = (name) => {
    const one = state.units[name]
    return Boolean(one?.active) && (!one.pid || alive(one.pid))
  }

  const start = (name) => {
    const text = readFileSync(join(unitDir, unitFile(name)), 'utf8')
    const exec = text.split('\n').find(line => line.startsWith('ExecStart='))
    let pid = 0
    if (exec) {
      const instance = name.includes('@') ? name.slice(name.indexOf('@') + 1, name.lastIndexOf('.')) : ''
      const argv = [...exec.slice('ExecStart='.length).matchAll(/"([^"]*)"|(\S+)/g)].map(found => (found[1] ?? found[2]).replaceAll('%i', instance))
      const log = openSync(`${file}.log`, 'a')
      const child = spawn(argv[0], argv.slice(1), { detached: true, stdio: ['ignore', log, log] })
      child.unref()
      pid = child.pid
    }
    state.units[name] = { active: true, pid }
  }

  const stop = (name) => {
    const one = state.units[name]
    if (one?.pid && alive(one.pid)) {
      process.kill(one.pid, 'SIGTERM')
      const until = Date.now() + 5000
      while (alive(one.pid) && Date.now() < until) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50)
    }
    state.units[name] = { active: false, pid: 0 }
  }

  let code = 0
  if (verb === 'show-environment') console.log(`HOME=${homedir()}`)
  else if (verb === 'show') {
    const name = rest[0]
    const on = active(name)
    console.log([`ActiveState=${on ? 'active' : 'inactive'}`, `SubState=${on ? 'running' : 'dead'}`, 'UnitFileState=enabled', 'ActiveEnterTimestamp=', `MainPID=${on ? state.units[name].pid : 0}`, 'NRestarts=0'].join('\n'))
  } else if (verb === 'start') start(rest[0])
  else if (verb === 'stop') stop(rest[0])
  else if (verb === 'restart') {
    stop(rest[0])
    start(rest[0])
  } else if (verb === 'is-active') {
    console.log(active(rest[0]) ? 'active' : 'inactive')
    code = active(rest[0]) ? 0 : 3
  } else if (!['daemon-reload', 'enable', 'disable'].includes(verb)) {
    console.error(`systemctl: ${verb} is not faked`)
    code = 1
  }
  writeFileSync(file, JSON.stringify(state))
  return code
}

if (process.argv[1] === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv.slice(2))
