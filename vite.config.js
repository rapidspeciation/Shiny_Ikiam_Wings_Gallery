import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [vue()],
  // This ensures assets load correctly on GitHub Pages
  base: '/Shiny_Ikiam_Wings_Gallery/',
  build: {
    outDir: 'dist',
    emptyOutDir: true
  }
})