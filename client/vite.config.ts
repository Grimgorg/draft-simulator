import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
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
