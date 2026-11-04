import type {
  CreatorProject,
  CreatorVoiceJobInfo,
  StartVoiceJobInput
} from '../../types/creator';
import {
  CreatorError,
  parseWavInfo,
  readAssetBuffer,
  readProject,
  saveSceneAudio,
  saveVoiceState
} from './storage';

/**
 * Per-scene narration synthesis against the existing VoxCPM2 worker contract
 * (`POST /clone_voice`). Scenes are checkpointed one at a time, so a failure or
 * a restart never discards audio that already exists.
 */

const WORKER_TIMEOUT_MS = Math.max(
  30_000,
  Number(process.env.WORKER_TIMEOUT_MS) || 120_000
);

const MIN_REFERENCE_SECONDS = 3;
const MAX_REFERENCE_SECONDS = 30;

class VoiceCancelError extends Error {
  constructor() {
    super('Voice synthesis cancelled.');
    this.name = 'VoiceCancelError';
  }
}

interface RunningJob {
  controller: AbortController;
}

const runningJobs = new Map<string, RunningJob>();

export function isVoiceJobRunning(projectId: string): boolean {
  return runningJobs.has(projectId);
}

export function voiceJobInfo(project: CreatorProject): CreatorVoiceJobInfo {
  const scenes = project.script?.scenes ?? [];
  return {
    status: project.voice.status,
    totalScenes: scenes.length,
    completedScenes: scenes.filter((scene) => Boolean(project.voice.scenes[scene.id])).length,
    running: runningJobs.has(project.id),
    message: project.voice.message
  };
}

function workerHost(value: string): string {
  try {
    return new URL(value).host;
  } catch {
    return value;
  }
}

function assertWorkerUrl(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new CreatorError('Worker URL is not a valid URL.', 400);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new CreatorError('Worker URL must start with http:// or https://.', 400);
  }
  return value.replace(/\/+$/, '');
}

interface ReferenceAudio {
  assetId: string;
  base64: string;
  durationSeconds: number;
  sampleRate: number;
}

async function resolveReference(
  project: CreatorProject,
  requestedAssetId?: string
): Promise<ReferenceAudio> {
  const assetId =
    requestedAssetId ||
    project.voice.referenceAssetId ||
    project.assets.find((asset) => asset.kind === 'reference_audio')?.id;

  if (!assetId) {
    throw new CreatorError(
      'Add a 3–30 second WAV reference clip before synthesizing narration.',
      400
    );
  }

  const asset = project.assets.find((item) => item.id === assetId);
  if (!asset) throw new CreatorError('The selected reference audio asset was not found.', 404);
  if (asset.mimeType !== 'audio/wav') {
    throw new CreatorError(
      `Reference audio must be WAV (received ${asset.mimeType}). Upload a 3–30s PCM WAV.`,
      415
    );
  }

  const { buffer } = await readAssetBuffer(project.id, assetId);
  const wav = parseWavInfo(buffer);
  if (!wav) {
    throw new CreatorError(
      'The reference audio is not a readable RIFF/WAVE file. Upload a 3–30s WAV.',
      400
    );
  }
  if (wav.durationSeconds < MIN_REFERENCE_SECONDS) {
    throw new CreatorError(
      `Reference audio is ${wav.durationSeconds.toFixed(2)}s; the worker needs at least ${MIN_REFERENCE_SECONDS}s.`,
      400
    );
  }
  if (wav.durationSeconds > MAX_REFERENCE_SECONDS) {
    throw new CreatorError(
      `Reference audio is ${wav.durationSeconds.toFixed(2)}s; trim it to ${MAX_REFERENCE_SECONDS}s or less.`,
      400
    );
  }

  return {
    assetId,
    base64: buffer.toString('base64'),
    durationSeconds: wav.durationSeconds,
    sampleRate: wav.sampleRate
  };
}

interface WorkerAudio {
  audioBase64: string;
  sampleRate: number;
  model: string;
}

