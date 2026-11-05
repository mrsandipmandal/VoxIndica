import { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Download,
  Film,
  Loader2,
  Music2,
  Play,
  RefreshCw,
  Save,
  Square,
  Type,
  Upload,
  Video
} from 'lucide-react';
import type {
  CaptionStyle,
  CreatorAsset,
  CreatorProject,
  RenderPreset
} from '../../types/creator';
import {
  CAPTION_POSITIONS,
  RENDER_PRESET_DIMENSIONS,
  RENDER_PRESETS
} from '../../types/creator';
import { creatorService } from '../../services/creatorService';

interface RenderPanelProps {
  project: CreatorProject;
  onProjectChange: (project: CreatorProject) => void;
  onError: (message: string) => void;
  onNotice: (message: string) => void;
}

const cardClass = 'p-5 bg-[#121927] border border-slate-800 rounded-xl';
const labelClass =
  'block text-[10px] font-mono uppercase tracking-wider text-slate-500 mb-1';
const MAX_VISUAL_BYTES = 25 * 1024 * 1024;

function readAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || '');
      resolve(result.includes(',') ? result.slice(result.indexOf(',') + 1) : result);
    };
    reader.onerror = () => reject(reader.error || new Error('Could not read the file.'));
    reader.readAsDataURL(file);
  });
}

function latestVisual(project: CreatorProject, sceneId: string): CreatorAsset | null {
  let found: CreatorAsset | null = null;
  for (const asset of project.assets) {
    if (asset.kind === 'scene_visual' && asset.sceneId === sceneId) found = asset;
  }
  return found;
}

function isVideoAsset(asset: CreatorAsset): boolean {
  return asset.mimeType === 'video/mp4' || asset.mimeType === 'video/webm';
}

function sameStyle(a: CaptionStyle, b: CaptionStyle): boolean {
  return (
    a.fontScale === b.fontScale &&
    a.textColor.toLowerCase() === b.textColor.toLowerCase() &&
    a.outlineColor.toLowerCase() === b.outlineColor.toLowerCase() &&
    a.outlineWidth === b.outlineWidth &&
    a.position === b.position &&
    a.background === b.background
  );
}

const POSITION_LABELS: Record<CaptionStyle['position'], string> = {
  bottom: 'Bottom',
  middle: 'Middle',
  top: 'Top'
};

