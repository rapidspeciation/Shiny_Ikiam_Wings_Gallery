import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { copyFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

// Emit 404.html = index.html so GitHub Pages serves the SPA for deep links
// (e.g. /Shiny_Ikiam_Wings_Gallery/ai_identifier). Assets use absolute base
// paths, so the app boots from any path and routes from window.location.
function spaFallback() {
  return {
    name: 'spa-404-fallback',
    writeBundle(options) {
      const dir = options.dir || 'dist'
      const idx = resolve(dir, 'index.html')
      if (existsSync(idx)) copyFileSync(idx, resolve(dir, '404.html'))
    }
  }
}

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [vue(), spaFallback()],
  // -----------------------------------------------------------------------
  // FORK CONFIGURATION (Use this for testing)
  // -----------------------------------------------------------------------
  base: '/Shiny_Ikiam_Wings_Gallery/',

  build: {
    outDir: 'dist',
    emptyOutDir: true
  }
})
