import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': 'http://localhost:5106',
      '/hubs': {
        target: 'http://localhost:5106',
        ws: true,
      },
    },
  },
})
