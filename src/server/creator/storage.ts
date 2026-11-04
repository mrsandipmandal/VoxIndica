import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type {
  ConsentRecord,
  CreateProjectInput,
  CreatorAsset,
  CreatorAssetKind,
  CreatorProject,
  CreatorProjectStatus,
  CreatorProjectSummary,
  CreatorSceneAudio,
  CreatorVoiceState,
  RenderJob,
  ScriptContent,
  UpdateProjectInput
} from '../../types/creator';

const DATA_ROOT = path.resolve(
  process.env.VOXINDICA_CREATOR_DATA_DIR || path.join(process.cwd(), 'data', 'projects')
);

const MAX_ASSET_BYTES = 30 * 1024 * 1024;

const MIME_EXTENSIONS: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'audio/wav': '.wav',
  'audio/x-wav': '.wav',
  'audio/mpeg': '.mp3',
  'audio/mp4': '.m4a',
  'audio/webm': '.webm',
  'audio/ogg': '.ogg',
  'video/mp4': '.mp4',
  'video/webm': '.webm'
};

export class CreatorError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = 'CreatorError';
    this.status = status;
  }
}

export function creatorDataRoot(): string {
  return DATA_ROOT;
}

function assertProjectId(id: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    throw new CreatorError('Invalid project id.', 400);
  }
  return id;
}

function projectDir(id: string): string {
  const safe = assertProjectId(id);
  const resolved = path.resolve(DATA_ROOT, safe);
  if (!resolved.startsWith(DATA_ROOT + path.sep)) {
    throw new CreatorError('Invalid project path.', 400);
  }
  return resolved;
}

function projectFile(id: string): string {
  return path.join(projectDir(id), 'project.json');
}

function assetsDir(id: string): string {
  return path.join(projectDir(id), 'assets');
}

export function renderWorkingDir(id: string): string {
  return path.join(projectDir(id), 'render');
}

export function defaultVoiceState(): CreatorVoiceState {
  return {
    status: 'idle',
    provider: null,
    voiceName: '',
    referenceAssetId: null,
    promptText: '',
    scenes: {},
    message: '',
    startedAt: null,
    finishedAt: null,
    updatedAt: new Date(0).toISOString()
  };
}

/**
 * Projects written before the voice stage have no `voice` key. Normalize on
 * read so the API never hands the browser a half-shaped document.
 */
function normalizeProject(raw: CreatorProject): CreatorProject {
  return {
    ...raw,
    assets: Array.isArray(raw.assets) ? raw.assets : [],
    script: raw.script ?? null,
    consent: raw.consent ?? null,
    render: raw.render
      ? {
          ...raw.render,
          preset: raw.render.preset ?? 'landscape',
          burnCaptions: raw.render.burnCaptions === true
        }
      : null,
    voice: {
      ...defaultVoiceState(),
      ...(raw.voice || {}),
      scenes: raw.voice?.scenes && typeof raw.voice.scenes === 'object' ? raw.voice.scenes : {}
    }
  };
}

