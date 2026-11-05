import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type {
  CreatorAsset,
  CreatorProject,
  RenderAudioOptions,
  RenderJob,
  RenderPreset,
  RenderSceneState
} from '../../types/creator';
import { RENDER_PRESET_DIMENSIONS } from '../../types/creator';
import {
  CreatorError,
  assetFilePath,
  readProject,
  renderWorkingDir,
  saveFinalVideo,
  saveRenderState
} from './storage';
import { buildAssCaptions } from './publish';

const FPS = 30;
const SCENE_TIMEOUT_MS = 10 * 60 * 1000;

interface RunningRender {
  controller: AbortController;
  child: ChildProcess | null;
  done: Promise<void>;
}

const runningRenders = new Map<string, RunningRender>();

export function isRenderJobRunning(projectId: string): boolean {
  return runningRenders.has(projectId);
}

export function renderJobInfo(render: RenderJob | null) {
  if (!render) {
    return {
      status: 'idle' as const,
      running: false,
      totalScenes: 0,
      completedScenes: 0,
      message: 'No render has been started.'
    };
  }
  return {
    status: render.status,
    running: render.status === 'queued' || render.status === 'running',
    totalScenes: render.totalScenes,
    completedScenes: render.completedScenes,
    message: render.message
  };
}

function visualFor(project: CreatorProject, sceneId: string): CreatorAsset | null {
  let found: CreatorAsset | null = null;
  for (const asset of project.assets) {
    if (asset.kind === 'scene_visual' && asset.sceneId === sceneId) found = asset;
  }
  return found;
}

function sceneClipPath(projectId: string, index: number): string {
  return path.join(renderWorkingDir(projectId), `scene-${String(index + 1).padStart(2, '0')}.mp4`);
}

function scaleFilter(width: number, height: number): string {
  return [
    `scale=${width}:${height}:force_original_aspect_ratio=decrease`,
    `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black`,
    'setsar=1',
    `fps=${FPS}`
  ].join(',');
}

function sceneArgs(
  visualPath: string,
  visualMime: string,
  audioPath: string,
  durationSeconds: number,
  outputPath: string,
  width: number,
  height: number
): string[] {
  const base = ['-y', '-hide_banner', '-loglevel', 'error'];
  const videoInput =
    visualMime === 'video/mp4' || visualMime === 'video/webm'
      ? ['-stream_loop', '-1', '-i', visualPath]
      : ['-loop', '1', '-framerate', String(FPS), '-i', visualPath];

  return [
    ...base,
    ...videoInput,
    '-i',
    audioPath,
    '-t',
    durationSeconds.toFixed(3),
    '-map',
    '0:v:0',
    '-map',
    '1:a:0',
    '-vf',
    scaleFilter(width, height),
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-crf',
    '20',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    '-b:a',
    '192k',
    '-ar',
    '48000',
    '-ac',
    '2',
    '-shortest',
    '-movflags',
    '+faststart',
    outputPath
  ];
}

function runFfmpeg(
  args: string[],
  entry: RunningRender,
  label: string,
  cwd?: string
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (entry.controller.signal.aborted) {
      reject(new CreatorError('Render cancelled.', 499));
      return;
    }

    const child = spawn('ffmpeg', args, {
      stdio: ['ignore', 'ignore', 'pipe'],
      ...(cwd ? { cwd } : {})
    });
    entry.child = child;
    let stderr = '';
    let settled = false;

    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      entry.child = null;
      if (error) reject(error);
      else resolve();
    };

    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish(
        new CreatorError(
          `${label} exceeded ${Math.round(SCENE_TIMEOUT_MS / 60000)} minutes and was stopped.`,
          500
        )
      );
    }, SCENE_TIMEOUT_MS);

    child.stderr?.on('data', (chunk: Buffer) => {
      stderr = (stderr + chunk.toString()).slice(-4000);
    });

    child.on('error', (error: Error) => {
      finish(
        new CreatorError(
          `Could not start ffmpeg: ${error.message}. Install ffmpeg and make sure it is on PATH.`,
          500
        )
      );
    });

    child.on('close', (code) => {
      if (entry.controller.signal.aborted) {
        finish(new CreatorError('Render cancelled.', 499));
        return;
      }
      if (code === 0) {
        finish();
        return;
      }
      const detail = stderr.trim().split('\n').slice(-6).join(' | ');
      finish(
        new CreatorError(`${label} failed (ffmpeg exit ${code}): ${detail || 'no error output'}`, 500)
      );
    });
  });
}

