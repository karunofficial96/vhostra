import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: './',
  // Keep service artwork as inspectable packaged files instead of inlining small
  // GIF/SVG assets into the renderer bundle.
  build: { assetsInlineLimit: 0 },
  server: { host: '127.0.0.1', port: 9000, strictPort: true },
})
