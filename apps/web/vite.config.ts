import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { createReadStream, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';

// En développement, l'API est servie sous la même origine (/v1) : pas de CORS ni de cookie tiers.
const api = process.env['VITE_API_PROXY'] ?? 'http://localhost:3000';
const tilesDir = fileURLToPath(new URL('../../infra/maps/data/', import.meta.url));

/**
 * Fond de carte PMTiles sous /tiles/ (comme nginx en conteneur) : lecture par plages
 * (`Range`), seule façon dont le client PMTiles accède à l'archive.
 */
function tiles(): Plugin {
  const serve: Plugin['configureServer'] = (server) => {
    server.middlewares.use('/tiles/', (req, res) => {
      const name = decodeURIComponent((req.url ?? '').split('?')[0]!.replace(/^\//, ''));
      const path = resolve(tilesDir, name);
      let size: number;
      try {
        if (!path.startsWith(tilesDir) || name.includes('..')) throw new Error('hors du dossier');
        size = statSync(path).size;
      } catch {
        res.statusCode = 404;
        res.end();
        return;
      }
      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('Content-Type', 'application/octet-stream');
      const range = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range ?? '');
      if (!range) {
        res.setHeader('Content-Length', size);
        if (req.method === 'HEAD') return void res.end();
        createReadStream(path).pipe(res);
        return;
      }
      const start = Number(range[1]);
      const end = Math.min(range[2] ? Number(range[2]) : size - 1, size - 1);
      if (start > end) {
        res.statusCode = 416;
        res.setHeader('Content-Range', `bytes */${size}`);
        return void res.end();
      }
      res.statusCode = 206;
      res.setHeader('Content-Range', `bytes ${start}-${end}/${size}`);
      res.setHeader('Content-Length', end - start + 1);
      if (req.method === 'HEAD') return void res.end();
      createReadStream(path, { start, end }).pipe(res);
    });
  };
  return { name: 'wasafili-tiles', configureServer: serve, configurePreviewServer: serve as never };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), tiles()],
  // Workers en modules ES : MapLibre les instancie avec `type: 'module'`.
  worker: { format: 'es' },
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  server: { port: 5173, proxy: { '/v1': api, '/health': api } },
  preview: { port: 4173, proxy: { '/v1': api, '/health': api } },
});
