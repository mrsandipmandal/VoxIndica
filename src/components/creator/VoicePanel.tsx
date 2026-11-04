import { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  Mic,
  RefreshCw,
  Square,
  Upload
} from 'lucide-react';
import type {
  CreatorProject,
  CreatorWorkerProvider,
  StartVoiceJobInput
} from '../../types/creator';
import { creatorService } from '../../services/creatorService';
import { ProviderService } from '../../services/providerService';

interface VoicePanelProps {
  project: CreatorProject;
  scriptSaved: boolean;
  onProjectChange: (project: CreatorProject) => void;
  onError: (message: string) => void;
  onNotice: (message: string) => void;
}

const MIN_REFERENCE_SECONDS = 3;
const MAX_REFERENCE_SECONDS = 30;

const inputClass =
  'w-full bg-[#0B0F17] border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-amber-500/60 transition-colors';
const labelClass =
  'block text-[10px] font-mono uppercase tracking-wider text-slate-500 mb-1';

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Could not read the selected file.'));
    reader.readAsDataURL(file);
  });
}

async function decodeDuration(file: File): Promise<number> {
  const buffer = await file.arrayBuffer();
  const context = new AudioContext();
  try {
    const decoded = await context.decodeAudioData(buffer);
    return decoded.duration;
  } finally {
    void context.close();
  }
}

