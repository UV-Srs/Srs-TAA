import { defineConfig, type ProxyOptions } from 'vite'
import react from '@vitejs/plugin-react'
import basicSsl from '@vitejs/plugin-basic-ssl'

const BACKEND = 'http://127.0.0.1:8000'

// A browser dropping its connection (phone loses Wi-Fi, laptop sleeps, tab closed) resets the
// proxied socket. Without these handlers Node treats that as an unhandled error and the dev server exits.
const ignoreResets: ProxyOptions['configure'] = (proxy) => {
  proxy.on('error', (err) => console.warn(`[proxy] ${err.message}`))
  proxy.on('proxyReqWs', (_proxyReq, _req, socket) => {
    socket.on('error', () => {})
  })
  proxy.on('open', (socket) => {
    socket.on('error', () => {})
  })
}

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react(), basicSsl()],
  server: {
    port: 5173,
    host: true,
    https: {},
    proxy: {
      '/api': {
        target: BACKEND,
        changeOrigin: true,
        configure: ignoreResets,
      },
      '/uploads': {
        target: BACKEND,
        changeOrigin: true,
        configure: ignoreResets,
      },
      // Live updates (liveSync.ts connects to /ws/live on the page's own host)
      '/ws': {
        target: BACKEND,
        ws: true,
        changeOrigin: true,
        configure: ignoreResets,
      },
    }
  }
})
