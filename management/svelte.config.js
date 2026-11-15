import { readFileSync } from 'node:fs'

import adapter from '@sveltejs/adapter-static'

const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))

export default {
  kit: {
    adapter: adapter({ pages: 'build', assets: 'build', strict: true }),
    paths: { base: '/oki', relative: false },
    prerender: { crawl: false },
    version: { name: version }
  }
}