interface ProbedVideo {
  durationSeconds: number;
  width: number;
  height: number;
}

function probeVideo(filePath: string): Promise<ProbedVideo> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      'ffprobe',
      [
        '-v',
        'error',
        '-print_format',
        'json',
        '-show_format',
        '-show_streams',
        filePath
      ],
      { stdio: ['ignore', 'pipe', 'pipe'] }
    );
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on('error', (error: Error) => {
      reject(new CreatorError(`Could not run ffprobe: ${error.message}`, 500));
    });
    child.on('close', (code) => {
      if (code !== 0) {
        reject(
          new CreatorError(`ffprobe rejected the output: ${stderr.trim() || `exit ${code}`}`, 500)
        );
        return;
      }
      try {
        const payload = JSON.parse(stdout);
        const videoStream = (payload.streams || []).find(
          (stream: any) => stream.codec_type === 'video'
        );
        if (!videoStream) {
          reject(new CreatorError('The rendered file has no video stream.', 500));
          return;
        }
        resolve({
          durationSeconds: Number(payload.format?.duration || 0),
          width: Number(videoStream.width || 0),
          height: Number(videoStream.height || 0)
        });
      } catch (error: any) {
        reject(new CreatorError(`Could not parse ffprobe output: ${error?.message || error}`, 500));
      }
    });
  });
}

function abortError(): CreatorError {
  return new CreatorError('Render cancelled.', 499);
}