async function callWorker(args: {
  workerUrl: string;
  workerToken: string;
  text: string;
  language: string;
  referenceBase64: string;
  promptText: string;
  controller: AbortController;
}): Promise<WorkerAudio> {
  const endpoint = `${args.workerUrl}/clone_voice`;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (args.workerToken) headers.Authorization = `Bearer ${args.workerToken}`;

  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        text: args.text,
        language: args.language,
        reference_audio: args.referenceBase64,
        prompt_text: args.promptText,
        cfg_value: 2.0,
        inference_timesteps: 8
      }),
      signal: AbortSignal.any([
        AbortSignal.timeout(WORKER_TIMEOUT_MS),
        args.controller.signal
      ])
    });
  } catch (error: any) {
    if (args.controller.signal.aborted) throw new VoiceCancelError();
    if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
      throw new CreatorError(
        `The worker did not answer within ${Math.round(WORKER_TIMEOUT_MS / 1000)}s. ` +
          'Shorten the scene text or raise WORKER_TIMEOUT_MS, then retry.',
        504
      );
    }
    throw new CreatorError(
      `Could not reach the worker at ${workerHost(args.workerUrl)}: ${error?.message || error}. ` +
        'Start the notebook and check the tunnel URL and bearer token.',
      502
    );
  }

  const bodyText = await response.text();
  let payload: any = null;
  try {
    payload = JSON.parse(bodyText);
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const detail =
      payload?.detail || payload?.error || bodyText.slice(0, 400) || `HTTP ${response.status}`;
    if (response.status === 401) {
      throw new CreatorError(
        'The worker rejected the bearer token. Copy the token printed by the notebook and save it in the provider panel.',
        401
      );
    }
    if (response.status === 422) {
      throw new CreatorError(`The worker rejected the reference audio: ${detail}`, 422);
    }
    if (response.status === 503) {
      throw new CreatorError(`The worker is online but the model is not loaded: ${detail}`, 503);
    }
    throw new CreatorError(
      `Worker synthesis failed (HTTP ${response.status}): ${detail}`,
      502
    );
  }

  const audioBase64 = payload?.audio_base64 || payload?.audioBase64;
  if (typeof audioBase64 !== 'string' || !audioBase64) {
    throw new CreatorError('The worker returned no audio payload; nothing was stored.', 502);
  }

  return {
    audioBase64,
    sampleRate: Number(payload?.sample_rate) || 24000,
    model: String(payload?.model || 'voxcpm2')
  };
}

interface RunVoiceJobArgs {
  projectId: string;
  workerUrl: string;
  workerToken: string;
  reference: ReferenceAudio;
  promptText: string;
  language: string;
  sceneIds: string[];
  controller: AbortController;
}

async function runVoiceJob(args: RunVoiceJobArgs): Promise<void> {
  const { projectId, controller, sceneIds } = args;

  try {
    for (let index = 0; index < sceneIds.length; index += 1) {
      if (controller.signal.aborted) throw new VoiceCancelError();

      const project = await readProject(projectId);
      const scene = project.script?.scenes.find((item) => item.id === sceneIds[index]);
      if (!scene) {
        throw new CreatorError(
          `Scene ${sceneIds[index]} no longer exists in the script; voice synthesis stopped.`,
          409
        );
      }
      if (!scene.voiceText.trim()) {
        throw new CreatorError(
          `Scene ${index + 1} has no voice text. Add narration before synthesizing.`,
          400
        );
      }

      const total = project.script?.scenes.length ?? sceneIds.length;
      const stored = project.script?.scenes.filter((item) => project.voice.scenes[item.id]).length ?? 0;
      await saveVoiceState(projectId, {
        status: 'running',
        message: `Synthesizing scene ${index + 1} of ${sceneIds.length} (${stored}/${total} already stored)…`
      });

      const audio = await callWorker({
        workerUrl: args.workerUrl,
        workerToken: args.workerToken,
        text: scene.voiceText.trim(),
        language: args.language,
        referenceBase64: args.reference.base64,
        promptText: args.promptText,
        controller
      });

      const { asset } = await saveSceneAudio(projectId, scene.id, {
        dataBase64: audio.audioBase64,
        sampleRate: audio.sampleRate,
        model: audio.model,
        fileName: `scene-${scene.id}.wav`
      });

      await saveVoiceState(projectId, {
        message: `Scene ${index + 1} of ${sceneIds.length} stored (${(
          asset.durationSeconds ?? 0
        ).toFixed(2)}s).`
      });
    }

    const finalProject = await readProject(projectId);
    const scenes = finalProject.script?.scenes ?? [];
    const complete = scenes.length > 0 && scenes.every((scene) => finalProject.voice.scenes[scene.id]);
    const ready = scenes.filter((scene) => finalProject.voice.scenes[scene.id]).length;
    const totalSeconds = scenes.reduce(
      (sum, scene) => sum + (finalProject.voice.scenes[scene.id]?.durationSeconds || 0),
      0
    );

    if (!complete) {
      await saveVoiceState(projectId, {
        status: 'interrupted',
        message:
          `The script changed during synthesis: ${ready} of ${scenes.length} scenes have audio. ` +
          'Start again to synthesize the missing scenes.',
        finishedAt: new Date().toISOString()
      });
      return;
    }

    await saveVoiceState(
      projectId,
      {
        status: 'complete',
        message: `Narration ready: ${ready} of ${scenes.length} scenes, ${totalSeconds.toFixed(1)}s of audio.`,
        finishedAt: new Date().toISOString()
      },
      'voice_ready'
    );
  } catch (error) {
    const finishedAt = new Date().toISOString();
    if (error instanceof VoiceCancelError || controller.signal.aborted) {
      await saveVoiceState(projectId, {
        status: 'cancelled',
        message: 'Voice synthesis cancelled. Finished scenes are kept.',
        finishedAt
      }).catch(() => undefined);
      return;
    }
    await saveVoiceState(projectId, {
      status: 'failed',
      message: error instanceof Error ? error.message : 'Voice synthesis failed.',
      finishedAt
    }).catch(() => undefined);
  } finally {
    runningJobs.delete(projectId);
  }
}

