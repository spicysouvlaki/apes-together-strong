import { defineConfig } from 'vitest/config';
import { fileURLToPath, URL } from 'node:url';

// Tests run headless in Node: the sim must never depend on the DOM or WebGL.
export default defineConfig({
  resolve: {
    alias: {
      '@contracts': fileURLToPath(new URL('./src/contracts', import.meta.url)),
      '@content': fileURLToPath(new URL('./content', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // Full-game replay tests take several seconds on CI runners; the 5 s default is too tight.
    testTimeout: 120_000,
  },
});
