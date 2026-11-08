import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// Dev only: the character studio (#/studio) posts PNG snapshots here, saved to docs/likeness/.
function studioSnapshots() {
  return {
    name: 'studio-snapshots',
    apply: 'serve' as const,
    configureServer(server: { middlewares: { use: (path: string, fn: (req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => void) => void } }) {
      server.middlewares.use('/__studio/snapshot', (req, res) => {
        if (req.method !== 'POST') { res.statusCode = 405; res.end(); return; }
        let body = '';
        req.on('data', (c) => { body += c; });
        req.on('end', () => {
          try {
            const { name, dataUrl } = JSON.parse(body) as { name: string; dataUrl: string };
            if (!/^[a-z0-9-]+$/.test(name) || !dataUrl.startsWith('data:image/png;base64,')) throw new Error('bad snapshot');
            const dir = join(process.cwd(), 'docs', 'likeness');
            mkdirSync(dir, { recursive: true });
            writeFileSync(join(dir, `${name}.png`), Buffer.from(dataUrl.slice(22), 'base64'));
            res.end('saved');
          } catch (e) { res.statusCode = 400; res.end(String(e)); }
        });
      });
    },
  };
}

// base './' so the build works from any folder or a GitHub Pages sub-path.
export default defineConfig({
  base: './',
  plugins: [react(), studioSnapshots()],
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1200,
    // No manual chunks: the lazy import() of GuideStage already puts three.js
    // and R3F in their own async chunk, so the portfolio never waits for 3D.
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
} as never);
