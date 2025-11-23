import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [vue()],
  // -----------------------------------------------------------------------
  // FORK CONFIGURATION (Use this for testing)
  // -----------------------------------------------------------------------
  base: '/Static_hiny_Ikiam_Wings_Gallery/', 
  
  build: {
    outDir: 'dist',
    emptyOutDir: true
  }
})