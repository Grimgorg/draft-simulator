import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// The release version lives in the root package.json; the management UI shows it.
const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(version),
  },
  build: {
    rolldownOptions: {
      // Two pages: the player client, and the host's management UI that only
      // the management server serves.
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        manage: fileURLToPath(new URL('./manage.html', import.meta.url)),
      },
    },
  },
})
