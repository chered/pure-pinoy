import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'

// https://vite.dev/config/
export default defineConfig({
  plugins: [svelte()],
  server: {
    host: true,
    port: 5173,
    strictPort: true,
    proxy: {
      '/wp-api': {
        target: 'https://radio.fourwebminds.com',
        changeOrigin: true,
        secure: true,
        rewrite: (path) => path.replace(/^\/wp-api/, '/wp-json')
      },
      '/rb-api': {
        target: 'https://all.api.radio-browser.info',
        changeOrigin: true,
        secure: true
      },
      '/api/radio-browser': {
        target: 'https://de1.api.radio-browser.info',
        changeOrigin: true,
        secure: true,
        rewrite: (path) => path.replace(/^\/api\/radio-browser/, '')
      }
    }
  }
})
