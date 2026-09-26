import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      // the app ships its own hand-written manifest.webmanifest (linked from index.html); this plugin
      // only adds the service worker that lets the installed app open its shell without a connection
      manifest: false,
      injectRegister: false, // registered manually from main.tsx, so an update can be offered instead of forced
      registerType: 'prompt',
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,wasm,woff,woff2,webmanifest}'],
        navigateFallbackDenylist: [/^\/api\//],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
      },
      devOptions: { enabled: false },
    }),
  ],
  server: { proxy: { '/api': 'http://localhost:3001' } },
  preview: { proxy: { '/api': 'http://localhost:3001' } },
  test: { environment: 'node', include: ['src/**/*.test.ts', 'server/**/*.test.ts'] },
});