async function atomicWriteJson(file: string, value: unknown): Promise<void> {
  const tmp = `${file}.${process.pid}.${randomUUID()}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(value, null, 2), 'utf8');
  await fs.rename(tmp, file);
}

function toSummary(project: CreatorProject): CreatorProjectSummary {
  return {
    id: project.id,
    topic: project.topic,
    language: project.language,
    tone: project.tone,
    videoMode: project.videoMode,
    targetDurationSeconds: project.targetDurationSeconds,
    status: project.status,
    hasScript: Boolean(project.script),
    updatedAt: project.updatedAt,
    createdAt: project.createdAt
  };
}

export async function listProjects(): Promise<CreatorProjectSummary[]> {
  let entries: string[] = [];
  try {
    entries = await fs.readdir(DATA_ROOT);
  } catch (error: any) {
    if (error?.code === 'ENOENT') return [];
    throw new CreatorError(`Could not read the project store: ${error?.message || error}`, 500);
  }

  const projects: CreatorProject[] = [];
  for (const entry of entries) {
    if (!/^[0-9a-f-]{36}$/i.test(entry)) continue;
    try {
      const raw = await fs.readFile(path.join(DATA_ROOT, entry, 'project.json'), 'utf8');
      projects.push(normalizeProject(JSON.parse(raw) as CreatorProject));
    } catch {
      // A partially written or foreign directory is skipped, not fatal.
    }
  }

  return projects
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .map(toSummary);
}

export async function readProject(id: string): Promise<CreatorProject> {
  try {
    const raw = await fs.readFile(projectFile(id), 'utf8');
    return normalizeProject(JSON.parse(raw) as CreatorProject);
  } catch (error: any) {
    if (error?.code === 'ENOENT') throw new CreatorError('Project not found.', 404);
    if (error instanceof CreatorError) throw error;
    throw new CreatorError(`Could not read project: ${error?.message || error}`, 500);
  }
}

export async function createProject(input: CreateProjectInput): Promise<CreatorProject> {
  const id = randomUUID();
  const now = new Date().toISOString();
  const project: CreatorProject = {
    id,
    topic: input.topic,
    language: input.language,
    tone: input.tone,
    audience: input.audience || '',
    targetDurationSeconds: input.targetDurationSeconds,
    videoMode: input.videoMode,
    status: 'draft',
    extraInstructions: input.extraInstructions || '',
    createdAt: now,
    updatedAt: now,
    script: null,
    consent: null,
    assets: [],
    voice: defaultVoiceState(),
    render: null
  };

  await fs.mkdir(assetsDir(id), { recursive: true });
  await atomicWriteJson(projectFile(id), project);
  return project;
}

export async function updateProject(
  id: string,
  patch: UpdateProjectInput
): Promise<CreatorProject> {
  const current = await readProject(id);
  const { script: scriptPatch, status: statusPatch, ...metaPatch } = patch;
  const next: CreatorProject = {
    ...current,
    ...metaPatch,
    id: current.id,
    createdAt: current.createdAt,
    updatedAt: new Date().toISOString(),
    status: statusPatch ?? current.status,
    script: current.script
  };

  if (scriptPatch === null) {
    next.script = null;
    if (next.status !== 'failed') next.status = 'draft';
  } else if (scriptPatch) {
    next.script = {
      ...scriptPatch,
      meta: current.script?.meta ?? {
        provider: 'manual',
        model: 'manual edit',
        generatedAt: new Date().toISOString(),
        latencyMs: 0
      }
    };
    if (!statusPatch && next.status === 'draft') next.status = 'script_ready';
  }

  await atomicWriteJson(projectFile(id), next);
  return next;
}

export async function deleteProject(id: string): Promise<void> {
  await fs.rm(projectDir(id), { recursive: true, force: true });
}

function sanitizeFileName(name: string): string {
  const cleaned = path.basename(name).replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80);
  return cleaned && cleaned !== '.' && cleaned !== '..' ? cleaned : 'asset.bin';
}

export interface WavInfo {
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
  audioFormat: number;
  durationSeconds: number;
}

/**
 * Minimal RIFF/WAVE header reader. Returns null for anything that is not a
 * parseable WAV, so callers can reject a file instead of guessing.
 */
export function parseWavInfo(buffer: Buffer): WavInfo | null {
  if (buffer.length < 44) return null;
  if (buffer.toString('ascii', 0, 4) !== 'RIFF') return null;
  if (buffer.toString('ascii', 8, 12) !== 'WAVE') return null;

  let offset = 12;
  let fmt: {
    audioFormat: number;
    channels: number;
    sampleRate: number;
    byteRate: number;
    bitsPerSample: number;
  } | null = null;
  let dataSize = 0;

  while (offset + 8 <= buffer.length) {
    const id = buffer.toString('ascii', offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    const body = offset + 8;
    if (id === 'fmt ' && size >= 16 && body + 16 <= buffer.length) {
      fmt = {
        audioFormat: buffer.readUInt16LE(body),
        channels: buffer.readUInt16LE(body + 2),
        sampleRate: buffer.readUInt32LE(body + 4),
        byteRate: buffer.readUInt32LE(body + 8),
        bitsPerSample: buffer.readUInt16LE(body + 14)
      };
    } else if (id === 'data') {
      dataSize = Math.min(size, buffer.length - body);
    }
    offset = body + size + (size % 2);
    if (dataSize && fmt) break;
  }

  if (!fmt || !dataSize || !fmt.byteRate) return null;
  return {
    ...fmt,
    durationSeconds: dataSize / fmt.byteRate
  };
}

export async function readAssetBuffer(
  projectId: string,
  assetId: string
): Promise<{ buffer: Buffer; asset: CreatorAsset }> {
  const { filePath, asset } = await assetFilePath(projectId, assetId);
  return { buffer: await fs.readFile(filePath), asset };
}

export async function saveAsset(
  projectId: string,
  input: {
    kind: CreatorAssetKind;
    fileName: string;
    mimeType: string;
    dataBase64: string;
    sceneId?: string;
    generatedBy?: string;
  }
): Promise<{ project: CreatorProject; asset: CreatorAsset }> {
  const project = await readProject(projectId);
  const mime = input.mimeType.toLowerCase();

  if (input.kind === 'scene_audio') {
    throw new CreatorError('Scene audio is written by the voice stage, not uploaded.', 400);
  }
  if (input.kind === 'final_video') {
    throw new CreatorError('The final video is written by the render stage, not uploaded.', 400);
  }
  if (input.kind === 'scene_visual') {
    if (!input.sceneId) {
      throw new CreatorError('A scene visual needs the sceneId it belongs to.', 400);
    }
    if (!project.script?.scenes.some((scene) => scene.id === input.sceneId)) {
      throw new CreatorError('That scene does not exist in the saved script.', 400);
    }
    if (!mime.startsWith('image/') && mime !== 'video/mp4' && mime !== 'video/webm') {
      throw new CreatorError('Scene visuals must be PNG, JPEG, WebP, MP4 or WebM.', 415);
    }
  }

  const extension = MIME_EXTENSIONS[mime];
  if (!extension) {
    throw new CreatorError(
      `Unsupported asset type "${input.mimeType}". Use PNG, JPEG, WebP, WAV, MP3, M4A, OGG, WebM or MP4.`,
      415
    );
  }

  const raw = input.dataBase64.replace(/^data:[^;]+;base64,/, '');
  let buffer: Buffer;
  try {
    buffer = Buffer.from(raw, 'base64');
  } catch {
    throw new CreatorError('Asset payload is not valid base64.', 400);
  }
  if (!buffer.length) throw new CreatorError('Asset payload is empty.', 400);
  if (buffer.length > MAX_ASSET_BYTES) {
    throw new CreatorError('Asset is larger than 30 MB.', 413);
  }

  const assetId = randomUUID();
  const safeName = sanitizeFileName(input.fileName);
  const storedName = `${assetId}${extension}`;
  await fs.mkdir(assetsDir(projectId), { recursive: true });
  await fs.writeFile(path.join(assetsDir(projectId), storedName), buffer);

  const wav = extension === '.wav' ? parseWavInfo(buffer) : null;
  const asset: CreatorAsset = {
    id: assetId,
    kind: input.kind,
    fileName: safeName,
    mimeType: mime,
    sizeBytes: buffer.length,
    createdAt: new Date().toISOString(),
    ...(input.sceneId ? { sceneId: input.sceneId } : {}),
    ...(input.generatedBy ? { generatedBy: input.generatedBy } : {}),
    ...(wav ? { durationSeconds: Math.round(wav.durationSeconds * 100) / 100 } : {})
  };

  if (input.kind === 'scene_visual' && input.sceneId) {
    const previous = project.assets.filter(
      (item) => item.kind === 'scene_visual' && item.sceneId === input.sceneId
    );
    project.assets = project.assets.filter(
      (item) => !(item.kind === 'scene_visual' && item.sceneId === input.sceneId)
    );
    for (const old of previous) {
      const oldExtension = MIME_EXTENSIONS[old.mimeType] || path.extname(old.fileName);
      await fs.rm(path.join(assetsDir(projectId), `${old.id}${oldExtension}`), { force: true });
    }
  }

  project.assets.push(asset);
  project.updatedAt = asset.createdAt;
  if (input.kind === 'scene_visual') {
    // A changed visual invalidates a previous final render's readiness.
    if (project.status === 'ready') project.status = 'assets_ready';
  } else {
    project.status =
      project.status === 'draft' || project.status === 'script_ready'
        ? 'assets_ready'
        : project.status;
  }
  await atomicWriteJson(projectFile(projectId), project);
  return { project, asset };
}

/**
 * Checkpoint one synthesized scene. The previous take for the same scene is
 * removed only after the new WAV has been parsed and written, so a failed
 * regeneration never destroys the working audio.
 */
export async function saveSceneAudio(
  projectId: string,
  sceneId: string,
  input: { dataBase64: string; sampleRate: number; model: string; fileName: string }
): Promise<{ project: CreatorProject; asset: CreatorAsset; scene: CreatorSceneAudio }> {
  const project = await readProject(projectId);
  const raw = input.dataBase64.replace(/^data:[^;]+;base64,/, '');
  const buffer = Buffer.from(raw, 'base64');
  if (!buffer.length) throw new CreatorError('The worker returned an empty audio payload.', 502);
  if (buffer.length > MAX_ASSET_BYTES) {
    throw new CreatorError('Synthesized scene audio is larger than 30 MB.', 502);
  }

  const wav = parseWavInfo(buffer);
  if (!wav) {
    throw new CreatorError(
      'The worker returned audio that is not a RIFF/WAVE file; it was not stored.',
      502
    );
  }

  const previous = project.voice.scenes[sceneId];
  const assetId = randomUUID();
  const storedName = `${assetId}.wav`;
  await fs.mkdir(assetsDir(projectId), { recursive: true });
  await fs.writeFile(path.join(assetsDir(projectId), storedName), buffer);

  if (previous) {
    project.assets = project.assets.filter((item) => item.id !== previous.assetId);
    await fs.rm(path.join(assetsDir(projectId), `${previous.assetId}.wav`), { force: true });
  }

  const now = new Date().toISOString();
  const asset: CreatorAsset = {
    id: assetId,
    kind: 'scene_audio',
    sceneId,
    fileName: sanitizeFileName(input.fileName),
    mimeType: 'audio/wav',
    sizeBytes: buffer.length,
    durationSeconds: Math.round(wav.durationSeconds * 100) / 100,
    createdAt: now
  };
  const scene: CreatorSceneAudio = {
    sceneId,
    assetId,
    durationSeconds: asset.durationSeconds || 0,
    sampleRate: wav.sampleRate || input.sampleRate,
    model: input.model,
    createdAt: now
  };

  project.assets.push(asset);
  project.voice.scenes[sceneId] = scene;
  project.voice.updatedAt = now;
  project.updatedAt = now;
  await atomicWriteJson(projectFile(projectId), project);
  return { project, asset, scene };
}

export async function assetFilePath(
  projectId: string,
  assetId: string
): Promise<{ filePath: string; asset: CreatorAsset }> {
  const project = await readProject(projectId);
  const asset = project.assets.find((item) => item.id === assetId);
  if (!asset) throw new CreatorError('Asset not found.', 404);
  const extension = MIME_EXTENSIONS[asset.mimeType] || path.extname(asset.fileName);
  const filePath = path.join(assetsDir(projectId), `${asset.id}${extension}`);
  return { filePath, asset };
}

export async function saveVoiceState(
  projectId: string,
  patch: Partial<CreatorVoiceState>,
  projectStatus?: CreatorProjectStatus
): Promise<CreatorProject> {
  const project = await readProject(projectId);
  const now = new Date().toISOString();
  project.voice = {
    ...project.voice,
    ...patch,
    scenes: patch.scenes ?? project.voice.scenes,
    updatedAt: now
  };
  if (projectStatus) project.status = projectStatus;
  project.updatedAt = now;
  await atomicWriteJson(projectFile(projectId), project);
  return project;
}

/**
 * A server restart kills in-process voice jobs. Any project still marked
 * queued/running is therefore stale; mark it interrupted so the UI never shows
 * fake progress. Completed scene audio stays on disk and is resumed on demand.
 */
export async function recoverInterruptedVoiceJobs(): Promise<number> {
  let entries: string[] = [];
  try {
    entries = await fs.readdir(DATA_ROOT);
  } catch {
    return 0;
  }

  let recovered = 0;
  for (const entry of entries) {
    if (!/^[0-9a-f-]{36}$/i.test(entry)) continue;
    try {
      const project = await readProject(entry);
      if (project.voice.status !== 'queued' && project.voice.status !== 'running') continue;
      await saveVoiceState(entry, {
        status: 'interrupted',
        message:
          'The server restarted while voice synthesis was running. Finished scenes are kept; start again to resume from the next scene.',
        finishedAt: new Date().toISOString()
      });
      recovered += 1;
    } catch {
      // A broken project directory is not this recovery pass's problem.
    }
  }
  return recovered;
}

/**
 * Persist render progress. The render job object is the checkpoint: every
 * completed scene listed here has a clip on disk in `render/`.
 */
export async function saveRenderState(
  projectId: string,
  render: RenderJob | null,
  projectStatus?: CreatorProjectStatus
): Promise<CreatorProject> {
  const project = await readProject(projectId);
  const now = new Date().toISOString();
  project.render = render;
  if (projectStatus) project.status = projectStatus;
  project.updatedAt = now;
  await atomicWriteJson(projectFile(projectId), project);
  return project;
}

/**
 * Move a finished render into the asset store. The previous final video is
 * removed only after the new file is in place, so a failed encode never
 * destroys the last working render.
 */
export async function saveFinalVideo(
  projectId: string,
  input: {
    sourcePath: string;
    fileName: string;
    durationSeconds: number;
    width: number;
    height: number;
  }
): Promise<{ project: CreatorProject; asset: CreatorAsset }> {
  const project = await readProject(projectId);
  const assetId = randomUUID();
  const storedName = `${assetId}.mp4`;
  await fs.mkdir(assetsDir(projectId), { recursive: true });
  const destination = path.join(assetsDir(projectId), storedName);

  try {
    await fs.rename(input.sourcePath, destination);
  } catch {
    await fs.copyFile(input.sourcePath, destination);
    await fs.rm(input.sourcePath, { force: true });
  }

  const previous = project.assets.filter((item) => item.kind === 'final_video');
  project.assets = project.assets.filter((item) => item.kind !== 'final_video');
  for (const old of previous) {
    await fs.rm(path.join(assetsDir(projectId), `${old.id}.mp4`), { force: true });
  }

  const now = new Date().toISOString();
  const asset: CreatorAsset = {
    id: assetId,
    kind: 'final_video',
    fileName: sanitizeFileName(input.fileName),
    mimeType: 'video/mp4',
    sizeBytes: (await fs.stat(destination)).size,
    durationSeconds: Math.round(input.durationSeconds * 100) / 100,
    createdAt: now
  };
  project.assets.push(asset);
  project.updatedAt = now;
  project.status = 'ready';
  await atomicWriteJson(projectFile(projectId), project);
  return { project, asset };
}

/**
 * A server restart kills in-process render jobs. Mark stale jobs interrupted
 * without touching scene clips, so the next run resumes at the first missing
 * scene.
 */
export async function recoverInterruptedRenderJobs(): Promise<number> {
  let entries: string[] = [];
  try {
    entries = await fs.readdir(DATA_ROOT);
  } catch {
    return 0;
  }

  let recovered = 0;
  for (const entry of entries) {
    if (!/^[0-9a-f-]{36}$/i.test(entry)) continue;
    try {
      const project = await readProject(entry);
      const render = project.render;
      if (!render || (render.status !== 'queued' && render.status !== 'running')) continue;
      const scenes = { ...render.scenes };
      for (const [sceneId, scene] of Object.entries(scenes)) {
        if (scene.status === 'running') {
          scenes[sceneId] = {
            ...scene,
            status: 'pending',
            message: 'Interrupted by a server restart; will be encoded again.',
            updatedAt: new Date().toISOString()
          };
        }
      }
      await saveRenderState(entry, {
        ...render,
        status: 'interrupted',
        scenes,
        message:
          'The server restarted while rendering. Finished scene clips are kept; start again to resume.',
        finishedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });
      recovered += 1;
    } catch {
      // A broken project directory is not this recovery pass's problem.
    }
  }
  return recovered;
}

export async function saveConsent(
  projectId: string,
  input: { presenterName: string; confirmed: boolean; notes: string }
): Promise<CreatorProject> {
  const project = await readProject(projectId);
  const consent: ConsentRecord = {
    presenterName: input.presenterName,
    confirmed: input.confirmed,
    confirmedAt: new Date().toISOString(),
    notes: input.notes
  };
  const next = {
    ...project,
    consent,
    updatedAt: consent.confirmedAt
  };
  await atomicWriteJson(projectFile(projectId), next);
  return next;
}

function renderScriptMarkdown(project: CreatorProject): string {
  const script = project.script;
  if (!script) return `# ${project.topic}\n\nNo script generated yet.\n`;

  const lines: string[] = [
    `# ${script.title}`,
    '',
    `**Topic:** ${project.topic}`,
    `**Language:** ${project.language}`,
    `**Tone:** ${project.tone}`,
    `**Duration:** ${project.targetDurationSeconds}s`,
    `**Mode:** ${project.videoMode}`,
    `**Generated by:** ${script.meta.provider} / ${script.meta.model}`,
    '',
    '## Hook',
    '',
    script.hook,
    '',
    '## Script',
    '',
    script.script,
    '',
    '## Scenes',
    ''
  ];

  script.scenes.forEach((scene, index) => {
    lines.push(
      `### Scene ${index + 1} — ${scene.durationSeconds}s`,
      '',
      `**Voice:** ${scene.voiceText}`,
      '',
      `**Visual:** ${scene.visualPrompt}`,
      '',
      `**Camera:** ${scene.camera} · **Type:** ${scene.videoType} · **Transition:** ${scene.transition}`,
      '',
      scene.subtitle ? `**Subtitle:** ${scene.subtitle}\n` : ''
    );
  });

  lines.push(
    '## Publishing package',
    '',
    `**Description:** ${script.description}`,
    '',
    `**Tags:** ${script.tags.join(', ')}`,
    `**Hashtags:** ${script.hashtags.join(' ')}`,
    '',
    '**Chapters:**',
    ...script.chapters.map((chapter) => `- ${chapter.timestamp} — ${chapter.title}`),
    '',
    `**Thumbnail prompt:** ${script.thumbnailPrompt}`,
    '',
    `**Disclosure:** ${script.disclosure}`,
    '',
    '**Sources:**',
    ...(script.sources.length ? script.sources.map((source) => `- ${source}`) : ['- None supplied']),
    ''
  );

  return lines.join('\n');
}

