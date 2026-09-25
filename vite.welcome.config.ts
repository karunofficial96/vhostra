import { defineConfig } from 'vite'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'

export default defineConfig({
  root: path.resolve('src/welcome'),
  // The welcome page is copied into the host-side localhost document root.
  // Keep its logo, favicon, local fonts, and canonical service artwork together
  // so it remains completely offline after the Electron app is packaged.
  publicDir: path.resolve('src/assets'),
  plugins: [tailwindcss()],
  base: './',
  build: { outDir: path.resolve('dist-welcome'), emptyOutDir: true },
})
