import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react()],
  // 5173 is the server's default WEB_ORIGIN for CORS (server/src/env.ts)
  server: { port: 5173, strictPort: true },
})
