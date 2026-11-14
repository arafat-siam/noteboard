import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// Production is served from https://arafat-siam.github.io/noteboard/ ; a design preview build
// (NOTEBOARD_BASE=/noteboard/preview/) from https://arafat-siam.github.io/noteboard/preview/
export default defineConfig(({ command }) => ({
  base: (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env.NOTEBOARD_BASE || (command === 'build' ? '/noteboard/' : '/'),
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'Noteboard',
        short_name: 'Noteboard',
        description: 'Handwritten notes with Apple Pencil, synced to your Google Drive.',
        display: 'standalone',
        orientation: 'any',
        background_color: '#ffffff',
        theme_color: '#1c252e',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,mjs,css,html,svg,png,woff2}'],
        // Test builds under /lab/ are separate apps with their own service workers.
        globIgnores: ['lab/**', 'preview/**'],
        // The PDF engine's worker is ~1.4 MB; keep it cached so PDFs open offline.
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        navigateFallback: 'index.html',
        // Opening the shell app download must fetch the zip, not the app page; test builds under
        // /lab/ must load their own page, not this app's.
        navigateFallbackDenylist: [/\.zip$/, /\/lab\//, /\/preview\//],
      },
    }),
  ],
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
}));
