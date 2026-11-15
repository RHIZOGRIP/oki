import { readFileSync } from 'node:fs'
import path from 'node:path'

import { sveltekit } from '@sveltejs/kit/vite'

const { services } = JSON.parse(readFileSync(new URL('../image/manifest.json', import.meta.url), 'utf8'))
const appliance = `http://${services.management.listen}`

export default {
  plugins: [sveltekit()],
  resolve: {
    alias: {
      $web: path.resolve('../../plugin-web/page')
    }
  },
  server: {
    proxy: {
      '/oki/api': { target: appliance, changeOrigin: true, headers: { origin: appliance } }
    }
  }
}
