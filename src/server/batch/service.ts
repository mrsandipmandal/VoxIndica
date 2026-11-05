import { randomBytes, randomUUID } from 'node:crypto';
import type { SupportedLanguage } from '../../types';
import {
  createBatchJob,
  isSafeBatchId,
  isSafeItemId,
  updateBatchJob,
} from './store';
import type { BatchJobInternal, BatchProvider } from './types';
import { toPublicBatch } from './types';
import type { BatchJobView } from '../../types';

export class BatchRequestError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'BatchRequestError';
    this.status = status;
  }
}

export interface BatchItemInput {
  id?: string;
  text: string;
  language?: SupportedLanguage;
}

export interface CreateBatchInput {
  provider: BatchProvider;
  workerUrl: string;
  workerToken?: string;
  language: SupportedLanguage;
  isCloned: boolean;
  /** Required when `isCloned` is true; the route rejects cloning without it. */
  consentConfirmed?: boolean;
  referenceAudioBase64?: string;
  promptText?: string;
  items: BatchItemInput[];
  callbackPort: number;
}

function workerTimeoutMs(): number {
  return Number(process.env.WORKER_TIMEOUT_MS) || 120000;
}

export function cleanWorkerUrl(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new BatchRequestError(400, 'workerUrl must be a valid HTTP(S) URL');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new BatchRequestError(400, 'workerUrl must use http:// or https://');
  }
  if (parsed.username || parsed.password) {
    throw new BatchRequestError(400, 'workerUrl must not contain embedded credentials');
  }
  return `${parsed.origin}${parsed.pathname}`.replace(/\/+$/, '');
}

export function isLoopbackWorker(value: string): boolean {
  try {
    const hostname = new URL(value).hostname.toLowerCase();
    return (
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname === '0.0.0.0' ||
      hostname === '::1' ||
      hostname === '[::1]' ||
      hostname.startsWith('127.')
    );
  } catch {
    return false;
  }
}

function publicCallbackBase(): string | null {
  const configured = process.env.VOXINDICA_PUBLIC_URL?.trim();
  if (!configured) return null;
  let parsed: URL;
  try {
    parsed = new URL(configured);
  } catch {
    throw new BatchRequestError(503, 'VOXINDICA_PUBLIC_URL is not a valid URL');
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new BatchRequestError(503, 'VOXINDICA_PUBLIC_URL must use http:// or https://');
  }
  return configured.replace(/\/+$/, '');
}

function resolveCallbackBase(
  workerUrl: string,
  callbackPort: number
): { base: string; mode: 'loopback' | 'public' } {
  if (isLoopbackWorker(workerUrl)) {
    return { base: `http://127.0.0.1:${callbackPort}`, mode: 'loopback' };
  }
  const base = publicCallbackBase();
  if (!base) {
    throw new BatchRequestError(
      503,
      'Remote worker callbacks need a public HTTPS URL. Start a tunnel to the Studio callback listener and set VOXINDICA_PUBLIC_URL, for example: cloudflared tunnel --url http://127.0.0.1:3099 && export VOXINDICA_PUBLIC_URL=https://<tunnel-host>'
    );
  }
  return { base, mode: 'public' };
}

function dispatchFailure(job: BatchJobInternal, message: string): Promise<BatchJobInternal> {
  const now = new Date().toISOString();
  return updateBatchJob(job.id, (current) => {
    current.status = 'failed';
    current.error = message;
    current.finishedAt = now;
    for (const item of current.items) {
      if (item.status === 'pending' || item.status === 'running') {
        item.status = 'interrupted';
        item.error = 'The worker did not accept this batch.';
        item.finishedAt = now;
      }
    }
  });
}

/**
 * Persists the job before contacting the worker so an immediate callback can
 * already find it, then dispatches the asynchronous `/batch` request.
 */
