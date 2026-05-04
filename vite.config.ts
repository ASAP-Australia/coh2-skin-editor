import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': path.resolve(__dirname, './src') } },
  base: '/coh2-skin-editor/',  // GitHub Pages subpath
  build: {
    // Pull three.js + pako into their own chunks so the main bundle stays
    // under the 500 kB warning threshold and re-renders / hot reloads stay
    // snappy. Three is by far the heaviest dep (~600 kB minified).
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/three')) return 'three'
          if (id.includes('node_modules/pako')) return 'pako'
          if (id.includes('node_modules/radix-ui') || id.includes('node_modules/@radix-ui')) return 'radix'
        },
      },
    },
    chunkSizeWarningLimit: 700,
  },
})
