import { randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { BatchJobInternal, BatchItemInternal } from './types';
import { completedCount, failedCount } from './types';

const SAFE_JOB_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{7,79}$/;
const SAFE_ITEM_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/;
const MAX_AUDIO_BYTES = 50 * 1024 * 1024;

/** Resolved lazily so dotenv has already run when a route touches the store. */
export function batchRoot(): string {
  return path.resolve(
    process.env.VOXINDICA_BATCH_DATA_DIR || path.join(process.cwd(), 'data', 'batches')
  );
}

export function isSafeBatchId(value: string): boolean {
  return SAFE_JOB_ID.test(value);
}

export function isSafeItemId(value: string): boolean {
  return SAFE_ITEM_ID.test(value);
}

function jobDirectory(jobId: string): string {
  if (!isSafeBatchId(jobId)) {
    throw new Error('Invalid batch job id');
  }
  return path.join(batchRoot(), jobId);
}

function jobFile(jobId: string): string {
  return path.join(jobDirectory(jobId), 'job.json');
}

function itemAudioFile(jobId: string, itemId: string): string {
  if (!isSafeItemId(itemId)) {
    throw new Error('Invalid batch item id');
  }
  return path.join(jobDirectory(jobId), 'items', `${itemId}.wav`);
}

async function writeJsonAtomic(file: string, value: unknown): Promise<void> {
  const directory = path.dirname(file);
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const temporary = `${file}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await fs.rename(temporary, file);
}

async function readJobUnlocked(jobId: string): Promise<BatchJobInternal | null> {
  try {
    const raw = await fs.readFile(jobFile(jobId), 'utf8');
    const parsed = JSON.parse(raw) as BatchJobInternal;
    if (!parsed || parsed.id !== jobId || !Array.isArray(parsed.items)) {
      return null;
    }
    return parsed;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

export async function readBatchJob(jobId: string): Promise<BatchJobInternal | null> {
  if (!isSafeBatchId(jobId)) return null;
  return readJobUnlocked(jobId);
}

export async function createBatchJob(job: BatchJobInternal): Promise<void> {
  await fs.mkdir(jobDirectory(job.id), { recursive: true, mode: 0o700 });
  await writeJsonAtomic(jobFile(job.id), job);
}

const chains = new Map<string, Promise<unknown>>();

/**
 * Serializes read-modify-write updates per job. Callbacks and the create route
 * can otherwise interleave and lose an item's state.
 */
export function withBatchLock<T>(jobId: string, task: () => Promise<T>): Promise<T> {
  const previous = chains.get(jobId) ?? Promise.resolve();
  const next = previous.then(task, task);
  const tail = next.then(
    () => undefined,
    () => undefined
  );
  chains.set(jobId, tail);
  return next.finally(() => {
    if (chains.get(jobId) === tail) {
      chains.delete(jobId);
    }
  });
}

export async function updateBatchJob(
  jobId: string,
  update: (job: BatchJobInternal) => void
): Promise<BatchJobInternal> {
  return withBatchLock(jobId, async () => {
    const job = await readJobUnlocked(jobId);
    if (!job) {
      throw new Error(`Batch job ${jobId} was not found`);
    }
    update(job);
    job.updatedAt = new Date().toISOString();
    await writeJsonAtomic(jobFile(jobId), job);
    return job;
  });
}

/** Writes a job while the caller already holds `withBatchLock`. */
export async function writeBatchJob(job: BatchJobInternal): Promise<void> {
  await writeJsonAtomic(jobFile(job.id), job);
}

export async function listBatchJobs(): Promise<BatchJobInternal[]> {
  let entries: import('node:fs').Dirent[];
  try {
    entries = await fs.readdir(batchRoot(), { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }

  const jobs = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory() && isSafeBatchId(entry.name))
      .map((entry) => readJobUnlocked(entry.name).catch(() => null))
  );
  return jobs
    .filter((job): job is BatchJobInternal => Boolean(job))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function findBatchByCallbackToken(
  token: string
): Promise<BatchJobInternal | null> {
  if (!/^[a-f0-9]{64}$/.test(token)) return null;
  const jobs = await listBatchJobs();
  return jobs.find((job) => job.callbackToken === token) ?? null;
}

export async function recoverInterruptedBatchJobs(): Promise<number> {
  const jobs = await listBatchJobs();
  let recovered = 0;
  for (const job of jobs) {
    if (job.status !== 'queued' && job.status !== 'running') continue;
    await withBatchLock(job.id, async () => {
      const current = await readJobUnlocked(job.id);
      if (!current || (current.status !== 'queued' && current.status !== 'running')) return;
      const now = new Date().toISOString();
      current.status = 'interrupted';
      current.error =
        'The Studio restarted before the worker sent a terminal callback. Existing items and audio were kept.';
      current.finishedAt = now;
      current.updatedAt = now;
      for (const item of current.items) {
        if (item.status === 'running') {
          item.status = 'interrupted';
          item.error = 'The Studio restarted while this item was running.';
          item.finishedAt = now;
        }
      }
      await writeJsonAtomic(jobFile(current.id), current);
    });
    recovered += 1;
  }
  return recovered;
}

export function isRiffWave(buffer: Buffer): boolean {
  return (
    buffer.length >= 44 &&
    buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buffer.subarray(8, 12).toString('ascii') === 'WAVE'
  );
}

export function decodeAudioBase64(value: string): Buffer {
  const comma = value.indexOf(',');
  const raw = value.startsWith('data:') && comma >= 0 ? value.slice(comma + 1) : value;
  const buffer = Buffer.from(raw, 'base64');
  if (buffer.length === 0 || buffer.length > MAX_AUDIO_BYTES) {
    throw new Error('Callback audio is empty or exceeds the 50 MB limit');
  }
  if (!isRiffWave(buffer)) {
    throw new Error('Callback audio is not a RIFF/WAVE file');
  }
  return buffer;
}

export async function saveBatchItemAudio(
  jobId: string,
  itemId: string,
  buffer: Buffer
): Promise<string> {
  const file = itemAudioFile(jobId, itemId);
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
  await fs.writeFile(temporary, buffer, { mode: 0o600 });
  await fs.rename(temporary, file);
  return `${itemId}.wav`;
}

export async function readBatchItemAudio(
  jobId: string,
  itemId: string
): Promise<{ buffer: Buffer; filename: string } | null> {
  if (!isSafeItemId(itemId)) return null;
  const job = await readBatchJob(jobId);
  if (!job) return null;
  const item = job.items.find((entry) => entry.id === itemId);
  if (!item || item.status !== 'completed' || !item.audioFile) return null;
  try {
    const buffer = await fs.readFile(itemAudioFile(jobId, itemId));
    return { buffer, filename: `${jobId}-${itemId}.wav` };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

export function findItem(job: BatchJobInternal, itemId: string): BatchItemInternal | undefined {
  return job.items.find((item) => item.id === itemId);
}

export function deriveBatchStatus(job: BatchJobInternal): 'completed' | 'failed' {
  const completed = completedCount(job);
  const failed = failedCount(job);
  return completed === 0 && failed > 0 ? 'failed' : 'completed';
}