export function VoicePanel({
  project,
  scriptSaved,
  onProjectChange,
  onError,
  onNotice
}: VoicePanelProps) {
  const fileInput = useRef<HTMLInputElement | null>(null);
  const providerService = ProviderService.getInstance();
  const [uploading, setUploading] = useState(false);
  const [starting, setStarting] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [providerId, setProviderId] = useState<CreatorWorkerProvider>('kaggle');
  const [referenceId, setReferenceId] = useState('');
  const [promptText, setPromptText] = useState(project.voice.promptText || '');

  const configs = providerService.getAllConfigs();
  const workerConfigs = (['local', 'kaggle', 'colab'] as CreatorWorkerProvider[])
    .map((id) => configs[id])
    .filter((config) => Boolean(config.endpointUrl.trim()));

  const references = project.assets.filter((asset) => asset.kind === 'reference_audio');
  const scenes = project.script?.scenes ?? [];
  const running = project.voice.status === 'queued' || project.voice.status === 'running';
  const completed = scenes.filter((scene) => project.voice.scenes[scene.id]).length;
  const totalSeconds = scenes.reduce(
    (sum, scene) => sum + (project.voice.scenes[scene.id]?.durationSeconds || 0),
    0
  );
  const complete = scenes.length > 0 && completed === scenes.length;

  useEffect(() => {
    const preferred =
      workerConfigs.find((config) => config.provider === project.voice.provider) ||
      workerConfigs.find((config) => config.isConnected) ||
      workerConfigs[0];
    if (preferred) {
      setProviderId(preferred.provider as CreatorWorkerProvider);
    } else {
      setProviderId('kaggle');
    }
    // Worker endpoints are read once per project open; the user can change the
    // select afterwards without it snapping back on every poll tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id]);

  useEffect(() => {
    const latest =
      references.find((asset) => asset.id === project.voice.referenceAssetId) ||
      references[references.length - 1];
    setReferenceId((current) => {
      if (current && references.some((asset) => asset.id === current)) return current;
      return latest?.id || '';
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id, project.assets.length, project.voice.referenceAssetId]);

  useEffect(() => {
    setPromptText(project.voice.promptText || '');
  }, [project.id, project.voice.promptText]);

  const uploadReference = async (file: File) => {
    if (!file.name.toLowerCase().endsWith('.wav')) {
      onError('The worker needs a WAV reference clip (3–30 seconds, PCM).');
      return;
    }
    if (file.size > 30 * 1024 * 1024) {
      onError('The reference clip is larger than 30 MB.');
      return;
    }

    setUploading(true);
    try {
      let duration: number;
      try {
        duration = await decodeDuration(file);
      } catch {
        onError('That file could not be decoded as WAV audio.');
        return;
      }
      if (duration < MIN_REFERENCE_SECONDS || duration > MAX_REFERENCE_SECONDS) {
        onError(
          `The reference clip is ${duration.toFixed(2)}s. The worker accepts ${MIN_REFERENCE_SECONDS}–${MAX_REFERENCE_SECONDS}s.`
        );
        return;
      }

      const dataBase64 = await fileToBase64(file);
      const { project: next } = await creatorService.uploadAsset(project.id, {
        kind: 'reference_audio',
        fileName: file.name,
        mimeType: 'audio/wav',
        dataBase64
      });
      onProjectChange(next);
      setReferenceId(
        next.assets.filter((asset) => asset.kind === 'reference_audio').slice(-1)[0]?.id || ''
      );
      onNotice(`Reference clip saved (${duration.toFixed(2)}s).`);
    } catch (error: any) {
      onError(error?.message || 'Could not upload the reference clip.');
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  };

  const startSynthesis = async (sceneIds?: string[]) => {
    if (!scriptSaved) {
      onError('Save the script first — the worker reads the saved scene text, not unsaved edits.');
      return;
    }
    const config = workerConfigs.find((item) => item.provider === providerId);
    if (!config) {
      onError('Choose a worker endpoint first: connect Kaggle, Colab or the local worker in Providers.');
      return;
    }
    if (!referenceId) {
      onError('Upload a 3–30s WAV reference clip before synthesizing narration.');
      return;
    }

    setStarting(true);
    try {
      const input: StartVoiceJobInput = {
        provider: config.provider as CreatorWorkerProvider,
        workerUrl: config.endpointUrl,
        workerToken: config.bearerToken || '',
        referenceAssetId: referenceId,
        voiceName: project.consent?.presenterName || 'Creator voice',
        promptText,
        regenerateSceneIds: sceneIds
      };
      const { project: next } = await creatorService.startVoiceJob(project.id, input);
      onProjectChange(next);
      onNotice(
        sceneIds
          ? 'Scene queued for re-synthesis. Progress is reported by the worker.'
          : 'Voice job queued. Scenes are stored one at a time as the worker finishes them.'
      );
    } catch (error: any) {
      onError(error?.message || 'Could not start voice synthesis.');
    } finally {
      setStarting(false);
    }
  };

  const cancelSynthesis = async () => {
    setCancelling(true);
    try {
      const { project: next } = await creatorService.cancelVoiceJob(project.id);
      onProjectChange(next);
      onNotice('Voice synthesis cancelled. Finished scenes were kept.');
    } catch (error: any) {
      onError(error?.message || 'Could not cancel voice synthesis.');
    } finally {
      setCancelling(false);
    }
  };

  return (
    <section className="p-5 bg-[#121927] border border-slate-800 rounded-xl space-y-4">
      <header className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
          <Mic className="w-4 h-4 text-amber-400" />
          Narration
        </h3>
        <span className="text-[10px] font-mono text-slate-500">
          {completed}/{scenes.length} scenes
          {totalSeconds > 0 ? ` · ${totalSeconds.toFixed(1)}s audio` : ''}
        </span>
      </header>

      {workerConfigs.length === 0 ? (
        <div className="flex items-start gap-2 p-3 rounded-lg border border-amber-500/30 bg-amber-500/10 text-amber-200 text-[11px]">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <span className="leading-relaxed">
            No worker endpoint is saved. Connect Kaggle, Colab or the local worker in the
            Providers panel first — narration is synthesized by that GPU worker, never by a
            placeholder.
          </span>
        </div>
      ) : null}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className={labelClass}>GPU worker</label>
          <select
            className={inputClass}
            value={providerId}
            onChange={(event) => setProviderId(event.target.value as CreatorWorkerProvider)}
            disabled={running}
          >
            {workerConfigs.map((config) => (
              <option key={config.provider} value={config.provider}>
                {config.provider} · {config.endpointUrl}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className={labelClass}>Reference clip</label>
          <div className="flex items-center gap-2">
            <select
              className={inputClass}
              value={referenceId}
              onChange={(event) => setReferenceId(event.target.value)}
              disabled={running || references.length === 0}
            >
              {references.length === 0 ? (
                <option value="">No reference WAV uploaded</option>
              ) : null}
              {references.map((asset) => (
                <option key={asset.id} value={asset.id}>
                  {asset.fileName}
                  {asset.durationSeconds ? ` · ${asset.durationSeconds.toFixed(2)}s` : ''}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => fileInput.current?.click()}
              disabled={uploading || running}
              className="flex items-center gap-1.5 px-2.5 py-2 rounded-md border border-slate-700 text-slate-300 hover:text-slate-100 text-[11px] shrink-0 disabled:opacity-40"
            >
              {uploading ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Upload className="w-3.5 h-3.5" />
              )}
              Upload
            </button>
            <input
              ref={fileInput}
              type="file"
              accept=".wav,audio/wav"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void uploadReference(file);
              }}
            />
          </div>
          <p className="text-[10px] text-slate-500 mt-1">
            {MIN_REFERENCE_SECONDS}–{MAX_REFERENCE_SECONDS}s WAV. The worker clones this voice; it is
            never sent to a script provider.
          </p>
        </div>
      </div>

      <div>
        <label className={labelClass}>Reference transcript (optional)</label>
        <textarea
          className={`${inputClass} min-h-14`}
          value={promptText}
          onChange={(event) => setPromptText(event.target.value)}
          placeholder="Exact words spoken in the reference clip — improves cloning, optional"
          disabled={running}
        />
      </div>

      {!scriptSaved ? (
        <div className="flex items-start gap-2 p-3 rounded-lg border border-amber-500/30 bg-amber-500/10 text-amber-200 text-[11px]">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <span className="leading-relaxed">
            The script has unsaved edits. Save it before synthesizing — the worker reads the
            persisted scene text, so unsaved wording would produce mismatched narration.
          </span>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => void startSynthesis()}
          disabled={starting || running || !referenceId || workerConfigs.length === 0 || !scriptSaved}
          className="flex items-center gap-2 px-3.5 py-2 rounded-md bg-amber-500 hover:bg-amber-400 disabled:opacity-40 text-slate-950 text-xs font-semibold transition-colors"
        >
          {starting || running ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Mic className="w-3.5 h-3.5" />
          )}
          {running
            ? 'Synthesizing…'
            : complete
              ? 'All scenes synthesized'
              : completed > 0
                ? 'Resume narration'
                : 'Synthesize narration'}
        </button>
        {running ? (
          <button
            type="button"
            onClick={() => void cancelSynthesis()}
            disabled={cancelling}
            className="flex items-center gap-2 px-3 py-2 rounded-md border border-slate-700 text-slate-300 hover:text-rose-300 text-xs disabled:opacity-40"
          >
            {cancelling ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Square className="w-3.5 h-3.5" />
            )}
            Cancel
          </button>
        ) : null}
        <span className="text-[10px] font-mono text-slate-500 ml-auto">
          {project.voice.status}
        </span>
      </div>

      {project.voice.message ? (
        <div
          className={`flex items-start gap-2 p-3 rounded-lg border text-[11px] ${
            project.voice.status === 'failed'
              ? 'border-rose-500/30 bg-rose-500/10 text-rose-200'
              : project.voice.status === 'complete'
                ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200'
                : 'border-slate-700 bg-[#0B0F17] text-slate-300'
          }`}
        >
          {project.voice.status === 'complete' ? (
            <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
          ) : (
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          )}
          <span className="leading-relaxed">{project.voice.message}</span>
        </div>
      ) : null}

      {scenes.length > 0 ? (
        <div className="space-y-2">
          <div className="h-1.5 rounded-full bg-slate-800 overflow-hidden">
            <div
              className="h-full bg-amber-500 transition-all"
              style={{ width: `${scenes.length ? (completed / scenes.length) * 100 : 0}%` }}
            />
          </div>

          <ul className="space-y-2">
            {scenes.map((scene, index) => {
              const audio = project.voice.scenes[scene.id];
              return (
                <li
                  key={scene.id}
                  className="p-2.5 rounded-lg bg-[#0B0F17] border border-slate-800 space-y-2"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[10px] font-mono uppercase tracking-wider text-amber-400">
                      Scene {String(index + 1).padStart(2, '0')}
                    </span>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-mono text-slate-500">
                        {audio ? `${audio.durationSeconds.toFixed(2)}s · ${audio.model}` : 'no audio'}
                      </span>
                      <button
                        type="button"
                        onClick={() => void startSynthesis([scene.id])}
                        disabled={starting || running || !referenceId}
                        className="p-1.5 rounded-md border border-slate-800 text-slate-500 hover:text-amber-300 hover:border-amber-500/40 disabled:opacity-30 transition-colors"
                        title="Re-synthesize this scene"
                      >
                        <RefreshCw className="w-3 h-3" />
                      </button>
                    </div>
                  </div>

                  <p className="text-[11px] text-slate-400 line-clamp-2">{scene.voiceText}</p>

                  {audio ? (
                    <audio
                      controls
                      preload="none"
                      className="w-full h-8"
                      src={creatorService.assetUrl(project.id, audio.assetId)}
                    />
                  ) : null}
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      <p className="text-[10px] text-slate-500 leading-relaxed border-t border-slate-800 pt-2">
        Each scene is synthesized by the worker and written to disk before the next one starts.
        A failed or interrupted job keeps the scenes that already exist; nothing is filled in
        locally.
      </p>
    </section>
  );
}