async function runRender(
  projectId: string,
  jobId: string,
  entry: RunningRender
): Promise<void> {
  const fail = async (error: unknown) => {
    let project: CreatorProject;
    try {
      project = await readProject(projectId);
    } catch {
      return;
    }
    const render = project.render;
    if (!render || render.id !== jobId) return;

    const cancelled = entry.controller.signal.aborted || (error as any)?.status === 499;
    const now = new Date().toISOString();
    const message = cancelled
      ? 'Render cancelled. Finished scene clips are kept.'
      : error instanceof Error
        ? error.message
        : 'Unexpected render failure.';
    const scenes = { ...render.scenes };
    for (const [sceneId, scene] of Object.entries(scenes)) {
      if (scene.status === 'running') {
        scenes[sceneId] = {
          ...scene,
          status: cancelled ? 'pending' : 'failed',
          message: cancelled ? 'Cancelled; will be encoded again.' : message,
          updatedAt: now
        };
      }
    }
    await saveRenderState(
      projectId,
      {
        ...render,
        status: cancelled ? 'cancelled' : 'failed',
        message,
        error: cancelled ? undefined : message,
        finishedAt: now,
        updatedAt: now,
        scenes
      },
      cancelled ? 'assets_ready' : 'failed'
    );
  };

  try {
    const initial = await readProject(projectId);
    const script = initial.script;
    if (!script) throw new CreatorError('The project has no script.', 400);

    const total = script.scenes.length;
    const current = initial.render;
    if (!current || current.id !== jobId) throw abortError();

    const scenes: Record<string, RenderSceneState> = { ...current.scenes };
    let completed = current.completedScenes;

    for (let index = 0; index < script.scenes.length; index += 1) {
      if (entry.controller.signal.aborted) throw abortError();
      const scene = script.scenes[index];
      const previous = scenes[scene.id];
      const project = await readProject(projectId);
      const audio = project.voice.scenes[scene.id];
      const visual = visualFor(project, scene.id);
      if (!audio) throw new CreatorError(`Scene ${index + 1} has no narration audio.`, 400);
      if (!visual) throw new CreatorError(`Scene ${index + 1} has no visual.`, 400);

      const clip = sceneClipPath(projectId, index);
      const clipExists = await fs
        .stat(clip)
        .then((stat) => stat.size > 0)
        .catch(() => false);

      if (
        previous?.status === 'complete' &&
        previous.audioAssetId === audio.assetId &&
        previous.visualAssetId === visual.id &&
        clipExists
      ) {
        scenes[scene.id] = previous;
        continue;
      }

      const now = new Date().toISOString();
      scenes[scene.id] = {
        sceneId: scene.id,
        status: 'running',
        durationSeconds: audio.durationSeconds,
        message: `Encoding scene ${index + 1} of ${total}…`,
        updatedAt: now,
        audioAssetId: audio.assetId,
        visualAssetId: visual.id
      };
      await saveRenderState(projectId, {
        ...current,
        status: 'running',
        progress: Math.round((completed / total) * 100),
        completedScenes: completed,
        message: `Encoding scene ${index + 1} of ${total}…`,
        updatedAt: now,
        scenes
      });

      const { filePath: audioPath } = await assetFilePath(projectId, audio.assetId);
      const { filePath: visualPath } = await assetFilePath(projectId, visual.id);
      await fs.mkdir(renderWorkingDir(projectId), { recursive: true });
      await fs.rm(clip, { force: true });

      await runFfmpeg(
        sceneArgs(
          visualPath,
          visual.mimeType,
          audioPath,
          Math.max(0.5, audio.durationSeconds),
          clip,
          current.width,
          current.height
        ),
        entry,
        `Scene ${index + 1}`
      );

      const probe = await probeVideo(clip);
      if (!probe.durationSeconds || !probe.width) {
        throw new CreatorError(`Scene ${index + 1} produced an unreadable clip.`, 500);
      }

      completed += 1;
      scenes[scene.id] = {
        sceneId: scene.id,
        status: 'complete',
        durationSeconds: probe.durationSeconds,
        message: `Scene ${index + 1} encoded.`,
        updatedAt: new Date().toISOString(),
        audioAssetId: audio.assetId,
        visualAssetId: visual.id
      };

      await saveRenderState(projectId, {
        ...current,
        status: 'running',
        progress: Math.round((completed / total) * 100),
        completedScenes: completed,
        message: `Encoded scene ${completed} of ${total}.`,
        updatedAt: new Date().toISOString(),
        scenes
      });
    }

    if (entry.controller.signal.aborted) throw abortError();

    const ordered = script.scenes.map((scene) => scenes[scene.id]);
    if (ordered.some((scene) => !scene || scene.status !== 'complete')) {
      throw new CreatorError('Not every scene clip is complete; the final video was not built.', 500);
    }

    const working = renderWorkingDir(projectId);
    const listPath = path.join(working, 'concat.txt');
    const finalPath = path.join(working, 'final.mp4');
    const burnCaptions = current.burnCaptions === true;
    const audio = current.audio;
    const musicPath = audio.musicAssetId
      ? (await assetFilePath(projectId, audio.musicAssetId)).filePath
      : null;
    const needsAudioWork = Boolean(musicPath) || audio.normalizeAudio;
    const needsEncode = burnCaptions || needsAudioWork;
    const list = script.scenes
      .map((_scene, index) => sceneClipPath(projectId, index).replace(/'/g, `'\\''`))
      .map((filePath) => `file '${filePath}'`)
      .join('\n');
    await fs.writeFile(listPath, `${list}\n`, 'utf8');
    await fs.rm(finalPath, { force: true });

    if (burnCaptions) {
      const { ass } = buildAssCaptions(await readProject(projectId), {
        width: current.width,
        height: current.height
      });
      await fs.writeFile(path.join(working, 'captions.ass'), ass, 'utf8');
    }

    if (!needsEncode) {
      await runFfmpeg(
        [
          '-y',
          '-hide_banner',
          '-loglevel',
          'error',
          '-f',
          'concat',
          '-safe',
          '0',
          '-i',
          listPath,
          '-c',
          'copy',
          '-movflags',
          '+faststart',
          finalPath
        ],
        entry,
        'Final assembly'
      );
    } else {
      const filters: string[] = [];
      const maps: string[] = [];
      if (burnCaptions) {
        filters.push('[0:v]ass=captions.ass[v]');
        maps.push('-map', '[v]');
      } else {
        maps.push('-map', '0:v:0');
      }

      const voiceFilter =
        '[0:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo';
      if (musicPath) {
        filters.push(
          `[1:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,volume=${audio.musicVolume.toFixed(3)}[music]`,
          `${voiceFilter},asplit=2[voice][side]`,
          '[music][side]sidechaincompress=threshold=0.03:ratio=12:attack=20:release=350[ducked]',
          '[voice][ducked]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[mix]'
        );
      } else {
        filters.push(`${voiceFilter}[voice]`);
      }

      const mixLabel = musicPath ? '[mix]' : '[voice]';
      if (audio.normalizeAudio) {
        filters.push(`${mixLabel}loudnorm=I=-14:TP=-1.5:LRA=11[aout]`);
        maps.push('-map', '[aout]');
      } else {
        maps.push('-map', mixLabel);
      }

      await runFfmpeg(
        [
          '-y',
          '-hide_banner',
          '-loglevel',
          'error',
          '-f',
          'concat',
          '-safe',
          '0',
          '-i',
          listPath,
          ...(musicPath ? ['-stream_loop', '-1', '-i', musicPath] : []),
          '-filter_complex',
          filters.join(';'),
          ...maps,
          ...(burnCaptions
            ? [
                '-c:v',
                'libx264',
                '-preset',
                'veryfast',
                '-crf',
                '20',
                '-pix_fmt',
                'yuv420p'
              ]
            : ['-c:v', 'copy']),
          '-c:a',
          'aac',
          '-b:a',
          '192k',
          '-ar',
          '48000',
          '-ac',
          '2',
          '-shortest',
          '-movflags',
          '+faststart',
          finalPath
        ],
        entry,
        'Final assembly',
        burnCaptions ? working : undefined
      );
    }

    const probe = await probeVideo(finalPath);
    if (
      !probe.durationSeconds ||
      probe.width !== current.width ||
      probe.height !== current.height
    ) {
      throw new CreatorError(
        `The assembled video is not ${current.width}×${current.height} (${probe.width}×${probe.height}, ${probe.durationSeconds}s).`,
        500
      );
    }

    const project = await readProject(projectId);
    const latest = project.render;
    if (!latest || latest.id !== jobId) throw abortError();

    const { asset } = await saveFinalVideo(projectId, {
      sourcePath: finalPath,
      fileName: 'creator-video.mp4',
      durationSeconds: probe.durationSeconds,
      width: probe.width,
      height: probe.height
    });

    const finishedAt = new Date().toISOString();
    const notes: string[] = [];
    if (burnCaptions) notes.push('burned-in captions');
    if (musicPath) notes.push('background music');
    if (audio.normalizeAudio) notes.push('normalized audio');
    await saveRenderState(
      projectId,
      {
        ...latest,
        status: 'complete',
        progress: 100,
        completedScenes: total,
        totalScenes: total,
        message: `Video ready: ${total} scenes, ${probe.durationSeconds.toFixed(1)}s at ${probe.width}×${probe.height}${notes.length ? ` with ${notes.join(', ')}` : ''}.`,
        error: undefined,
        finishedAt,
        updatedAt: finishedAt,
        outputAssetId: asset.id,
        scenes
      },
      'ready'
    );
  } catch (error) {
    await fail(error);
  } finally {
    runningRenders.delete(projectId);
  }
}

export async function startRender(
  projectId: string,
  options: {
    burnCaptions?: boolean;
    preset?: RenderPreset;
    musicAssetId?: string | null;
    musicVolume?: number;
    normalizeAudio?: boolean;
  } = {}
): Promise<CreatorProject> {
  if (runningRenders.has(projectId)) {
    throw new CreatorError('A render is already running for this project.', 409);
  }

  const project = await readProject(projectId);
  const script = project.script;
  if (!script) {
    throw new CreatorError('Generate and save a script before rendering.', 400);
  }

  const missingAudio = script.scenes.filter((scene) => !project.voice.scenes[scene.id]);
  if (missingAudio.length) {
    throw new CreatorError(
      `Synthesize narration for every scene first (${missingAudio.length} missing).`,
      400
    );
  }

  const missingVisual = script.scenes.filter((scene) => !visualFor(project, scene.id));
  if (missingVisual.length) {
    throw new CreatorError(
      `Attach a visual to every scene first (${missingVisual.length} missing).`,
      400
    );
  }

  const previous = project.render;
  const audio: RenderAudioOptions = {
    musicAssetId:
      options.musicAssetId !== undefined
        ? options.musicAssetId
        : (previous?.audio?.musicAssetId ?? null),
    musicVolume: options.musicVolume ?? previous?.audio?.musicVolume ?? 0.2,
    normalizeAudio: options.normalizeAudio ?? previous?.audio?.normalizeAudio ?? true
  };

  if (audio.musicAssetId) {
    const asset = project.assets.find((item) => item.id === audio.musicAssetId);
    if (!asset) {
      throw new CreatorError('The selected music track is not part of this project.', 400);
    }
    if (asset.kind !== 'music_bed') {
      throw new CreatorError(
        'The selected audio is not a music bed. Upload it as a music track first.',
        400
      );
    }
    const { filePath } = await assetFilePath(projectId, asset.id);
    const exists = await fs
      .stat(filePath)
      .then((stat) => stat.size > 0)
      .catch(() => false);
    if (!exists) {
      throw new CreatorError(
        'The music track file is missing from the project store. Upload it again.',
        400
      );
    }
  }

  if (previous?.status === 'complete' && previous.outputAssetId) {
    const requestedPreset = options.preset ?? previous.preset;
    const requestedBurn = options.burnCaptions ?? previous.burnCaptions ?? false;
    const sameAudio =
      previous.audio.musicAssetId === audio.musicAssetId &&
      Math.abs(previous.audio.musicVolume - audio.musicVolume) < 0.0005 &&
      previous.audio.normalizeAudio === audio.normalizeAudio;
    if (
      previous.preset === requestedPreset &&
      previous.burnCaptions === requestedBurn &&
      sameAudio
    ) {
      throw new CreatorError(
        'This project already has a finished render with these settings. Change the preset, captions, audio, a scene visual or narration to regenerate.',
        409
      );
    }
  }

  const total = script.scenes.length;
  const now = new Date().toISOString();
  const preset = options.preset ?? previous?.preset ?? 'landscape';
  const { width, height } = RENDER_PRESET_DIMENSIONS[preset];
  const samePreset = previous?.width === width && previous?.height === height;
  const scenes: Record<string, RenderSceneState> = {};
  let completed = 0;
  for (let index = 0; index < script.scenes.length; index += 1) {
    const scene = script.scenes[index];
    const audio = project.voice.scenes[scene.id];
    const visual = visualFor(project, scene.id)!;
    const old = previous?.scenes[scene.id];
    const clipExists = await fs
      .stat(sceneClipPath(projectId, index))
      .then((stat) => stat.size > 0)
      .catch(() => false);
    const reusable =
      samePreset &&
      old?.status === 'complete' &&
      old.audioAssetId === audio.assetId &&
      old.visualAssetId === visual.id &&
      clipExists;
    if (reusable) {
      completed += 1;
      scenes[scene.id] = old;
    } else {
      scenes[scene.id] = {
        sceneId: scene.id,
        status: 'pending',
        durationSeconds: audio.durationSeconds,
        message: 'Waiting to encode.',
        updatedAt: now,
        audioAssetId: audio.assetId,
        visualAssetId: visual.id
      };
    }
  }

  const job: RenderJob = {
    id: randomUUID(),
    provider: 'local',
    preset,
    burnCaptions: options.burnCaptions ?? project.render?.burnCaptions ?? false,
    audio,
    status: 'queued',
    progress: Math.round((completed / total) * 100),
    completedScenes: completed,
    totalScenes: total,
    message:
      completed > 0
        ? `Resuming: ${completed} of ${total} scene clips already exist.`
        : `Queued ${total} scenes at ${width}×${height}, ${FPS}fps${audio.musicAssetId ? ' with a music bed' : ''}.`,
    startedAt: now,
    updatedAt: now,
    width,
    height,
    fps: FPS,
    scenes
  };

  const saved = await saveRenderState(projectId, job, 'rendering');

  const entry: RunningRender = {
    controller: new AbortController(),
    child: null,
    done: Promise.resolve()
  };
  runningRenders.set(projectId, entry);
  entry.done = runRender(projectId, job.id, entry).catch(() => {
    // runRender records its own failure; this only prevents an unhandled rejection.
  });

  return saved;
}

export async function cancelRender(projectId: string): Promise<CreatorProject> {
  const entry = runningRenders.get(projectId);
  if (!entry) {
    throw new CreatorError('No render is running for this project.', 409);
  }
  const project = await readProject(projectId);
  const render = project.render;
  if (!render || (render.status !== 'queued' && render.status !== 'running')) {
    throw new CreatorError('No render is running for this project.', 409);
  }

  entry.controller.abort();
  entry.child?.kill('SIGKILL');

  // Wait for the encoder loop to release its files and persist the cancelled
  // state before the request returns, so an immediate resume never races it.
  await entry.done.catch(() => {});

  const next = await readProject(projectId);
  if (next.render?.status === 'complete') {
    throw new CreatorError('The render finished before it could be cancelled.', 409);
  }
  if (next.render?.status === 'cancelled') return next;

  const now = new Date().toISOString();
  const scenes = { ...next.render!.scenes };
  for (const [sceneId, scene] of Object.entries(scenes)) {
    if (scene.status === 'running') {
      scenes[sceneId] = {
        ...scene,
        status: 'pending',
        message: 'Cancelled; will be encoded again.',
        updatedAt: now
      };
    }
  }

  return saveRenderState(
    projectId,
    {
      ...next.render!,
      status: 'cancelled',
      message: 'Render cancelled. Finished scene clips are kept.',
      finishedAt: now,
      updatedAt: now,
      scenes
    },
    'assets_ready'
  );
}
