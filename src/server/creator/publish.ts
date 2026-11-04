/**
 * Captions and publishing package.
 *
 * Every timestamp here is derived from the narration WAVs that actually exist
 * in the project. Nothing is estimated from word counts, and no chapter timestamp
 * is invented when a scene has not been synthesized yet.
 */
import type { CreatorProject } from '../../types/creator';
import { CreatorError, readProject } from './storage';

function formatSrtTimestamp(totalSeconds: number): string {
  const clamped = Math.max(0, totalSeconds);
  const hours = Math.floor(clamped / 3600);
  const minutes = Math.floor((clamped % 3600) / 60);
  const seconds = Math.floor(clamped % 60);
  const millis = Math.round((clamped - Math.floor(clamped)) * 1000);
  const pad = (value: number, size = 2) => String(value).padStart(size, '0');
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)},${pad(millis, 3)}`;
}

function formatChapterTimestamp(totalSeconds: number): string {
  const clamped = Math.max(0, Math.round(totalSeconds));
  const minutes = Math.floor(clamped / 60);
  const seconds = clamped % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function slugify(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return slug || 'creator-project';
}

function collapse(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function missingNarration(project: CreatorProject): string[] {
  const scenes = project.script?.scenes ?? [];
  return scenes
    .filter((scene) => !project.voice.scenes[scene.id])
    .map((scene) => scene.id);
}

export interface CaptionPackage {
  srt: string;
  cueCount: number;
  durationSeconds: number;
  fileName: string;
}

interface CaptionCue {
  start: number;
  end: number;
  text: string;
}

interface CaptionCues {
  cues: CaptionCue[];
  durationSeconds: number;
}

function collectCues(project: CreatorProject): CaptionCues {
  const script = project.script;
  if (!script) {
    throw new CreatorError('Generate a script before exporting captions.', 400);
  }

  const missing = missingNarration(project);
  if (missing.length) {
    throw new CreatorError(
      `Synthesize narration for every scene before exporting captions (${missing.length} missing).`,
      400
    );
  }

  let cursor = 0;
  const cues: CaptionCue[] = [];
  script.scenes.forEach((scene) => {
    const audio = project.voice.scenes[scene.id];
    const start = cursor;
    const end = cursor + audio.durationSeconds;
    cursor = end;
    cues.push({
      start,
      end,
      text: collapse(scene.subtitle || scene.voiceText)
    });
  });

  return { cues, durationSeconds: cursor };
}

export function buildCaptions(project: CreatorProject): CaptionPackage {
  const { cues, durationSeconds } = collectCues(project);
  const srt = cues
    .map(
      (cue, index) =>
        `${index + 1}\n${formatSrtTimestamp(cue.start)} --> ${formatSrtTimestamp(cue.end)}\n${cue.text}\n`
    )
    .join('\n');

  return {
    srt,
    cueCount: cues.length,
    durationSeconds,
    fileName: `${slugify(project.topic)}.srt`
  };
}

function formatAssTimestamp(totalSeconds: number): string {
  const hundredths = Math.max(0, Math.round(totalSeconds * 100));
  const hours = Math.floor(hundredths / 360000);
  const minutes = Math.floor((hundredths % 360000) / 6000);
  const seconds = Math.floor((hundredths % 6000) / 100);
  const centis = hundredths % 100;
  const pad = (value: number, size = 2) => String(value).padStart(size, '0');
  return `${hours}:${pad(minutes)}:${pad(seconds)}.${pad(centis)}`;
}

function assFontFor(project: CreatorProject): string {
  if (project.language === 'bn-IN') return 'Noto Sans Bengali';
  if (project.language === 'hi-IN') return 'Noto Sans Devanagari';
  return 'DejaVu Sans';
}

function escapeAssText(value: string): string {
  // Braces open ASS override blocks; newlines would split the Dialogue line.
  return collapse(value).replace(/\{/g, '(').replace(/\}/g, ')');
}

export interface AssCaptionPackage {
  ass: string;
  cueCount: number;
  durationSeconds: number;
  fileName: string;
}

export interface AssCaptionOptions {
  width?: number;
  height?: number;
}

export function buildAssCaptions(
  project: CreatorProject,
  options: AssCaptionOptions = {}
): AssCaptionPackage {
  const { cues, durationSeconds } = collectCues(project);
  const font = assFontFor(project);
  const width = Math.round(options.width || 1280);
  const height = Math.round(options.height || 720);
  const fontSize = Math.max(28, Math.round(Math.min(width, height) / 16.36));
  const marginH = Math.max(24, Math.round(width * 0.055));
  const marginV = Math.max(24, Math.round(height * 0.067));
  const lines = [
    '[Script Info]',
    'ScriptType: v4.00+',
    'WrapStyle: 2',
    'ScaledBorderAndShadow: yes',
    `PlayResX: ${width}`,
    `PlayResY: ${height}`,
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    `Style: VoxIndica,${font},${fontSize},&H00FFFFFF,&H000000FF,&H00000000,&H64000000,0,0,0,0,100,100,0,0,1,3,1,2,${marginH},${marginH},${marginV},1`,
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text'
  ];

  for (const cue of cues) {
    lines.push(
      `Dialogue: 0,${formatAssTimestamp(cue.start)},${formatAssTimestamp(cue.end)},VoxIndica,,0,0,0,,${escapeAssText(cue.text)}`
    );
  }

  return {
    ass: `${lines.join('\n')}\n`,
    cueCount: cues.length,
    durationSeconds,
    fileName: `${slugify(project.topic)}.ass`
  };
}

export interface PublishingPackage {
  markdown: string;
  fileName: string;
  chaptersAvailable: boolean;
  chapterCount: number;
  durationSeconds: number | null;
}

export function buildPublishingPackage(project: CreatorProject): PublishingPackage {
  const script = project.script;
  if (!script) {
    throw new CreatorError('Generate a script before exporting a publishing package.', 400);
  }

  const complete = missingNarration(project).length === 0;
  let cursor = 0;
  const chapters: { timestamp: string; title: string }[] = [];

  if (complete) {
    script.scenes.forEach((scene, index) => {
      const audio = project.voice.scenes[scene.id];
      const planned = script.chapters[index]?.title?.trim();
      chapters.push({
        timestamp: formatChapterTimestamp(cursor),
        title: planned || collapse(scene.subtitle) || `Scene ${index + 1}`
      });
      cursor += audio.durationSeconds;
    });
  }

  const lines: string[] = [
    `# ${script.title}`,
    '',
    '## Description',
    '',
    script.description || '_No description was written for this script._',
    '',
    '## Tags',
    '',
    script.tags.length ? script.tags.join(', ') : '_None_',
    '',
    '## Hashtags',
    '',
    script.hashtags.length ? script.hashtags.join(' ') : '_None_',
    '',
    '## Chapters',
    ''
  ];

  if (complete) {
    for (const chapter of chapters) {
      lines.push(`- ${chapter.timestamp} — ${chapter.title}`);
    }
  } else {
    lines.push(
      '_Chapters are generated from real scene narration timings. Synthesize every scene, then export again — no timestamps are estimated._'
    );
  }

  lines.push(
    '',
    '## Thumbnail prompt',
    '',
    script.thumbnailPrompt || '_None_',
    '',
    '## AI disclosure',
    '',
    script.disclosure || '_No disclosure was written for this script._',
    '',
    '## Sources',
    '',
    ...(script.sources.length ? script.sources.map((source) => `- ${source}`) : ['_None supplied_']),
    '',
    '## Captions',
    '',
    complete
      ? `SRT available: ${script.scenes.length} cues covering ${cursor.toFixed(2)} seconds of synthesized narration.`
      : 'SRT becomes available after every scene has synthesized narration.',
    ''
  );

  return {
    markdown: lines.join('\n'),
    fileName: `${slugify(project.topic)}-publishing.md`,
    chaptersAvailable: complete,
    chapterCount: chapters.length,
    durationSeconds: complete ? cursor : null
  };
}

export async function captionsForProject(projectId: string): Promise<CaptionPackage> {
  return buildCaptions(await readProject(projectId));
}

export async function assCaptionsForProject(
  projectId: string,
  options: AssCaptionOptions = {}
): Promise<AssCaptionPackage> {
  const project = await readProject(projectId);
  return buildAssCaptions(project, {
    width: options.width ?? project.render?.width,
    height: options.height ?? project.render?.height
  });
}

export async function publishingForProject(projectId: string): Promise<PublishingPackage> {
  return buildPublishingPackage(await readProject(projectId));
}
