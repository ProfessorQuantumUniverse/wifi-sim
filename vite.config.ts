import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

/**
 * `BASE_PATH` exists because the same build is served from two different
 * places. Under `npx wifi-sim` and in the Docker image the app sits at the root
 * of its own server, so the default `/` is right. On GitHub Pages it lives in a
 * subdirectory named after the repository, and every asset URL has to carry
 * that prefix, so the Pages workflow sets this to `/wifi-sim/`.
 */
export default defineConfig({
  base: process.env.BASE_PATH ?? '/',
  plugins: [react(), tailwindcss()],
  worker: { format: 'es' },
})
