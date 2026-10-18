import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

// En développement, l'API est servie sous la même origine (/v1) : pas de CORS ni de cookie tiers.
const api = process.env['VITE_API_PROXY'] ?? 'http://localhost:3000';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  server: { port: 5173, proxy: { '/v1': api, '/health': api } },
  preview: { port: 4173, proxy: { '/v1': api, '/health': api } },
});
