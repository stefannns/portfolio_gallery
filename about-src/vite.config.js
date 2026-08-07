import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// The Vite project lives in about-src/ rather than the repo root on purpose: a root
// package.json would make Vercel's zero-config detection treat the whole portfolio as a
// Vite app instead of the static site it is. Output goes straight into ../about, which is
// what actually gets committed and served — both by /about (standalone) and by the root
// page, which mounts this same bundle as its hero section.
export default defineConfig({
  base: '/about/',
  plugins: [react()],
  assetsInclude: ['**/*.glb'],   // not in Vite 5's default list; clip.glb is imported as a URL
  build: {
    outDir: '../about',
    emptyOutDir: true,
    assetsDir: 'assets',
    // Fixed filenames, no content hash. The root page (the combined site) hand-references this
    // bundle from its own static index.html, which no build step rewrites — a hashed name would
    // go stale on every rebuild and silently 404. Cache-busting is Vercel's immutable-deploy
    // problem, not ours; the files change identity with each deployment URL anyway.
    rollupOptions: {
      output: {
        entryFileNames: 'assets/about.js',
        chunkFileNames: 'assets/about-[name].js',
        assetFileNames: info =>
          info.name && info.name.endsWith('.css') ? 'assets/about.css' : 'assets/[name][extname]',
      },
    },
  },
})
