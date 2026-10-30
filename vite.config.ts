import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Served from https://<user>.github.io/mdpad/ on GitHub Pages, but from the
// root during local development.
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/mdpad/' : '/',
  plugins: [react()],
}))
