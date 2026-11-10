import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// Production is served from https://arafat-siam.github.io/noteboard/
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/noteboard/' : '/',
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
        background_color: '#f2f2f7',
        theme_color: '#2f6fde',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        navigateFallback: 'index.html',
      },
    }),
  ],
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
}));
