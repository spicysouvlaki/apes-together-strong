import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import { VitePWA } from 'vite-plugin-pwa';
import { fileURLToPath, URL } from 'node:url';

// Offline-first: the service worker precaches the whole build so a full game
// runs with no network after install (see docs/GDD.md, "Platform and tech").
export default defineConfig({
  resolve: {
    alias: {
      '@contracts': fileURLToPath(new URL('./src/contracts', import.meta.url)),
      '@content': fileURLToPath(new URL('./content', import.meta.url)),
    },
  },
  plugins: [
    preact(),
    VitePWA({
      // 'prompt': a new version waits for src/platform/pwa.ts applyUpdate() instead of
      // reloading the page mid-game.
      registerType: 'prompt',
      // 'auto': src/platform/pwa.ts imports virtual:pwa-register, so no extra script is injected.
      includeAssets: ['icon.svg'],
      workbox: {
        // Content JSON is bundled into the JS chunks and the sim worker is its own .js chunk,
        // so this glob covers everything a full offline game needs.
        globPatterns: ['**/*.{js,css,html,svg,png,webp,json,glb,opus,woff2}'],
        maximumFileSizeToCacheInBytes: 20 * 1024 * 1024,
        navigateFallback: 'index.html',
        // The audition page is a real document, not an app route.
        navigateFallbackDenylist: [/audio-demo\.html/],
        cleanupOutdatedCaches: true,
      },
      manifest: {
        name: 'Apes Together Strong',
        short_name: 'Apes',
        description: 'Build a civilization from the famous people your play attracts.',
        display: 'standalone',
        orientation: 'any',
        background_color: '#f3ede1',
        theme_color: '#5b7f5a',
        icons: [
          { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
  ],
  worker: { format: 'es' },
  build: {
    target: 'es2022',
    sourcemap: true,
    // audio-demo.html ships too, so every sound can be auditioned on a phone from the deployed site.
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        audio: fileURLToPath(new URL('./audio-demo.html', import.meta.url)),
      },
    },
  },
});
