import type { Express, RequestHandler, Response } from 'express';
import { z } from 'zod';
import type { SupportedLanguage } from '../../types';
import {
  createAndDispatchBatch,
  BatchRequestError,
  cancelBatchJob,
} from './service';
import {
  isSafeBatchId,
  isSafeItemId,
  listBatchJobs,
  readBatchItemAudio,
  readBatchJob,
} from './store';
import { toPublicBatch } from './types';
import { getWebhookRoute, handleBatchWebhook } from './webhook';

const SUPPORTED_LANGUAGES: [SupportedLanguage, ...SupportedLanguage[]] = [
  'bn-IN',
  'hi-IN',
  'en-IN',
];

const batchItemSchema = z.object({
  id: z.string().min(1).optional(),
  text: z.string().trim().min(1).max(10000),
  language: z.enum(SUPPORTED_LANGUAGES).optional(),
});

const createBatchSchema = z.object({
  provider: z.enum(['local', 'kaggle', 'colab']),
  workerUrl: z.string().trim().min(1),
  workerToken: z.string().optional(),
  language: z.enum(SUPPORTED_LANGUAGES),
  isCloned: z.boolean().default(false),
  consentConfirmed: z.boolean().default(false),
  referenceAudioBase64: z.string().optional(),
  promptText: z.string().max(4000).optional(),
  items: z.array(batchItemSchema).min(1).max(32),
});

const cancelSchema = z.object({
  workerToken: z.string().optional(),
});

function sendError(response: Response, error: unknown): void {
  if (error instanceof BatchRequestError) {
    response.status(error.status).json({ error: error.message });
    return;
  }
  if (error instanceof z.ZodError) {
    response.status(400).json({ error: 'Invalid batch request', issues: error.issues });
    return;
  }
  console.error('[batch] request failed:', error);
  response.status(500).json({ error: 'Batch request failed' });
}

function handle(
  task: (request: Parameters<RequestHandler>[0], response: Response) => Promise<void>
): RequestHandler {
  return (request, response) => {
    void task(request, response).catch((error: unknown) => sendError(response, error));
  };
}

export interface BatchRouteOptions {
  callbackPort: number;
}

export function registerBatchRoutes(app: Express, options: BatchRouteOptions): void {
  app.get(
    '/api/providers/batch',
    handle(async (_request, response) => {
      const jobs = await listBatchJobs();
      response.json({ jobs: jobs.slice(0, 50).map(toPublicBatch) });
    })
  );

  app.post(
    '/api/providers/batch',
    handle(async (request, response) => {
      const parsed = createBatchSchema.safeParse(request.body);
      if (!parsed.success) {
        response.status(400).json({ error: 'Invalid batch request', issues: parsed.error.issues });
        return;
      }
      const input = parsed.data;
      const totalCharacters = input.items.reduce((total, item) => total + item.text.length, 0);
      if (totalCharacters > 100000) {
        response.status(400).json({
          error: 'Batch text is too large',
          detail: `The batch contains ${totalCharacters} characters; the limit is 100000.`,
        });
        return;
      }
      if (input.isCloned && !input.referenceAudioBase64) {
        response.status(400).json({
          error: 'Voice cloning requires reference audio (3-30s, 16-bit PCM WAV).',
        });
        return;
      }
      if (input.isCloned && !input.consentConfirmed) {
        response.status(400).json({
          error: 'Voice cloning requires explicit presenter consent.',
        });
        return;
      }

      const job = await createAndDispatchBatch({
        ...input,
        callbackPort: options.callbackPort,
      });
      response.status(202).json({ job });
    })
  );

  app.get(
    '/api/providers/batch/:id',
    handle(async (request, response) => {
      const jobId = String(request.params.id ?? '');
      if (!isSafeBatchId(jobId)) {
        response.status(404).json({ error: 'Batch job not found' });
        return;
      }
      const job = await readBatchJob(jobId);
      if (!job) {
        response.status(404).json({ error: 'Batch job not found' });
        return;
      }
      response.json({ job: toPublicBatch(job) });
    })
  );

  app.post(
    '/api/providers/batch/:id/cancel',
    handle(async (request, response) => {
      const jobId = String(request.params.id ?? '');
      if (!isSafeBatchId(jobId)) {
        response.status(404).json({ error: 'Batch job not found' });
        return;
      }
      const job = await readBatchJob(jobId);
      if (!job) {
        response.status(404).json({ error: 'Batch job not found' });
        return;
      }
      const parsed = cancelSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        response.status(400).json({ error: 'Invalid cancellation request' });
        return;
      }
      await cancelBatchJob(job, parsed.data.workerToken);
      response.json({ ok: true, status: 'cancellation forwarded to the worker' });
    })
  );

  app.get(
    '/api/providers/batch/:id/items/:itemId/audio',
    handle(async (request, response) => {
      const jobId = String(request.params.id ?? '');
      const itemId = String(request.params.itemId ?? '');
      if (!isSafeBatchId(jobId) || !isSafeItemId(itemId)) {
        response.status(404).json({ error: 'Batch audio not found' });
        return;
      }
      const audio = await readBatchItemAudio(jobId, itemId);
      if (!audio) {
        response.status(404).json({ error: 'Batch audio not found' });
        return;
      }
      response.setHeader('Content-Type', 'audio/wav');
      response.setHeader('Content-Disposition', `attachment; filename="${audio.filename}"`);
      response.send(audio.buffer);
    })
  );

  app.post(getWebhookRoute(), handleBatchWebhook);
}