export function RenderPanel({
  project,
  onProjectChange,
  onError,
  onNotice
}: RenderPanelProps) {
  const [uploadingScene, setUploadingScene] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [burnCaptions, setBurnCaptions] = useState(project.render?.burnCaptions === true);
  const [preset, setPreset] = useState<RenderPreset>(
    project.render?.preset ?? 'landscape'
  );
  const [musicAssetId, setMusicAssetId] = useState<string | null>(
    project.render?.audio?.musicAssetId ?? null
  );
  const [musicVolume, setMusicVolume] = useState(
    project.render?.audio?.musicVolume ?? 0.2
  );
  const [normalizeAudio, setNormalizeAudio] = useState(
    project.render?.audio?.normalizeAudio ?? true
  );
  const [captionStyle, setCaptionStyle] = useState<CaptionStyle>({
    ...project.captionStyle
  });
  const [uploadingMusic, setUploadingMusic] = useState(false);
  const [savingStyle, setSavingStyle] = useState(false);

  // The panel stays mounted while the creator switches projects, so reset the
  // controls to the newly selected project instead of carrying stale values.
  useEffect(() => {
    setBurnCaptions(project.render?.burnCaptions === true);
    setPreset(project.render?.preset ?? 'landscape');
    setMusicAssetId(project.render?.audio?.musicAssetId ?? null);
    setMusicVolume(project.render?.audio?.musicVolume ?? 0.2);
    setNormalizeAudio(project.render?.audio?.normalizeAudio ?? true);
    setCaptionStyle({ ...project.captionStyle });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id]);

  const scenes = project.script?.scenes ?? [];
  const render = project.render;
  const musicAssets = project.assets.filter((asset) => asset.kind === 'music_bed');
  const selectedMusic = musicAssets.find((asset) => asset.id === musicAssetId) ?? null;
  const running = render?.status === 'queued' || render?.status === 'running';
  const complete = render?.status === 'complete';
  const dimensions = RENDER_PRESET_DIMENSIONS[preset];
  const styleChanged = !sameStyle(captionStyle, project.captionStyle);
  const transitionsChanged =
    !!render &&
    scenes.some((scene, index) => {
      const state = render.scenes[scene.id];
      const outgoing = scenes[index + 1]?.transition ?? 'cut';
      return (
        !state ||
        state.transition !== scene.transition ||
        state.outgoingTransition !== outgoing
      );
    });
  const formatChanged =
    !render ||
    render.preset !== preset ||
    render.burnCaptions !== burnCaptions ||
    (burnCaptions &&
      !sameStyle(captionStyle, render.captionStyle ?? project.captionStyle)) ||
    render.audio.musicAssetId !== musicAssetId ||
    Math.abs(render.audio.musicVolume - musicVolume) > 0.0005 ||
    render.audio.normalizeAudio !== normalizeAudio ||
    transitionsChanged;
  const finalAsset = useMemo(() => {
    const byId = render?.outputAssetId
      ? project.assets.find((asset) => asset.id === render.outputAssetId)
      : undefined;
    if (byId) return byId;
    const finals = project.assets.filter((asset) => asset.kind === 'final_video');
    return finals.length ? finals[finals.length - 1] : null;
  }, [project.assets, render?.outputAssetId]);

  const missingAudio = scenes.filter((scene) => !project.voice.scenes[scene.id]);
  const missingVisual = scenes.filter((scene) => !latestVisual(project, scene.id));
  const ready = scenes.length > 0 && !missingAudio.length && !missingVisual.length;
  const canStart = ready && !starting && formatChanged;

  const uploadVisual = async (sceneId: string, file: File) => {
    const allowed = ['image/png', 'image/jpeg', 'image/webp', 'video/mp4', 'video/webm'];
    const mime = file.type || 'image/png';
    if (!allowed.includes(mime)) {
      onError('Scene visuals must be PNG, JPEG, WebP, MP4 or WebM.');
      return;
    }
    if (file.size > MAX_VISUAL_BYTES) {
      onError('Scene visuals must be smaller than 25 MB.');
      return;
    }

    setUploadingScene(sceneId);
    try {
      const dataBase64 = await readAsBase64(file);
      const result = await creatorService.uploadAsset(project.id, {
        kind: 'scene_visual',
        sceneId,
        fileName: file.name,
        mimeType: mime,
        dataBase64
      });
      onProjectChange(result.project);
      onNotice(`Visual saved for scene ${scenes.findIndex((scene) => scene.id === sceneId) + 1}.`);
    } catch (caught: any) {
      onError(caught?.message || 'Could not upload the scene visual.');
    } finally {
      setUploadingScene(null);
    }
  };

  const start = async () => {
    setStarting(true);
    try {
      const next = await creatorService.startRender(project.id, {
        burnCaptions,
        preset,
        musicAssetId,
        musicVolume,
        normalizeAudio,
        ...(burnCaptions ? { captionStyle } : {})
      });
      onProjectChange(next);
      onNotice('Render queued on this machine. Scene clips are written one at a time.');
    } catch (caught: any) {
      onError(caught?.message || 'Could not start the render.');
    } finally {
      setStarting(false);
    }
  };

  const saveStyle = async () => {
    setSavingStyle(true);
    try {
      const next = await creatorService.updateProject(project.id, {
        captionStyle
      });
      onProjectChange(next);
      onNotice('Caption style saved. ASS downloads use the same values.');
    } catch (caught: any) {
      onError(caught?.message || 'Could not save the caption style.');
    } finally {
      setSavingStyle(false);
    }
  };

  const uploadMusic = async (file: File) => {
    const allowed = [
      'audio/mpeg',
      'audio/wav',
      'audio/x-wav',
      'audio/mp4',
      'audio/ogg',
      'audio/aac',
      'audio/flac',
      'audio/webm'
    ];
    const mime = file.type || 'audio/mpeg';
    if (!allowed.includes(mime)) {
      onError('Music beds must be MP3, WAV, M4A, OGG, AAC, FLAC or WebM audio.');
      return;
    }
    if (file.size > 30 * 1024 * 1024) {
      onError('Music beds must be smaller than 30 MB.');
      return;
    }

    setUploadingMusic(true);
    try {
      const dataBase64 = await readAsBase64(file);
      const result = await creatorService.uploadAsset(project.id, {
        kind: 'music_bed',
        fileName: file.name,
        mimeType: mime,
        dataBase64
      });
      onProjectChange(result.project);
      setMusicAssetId(result.asset.id);
      onNotice(`Music bed saved: ${result.asset.fileName}.`);
    } catch (caught: any) {
      onError(caught?.message || 'Could not upload the music bed.');
    } finally {
      setUploadingMusic(false);
    }
  };

  const cancel = async () => {
    setCancelling(true);
    try {
      const next = await creatorService.cancelRender(project.id);
      onProjectChange(next);
      onNotice('Render cancelled. Finished scene clips are kept.');
    } catch (caught: any) {
      onError(caught?.message || 'Could not cancel the render.');
    } finally {
      setCancelling(false);
    }
  };

  return (
    <div className={`${cardClass} space-y-4`}>
      <header className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
            <Video className="w-4 h-4 text-amber-400" />
            Scene render
          </h3>
          <p className="text-[11px] text-slate-500 mt-1 leading-relaxed">
            Assembles the visuals you uploaded with the synthesized scene narration into
            a {dimensions.width}×{dimensions.height} cut. It does not generate footage or an avatar.
          </p>
        </div>
        <span className="text-[10px] font-mono text-slate-500 shrink-0">
          {render ? `${render.completedScenes}/${render.totalScenes}` : `${scenes.length} scenes`}
        </span>
      </header>

      <div className="grid grid-cols-3 gap-2 text-[11px]">
        <div className="flex items-center gap-1.5 text-slate-400">
          {scenes.length > 0 ? (
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
          ) : (
            <AlertCircle className="w-3.5 h-3.5 text-amber-400" />
          )}
          {scenes.length} scenes
        </div>
        <div className="flex items-center gap-1.5 text-slate-400">
          {missingAudio.length === 0 && scenes.length > 0 ? (
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
          ) : (
            <AlertCircle className="w-3.5 h-3.5 text-amber-400" />
          )}
          {scenes.length - missingAudio.length} narrated
        </div>
        <div className="flex items-center gap-1.5 text-slate-400">
          {missingVisual.length === 0 && scenes.length > 0 ? (
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
          ) : (
            <AlertCircle className="w-3.5 h-3.5 text-amber-400" />
          )}
          {scenes.length - missingVisual.length} with visuals
        </div>
      </div>

      <div className="space-y-2">
        {scenes.map((scene, index) => {
          const audio = project.voice.scenes[scene.id];
          const visual = latestVisual(project, scene.id);
          const sceneState = render?.scenes[scene.id];
          return (
            <article
              key={scene.id}
              className="p-3 bg-[#0B0F17] border border-slate-800 rounded-lg flex items-center gap-3"
            >
              <div className="w-14 h-14 shrink-0 rounded-md overflow-hidden bg-[#121927] border border-slate-800 flex items-center justify-center">
                {visual ? (
                  isVideoAsset(visual) ? (
                    <Film className="w-5 h-5 text-slate-500" />
                  ) : (
                    <img
                      src={creatorService.assetUrl(project.id, visual.id)}
                      alt={`Scene ${index + 1} visual`}
                      className="w-full h-full object-cover"
                    />
                  )
                ) : (
                  <Upload className="w-4 h-4 text-slate-600" />
                )}
              </div>

              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-mono uppercase tracking-wider text-amber-400">
                    Scene {String(index + 1).padStart(2, '0')}
                  </span>
                  {audio ? (
                    <span className="text-[10px] font-mono text-slate-500">
                      {audio.durationSeconds.toFixed(2)}s narration
                    </span>
                  ) : (
                    <span className="text-[10px] font-mono text-amber-400/80">
                      no narration
                    </span>
                  )}
                  {sceneState?.status === 'complete' ? (
                    <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                  ) : null}
                </div>
                <p className="text-[11px] text-slate-300 truncate mt-0.5">
                  {scene.voiceText || scene.visualPrompt || 'Empty scene'}
                </p>
                {visual ? (
                  <p className="text-[10px] text-slate-500 truncate">
                    {visual.fileName} · {isVideoAsset(visual) ? 'video' : 'still'}
                  </p>
                ) : null}
              </div>

              <label className="shrink-0 flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-slate-700 text-[11px] text-slate-300 hover:text-amber-300 hover:border-amber-500/40 cursor-pointer transition-colors">
                {uploadingScene === scene.id ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : visual ? (
                  <RefreshCw className="w-3 h-3" />
                ) : (
                  <Upload className="w-3 h-3" />
                )}
                {visual ? 'Replace' : 'Visual'}
                <input
                  type="file"
                  className="hidden"
                  accept="image/png,image/jpeg,image/webp,video/mp4,video/webm"
                  disabled={uploadingScene === scene.id || running}
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    event.target.value = '';
                    if (file) void uploadVisual(scene.id, file);
                  }}
                />
              </label>
            </article>
          );
        })}
      </div>

      {render ? (
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] font-mono uppercase tracking-wider text-slate-500">
              {render.status}
            </span>
            <span className="text-[10px] font-mono text-slate-500">
              {render.progress}% · {render.width}×{render.height} · {render.fps}fps
              {render.burnCaptions ? ' · captions burned in' : ''}
            </span>
          </div>
          <div className="h-1.5 rounded-full bg-slate-800 overflow-hidden">
            <div
              className={`h-full transition-all ${
                render.status === 'failed'
                  ? 'bg-rose-500'
                  : render.status === 'complete'
                    ? 'bg-emerald-500'
                    : 'bg-amber-500'
              }`}
              style={{ width: `${Math.max(0, Math.min(100, render.progress))}%` }}
            />
          </div>
          <p
            className={`text-[11px] leading-relaxed ${
              render.status === 'failed'
                ? 'text-rose-300'
                : render.status === 'complete'
                  ? 'text-emerald-300'
                  : 'text-slate-400'
            }`}
          >
            {render.message}
          </p>
        </div>
      ) : null}

      {complete && finalAsset ? (
        <div className="space-y-2">
          <video
            controls
            preload="metadata"
            src={creatorService.assetUrl(project.id, finalAsset.id)}
            className="w-full rounded-lg border border-slate-800 bg-black"
          />
          <a
            href={creatorService.assetUrl(project.id, finalAsset.id)}
            download={finalAsset.fileName}
            className="inline-flex items-center gap-1.5 text-[11px] text-slate-300 hover:text-amber-300"
          >
            <Download className="w-3 h-3" />
            Download {finalAsset.fileName}
          </a>
        </div>
      ) : null}

      {!scenes.length ? (
        <p className="text-[11px] text-amber-300/90 leading-relaxed">
          Generate and save a script first. The renderer has nothing to encode until every
          scene has narration and a visual.
        </p>
      ) : !ready && !complete ? (
        <p className="text-[11px] text-amber-300/90 leading-relaxed">
          {missingAudio.length
            ? `Synthesize narration for ${missingAudio.length} more scene${missingAudio.length === 1 ? '' : 's'}. `
            : ''}
          {missingVisual.length
            ? `Attach a visual to ${missingVisual.length} more scene${missingVisual.length === 1 ? '' : 's'}.`
            : ''}
        </p>
      ) : null}

      <div>
        <label className={labelClass}>Output format</label>
        <select
          value={preset}
          disabled={running}
          onChange={(event) => setPreset(event.target.value as RenderPreset)}
          className="w-full bg-[#0B0F17] border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-amber-500/60 disabled:opacity-50"
        >
          {RENDER_PRESETS.map((id) => (
            <option key={id} value={id}>
              {RENDER_PRESET_DIMENSIONS[id].label} · {RENDER_PRESET_DIMENSIONS[id].width}×
              {RENDER_PRESET_DIMENSIONS[id].height}
            </option>
          ))}
        </select>
        <p className="text-[10px] text-slate-500 mt-1 leading-snug">
          Changing the format re-encodes every scene clip; existing clips in another
          size are not reused.
        </p>
      </div>

      <div className="space-y-3 p-3 bg-[#0B0F17] border border-slate-800 rounded-lg">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] font-semibold text-slate-200 flex items-center gap-1.5">
            <Music2 className="w-3.5 h-3.5 text-amber-400" />
            Music bed
          </span>
          <label className="shrink-0 flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-slate-700 text-[11px] text-slate-300 hover:text-amber-300 hover:border-amber-500/40 cursor-pointer transition-colors">
            {uploadingMusic ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : (
              <Upload className="w-3 h-3" />
            )}
            Upload
            <input
              type="file"
              className="hidden"
              accept="audio/mpeg,audio/wav,audio/x-wav,audio/mp4,audio/ogg,audio/aac,audio/flac,audio/webm"
              disabled={uploadingMusic || running}
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = '';
                if (file) void uploadMusic(file);
              }}
            />
          </label>
        </div>

        <select
          value={musicAssetId ?? ''}
          disabled={running}
          onChange={(event) => setMusicAssetId(event.target.value || null)}
          className="w-full bg-[#121927] border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-amber-500/60 disabled:opacity-50"
        >
          <option value="">No music — narration only</option>
          {musicAssets.map((asset) => (
            <option key={asset.id} value={asset.id}>
              {asset.fileName}
            </option>
          ))}
        </select>

        {selectedMusic ? (
          <audio
            controls
            preload="none"
            src={creatorService.assetUrl(project.id, selectedMusic.id)}
            className="w-full h-8"
          />
        ) : null}

        <div>
          <div className="flex items-center justify-between mb-1">
            <span className="text-[10px] font-mono uppercase tracking-wider text-slate-500">
              Music volume
            </span>
            <span className="text-[10px] font-mono text-slate-500">
              {Math.round(musicVolume * 100)}%
            </span>
          </div>
          <input
            type="range"
            min={0}
            max={100}
            step={1}
            value={Math.round(musicVolume * 100)}
            disabled={running}
            onChange={(event) => setMusicVolume(Number(event.target.value) / 100)}
            className="w-full accent-amber-500 disabled:opacity-50"
          />
        </div>

        <label
          className={`flex items-start gap-2 text-[11px] leading-relaxed ${running ? 'text-slate-500' : 'text-slate-300'}`}
        >
          <input
            type="checkbox"
            checked={normalizeAudio}
            disabled={running}
            onChange={(event) => setNormalizeAudio(event.target.checked)}
            className="mt-0.5 accent-amber-500"
          />
          <span>
            Normalize audio to -14 LUFS
            <span className="block text-[10px] text-slate-500 mt-0.5">
              Applies ffmpeg loudnorm to the final mix. It changes level, not content.
            </span>
          </span>
        </label>

        <p className="text-[10px] text-slate-500 leading-relaxed border-t border-slate-800 pt-2">
          The track loops to the video length and is ducked under narration with
          ffmpeg sidechain compression. Only upload music you have the rights to use.
        </p>
      </div>

      <label className={`flex items-start gap-2 text-[11px] leading-relaxed ${running ? 'text-slate-500' : 'text-slate-300'}`}>
        <input
          type="checkbox"
          checked={burnCaptions}
          disabled={running}
          onChange={(event) => setBurnCaptions(event.target.checked)}
          className="mt-0.5 accent-amber-500"
        />
        <span>
          Burn in captions
          <span className="block text-[10px] text-slate-500 mt-0.5">
            Uses the same ASS cues derived from scene narration. Adds a subtitle re-encode
            during final assembly; it never estimates timing.
          </span>
        </span>
      </label>

      <div className="space-y-3 p-3 bg-[#0B0F17] border border-slate-800 rounded-lg">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] font-semibold text-slate-200 flex items-center gap-1.5">
            <Type className="w-3.5 h-3.5 text-amber-400" />
            Caption style
          </span>
          <span
            className={`text-[10px] font-mono uppercase tracking-wider ${
              styleChanged ? 'text-amber-400' : 'text-slate-500'
            }`}
          >
            {styleChanged ? 'Unsaved' : 'Saved'}
          </span>
        </div>

        <div>
          <div className="flex items-center justify-between mb-1">
            <span className="text-[10px] font-mono uppercase tracking-wider text-slate-500">
              Text size
            </span>
            <span className="text-[10px] font-mono text-slate-500">
              {Math.round(captionStyle.fontScale * 100)}%
            </span>
          </div>
          <input
            type="range"
            min={50}
            max={200}
            step={5}
            value={Math.round(captionStyle.fontScale * 100)}
            disabled={running}
            onChange={(event) =>
              setCaptionStyle({
                ...captionStyle,
                fontScale: Number(event.target.value) / 100
              })
            }
            className="w-full accent-amber-500 disabled:opacity-50"
          />
        </div>

        <div className="grid grid-cols-2 gap-2">
          <label className="block">
            <span className={labelClass}>Text colour</span>
            <input
              type="color"
              value={captionStyle.textColor}
              disabled={running}
              onChange={(event) =>
                setCaptionStyle({ ...captionStyle, textColor: event.target.value })
              }
              className="h-8 w-full bg-transparent border border-slate-700 rounded-md cursor-pointer disabled:opacity-50"
            />
            <span className="block text-[10px] font-mono text-slate-500 mt-1">
              {captionStyle.textColor.toUpperCase()}
            </span>
          </label>
          <label className="block">
            <span className={labelClass}>Outline colour</span>
            <input
              type="color"
              value={captionStyle.outlineColor}
              disabled={running}
              onChange={(event) =>
                setCaptionStyle({ ...captionStyle, outlineColor: event.target.value })
              }
              className="h-8 w-full bg-transparent border border-slate-700 rounded-md cursor-pointer disabled:opacity-50"
            />
            <span className="block text-[10px] font-mono text-slate-500 mt-1">
              {captionStyle.outlineColor.toUpperCase()}
            </span>
          </label>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className={labelClass} htmlFor="caption-position">
              Position
            </label>
            <select
              id="caption-position"
              value={captionStyle.position}
              disabled={running}
              onChange={(event) =>
                setCaptionStyle({
                  ...captionStyle,
                  position: event.target.value as CaptionStyle['position']
                })
              }
              className="w-full bg-[#121927] border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-amber-500/60 disabled:opacity-50"
            >
              {CAPTION_POSITIONS.map((position) => (
                <option key={position} value={position}>
                  {POSITION_LABELS[position]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-[10px] font-mono uppercase tracking-wider text-slate-500">
                {captionStyle.background ? 'Box padding' : 'Outline'}
              </span>
              <span className="text-[10px] font-mono text-slate-500">
                {captionStyle.outlineWidth}px
              </span>
            </div>
            <input
              type="range"
              min={0}
              max={8}
              step={1}
              value={captionStyle.outlineWidth}
              disabled={running}
              onChange={(event) =>
                setCaptionStyle({
                  ...captionStyle,
                  outlineWidth: Number(event.target.value)
                })
              }
              className="w-full accent-amber-500 disabled:opacity-50"
            />
          </div>
        </div>

        <label
          className={`flex items-start gap-2 text-[11px] leading-relaxed ${running ? 'text-slate-500' : 'text-slate-300'}`}
        >
          <input
            type="checkbox"
            checked={captionStyle.background}
            disabled={running}
            onChange={(event) =>
              setCaptionStyle({ ...captionStyle, background: event.target.checked })
            }
            className="mt-0.5 accent-amber-500"
          />
          <span>
            Opaque caption box
            <span className="block text-[10px] text-slate-500 mt-0.5">
              Uses the outline colour as a solid box behind the text.
            </span>
          </span>
        </label>

        <div className="flex items-center gap-2 border-t border-slate-800 pt-2">
          <button
            type="button"
            onClick={() => void saveStyle()}
            disabled={running || savingStyle || !styleChanged}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-slate-700 text-[11px] text-slate-300 hover:text-amber-300 hover:border-amber-500/40 disabled:opacity-50 transition-colors"
          >
            {savingStyle ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : (
              <Save className="w-3 h-3" />
            )}
            {styleChanged ? 'Save style' : 'Style saved'}
          </button>
          <span className="text-[10px] text-slate-500 leading-snug">
            Applies to ASS downloads and burned-in captions.
          </span>
        </div>
      </div>

      <div className="flex items-center gap-2 border-t border-slate-800 pt-3">
        {running ? (
          <button
            onClick={() => void cancel()}
            disabled={cancelling}
            className="flex items-center gap-2 px-3 py-2 rounded-md border border-rose-500/40 text-rose-300 hover:bg-rose-500/10 disabled:opacity-50 text-xs font-semibold transition-colors"
          >
            {cancelling ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Square className="w-3.5 h-3.5" />
            )}
            Cancel render
          </button>
        ) : (
          <button
            onClick={() => void start()}
            disabled={!canStart}
            className="flex items-center gap-2 px-3.5 py-2 rounded-md bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-slate-950 text-xs font-semibold transition-colors"
          >
            {starting ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Play className="w-3.5 h-3.5" />
            )}
            {complete && formatChanged
              ? 'Render again'
              : render && render.completedScenes > 0 && !complete
                ? 'Resume render'
                : complete && !finalAsset
                  ? 'Render again'
                  : 'Render video'}
          </button>
        )}
        <span className="text-[10px] text-slate-500 leading-snug">
          ffmpeg runs on this machine; nothing is uploaded to a third party.
        </span>
      </div>
    </div>
  );
}
