import { defineConfig, createLogger } from 'vite'
import react from '@vitejs/plugin-react'
import basicSsl from '@vitejs/plugin-basic-ssl'

// Silence the "[vite] ws proxy socket error: ECONNRESET" noise.
// ECONNRESET just means the browser closed the WebSocket (tab close / refresh) —
// it is completely normal and not an application error.
const logger = createLogger()
const _origError = logger.error.bind(logger)
logger.error = (msg, opts) => {
  if (opts?.error?.code === 'ECONNRESET' || opts?.error?.code === 'ECONNREFUSED') return
  _origError(msg, opts)
}

export default defineConfig({
  customLogger: logger,
  plugins: [react(), basicSsl()],
  server: {
    port: 5173,
    host: true,
    https: true,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
      '/uploads': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
      '/ws': {
        target: 'ws://127.0.0.1:8000',
        ws: true,
        changeOrigin: true,
        configure: (proxy) => {
          proxy.on('error', (err: any) => {
            if (err.code === 'ECONNRESET' || err.code === 'ECONNREFUSED') return;
            console.error('[ws proxy]', err.message);
          });
        },
      }
    }
  }
})
