import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const vendor = (path: string) => fileURLToPath(new URL(`./vendor/markra/${path}`, import.meta.url))

// Served from https://<user>.github.io/mdpad/ on GitHub Pages, but from the
// root during local development.
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/mdpad/' : '/',
  plugins: [react(), tailwindcss()],
  resolve: {
    // rehype-katex and Markra's math renderer both import KaTeX; without this
    // the bundler emits a second copy into the main chunk.
    dedupe: ['katex'],
    // The Markra packages are vendored as source (see vendor/markra/NOTICE.md)
    // and keep their upstream workspace import specifiers. Two of them are
    // stubbed: the AI package is type-only here, and the Tauri API only backs
    // local-file images in the desktop app.
    alias: [
      { find: /^@markra\/editor\/codemirror$/, replacement: vendor('packages/editor/src/codemirror/index.ts') },
      { find: /^@markra\/editor$/, replacement: vendor('packages/editor/src/index.ts') },
      { find: /^@markra\/markdown$/, replacement: vendor('packages/markdown/src/index.ts') },
      { find: /^@markra\/shared$/, replacement: vendor('packages/shared/src/index.ts') },
      { find: /^@markra\/editor-react$/, replacement: vendor('packages/editor-react/src/index.ts') },
      { find: /^@markra\/ai$/, replacement: vendor('stubs/ai.ts') },
      { find: /^@tauri-apps\/api\/core$/, replacement: vendor('stubs/tauri-core.ts') },
    ],
  },
}))
