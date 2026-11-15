/**
 * The spores page: `spore define`, `spore rm` and `spore model`, through the same library functions.
 * Every spore made here is granted a folder of its own, `/folders/<its name>`, linked into it as
 * `folder`, and told what that folder is to the person; anything finer is spore's own, by hand.
 */

import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'

import {
  define, defaultModel, definitionPath, edit, errorText, loadMohdelEnvironment, modelReadiness, NAMES, parseDefinition,
  parseFrontmatter, remove, RUNNING, setDefaultModel, show, sporangia, SporeError, sporePaths, stateWord, switchModel, tagModel, TOOL_NAMES
} from '@rhizogrip/spore'

import { CHOSEN, deprecations } from './catalog.js'
import { Unusable, FOLDERS } from './setup.js'

export const KINDS = ['default', 'perennial']
const FOLDER = 'folder'

const folderOf = (name) => join(FOLDERS, name)

const aboutFolder = (name) => `

**The person's folder.** \`${FOLDER}/\` is a folder on the computer of the person you work for: the one named \`${name}\` in their Oki folder, which they open in their file manager. It is the only place of theirs you reach, and no other spore reaches it.

- A file they give you to work on is there. Read it there, and change it there when that is what they ask.
- A file they ask you for goes there, under a name they would recognise, and you tell them its name.
- Your own working files, programs and notes stay in \`data/\`, as always. \`data/out/\` is for a file you hand back in the chat as a download; when they want a file to keep, put it in \`${FOLDER}/\`.
`

const ABOUT_OKI = `

**Where you are.** You run inside Oki, an app on the person's computer, and they talk to you in Oki's chat, in their browser. Assume they are not technical: answer in plain words, and do not show commands, file paths or tool names unless they ask. Oki has four pages beside the chat: Spores (add or delete assistants like you), Models (the AI model you think with), Back up, and System (how much space is used). You cannot change those yourself; say which page does it. You can fetch a web page when given an address or when you know one, but you have no search engine. Your space is limited and shared with the other spores: when asked to tidy up, delete what is no longer needed in your own files.
`

const telling = (name) => (draft) => {
  appendFileSync(draft, ABOUT_OKI + aboutFolder(name))
  return 0
}

const named = (name) => {
  if (typeof name !== 'string' || !NAMES.spore.pattern.test(name)) throw new Unusable(`a spore's name is ${NAMES.spore.says}`)
  return name
}

async function ready (model) {
  loadMohdelEnvironment()
  const readiness = await modelReadiness(model)
  if (!readiness.ready) throw new Unusable(`${model} is not ready — ${readiness.credential ? 'it is not in the catalog' : 'its provider has no credential'}`)
}

export function kinds () {
  const shipped = sporangia()
  return KINDS.map(name => {
    const one = shipped.find(each => each.name === name)
    if (!one) throw new Error(`spore ships no sporangium "${name}"`)
    if (one.error) throw new Error(one.error)
    return { name, description: one.description }
  })
}

export function spores () {
  return sporePaths().map(ws => {
    const name = basename(ws)
    let one
    try {
      one = show({ ws })
    } catch (err) {
      if (!(err instanceof SporeError)) throw err
      return { name, error: errorText(err) }
    }
    return { name, kind: one.sporangium, model: one.model, state: stateWord(one), running: one.state === RUNNING, turns: one.lastTurnNo, folder: one.writes.some(grant => grant.name === FOLDER && grant.path === folderOf(name)) }
  })
}

/**
 * The folders the spores' definitions grant in the host folder, made where a restore found none:
 * spore drops a grant whose directory is missing. Read from each `spore.cmk`, not through `show`,
 * which opens the spore's database in this process.
 */
export function makeFolders () {
  for (const ws of sporePaths()) {
    const definition = parseDefinition(readFileSync(definitionPath(ws), 'utf8'), { knownTools: TOOL_NAMES })
    if (definition.error) throw new Error(`${definitionPath(ws)} ${definition.error}`)
    for (const grant of definition.writes) {
      if (grant.path.startsWith(`${FOLDERS}/`)) mkdirSync(grant.path, { recursive: true })
    }
  }
}

export async function create ({ name, kind, model, adopt }) {
  named(name)
  if (sporePaths().some(ws => basename(ws) === name)) throw new Unusable(`Oki already has a spore called ${name}`)
  if (!KINDS.includes(kind)) throw new Unusable(`a spore made here is one of ${KINDS.join(', ')}`)
  await ready(model)
  if (!adopt && existsSync(folderOf(name)) && readdirSync(folderOf(name)).length) {
    throw new Unusable(`your Oki folder already has a folder called ${name}, with files in it — the spore would use it, and could change and delete what is there`, 'FOLDER_HOLDS_FILES')
  }
  await tagModel(model, CHOSEN)
  mkdirSync(folderOf(name), { recursive: true })
  const made = define({ ws: name, sporangium: kind, model, writes: [`${FOLDER}=${folderOf(name)}`] })
  const told = await edit({ ws: name, open: telling(name), again: async () => false })
  if (!told.edited) throw new Error(`${name}'s spore.cmk would not take the account of its folder — ${told.error ?? told.why}`)
  return { name, ws: made.ws, kind, model }
}

export const removeSpore = ({ name, yes }) => remove({ ws: named(name), yes: yes === true })

const offering = (model) => (draft) => {
  const text = readFileSync(draft, 'utf8')
  const end = text.indexOf('\n---', 3)
  const head = text.slice(0, end).split('\n')
  const at = head.findIndex((line, i) => i > 0 && line.startsWith('models:'))
  const held = at > 0 ? [].concat(parseFrontmatter(head[at]).fields.models) : []
  const line = `models: [${[...held, model].join(', ')}]`
  if (at > 0) head[at] = line
  else head.splice(head.findIndex((one, i) => i > 0 && one.startsWith('model:')) + 1, 0, line)
  writeFileSync(draft, head.join('\n') + text.slice(end))
  return 0
}

/**
 * `spore model <spore> <model>` for each spore on the retired `from`, under its lock, so one in a
 * turn is refused and keeps its model; `models:` is given `to` first, since a spore switches only to
 * a model it offers. The default for new spores follows when it was `from`.
 */
export async function move ({ from, to }) {
  const offer = deprecations().find(one => one.model === from)
  if (!offer) throw new Unusable(`${from} is not a retired model in use`)
  await ready(to)
  await tagModel(to, CHOSEN)
  const moved = []
  const refused = []
  for (const name of offer.spores) {
    try {
      const { model, models } = show({ ws: name })
      if (![model, ...models].includes(to)) {
        const offered = await edit({ ws: name, open: offering(to), again: async () => false })
        if (!offered.edited) throw new Unusable(`its spore.cmk would not take ${to} — ${offered.error ?? offered.why}`)
      }
      switchModel({ ws: name, model: to })
      moved.push(name)
    } catch (err) {
      if (!(err instanceof SporeError) && !(err instanceof Unusable)) throw err
      refused.push({ name, type: err.type ?? null, why: err instanceof SporeError ? errorText(err) : err.message })
    }
  }
  const defaultMoved = offer.isDefault && defaultModel().model === from
  if (defaultMoved) setDefaultModel(to)
  return { from, to, moved, refused, defaultMoved }
}
