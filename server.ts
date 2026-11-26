import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { createApiApp, ensureBackendBootstrapped } from './server/app.ts';
import { createLocalBackup, flushStoreToDisk, getSetting } from './server/store.ts';

export async function createAppServer(): Promise<express.Express> {
  const app = createApiApp();

  // Vite in dev, static dist in production
  const isProd = process.env.NODE_ENV === 'production';
  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  return app;
}

export async function startServer(
  port = Number(process.env.PORT || 3000)
): Promise<{ port: number; close: () => Promise<void> }> {
  const app = await createAppServer();
  await ensureBackendBootstrapped();

  // Periodic automatic local backup every 30 minutes
  const backupInterval = setInterval(() => {
    if (getSetting('auto_backup_enabled') === '1') {
      createLocalBackup('auto').catch(() => {});
    }
  }, 30 * 60 * 1000);

  const server = await new Promise<ReturnType<typeof app.listen>>((resolve) => {
    const s = app.listen(port, '0.0.0.0', () => resolve(s));
  });

  const address = server.address();
  const boundPort = typeof address === 'object' && address ? address.port : port;
  console.log(`Strenx WhatsApp Sender server running on http://localhost:${boundPort}`);

  return {
    port: boundPort,
    close: async () => {
      clearInterval(backupInterval);
      await new Promise<void>((resolve) => server.close(() => resolve()));
      flushStoreToDisk();
    },
  };
}

// Start automatically when executed as entry script
const isDirectRun =
  process.argv[1] &&
  (process.argv[1].endsWith('server.ts') || process.argv[1].endsWith('server.mjs'));

if (isDirectRun && !process.env.STRENX_EMBEDDED_IN_ELECTRON) {
  void startServer();
}
