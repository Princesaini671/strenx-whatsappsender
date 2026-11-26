import type { IncomingMessage, ServerResponse } from 'node:http';
import { createApiApp, ensureBackendBootstrapped } from '../server/app.ts';

const app = createApiApp();

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    await ensureBackendBootstrapped();
    if (req.url && !req.url.startsWith('/api')) {
      req.url = `/api${req.url.startsWith('/') ? '' : '/'}${req.url}`;
    }
    app(req as Parameters<typeof app>[0], res as Parameters<typeof app>[1]);
  } catch (err) {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(
      JSON.stringify({
        error: err instanceof Error ? err.message : 'Internal server error',
      })
    );
  }
}
