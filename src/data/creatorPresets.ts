import type {
  CreatorLanguage,
  CreatorProjectStatus,
  CreatorTone,
  CreatorVideoMode
} from '../types/creator';

export interface CreatorOption<T extends string> {
  id: T;
  label: string;
  description: string;
}

export const CREATOR_LANGUAGE_OPTIONS: CreatorOption<CreatorLanguage>[] = [
  { id: 'bn-IN', label: 'Bengali', description: 'Bangla narration and captions' },
  { id: 'hi-IN', label: 'Hindi', description: 'Hindi narration and captions' },
  { id: 'en-IN', label: 'English (India)', description: 'Indian English narration' }
];

export const CREATOR_TONE_OPTIONS: CreatorOption<CreatorTone>[] = [
  { id: 'news', label: 'News', description: 'Factual, tight, attributable' },
  { id: 'educational', label: 'Educational', description: 'One idea per scene, plain words' },
  { id: 'documentary', label: 'Documentary', description: 'Measured, atmospheric, contextual' },
  { id: 'tech', label: 'Tech explainer', description: 'Precise terms, defined clearly' },
  { id: 'travel', label: 'Travel', description: 'Sensory detail and practical tips' },
  { id: 'storytelling', label: 'Storytelling', description: 'Tension, detail, emotional payoff' }
];

export const CREATOR_MODE_OPTIONS: CreatorOption<CreatorVideoMode>[] = [
  { id: 'presenter', label: 'AI presenter', description: 'A consented presenter speaks to camera' },
  { id: 'cinematic', label: 'Cinematic B-roll', description: 'No presenter; generated scenes and narration' },
  { id: 'hybrid', label: 'Hybrid', description: 'Presenter plus B-roll cutaways' }
];

export const CREATOR_DURATION_OPTIONS = [30, 60, 90, 120, 180] as const;

export const CREATOR_STATUS_LABELS: Record<CreatorProjectStatus, string> = {
  draft: 'Draft',
  script_ready: 'Script ready',
  voice_ready: 'Voice ready',
  assets_ready: 'Assets ready',
  rendering: 'Rendering',
  ready: 'Ready',
  failed: 'Failed'
};

export const CREATOR_STATUS_STYLES: Record<CreatorProjectStatus, string> = {
  draft: 'bg-slate-800/80 text-slate-300 border-slate-700',
  script_ready: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  voice_ready: 'bg-sky-500/15 text-sky-300 border-sky-500/30',
  assets_ready: 'bg-violet-500/15 text-violet-300 border-violet-500/30',
  rendering: 'bg-orange-500/15 text-orange-300 border-orange-500/30',
  ready: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  failed: 'bg-rose-500/15 text-rose-300 border-rose-500/30'
};

export const DEFAULT_CREATOR_LANGUAGE: CreatorLanguage = 'bn-IN';
export const DEFAULT_CREATOR_TONE: CreatorTone = 'news';
export const DEFAULT_CREATOR_MODE: CreatorVideoMode = 'presenter';
export const DEFAULT_CREATOR_DURATION = 60;
