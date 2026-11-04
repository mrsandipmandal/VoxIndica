import { useRef, useState } from 'react';
import {
  AlertTriangle,
  Captions,
  CheckCircle2,
  Copy,
  Download,
  Image as ImageIcon,
  Loader2,
  Share2,
  Upload
} from 'lucide-react';
import type { CreatorProject } from '../../types/creator';
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
              : 'No image provider is connected. Upload the thumbnail you approve — nothing is generated or invented here.'}
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
        <p className="text-[11px] text-slate-300 bg-[#0B0F17] border border-slate-800 rounded-lg px-3 py-2 leading-relaxed whitespace-pre-wrap">
          {script?.thumbnailPrompt || 'No thumbnail prompt was written for this script.'}
        </p>
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
