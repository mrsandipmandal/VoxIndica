import { useCallback, useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Download,
  FileAudio,
  Layers,
  Loader2,
  RefreshCw,
  Square,
  Upload
} from 'lucide-react';
import type {
  BatchItemStatus,
  BatchJobStatus,
  BatchJobView,
  InferenceProvider,
  SupportedLanguage
} from '../types';
import { batchService } from '../services/batchService';
import type { BatchProvider } from '../services/batchService';
import { ProviderService } from '../services/providerService';
import {
  REFERENCE_MAX_SECONDS,
  REFERENCE_MIN_SECONDS,
  blobToBase64,
  dataUrlToBlob,
  prepareReferenceWav
} from '../utils/audio';

const PROVIDERS: { value: BatchProvider; label: string }[] = [
  { value: 'local', label: 'Local hardware' },
  { value: 'kaggle', label: 'Kaggle' },
  { value: 'colab', label: 'Google Colab' }
];

const LANGUAGES: { value: SupportedLanguage; label: string }[] = [
  { value: 'bn-IN', label: 'Bengali · West Bengal' },
  { value: 'hi-IN', label: 'Hindi' },
  { value: 'en-IN', label: 'Indian English' }
];

const JOB_STATUS_COLORS: Record<BatchJobStatus, string> = {
  queued: 'text-slate-400',
  running: 'text-amber-300',
  completed: 'text-emerald-300',
  failed: 'text-rose-300',
  cancelled: 'text-slate-400',
  interrupted: 'text-orange-300'
};

const ITEM_STATUS_COLORS: Record<BatchItemStatus, string> = {
  pending: 'text-slate-500',
  running: 'text-amber-300',
  completed: 'text-emerald-300',
  failed: 'text-rose-300',
  interrupted: 'text-orange-300'
};

const inputClass =
  'w-full bg-[#0B0F17] border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-amber-500/60 transition-colors';
const labelClass = 'block text-[10px] font-mono uppercase tracking-wider text-slate-500 mb-1';

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function StatusText({ status }: { status: BatchJobStatus | BatchItemStatus }) {
  const color =
    status in JOB_STATUS_COLORS
      ? JOB_STATUS_COLORS[status as BatchJobStatus]
      : 'text-slate-400';
  return (
    <span className={`inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider ${color}`}>
      <span className="w-1.5 h-1.5 rounded-full bg-current" />
      {status}
    </span>
  );
}

function batchProviderFor(provider: InferenceProvider): BatchProvider {
  return provider === 'kaggle' || provider === 'colab' ? provider : 'local';
}

interface PreparedReference {
  base64: string;
  fileName: string;
  durationSeconds: number;
  sourceDurationSeconds: number;
  trimmed: boolean;
}

interface BatchStudioProps {
  activeProvider: InferenceProvider;
  onOpenProviderModal: () => void;
}

