import express from 'express';
import { createServer, type Server } from 'node:http';
import { captureRawJson } from './http';
import { getWebhookRoute, handleBatchWebhook } from './webhook';

export interface BatchCallbackServer {
  port: number;
  close: () => Promise<void>;
}

function requestedPort(): number {
  const raw = process.env.VOXINDICA_CALLBACK_PORT;
  if (raw === undefined || raw.trim() === '') return 3099;
  const value = Number(raw);
  return Number.isInteger(value) && value >= 0 && value <= 65535 ? value : 3099;
}

/**
 * Dedicated loopback listener for worker callbacks. It deliberately exposes only
 * the webhook and a health probe, so a public tunnel for remote workers does not
 * expose the Studio UI, creator projects, or provider keys.
 */
export async function startBatchCallbackServer(): Promise<BatchCallbackServer> {
  const app = express();
  app.disable('x-powered-by');
  app.get('/healthz', (_request, response) => {
    response.json({ ok: true, service: 'voxindica-batch-callback' });
  });
  app.post(getWebhookRoute(), captureRawJson(), handleBatchWebhook);

  const port = requestedPort();
  const server: Server = createServer(app);

  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => {
      server.off('listening', onListening);
      reject(error);
    };
    const onListening = () => {
      server.off('error', onError);
      resolve();
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, '127.0.0.1');
  });

  const address = server.address();
  const actualPort = typeof address === 'object' && address ? address.port : port;
  console.log(`[batch] callback listener on http://127.0.0.1:${actualPort}`);

  return {
    port: actualPort,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  };
}
