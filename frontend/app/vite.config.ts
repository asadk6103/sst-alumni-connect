import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

// Portal, administration, sign-in and setup screens (single-page app).
// In production nginx serves the build; in development the API runs on API_PROXY_TARGET.
const api = process.env.API_PROXY_TARGET ?? 'http://localhost:8100';
const realtime = process.env.REALTIME_PROXY_TARGET ?? 'http://localhost:8101';
const web = process.env.WEB_PROXY_TARGET ?? 'http://localhost:3000'; // public website (page previews)

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  build: { assetsDir: 'spa-assets', sourcemap: false, chunkSizeWarningLimit: 900 },
  server: {
    port: 5173,
    proxy: {
      '/api': { target: api, changeOrigin: false },
      '/media': { target: api, changeOrigin: false },
      '/realtime': { target: realtime, ws: true, changeOrigin: false },
      '/preview': { target: web, changeOrigin: false },
      '/_next': { target: web, changeOrigin: false },
    },
  },
});
