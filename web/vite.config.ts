import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react()],
  // 5173 is the server's default WEB_ORIGIN for CORS (server/src/env.ts)
  server: { port: 5173, strictPort: true },
  // The /app chunk is lazy: pre-bundle its dependencies up front so the first visit doesn't hit a
  // mid-session re-optimisation ("Failed to fetch dynamically imported module").
  optimizeDeps: {
    include: ['wagmi', 'wagmi/actions', 'wagmi/chains', 'wagmi/connectors', '@tanstack/react-query', 'viem', 'viem/chains'],
  },
})