export async function createAndDispatchBatch(input: CreateBatchInput): Promise<BatchJobView> {
  const workerUrl = cleanWorkerUrl(input.workerUrl);
  const callback = resolveCallbackBase(workerUrl, input.callbackPort);

  const now = new Date().toISOString();
  const jobId = randomUUID();
  const callbackToken = randomBytes(32).toString('hex');
  const callbackSecret = randomBytes(32).toString('hex');

  const seen = new Set<string>();
  const items = input.items.map((item, index) => {
    const itemId = item.id ?? randomUUID();
    if (!isSafeItemId(itemId)) {
      throw new BatchRequestError(400, `Invalid item id: ${itemId}`);
    }
    if (seen.has(itemId)) {
      throw new BatchRequestError(400, `Duplicate item id: ${itemId}`);
    }
    seen.add(itemId);
    return {
      id: itemId,
      index,
      text: item.text,
      language: item.language ?? input.language,
      status: 'pending' as const,
    };
  });

  const job: BatchJobInternal = {
    id: jobId,
    provider: input.provider,
    workerUrl,
    language: input.language,
    isCloned: input.isCloned,
    status: 'queued',
    items,
    callbackToken,
    callbackSecret,
    callbackMode: callback.mode,
    createdAt: now,
    updatedAt: now,
  };
  await createBatchJob(job);

  const callbackUrl = `${callback.base}/api/providers/batch/webhook/${callbackToken}`;
  const body = {
    batch_id: jobId,
    items: items.map((item) => ({
      id: item.id,
      text: item.text,
      language: item.language,
    })),
    callback_url: callbackUrl,
    callback_secret: callbackSecret,
    reference_audio: input.referenceAudioBase64 || '',
    prompt_text: input.promptText || '',
    cfg_value: 2.0,
    inference_timesteps: 8,
  };

  let response: Response;
  try {
    response = await fetch(`${workerUrl}/batch`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(input.workerToken
          ? { Authorization: `Bearer ${input.workerToken}` }
          : {}),
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(workerTimeoutMs()),
    });
  } catch (error) {
    const detail =
      (error as Error).name === 'TimeoutError'
        ? `The worker did not accept the batch within ${workerTimeoutMs()} ms.`
        : `Could not reach the worker: ${(error as Error).message}`;
    const failed = await dispatchFailure(job, detail);
    throw new BatchRequestError(
      (error as Error).name === 'TimeoutError' ? 504 : 502,
      toPublicBatch(failed).error || detail
    );
  }

  const responseText = await response.text();
  if (!response.ok) {
    let detail = responseText.trim();
    try {
      const parsed = JSON.parse(responseText) as { detail?: string; error?: string };
      detail = parsed.detail || parsed.error || detail;
    } catch {
      // Keep the raw response text.
    }
    if (response.status === 404) {
      detail =
        'The worker does not support /batch (HTTP 404). Relaunch the Kaggle/Colab notebook with the current worker build.';
    }
    const failed = await dispatchFailure(
      job,
      `Worker rejected the batch (HTTP ${response.status}): ${detail || 'no detail'}`
    );
    throw new BatchRequestError(
      response.status === 401 ? 401 : 502,
      toPublicBatch(failed).error || detail
    );
  }

  let workerJobId: string | undefined;
  try {
    const parsed = JSON.parse(responseText) as { batch_id?: string };
    if (typeof parsed.batch_id === 'string' && isSafeBatchId(parsed.batch_id)) {
      workerJobId = parsed.batch_id;
    }
  } catch {
    // The 202 body is advisory; the Studio job id is still the callback key.
  }

  const updated = await updateBatchJob(job.id, (current) => {
    if (current.status === 'queued') current.status = 'running';
    if (workerJobId) current.workerJobId = workerJobId;
  });
  return toPublicBatch(updated);
}

export async function cancelBatchJob(
  job: BatchJobInternal,
  workerToken: string | undefined
): Promise<void> {
  if (['completed', 'failed', 'cancelled', 'interrupted'].includes(job.status)) {
    throw new BatchRequestError(409, `Batch is already ${job.status}`);
  }
  if (!job.workerJobId) {
    await updateBatchJob(job.id, (current) => {
      current.status = 'cancelled';
      current.error = 'Cancelled before the worker returned a job id.';
      current.finishedAt = new Date().toISOString();
    });
    return;
  }

  let response: Response;
  try {
    response = await fetch(`${cleanWorkerUrl(job.workerUrl)}/batch/${job.workerJobId}/cancel`, {
      method: 'POST',
      headers: {
        ...(workerToken ? { Authorization: `Bearer ${workerToken}` } : {}),
      },
      signal: AbortSignal.timeout(30000),
    });
  } catch (error) {
    throw new BatchRequestError(502, `Could not reach the worker: ${(error as Error).message}`);
  }
  if (!response.ok) {
    const detail = (await response.text()).trim();
    throw new BatchRequestError(
      response.status === 401 ? 401 : 502,
      `Worker rejected the cancellation (HTTP ${response.status}): ${detail || 'no detail'}`
    );
  }
}
