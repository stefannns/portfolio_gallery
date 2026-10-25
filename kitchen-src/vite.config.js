import {defineConfig} from 'vite';

// The repository root is also the published static directory. Runtime artwork
// stays there; rebuilding replaces only index.html and the compiled JS/CSS.
export default defineConfig(({command}) => ({
  publicDir: command === 'serve' ? 'public' : false,
  server: {fs: {allow: ['..']}},
  build: {outDir: '..', emptyOutDir: false},
}));
