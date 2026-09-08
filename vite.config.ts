import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  // Relative asset paths, so the built app works wherever it ends up: at the
  // domain root, in a subdirectory of a webspace, or opened straight from
  // the file system. Vite's default ("/") only resolves when the app sits
  // exactly at the root.
  base: './',
  plugins: [react()],
})
