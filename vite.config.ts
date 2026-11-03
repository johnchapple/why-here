import { defineConfig } from 'vite';

// Relative base so the static build works from any GitHub Pages sub-path.
export default defineConfig({
  base: './',
  worker: { format: 'es' },
  build: { target: 'es2022', chunkSizeWarningLimit: 1500 },
  test: { include: ['tests/**/*.test.ts'] },
} as any);
