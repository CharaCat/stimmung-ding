import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import os from 'os'

// https://vite.dev/config/
function getLANIP() {
  const nets = os.networkInterfaces()
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net && net.family === 'IPv4' && !net.internal) {
        return net.address
      }
    }
  }
  return undefined
}

const lanHost = getLANIP()
export default defineConfig({
  plugins: [react()],
  server: {
    host: "0.0.0.0",
    port: 5173,
    hmr: lanHost ? { host: lanHost } : undefined,
    proxy: {
      '/api': {
        target: 'http://localhost:4000',
        changeOrigin: true,
      }
    }
  },
  preview: {
    host: true,
  }
})
