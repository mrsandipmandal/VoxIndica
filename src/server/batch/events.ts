import type { BatchCallbackPayload, BatchJobInternal } from './types';
import { completedCount, failedCount } from './types';
import {
  decodeAudioBase64,
  deriveBatchStatus,
  readBatchJob,
  saveBatchItemAudio,
  withBatchLock,
  writeBatchJob,
} from './store';

export class BatchCallbackError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'BatchCallbackError';
    this.status = status;
  }
}

function findItemOrThrow(job: BatchJobInternal, itemId: string) {
  const item = job.items.find((entry) => entry.id === itemId);
  if (!item) {
    throw new BatchCallbackError(400, `Unknown batch item: ${itemId}`);
  }
  return item;
}

function isTerminal(job: BatchJobInternal): boolean {
  return ['completed', 'failed', 'cancelled'].includes(job.status);
}

function clearTerminalState(job: BatchJobInternal): void {
  job.finishedAt = undefined;
  job.error = undefined;
}

/**
 * Applies a signed worker callback. Duplicate deliveries are acknowledged but
 * cannot regress a finished item or overwrite its audio.
 */
export async function applyBatchCallback(
  jobId: string,
  payload: BatchCallbackPayload
): Promise<{ job: BatchJobInternal; duplicate: boolean }> {
  return withBatchLock(jobId, async () => {
    const job = await readBatchJob(jobId);
    if (!job) {
      throw new BatchCallbackError(404, 'Batch job not found');
    }
    if (payload.job_id !== job.id) {
      throw new BatchCallbackError(400, 'Callback job_id does not match this job');
    }

    let duplicate = false;
    const now = new Date().toISOString();

    switch (payload.event) {
      case 'item.started': {
        const itemId = payload.item_id;
        if (!itemId) throw new BatchCallbackError(400, 'item.started requires item_id');
        const item = findItemOrThrow(job, itemId);
        if (item.status === 'completed' || item.status === 'failed' || isTerminal(job)) {
          duplicate = true;
          break;
        }
        item.status = 'running';
        item.startedAt = item.startedAt ?? now;
        item.error = undefined;
        job.status = 'running';
        clearTerminalState(job);
        break;
      }

      case 'item.completed': {
        const itemId = payload.item_id;
        if (!itemId) throw new BatchCallbackError(400, 'item.completed requires item_id');
        const item = findItemOrThrow(job, itemId);
        if (item.status === 'completed' || item.status === 'failed' || isTerminal(job)) {
          duplicate = true;
          break;
        }
        if (!payload.audio_base64) {
          throw new BatchCallbackError(422, 'item.completed requires audio_base64');
        }
        const audio = decodeAudioBase64(payload.audio_base64);
        item.audioFile = await saveBatchItemAudio(job.id, item.id, audio);
        item.status = 'completed';
        item.sampleRate =
          typeof payload.sample_rate === 'number' ? payload.sample_rate : undefined;
        item.durationSeconds =
          typeof payload.duration_seconds === 'number' ? payload.duration_seconds : undefined;
        item.chunks = typeof payload.chunks === 'number' ? payload.chunks : undefined;
        item.generationSeconds =
          typeof payload.generation_seconds === 'number' ? payload.generation_seconds : undefined;
        item.error = undefined;
        item.finishedAt = now;
        if (!isTerminal(job)) {
          job.status = 'running';
          clearTerminalState(job);
        }
        break;
      }

      case 'item.failed': {
        const itemId = payload.item_id;
        if (!itemId) throw new BatchCallbackError(400, 'item.failed requires item_id');
        const item = findItemOrThrow(job, itemId);
        if (item.status === 'completed' || item.status === 'failed' || isTerminal(job)) {
          duplicate = true;
          break;
        }
        item.status = 'failed';
        item.error = payload.error || 'The worker reported an item failure';
        item.finishedAt = now;
        if (!isTerminal(job)) {
          job.status = 'running';
          clearTerminalState(job);
        }
        break;
      }

      case 'batch.completed': {
        if (isTerminal(job)) {
          duplicate = true;
          break;
        }
        const missing = job.items.filter(
          (item) =>
            item.status === 'pending' ||
            item.status === 'running' ||
            item.status === 'interrupted'
        );
        if (missing.length > 0) {
          job.status = 'interrupted';
          job.error = `The worker reported completion but ${missing.length} item(s) have no terminal result.`;
          job.finishedAt = now;
          break;
        }
        job.status = deriveBatchStatus(job);
        const failed = failedCount(job);
        if (failed > 0) {
          job.error = `${failed} of ${job.items.length} item(s) failed.`;
        }
        job.finishedAt = now;
        break;
      }

      case 'batch.failed': {
        if (isTerminal(job)) {
          duplicate = true;
          break;
        }
        job.status = 'failed';
        job.error = payload.error || 'The worker reported a batch failure';
        job.finishedAt = now;
        for (const item of job.items) {
          if (item.status === 'pending' || item.status === 'running') {
            item.status = 'interrupted';
            item.error = 'The worker stopped before this item finished.';
            item.finishedAt = now;
          }
        }
        break;
      }

      case 'batch.cancelled': {
        if (isTerminal(job)) {
          duplicate = true;
          break;
        }
        job.status = 'cancelled';
        job.error = payload.error || 'The worker cancelled this batch.';
        job.finishedAt = now;
        for (const item of job.items) {
          if (item.status === 'pending' || item.status === 'running') {
            item.status = 'interrupted';
            item.error = 'The batch was cancelled before this item completed.';
            item.finishedAt = now;
          }
        }
        break;
      }

      default:
        throw new BatchCallbackError(400, `Unsupported callback event: ${String(payload.event)}`);
    }

    if (!duplicate) {
      job.updatedAt = now;
      await writeBatchJob(job);
    }
    return { job, duplicate };
  });
}

export function callbackSummary(job: BatchJobInternal): {
  total: number;
  completed: number;
  failed: number;
} {
  return {
    total: job.items.length,
    completed: completedCount(job),
    failed: failedCount(job),
  };
}