function slugify(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return slug || 'creator-project';
}

export async function exportProjectZip(
  id: string
): Promise<{ buffer: Buffer; fileName: string }> {
  const project = await readProject(id);
  const module: any = await import('jszip');
  const JSZip = module.default ?? module;
  const zip = new JSZip();

  zip.file('project.json', JSON.stringify(project, null, 2));
  zip.file('script.md', renderScriptMarkdown(project));

  // Captions and the publishing pack are derived from stored narration. They are
  // added only when the data they need exists; the records themselves are never
  // synthesized for the archive.
  try {
    const { buildCaptions, buildAssCaptions } = await import('./publish');
    const captions = buildCaptions(project);
    zip.file(captions.fileName, captions.srt);
    const ass = buildAssCaptions(project);
    zip.file(ass.fileName, ass.ass);
  } catch {
    // Narration is incomplete; no caption files are added.
  }
  try {
    const { buildPublishingPackage } = await import('./publish');
    const publishing = buildPublishingPackage(project);
    zip.file(publishing.fileName, publishing.markdown);
  } catch {
    // No script; no publishing pack is added.
  }
  if (project.consent) {
    zip.file('consent.json', JSON.stringify(project.consent, null, 2));
  }

  for (const asset of project.assets) {
    try {
      const extension = MIME_EXTENSIONS[asset.mimeType] || path.extname(asset.fileName);
      const filePath = path.join(assetsDir(id), `${asset.id}${extension}`);
      const name =
        asset.kind === 'scene_audio' && asset.sceneId
          ? `scene-${asset.sceneId}.wav`
          : asset.kind === 'scene_visual' && asset.sceneId
            ? `visual-${asset.sceneId}${extension}`
            : asset.kind === 'final_video'
              ? `final-video.mp4`
              : asset.fileName;
      zip.file(`assets/${name}`, await fs.readFile(filePath));
    } catch {
      // Missing asset files do not abort the export.
    }
  }

  const buffer: Buffer = await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 }
  });

  return {
    buffer,
    fileName: `${slugify(project.topic)}-${project.id.slice(0, 8)}.zip`
  };
}

export function stripScriptMeta(content: ScriptContent): ScriptContent {
  return {
    title: content.title,
    hook: content.hook,
    script: content.script,
    scenes: content.scenes,
    description: content.description,
    tags: content.tags,
    hashtags: content.hashtags,
    chapters: content.chapters,
    thumbnailPrompt: content.thumbnailPrompt,
    sources: content.sources,
    disclosure: content.disclosure
  };
}