export async function startVoiceJob(
  projectId: string,
  input: StartVoiceJobInput
): Promise<CreatorProject> {
  if (runningJobs.has(projectId)) {
    throw new CreatorError('A voice job is already running for this project.', 409);
  }

  const project = await readProject(projectId);
  if (!project.script || project.script.scenes.length === 0) {
    throw new CreatorError('Generate or write a script before synthesizing voice.', 400);
  }

  const workerUrl = assertWorkerUrl(input.workerUrl);
  const reference = await resolveReference(project, input.referenceAssetId);
  const regenerate = new Set(input.regenerateSceneIds ?? []);
  const pending = project.script.scenes.filter(
    (scene) => regenerate.has(scene.id) || !project.voice.scenes[scene.id]
  );

  if (pending.length === 0) {
    throw new CreatorError(
      'Every scene already has audio. Regenerate a specific scene instead of the whole script.',
      409
    );
  }

  const missingText = pending.find((scene) => !scene.voiceText.trim());
  if (missingText) {
    const index = project.script.scenes.findIndex((scene) => scene.id === missingText.id) + 1;
    throw new CreatorError(
      `Scene ${index} has no voice text. Add narration before synthesizing.`,
      400
    );
  }

  const controller = new AbortController();
  const startedAt = new Date().toISOString();

  await saveVoiceState(projectId, {
    status: 'queued',
    provider: input.provider,
    voiceName: input.voiceName || project.voice.voiceName || project.consent?.presenterName || '',
    referenceAssetId: reference.assetId,
    promptText: input.promptText ?? project.voice.promptText,
    message: `Queued ${pending.length} of ${project.script.scenes.length} scenes for synthesis.`,
    startedAt,
    finishedAt: null
  });

  runningJobs.set(projectId, { controller });

  void runVoiceJob({
    projectId,
    workerUrl,
    workerToken: input.workerToken || '',
    reference,
    promptText: input.promptText ?? project.voice.promptText,
    language: project.language,
    sceneIds: pending.map((scene) => scene.id),
    controller
  }).catch(() => {
    // runVoiceJob records its own failure; this guard only stops an unhandled rejection.
    runningJobs.delete(projectId);
  });

  return readProject(projectId);
}

export async function cancelVoiceJob(projectId: string): Promise<CreatorProject> {
  const job = runningJobs.get(projectId);
  if (!job) {
    throw new CreatorError('No voice job is running for this project.', 409);
  }

  job.controller.abort();
  return saveVoiceState(projectId, {
    status: 'cancelled',
    message: 'Voice synthesis cancelled. Finished scenes are kept.',
    finishedAt: new Date().toISOString()
  });
}
