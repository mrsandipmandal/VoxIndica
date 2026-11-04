import { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  Captions,
  CheckCircle2,
  Copy,
  Download,
  Image as ImageIcon,
  Loader2,
  Share2,
  Sparkles,
  Upload,
  X
} from 'lucide-react';
import type { CreatorProject, GeneratedThumbnail } from '../../types/creator';
import { creatorService } from '../../services/creatorService';

interface PublishingPanelProps {
  project: CreatorProject;
  onProjectChange: (project: CreatorProject) => void;
  onError: (message: string) => void;
  onNotice: (message: string) => void;
}

const cardClass = 'p-5 bg-[#121927] border border-slate-800 rounded-xl space-y-4';
const labelClass =
  'block text-[10px] font-mono uppercase tracking-wider text-slate-500 mb-1';

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Could not read the selected image.'));
    reader.readAsDataURL(file);
  });
}

function formatSeconds(value: number): string {
  const minutes = Math.floor(value / 60);
  const seconds = Math.round(value % 60);
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

export function PublishingPanel({
  project,
  onProjectChange,
  onError,
  onNotice
}: PublishingPanelProps) {
  const fileInput = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [promptDraft, setPromptDraft] = useState(project.script?.thumbnailPrompt ?? '');
  const [generating, setGenerating] = useState(false);
  const [approving, setApproving] = useState(false);
  const [candidate, setCandidate] = useState<GeneratedThumbnail | null>(null);

  useEffect(() => {
    setPromptDraft(project.script?.thumbnailPrompt ?? '');
  }, [project.id, project.script?.thumbnailPrompt]);

  const script = project.script;
  const scenes = script?.scenes ?? [];
  const narrationSeconds = scenes.reduce(
    (sum, scene) => sum + (project.voice.scenes[scene.id]?.durationSeconds ?? 0),
    0
  );
  const narrativeScenes = scenes.filter((scene) => project.voice.scenes[scene.id]).length;
  const captionsReady = scenes.length > 0 && narrativeScenes === scenes.length;
  const thumbnails = project.assets.filter((asset) => asset.kind === 'thumbnail');
  const thumbnail = thumbnails[thumbnails.length - 1];

  const uploadThumbnail = async (file: File) => {
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      onError('Choose a PNG, JPEG or WebP image for the thumbnail.');
      return;
    }
    if (file.size > 30 * 1024 * 1024) {
      onError('The thumbnail must be smaller than 30 MB.');
      return;
    }

    setUploading(true);
    try {
      const dataBase64 = await fileToBase64(file);
      const result = await creatorService.uploadAsset(project.id, {
        kind: 'thumbnail',
        fileName: file.name,
        mimeType: file.type,
        dataBase64
      });
      onProjectChange(result.project);
      onNotice(`Thumbnail saved: ${result.asset.fileName}.`);
    } catch (caught: any) {
      onError(caught?.message || 'Could not upload the thumbnail.');
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  };

  const copyPrompt = async () => {
    try {
      await navigator.clipboard.writeText(script?.thumbnailPrompt || '');
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      onError('The browser refused clipboard access. Select the prompt and copy it manually.');
    }
  };

  const generateCandidate = async () => {
    if (!promptDraft.trim()) {
      onError('Write a thumbnail prompt before generating.');
      return;
    }
    setGenerating(true);
    try {
      const result = await creatorService.generateThumbnail(project.id, promptDraft.trim());
      setCandidate(result);
      onNotice(
        `Thumbnail generated with ${result.provider} (${result.model}). Review it before using it.`
      );
    } catch (caught: any) {
      onError(caught?.message || 'Thumbnail generation failed.');
    } finally {
      setGenerating(false);
    }
  };

  const approveCandidate = async () => {
    if (!candidate) return;
    setApproving(true);
    try {
      const result = await creatorService.uploadAsset(project.id, {
        kind: 'thumbnail',
        fileName: 'generated-thumbnail.png',
        mimeType: candidate.mimeType,
        dataBase64: candidate.base64,
        generatedBy: `${candidate.provider}/${candidate.model}`
      });
      onProjectChange(result.project);
      onNotice(`Thumbnail saved: ${result.asset.fileName}.`);
      setCandidate(null);
    } catch (caught: any) {
      onError(caught?.message || 'Could not save the generated thumbnail.');
    } finally {
      setApproving(false);
    }
  };

  return (
    <section className={cardClass}>
      <header className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
          <Share2 className="w-4 h-4 text-amber-400" />
          Publishing package
        </h3>
        <span className="text-[10px] font-mono text-slate-500">
          captions · chapters · thumbnail · description
        </span>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="p-4 bg-[#0B0F17] border border-slate-800 rounded-lg space-y-3">
          <h4 className="text-xs font-semibold text-slate-100 flex items-center gap-2">
            <Captions className="w-3.5 h-3.5 text-amber-400" />
            Captions
          </h4>
          <p className="text-[11px] text-slate-400 leading-relaxed">
            {captionsReady
              ? `${scenes.length} cues from ${formatSeconds(narrationSeconds)} of synthesized narration. Timestamps follow the real WAV durations, not word-count estimates.`
              : `Synthesize every scene to unlock captions. ${narrativeScenes} of ${scenes.length} scenes have narration.`}
          </p>
          {captionsReady ? (
            <div className="flex flex-wrap items-center gap-2">
              <a
                href={creatorService.captionsUrl(project.id)}
                className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md border border-slate-700 text-slate-300 hover:text-amber-300 hover:border-amber-500/40 text-[11px] transition-colors"
              >
                <Download className="w-3 h-3" />
                Download SRT
              </a>
              <a
                href={creatorService.captionsUrl(project.id, 'ass')}
                className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md border border-slate-700 text-slate-300 hover:text-amber-300 hover:border-amber-500/40 text-[11px] transition-colors"
              >
                <Download className="w-3 h-3" />
                Download ASS
              </a>
            </div>
          ) : (
            <span className="inline-flex items-center gap-1.5 text-[10px] font-mono text-slate-600">
              <AlertTriangle className="w-3 h-3" />
              waiting for narration
            </span>
          )}
        </div>

        <div className="p-4 bg-[#0B0F17] border border-slate-800 rounded-lg space-y-3">
          <h4 className="text-xs font-semibold text-slate-100 flex items-center gap-2">
            <ImageIcon className="w-3.5 h-3.5 text-amber-400" />
            Thumbnail
          </h4>
          <p className="text-[11px] text-slate-400 leading-relaxed">
            {thumbnail
              ? `Using ${thumbnail.fileName}. Replace it any time; the previous file is removed.`
              : 'Upload an image you approve, or generate one below and approve it before it is saved.'}
          </p>
          <div className="flex items-center gap-3">
            {thumbnail ? (
              <img
                src={creatorService.assetUrl(project.id, thumbnail.id)}
                alt="Project thumbnail"
                className="w-24 h-14 object-cover rounded border border-slate-800"
              />
            ) : null}
            <button
              type="button"
              onClick={() => fileInput.current?.click()}
              disabled={uploading}
              className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md border border-slate-700 text-slate-300 hover:text-amber-300 hover:border-amber-500/40 text-[11px] transition-colors disabled:opacity-50"
            >
              {uploading ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : (
                <Upload className="w-3 h-3" />
              )}
              {thumbnail ? 'Replace image' : 'Upload image'}
            </button>
            <input
              ref={fileInput}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="sr-only"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void uploadThumbnail(file);
              }}
            />
          </div>
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between gap-2 mb-1">
          <label className={`${labelClass} mb-0`}>Thumbnail prompt</label>
          <button
            type="button"
            onClick={() => void copyPrompt()}
            disabled={!script?.thumbnailPrompt}
            className="inline-flex items-center gap-1 text-[10px] font-mono text-slate-400 hover:text-amber-300 disabled:opacity-40"
          >
            {copied ? (
              <CheckCircle2 className="w-3 h-3 text-emerald-400" />
            ) : (
              <Copy className="w-3 h-3" />
            )}
            {copied ? 'copied' : 'copy prompt'}
          </button>
        </div>
        <textarea
          className="w-full min-h-20 bg-[#0B0F17] border border-slate-800 rounded-lg px-3 py-2 text-[11px] text-slate-300 leading-relaxed focus:outline-none focus:border-amber-500/60"
          value={promptDraft}
          onChange={(event) => setPromptDraft(event.target.value)}
          placeholder="Describe the thumbnail you want…"
          disabled={generating || approving}
        />
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void generateCandidate()}
            disabled={generating || approving || !promptDraft.trim()}
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md border border-amber-500/40 text-amber-300 hover:bg-amber-500/10 text-[11px] transition-colors disabled:opacity-50"
          >
            {generating ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : (
              <Sparkles className="w-3 h-3" />
            )}
            {generating ? 'Generating…' : candidate ? 'Generate again' : 'Generate with Gemini'}
          </button>
          <span className="text-[10px] text-slate-500 leading-relaxed">
            Needs GEMINI_API_KEY. The image is not saved until you approve it.
          </span>
        </div>

        {candidate ? (
          <div className="p-3 bg-[#0B0F17] border border-amber-500/30 rounded-lg space-y-2">
            <img
              src={`data:${candidate.mimeType};base64,${candidate.base64}`}
              alt="Generated thumbnail candidate"
              className="w-full max-w-xs rounded border border-slate-800"
            />
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => void approveCandidate()}
                disabled={approving}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-amber-500 hover:bg-amber-400 text-slate-950 text-[11px] font-semibold disabled:opacity-50"
              >
                {approving ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : (
                  <CheckCircle2 className="w-3 h-3" />
                )}
                Use image
              </button>
              <button
                type="button"
                onClick={() => setCandidate(null)}
                disabled={approving}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-slate-700 text-slate-300 hover:text-rose-300 text-[11px] disabled:opacity-50"
              >
                <X className="w-3 h-3" />
                Discard
              </button>
              <span className="text-[10px] font-mono text-slate-500">
                {candidate.provider} · {candidate.model}
              </span>
            </div>
          </div>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-800 pt-3">
        <div className="text-[11px] text-slate-400 leading-relaxed">
          {captionsReady
            ? `Chapters use real scene timings · ${formatSeconds(narrationSeconds)} total`
            : 'Chapter timestamps stay hidden until every scene has narration.'}
        </div>
        <a
          href={creatorService.publishingUrl(project.id)}
          className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md bg-amber-500 hover:bg-amber-400 text-slate-950 text-[11px] font-semibold transition-colors"
        >
          <Download className="w-3 h-3" />
          Download publishing pack
        </a>
      </div>
    </section>
  );
}
