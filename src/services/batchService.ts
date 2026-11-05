import type { BatchJobView, SupportedLanguage } from '../types';

export type BatchProvider = 'local' | 'kaggle' | 'colab';

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
  /** Required when `isCloned` is true; the server rejects cloning without it. */
  consentConfirmed?: boolean;
  referenceAudioBase64?: string;
  promptText?: string;
  items: BatchItemInput[];
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers || {})
    }
  });

  let payload: any = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok || payload?.ok === false) {
    const message = payload?.error || `Batch request failed with HTTP ${response.status} (${url}).`;
    throw new Error(message);
  }
  return payload as T;
}

export const batchService = {
  async list(): Promise<BatchJobView[]> {
    const data = await request<{ jobs: BatchJobView[] }>('/api/providers/batch');
    return data.jobs;
  },

  async get(id: string): Promise<BatchJobView> {
    const data = await request<{ job: BatchJobView }>(
      `/api/providers/batch/${encodeURIComponent(id)}`
    );
    return data.job;
  },

  async create(input: CreateBatchInput): Promise<BatchJobView> {
    const data = await request<{ job: BatchJobView }>('/api/providers/batch', {
      method: 'POST',
      body: JSON.stringify(input)
    });
    return data.job;
  },

  async cancel(id: string, workerToken?: string): Promise<void> {
    await request<{ ok: true }>(`/api/providers/batch/${encodeURIComponent(id)}/cancel`, {
      method: 'POST',
      body: JSON.stringify({ workerToken })
    });
  }
};