export function BatchStudio({ activeProvider, onOpenProviderModal }: BatchStudioProps) {
  const providerService = ProviderService.getInstance();
  const initialProvider = batchProviderFor(activeProvider);
  const initialConfig = providerService.getConfig(initialProvider);

  const [provider, setProvider] = useState<BatchProvider>(initialProvider);
  const [workerUrl, setWorkerUrl] = useState(initialConfig.endpointUrl || '');
  const [workerToken, setWorkerToken] = useState(initialConfig.bearerToken || '');
  const [language, setLanguage] = useState<SupportedLanguage>('bn-IN');
  const [itemText, setItemText] = useState('');
  const [promptText, setPromptText] = useState('');
  const [useReference, setUseReference] = useState(false);
  const [reference, setReference] = useState<PreparedReference | null>(null);
  const [referenceError, setReferenceError] = useState('');
  const [preparingReference, setPreparingReference] = useState(false);
  const [consentChecked, setConsentChecked] = useState(false);

  const [jobs, setJobs] = useState<BatchJobView[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const items = useMemo(
    () =>
      itemText
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean),
    [itemText]
  );
  const totalCharacters = useMemo(
    () => items.reduce((total, text) => total + text.length, 0),
    [items]
  );
  const itemsError = useMemo(() => {
    if (items.length === 0) return 'Add at least one non-empty line.';
    if (items.length > 32) return `This batch has ${items.length} items; the limit is 32.`;
    const tooLong = items.find((text) => text.length > 10000);
    if (tooLong) return `One item is ${tooLong.length} characters; the limit is 10,000.`;
    if (totalCharacters > 100000) {
      return `This batch has ${totalCharacters.toLocaleString()} characters; the limit is 100,000.`;
    }
    return '';
  }, [items, totalCharacters]);

  const selectedJob = jobs.find((job) => job.id === selectedId) || null;

  const referencePreviewUrl = useMemo(() => {
    if (!reference) return '';
    return URL.createObjectURL(dataUrlToBlob(reference.base64));
  }, [reference]);

  useEffect(() => {
    return () => {
      if (referencePreviewUrl) URL.revokeObjectURL(referencePreviewUrl);
    };
  }, [referencePreviewUrl]);

  useEffect(() => {
    const next = batchProviderFor(activeProvider);
    setProvider(next);
    const config = providerService.getConfig(next);
    setWorkerUrl(config.endpointUrl || '');
    setWorkerToken(config.bearerToken || '');
  }, [activeProvider, providerService]);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const next = await batchService.list();
      setJobs(next);
      setSelectedId((current) =>
        current && next.some((job) => job.id === current) ? current : next[0]?.id || ''
      );
      setError('');
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : 'Could not load batches.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Poll only the selected queued/running job. Every value shown comes from the
  // persisted server job; no local progress or placeholder audio is invented.
  useEffect(() => {
    if (!selectedJob) return;
    if (selectedJob.status !== 'queued' && selectedJob.status !== 'running') return;

    let cancelled = false;
    let timer: number | undefined;

    const tick = async () => {
      try {
        const next = await batchService.get(selectedJob.id);
        if (cancelled) return;
        setJobs((current) => current.map((job) => (job.id === next.id ? next : job)));
        if (next.status === 'queued' || next.status === 'running') {
          timer = window.setTimeout(tick, 2000);
        }
      } catch (caught: unknown) {
        if (!cancelled) {
          setError(caught instanceof Error ? caught.message : 'Could not refresh the batch.');
        }
      }
    };

    timer = window.setTimeout(tick, 1500);
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [selectedJob?.id, selectedJob?.status]);

  const changeProvider = (next: BatchProvider) => {
    setProvider(next);
    const config = providerService.getConfig(next);
    setWorkerUrl(config.endpointUrl || '');
    setWorkerToken(config.bearerToken || '');
  };

  const handleReferenceFile = async (file: File | undefined) => {
    setReferenceError('');
    setReference(null);
    setConsentChecked(false);
    if (!file) return;

    if (file.size > 25 * 1024 * 1024) {
      setReferenceError('Reference audio exceeds the 25 MB worker limit.');
      return;
    }

    setPreparingReference(true);
    try {
      const prepared = await prepareReferenceWav(file, REFERENCE_MAX_SECONDS);
      if (prepared.durationSeconds < REFERENCE_MIN_SECONDS) {
        throw new Error(
          `Reference clip is ${prepared.durationSeconds.toFixed(1)}s; at least ${REFERENCE_MIN_SECONDS}s is required.`
        );
      }
      const base64 = await blobToBase64(prepared.blob);
      setReference({
        base64,
        fileName: file.name,
        durationSeconds: prepared.durationSeconds,
        sourceDurationSeconds: prepared.sourceDurationSeconds,
        trimmed: prepared.trimmed
      });
    } catch (caught: unknown) {
      setReferenceError(
        caught instanceof Error ? caught.message : 'Could not decode the reference audio.'
      );
    } finally {
      setPreparingReference(false);
    }
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');
    setNotice('');

    if (itemsError) {
      setError(itemsError);
      return;
    }
    if (!workerUrl.trim()) {
      setError('Enter the worker URL before dispatching a batch.');
      return;
    }
    if (useReference && !reference) {
      setError('Upload a 3–30s reference clip or turn off voice cloning.');
      return;
    }
    if (useReference && !consentChecked) {
      setError('Confirm presenter consent before cloning a voice.');
      return;
    }

    setSubmitting(true);
    try {
      const job = await batchService.create({
        provider,
        workerUrl: workerUrl.trim(),
        workerToken: workerToken.trim() || undefined,
        language,
        isCloned: useReference,
        consentConfirmed: useReference ? true : undefined,
        referenceAudioBase64: useReference ? reference?.base64 : undefined,
        promptText: promptText.trim() || undefined,
        items: items.map((text) => ({ text, language }))
      });
      setJobs((current) => [job, ...current.filter((entry) => entry.id !== job.id)]);
      setSelectedId(job.id);
      setNotice(
        'Batch accepted by the Studio. Item states change only when the worker sends signed callbacks.'
      );
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : 'Could not create the batch.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleCancel = async () => {
    if (!selectedJob) return;
    setCancelling(true);
    setError('');
    setNotice('');
    try {
      await batchService.cancel(selectedJob.id, workerToken.trim() || undefined);
      setNotice(
        'Cancellation forwarded. The job changes only after the worker acknowledges it with a signed callback.'
      );
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : 'Could not cancel the batch.');
    } finally {
      setCancelling(false);
    }
  };

  const terminalItems = selectedJob ? selectedJob.completed + selectedJob.failed : 0;
  const terminalPercent =
    selectedJob && selectedJob.total > 0
      ? Math.round((terminalItems / selectedJob.total) * 100)
      : 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Layers className="w-4 h-4 text-amber-400" />
            <h1 className="text-lg font-bold tracking-tight text-slate-100">Batch Inference</h1>
          </div>
          <p className="mt-1 text-xs text-slate-400">
            Dispatch an asynchronous worker batch, then follow real signed callbacks.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => void refresh()}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-slate-700 bg-slate-800/80 hover:bg-slate-800 disabled:opacity-50 text-xs text-slate-300 transition-colors"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
          <button
            onClick={onOpenProviderModal}
            className="px-3 py-1.5 rounded-md border border-slate-700 bg-slate-800/80 hover:bg-slate-800 text-xs text-slate-300 transition-colors"
          >
            Configure worker
          </button>
        </div>
      </div>

      {error && (
        <div className="flex items-start gap-2 p-3 bg-rose-500/10 border border-rose-500/30 rounded-lg text-xs text-rose-200">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <span className="whitespace-pre-wrap break-words">{error}</span>
        </div>
      )}
      {notice && (
        <div className="flex items-start gap-2 p-3 bg-emerald-500/10 border border-emerald-500/30 rounded-lg text-xs text-emerald-200">
          <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
          <span className="whitespace-pre-wrap break-words">{notice}</span>
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
        <form
          onSubmit={handleSubmit}
          className="xl:col-span-5 space-y-4 p-5 bg-[#121927] border border-slate-800 rounded-xl"
        >
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelClass} htmlFor="batch-provider">
                Provider
              </label>
              <select
                id="batch-provider"
                value={provider}
                onChange={(event) => changeProvider(event.target.value as BatchProvider)}
                className={inputClass}
              >
                {PROVIDERS.map((entry) => (
                  <option key={entry.value} value={entry.value}>
                    {entry.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelClass} htmlFor="batch-language">
                Language
              </label>
              <select
                id="batch-language"
                value={language}
                onChange={(event) => setLanguage(event.target.value as SupportedLanguage)}
                className={inputClass}
              >
                {LANGUAGES.map((entry) => (
                  <option key={entry.value} value={entry.value}>
                    {entry.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className={labelClass} htmlFor="batch-worker-url">
              Worker URL
            </label>
            <input
              id="batch-worker-url"
              value={workerUrl}
              onChange={(event) => setWorkerUrl(event.target.value)}
              placeholder="http://127.0.0.1:8000"
              className={inputClass}
              spellCheck={false}
            />
          </div>

          <div>
            <label className={labelClass} htmlFor="batch-worker-token">
              Worker token
            </label>
            <input
              id="batch-worker-token"
              type="password"
              value={workerToken}
              onChange={(event) => setWorkerToken(event.target.value)}
              placeholder="Bearer token from the worker session"
              className={inputClass}
              autoComplete="off"
            />
            <p className="mt-1 text-[10px] text-slate-500">
              Sent only to the Studio server for this request. It is required again to cancel.
            </p>
          </div>

          <div>
            <div className="flex items-center justify-between gap-3">
              <label className={labelClass} htmlFor="batch-items">
                Batch items
              </label>
              <span className="font-mono text-[10px] text-slate-500">
                {items.length} / 32 · {totalCharacters.toLocaleString()} / 100,000 chars
              </span>
            </div>
            <textarea
              id="batch-items"
              value={itemText}
              onChange={(event) => setItemText(event.target.value)}
              rows={7}
              placeholder={'প্রথম বাক্য।\nদ্বিতীয় বাক্য।'}
              className={`${inputClass} resize-y min-h-[140px]`}
            />
            <p className={`mt-1 text-[10px] ${itemsError ? 'text-amber-300' : 'text-slate-500'}`}>
              {itemsError || 'One non-empty line becomes one batch item.'}
            </p>
          </div>

          <div className="space-y-2 pt-1">
            <label className="flex items-start gap-2 text-xs text-slate-300">
              <input
                type="checkbox"
                checked={useReference}
                onChange={(event) => setUseReference(event.target.checked)}
                className="mt-0.5 accent-amber-500"
              />
              <span>Use a reference clip for voice cloning</span>
            </label>

            {useReference && (
              <div className="space-y-3 pl-6">
                <input
                  type="file"
                  accept="audio/*"
                  onChange={(event) => void handleReferenceFile(event.target.files?.[0])}
                  className="block w-full text-xs text-slate-400 file:mr-3 file:rounded-md file:border-0 file:bg-slate-800 file:px-3 file:py-1.5 file:text-xs file:text-slate-200 hover:file:bg-slate-700"
                />

                {preparingReference && (
                  <p className="flex items-center gap-1.5 text-[11px] text-slate-400">
                    <Loader2 className="w-3 h-3 animate-spin" />
                    Preparing a 16-bit mono WAV…
                  </p>
                )}

                {reference && (
                  <div className="space-y-2 p-3 bg-[#0B0F17] border border-slate-800 rounded-lg">
                    <div className="flex items-start gap-2">
                      <FileAudio className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
                      <div className="min-w-0">
                        <p className="text-[11px] text-slate-200 truncate">{reference.fileName}</p>
                        <p className="mt-0.5 font-mono text-[10px] text-slate-500">
                          {reference.durationSeconds.toFixed(1)}s
                          {reference.trimmed
                            ? ` · trimmed from ${reference.sourceDurationSeconds.toFixed(1)}s`
                            : ''}
                        </p>
                      </div>
                    </div>
                    {referencePreviewUrl && (
                      <audio controls preload="none" src={referencePreviewUrl} className="w-full" />
                    )}
                  </div>
                )}

                {referenceError && (
                  <p className="flex items-start gap-1.5 text-[11px] text-rose-300">
                    <AlertCircle className="w-3 h-3 shrink-0 mt-0.5" />
                    {referenceError}
                  </p>
                )}

                <label className="flex items-start gap-2 text-[11px] text-slate-400">
                  <input
                    type="checkbox"
                    checked={consentChecked}
                    onChange={(event) => setConsentChecked(event.target.checked)}
                    disabled={!reference}
                    className="mt-0.5 accent-amber-500"
                  />
                  <span>
                    I confirm I have the presenter&apos;s explicit permission to clone this voice
                    and use the resulting audio.
                  </span>
                </label>
              </div>
            )}
          </div>

          <div>
            <label className={labelClass} htmlFor="batch-prompt">
              Reference transcript (optional)
            </label>
            <textarea
              id="batch-prompt"
              value={promptText}
              onChange={(event) => setPromptText(event.target.value)}
              rows={2}
              placeholder="Exact words spoken in the reference clip"
              className={`${inputClass} resize-y`}
            />
          </div>

          {provider !== 'local' && (
            <p className="text-[10px] text-slate-500">
              Remote callbacks require <code className="text-slate-400">VOXINDICA_PUBLIC_URL</code>{' '}
              to point at the Studio callback tunnel. Without it the Studio returns an honest 503.
            </p>
          )}

          <button
            type="submit"
            disabled={
              submitting ||
              Boolean(itemsError) ||
              !workerUrl.trim() ||
              (useReference && (!reference || !consentChecked))
            }
            className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 disabled:opacity-50 disabled:cursor-not-allowed text-slate-950 text-xs font-semibold transition-colors"
          >
            {submitting ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                Dispatching…
              </>
            ) : (
              <>
                <Upload className="w-3.5 h-3.5" />
                Dispatch batch
              </>
            )}
          </button>
        </form>

        <section className="xl:col-span-7 space-y-4">
          <div className="p-5 bg-[#121927] border border-slate-800 rounded-xl">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-sm font-semibold text-slate-100">Recent batches</h2>
              <span className="font-mono text-[10px] text-slate-500">{jobs.length} jobs</span>
            </div>

            {loading ? (
              <p className="mt-4 flex items-center gap-2 text-xs text-slate-400">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                Loading persisted batches…
              </p>
            ) : jobs.length === 0 ? (
              <p className="mt-4 text-xs text-slate-500">
                No batches yet. Dispatch one to create the first persisted job.
              </p>
            ) : (
              <div className="mt-3 -mx-2 divide-y divide-slate-800/70">
                {jobs.map((job) => (
                  <button
                    key={job.id}
                    type="button"
                    onClick={() => setSelectedId(job.id)}
                    className={`w-full text-left px-2 py-2.5 border-l-2 transition-colors ${
                      job.id === selectedId
                        ? 'border-amber-400 bg-slate-800/40'
                        : 'border-transparent hover:bg-slate-800/30'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="font-mono text-[11px] text-slate-300">
                        {job.id.slice(0, 8)}
                      </span>
                      <StatusText status={job.status} />
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 font-mono text-[10px] text-slate-500">
                      <span>{job.provider}</span>
                      <span>·</span>
                      <span>
                        {job.completed}/{job.total} completed
                      </span>
                      {job.failed > 0 && (
                        <>
                          <span>·</span>
                          <span className="text-rose-400">{job.failed} failed</span>
                        </>
                      )}
                      <span>·</span>
                      <span>{formatDate(job.createdAt)}</span>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          {selectedJob && (
            <div className="p-5 bg-[#121927] border border-slate-800 rounded-xl space-y-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-sm font-semibold text-slate-100">
                      Job {selectedJob.id.slice(0, 8)}
                    </h2>
                    <StatusText status={selectedJob.status} />
                  </div>
                  <p className="mt-1 font-mono text-[10px] text-slate-500">
                    {selectedJob.provider} · {selectedJob.callbackMode} callback ·{' '}
                    {formatDate(selectedJob.createdAt)}
                  </p>
                </div>
                {(selectedJob.status === 'queued' || selectedJob.status === 'running') && (
                  <button
                    type="button"
                    onClick={() => void handleCancel()}
                    disabled={cancelling}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-rose-500/40 bg-rose-500/10 hover:bg-rose-500/20 disabled:opacity-50 text-xs text-rose-200 transition-colors"
                  >
                    {cancelling ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Square className="w-3.5 h-3.5" />
                    )}
                    Cancel
                  </button>
                )}
              </div>

              <div>
                <div className="flex items-center justify-between gap-3 font-mono text-[10px] text-slate-500">
                  <span>
                    {selectedJob.completed} completed · {selectedJob.failed} failed ·{' '}
                    {selectedJob.total} total
                  </span>
                  <span>{terminalPercent}% terminal</span>
                </div>
                <div className="mt-1.5 h-1.5 rounded-full bg-slate-800 overflow-hidden">
                  <div
                    className="h-full bg-amber-400 transition-[width] duration-500"
                    style={{ width: `${terminalPercent}%` }}
                  />
                </div>
              </div>

              {selectedJob.error && (
                <p className="flex items-start gap-2 text-[11px] text-rose-300">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                  {selectedJob.error}
                </p>
              )}

              <ul className="divide-y divide-slate-800/70">
                {selectedJob.items.map((item) => (
                  <li key={item.id} className="py-3 space-y-1.5">
                    <div className="flex items-center justify-between gap-3">
                      <span className="font-mono text-[10px] text-slate-500">
                        {String(item.index + 1).padStart(2, '0')} · {item.id.slice(0, 8)}
                      </span>
                      <span
                        className={`font-mono text-[10px] uppercase tracking-wider ${ITEM_STATUS_COLORS[item.status]}`}
                      >
                        {item.status}
                      </span>
                    </div>
                    <p className="text-xs text-slate-300 whitespace-pre-wrap break-words">
                      {item.text}
                    </p>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[10px] text-slate-500">
                      {item.durationSeconds !== undefined && (
                        <span>{item.durationSeconds.toFixed(2)}s</span>
                      )}
                      {item.sampleRate !== undefined && <span>{item.sampleRate} Hz</span>}
                      {item.chunks !== undefined && <span>{item.chunks} chunk(s)</span>}
                      {item.error && <span className="text-rose-400">{item.error}</span>}
                    </div>
                    {item.audioUrl && (
                      <div className="flex items-center gap-2 pt-1">
                        <audio controls preload="none" src={item.audioUrl} className="w-full min-w-0" />
                        <a
                          href={item.audioUrl}
                          download
                          className="flex items-center gap-1 px-2 py-1 rounded-md border border-slate-700 bg-slate-800/80 hover:bg-slate-800 text-[10px] text-slate-300 transition-colors shrink-0"
                        >
                          <Download className="w-3 h-3" />
                          WAV
                        </a>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
