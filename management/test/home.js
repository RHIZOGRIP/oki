/**
 * Imported first: spore and mohdel place their files from $HOME when they load. Spore refuses a spore
 * under /tmp, so the home is made where spore's own tests make theirs.
 */

import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const base = process.env.SPORE_TEST_DIR || join(process.env.XDG_STATE_HOME || join(homedir(), '.local', 'state'), 'spore', 'tests')
mkdirSync(base, { recursive: true })
export const home = mkdtempSync(join(base, 'oki-catalog-'))
process.env.HOME = home
delete process.env.XDG_CONFIG_HOME
delete process.env.XDG_STATE_HOME
mkdirSync(join(home, '.config', 'spore'), { recursive: true })
writeFileSync(join(home, '.config', 'spore', 'config.json'), '{ "home": "~/.spore" }\n')
