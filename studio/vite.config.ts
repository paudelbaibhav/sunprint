import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// ComfyUI is the backend. Everything under /api (HTTP + the progress websocket)
// is forwarded to it, so the browser only ever talks to this dev server.
const COMFY = 'http://127.0.0.1:8188'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: COMFY,
        ws: true,
        changeOrigin: true,
        // ComfyUI rejects POSTs whose Origin differs from its own host (CSRF guard),
        // so present ComfyUI's origin instead of the dev server's.
        configure: (proxy) => {
          proxy.on('proxyReq', (req) => req.setHeader('origin', COMFY))
          proxy.on('proxyReqWs', (req) => req.setHeader('origin', COMFY))
        },
      },
    },
  },
})
