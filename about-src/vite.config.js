import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// The Vite project lives in about-src/ rather than the repo root on purpose: a root
// package.json would make Vercel's zero-config detection treat the whole portfolio as a
// Vite app instead of the static site it is. Output goes straight into ../about, which is
// what actually gets committed and served.
export default defineConfig({
  base: '/about/',
  plugins: [react()],
  assetsInclude: ['**/*.glb'],   // not in Vite 5's default list; clip.glb is imported as a URL
  build: {
    outDir: '../about',
    emptyOutDir: false,   // about/index-2d.html is the old 2D page; keep it
    assetsDir: 'assets',
  },
})
