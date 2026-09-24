import { defineConfig } from 'vite'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'

export default defineConfig({
  root: path.resolve('src/welcome'),
  publicDir: path.resolve('src/assets/services'),
  plugins: [tailwindcss()],
  base: './',
  build: { outDir: path.resolve('dist-welcome'), emptyOutDir: true },
})
