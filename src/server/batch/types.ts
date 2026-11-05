import type {
  BatchItemStatus,
  BatchJobStatus,
  BatchJobView,
  SupportedLanguage,
} from '../../types';

export const BATCH_PROVIDERS = ['local', 'kaggle', 'colab'] as const;
export type BatchProvider = (typeof BATCH_PROVIDERS)[number];

export interface BatchItemInternal {
  id: string;
  index: number;
  text: string;
  language: SupportedLanguage;
  status: BatchItemStatus;
  audioFile?: string;
  sampleRate?: number;
  durationSeconds?: number;
  chunks?: number;
  generationSeconds?: number;
  error?: string;
  startedAt?: string;
  finishedAt?: string;
}

export interface BatchJobInternal {
  id: string;
  provider: BatchProvider;
  workerUrl: string;
  language: SupportedLanguage;
  isCloned: boolean;
  status: BatchJobStatus;
  items: BatchItemInternal[];
  callbackToken: string;
  callbackSecret: string;
  callbackMode: 'loopback' | 'public';
  workerJobId?: string;
  error?: string;
  createdAt: string;
  updatedAt: string;
  finishedAt?: string;
}

export interface BatchCallbackPayload {
  event:
    | 'item.started'
    | 'item.completed'
    | 'item.failed'
    | 'batch.completed'
    | 'batch.failed'
    | 'batch.cancelled';
  job_id: string;
  item_id?: string;
  index?: number;
  status?: string;
  error?: string;
  audio_base64?: string;
  sample_rate?: number;
  duration_seconds?: number;
  chunks?: number;
  generation_seconds?: number;
  total?: number;
  completed?: number;
  failed?: number;
  sent_at?: string;
}

export function completedCount(job: BatchJobInternal): number {
  return job.items.filter((item) => item.status === 'completed').length;
}

export function failedCount(job: BatchJobInternal): number {
  return job.items.filter((item) => item.status === 'failed').length;
}

export function toPublicBatch(job: BatchJobInternal): BatchJobView {
  return {
    id: job.id,
    provider: job.provider,
    status: job.status,
    language: job.language,
    isCloned: job.isCloned,
    total: job.items.length,
    completed: completedCount(job),
    failed: failedCount(job),
    callbackMode: job.callbackMode,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    ...(job.finishedAt ? { finishedAt: job.finishedAt } : {}),
    ...(job.error ? { error: job.error } : {}),
    items: job.items.map((item) => ({
      id: item.id,
      index: item.index,
      text: item.text,
      language: item.language,
      status: item.status,
      ...(item.sampleRate !== undefined ? { sampleRate: item.sampleRate } : {}),
      ...(item.durationSeconds !== undefined ? { durationSeconds: item.durationSeconds } : {}),
      ...(item.chunks !== undefined ? { chunks: item.chunks } : {}),
      ...(item.generationSeconds !== undefined ? { generationSeconds: item.generationSeconds } : {}),
      ...(item.error ? { error: item.error } : {}),
      ...(item.status === 'completed' && item.audioFile
        ? { audioUrl: `/api/providers/batch/${job.id}/items/${item.id}/audio` }
        : {}),
    })),
  };
}
