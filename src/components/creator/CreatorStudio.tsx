import { useCallback, useEffect, useState } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  ChevronRight,
  Clapperboard,
  Download,
  Film,
  Loader2,
  Mic,
  Plus,
  Save,
  Share2,
  ShieldCheck,
  Sparkles,
  Trash2,
  Video,
  Wand2
} from 'lucide-react';
import type {
  CreateProjectInput,
  CreatorHealth,
  CreatorLanguage,
  CreatorProject,
  CreatorProjectSummary,
  CreatorTone,
  CreatorVideoMode,
  ScriptDocument
} from '../../types/creator';
import { creatorService } from '../../services/creatorService';
import { generateScript } from '../../services/scriptService';
import {
  CREATOR_DURATION_OPTIONS,
  CREATOR_LANGUAGE_OPTIONS,
  CREATOR_MODE_OPTIONS,
  CREATOR_STATUS_LABELS,
  CREATOR_STATUS_STYLES,
  CREATOR_TONE_OPTIONS,
  DEFAULT_CREATOR_DURATION,
  DEFAULT_CREATOR_LANGUAGE,
  DEFAULT_CREATOR_MODE,
  DEFAULT_CREATOR_TONE
} from '../../data/creatorPresets';
import { ScriptEditor } from './ScriptEditor';
import { VoicePanel } from './VoicePanel';
import { RenderPanel } from './RenderPanel';
import { PublishingPanel } from './PublishingPanel';

type View = 'list' | 'wizard' | 'editor';

const inputClass =
  'w-full bg-[#0B0F17] border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-amber-500/60 transition-colors';
const labelClass =
  'block text-[10px] font-mono uppercase tracking-wider text-slate-500 mb-1';
const cardClass = 'p-5 bg-[#121927] border border-slate-800 rounded-xl';

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

function StatusBadge({ status }: { status: CreatorProjectSummary['status'] }) {
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full border text-[10px] font-mono uppercase tracking-wider ${CREATOR_STATUS_STYLES[status]}`}
    >
      {CREATOR_STATUS_LABELS[status]}
    </span>
  );
}

export function CreatorStudio() {
  const [view, setView] = useState<View>('list');
  const [projects, setProjects] = useState<CreatorProjectSummary[]>([]);
  const [project, setProject] = useState<CreatorProject | null>(null);
  const [draft, setDraft] = useState<ScriptDocument | null>(null);
  const [health, setHealth] = useState<CreatorHealth | null>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [consentSaving, setConsentSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [consentName, setConsentName] = useState('');
  const [consentChecked, setConsentChecked] = useState(false);
  const [form, setForm] = useState<CreateProjectInput>({
    topic: '',
    language: DEFAULT_CREATOR_LANGUAGE,
    tone: DEFAULT_CREATOR_TONE,
    audience: '',
    targetDurationSeconds: DEFAULT_CREATOR_DURATION,
    videoMode: DEFAULT_CREATOR_MODE,
    extraInstructions: ''
  });

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const next = await creatorService.listProjects();
      setProjects(next);
      setError('');
    } catch (caught: any) {
      setError(caught?.message || 'Could not load projects.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    creatorService
      .health()
      .then(setHealth)
      .catch(() => setHealth(null));
  }, [refresh]);

  // Poll only while a real server-side voice or render job is running. The
  // interval stops as soon as both jobs leave queued/running — no synthetic
  // progress and no polling of idle projects.
  useEffect(() => {
    if (!project) return;
    const voiceActive =
      project.voice.status === 'queued' || project.voice.status === 'running';
    const renderActive =
      project.render?.status === 'queued' || project.render?.status === 'running';
    if (!voiceActive && !renderActive) return;

    let cancelled = false;
    const timer = window.setInterval(() => {
      creatorService
        .getProject(project.id)
        .then((next) => {
          if (cancelled) return;
          setProject(next);
          if (next.voice.status === 'complete' && voiceActive) {
            setNotice(next.voice.message);
            setError('');
          } else if (next.voice.status === 'failed' && voiceActive) {
            setError(next.voice.message);
          }
          if (next.render?.status === 'complete' && renderActive) {
            setNotice(next.render.message);
            setError('');
          } else if (next.render?.status === 'failed' && renderActive) {
            setError(next.render.message);
          }
        })
        .catch(() => {
          // A transient poll failure must not stop the job; the next tick retries.
        });
    }, 2000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [project?.id, project?.voice.status, project?.render?.status]);

  const resetMessages = () => {
    setError('');
    setNotice('');
  };

  const openProject = async (id: string) => {
    resetMessages();
    try {
      const next = await creatorService.getProject(id);
      setProject(next);
      setDraft(next.script);
      setConsentName(next.consent?.presenterName || '');
      setConsentChecked(Boolean(next.consent?.confirmed));
      setView('editor');
    } catch (caught: any) {
      setError(caught?.message || 'Could not open that project.');
    }
  };

  const createProject = async () => {
    if (form.topic.trim().length < 3) {
      setError('Give the project a topic of at least 3 characters.');
      return;
    }
    setCreating(true);
    resetMessages();
    try {
      const created = await creatorService.createProject(form);
      setProject(created);
      setDraft(created.script);
      setConsentName('');
      setConsentChecked(false);
      setView('editor');
      await refresh();
    } catch (caught: any) {
      setError(caught?.message || 'Could not create the project.');
    } finally {
      setCreating(false);
    }
  };

  const runGeneration = async () => {
    if (!project) return;
    setGenerating(true);
    resetMessages();
    try {
      const result = await generateScript({
        projectId: project.id,
        topic: project.topic,
        language: project.language,
        tone: project.tone,
        audience: project.audience,
        targetDurationSeconds: project.targetDurationSeconds,
        videoMode: project.videoMode,
        extraInstructions: project.extraInstructions
      });
      setDraft(result.script);
      setProject(result.project ?? { ...project, script: result.script });
      setNotice(
        `Script generated with ${result.script.meta.provider} (${result.script.meta.model}) in ${result.script.meta.latencyMs} ms. Review it before saving.`
      );
      await refresh();
    } catch (caught: any) {
      setError(caught?.message || 'Script generation failed.');
    } finally {
      setGenerating(false);
    }
  };

  const saveScript = async () => {
    if (!project || !draft) return;
    setSaving(true);
    resetMessages();
    try {
      const next = await creatorService.updateProject(project.id, { script: draft });
      setProject(next);
      setDraft(next.script);
      setNotice('Script saved to the project store.');
      await refresh();
    } catch (caught: any) {
      setError(caught?.message || 'Could not save the script.');
    } finally {
      setSaving(false);
    }
  };

  const saveConsent = async () => {
    if (!project) return;
    if (consentName.trim().length < 2 || !consentChecked) {
      setError('Enter the presenter name and confirm consent before saving.');
      return;
    }
    setConsentSaving(true);
    resetMessages();
    try {
      const next = await creatorService.saveConsent(project.id, {
        presenterName: consentName.trim(),
        confirmed: true,
        notes: ''
      });
      setProject(next);
      setNotice('Presenter consent recorded.');
    } catch (caught: any) {
      setError(caught?.message || 'Could not record consent.');
    } finally {
      setConsentSaving(false);
    }
  };

  const removeProject = async () => {
    if (!project) return;
    if (!window.confirm('Delete this project and all of its assets? This cannot be undone.')) {
      return;
    }
    try {
      await creatorService.deleteProject(project.id);
      setProject(null);
      setDraft(null);
      setView('list');
      await refresh();
    } catch (caught: any) {
      setError(caught?.message || 'Could not delete the project.');
    }
  };

  const backToList = () => {
    setView('list');
    setProject(null);
    setDraft(null);
    resetMessages();
    void refresh();
  };

  const providerEntries = health
    ? (Object.keys(health.providers) as Array<keyof CreatorHealth['providers']>)
    : [];

  const voiceSceneCount = project?.script?.scenes.length ?? 0;
  const voiceStoredCount = project
    ? project.script?.scenes.filter((scene) => project.voice.scenes[scene.id]).length ?? 0
    : 0;
  const voiceComplete = voiceSceneCount > 0 && voiceStoredCount === voiceSceneCount;
  const renderComplete = project?.render?.status === 'complete';
  const publishReady = voiceComplete && renderComplete;

  return (
    <div className="space-y-6">
      <header className="pb-4 border-b border-slate-800 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-slate-100 flex items-center gap-2">
            <Clapperboard className="w-5 h-5 text-amber-400" />
            Creator Studio
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            Topic → script → narration → visuals → video. Script, voice and render
            run for real; the presenter stage waits on the avatar spike.
          </p>
        </div>
        {view === 'list' ? (
          <button
            onClick={() => {
              resetMessages();
              setView('wizard');
            }}
            className="flex items-center gap-2 px-3.5 py-2 rounded-md bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-semibold transition-colors shrink-0"
          >
            <Plus className="w-3.5 h-3.5" />
            New project
          </button>
        ) : null}
      </header>

      {error ? (
        <div className="flex items-start gap-2 p-3 rounded-lg border border-rose-500/30 bg-rose-500/10 text-rose-200 text-xs">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <span className="leading-relaxed">{error}</span>
        </div>
      ) : null}

      {notice ? (
        <div className="flex items-start gap-2 p-3 rounded-lg border border-emerald-500/30 bg-emerald-500/10 text-emerald-200 text-xs">
          <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
          <span className="leading-relaxed">{notice}</span>
        </div>
      ) : null}

      {view === 'list' ? (
        loading ? (
          <div className="flex items-center gap-2 text-xs text-slate-400">
            <Loader2 className="w-4 h-4 animate-spin" />
            Loading projects…
          </div>
        ) : projects.length === 0 ? (
          <div className={`${cardClass} text-center py-12 space-y-3`}>
            <Clapperboard className="w-8 h-8 text-slate-600 mx-auto" />
            <h3 className="text-sm font-semibold text-slate-200">No projects yet</h3>
            <p className="text-xs text-slate-400 max-w-md mx-auto leading-relaxed">
              Create a project with a topic and target duration, then generate a
              scene-by-scene script. Everything is stored on this machine under{' '}
              <code className="text-amber-300">data/projects/</code> and survives restarts.
            </p>
            <button
              onClick={() => setView('wizard')}
              className="inline-flex items-center gap-2 px-3.5 py-2 rounded-md bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-semibold transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              Create the first project
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
            {projects.map((item) => (
              <button
                key={item.id}
                onClick={() => void openProject(item.id)}
                className="text-left p-4 bg-[#121927] border border-slate-800 hover:border-amber-500/40 rounded-xl space-y-3 transition-colors group"
              >
                <div className="flex items-center justify-between gap-2">
                  <StatusBadge status={item.status} />
                  <span className="text-[10px] font-mono text-slate-500 uppercase">
                    {item.language} · {item.videoMode}
                  </span>
                </div>
                <h3 className="text-sm font-semibold text-slate-100 leading-snug line-clamp-2 group-hover:text-amber-200">
                  {item.topic}
                </h3>
                <div className="flex items-center justify-between text-[10px] font-mono text-slate-500">
                  <span>
                    {item.targetDurationSeconds}s · {item.tone}
                  </span>
                  <span className="flex items-center gap-1">
                    {formatDate(item.updatedAt)}
                    <ChevronRight className="w-3 h-3" />
                  </span>
                </div>
              </button>
            ))}
          </div>
        )
      ) : null}

      {view === 'wizard' ? (
        <div className="max-w-2xl space-y-5">
          <button
            onClick={backToList}
            className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-200"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Back to projects
          </button>

          <div className={`${cardClass} space-y-5`}>
            <div>
              <h3 className="text-sm font-semibold text-slate-100">New video project</h3>
              <p className="text-[11px] text-slate-500 mt-1">
                The topic and settings become the generation prompt. You can edit
                every field later.
              </p>
            </div>

            <div>
              <label className={labelClass}>Topic</label>
              <textarea
                className={`${inputClass} min-h-20`}
                value={form.topic}
                maxLength={500}
                onChange={(event) => setForm({ ...form, topic: event.target.value })}
                placeholder="e.g. How Kolkata's tram network survived for 150 years"
              />
              <div className="text-[10px] font-mono text-slate-600 mt-1 text-right">
                {form.topic.length}/500
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className={labelClass}>Language</label>
                <select
                  className={inputClass}
                  value={form.language}
                  onChange={(event) =>
                    setForm({ ...form, language: event.target.value as CreatorLanguage })
                  }
                >
                  {CREATOR_LANGUAGE_OPTIONS.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className={labelClass}>Tone</label>
                <select
                  className={inputClass}
                  value={form.tone}
                  onChange={(event) =>
                    setForm({ ...form, tone: event.target.value as CreatorTone })
                  }
                >
                  {CREATOR_TONE_OPTIONS.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className={labelClass}>Audience</label>
                <input
                  className={inputClass}
                  value={form.audience}
                  onChange={(event) => setForm({ ...form, audience: event.target.value })}
                  placeholder="General online viewers"
                />
              </div>
              <div>
                <label className={labelClass}>Target duration</label>
                <select
                  className={inputClass}
                  value={form.targetDurationSeconds}
                  onChange={(event) =>
                    setForm({
                      ...form,
                      targetDurationSeconds: Number(event.target.value)
                    })
                  }
                >
                  {CREATOR_DURATION_OPTIONS.map((seconds) => (
                    <option key={seconds} value={seconds}>
                      {seconds} seconds
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className={labelClass}>Video mode</label>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                {CREATOR_MODE_OPTIONS.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    aria-pressed={form.videoMode === option.id}
                    onClick={() =>
                      setForm({ ...form, videoMode: option.id as CreatorVideoMode })
                    }
                    className={`text-left p-3 rounded-lg border transition-colors ${
                      form.videoMode === option.id
                        ? 'border-amber-500/50 bg-amber-500/10'
                        : 'border-slate-800 bg-[#0B0F17] hover:border-slate-700'
                    }`}
                  >
                    <span className="block text-xs font-semibold text-slate-100">
                      {option.label}
                    </span>
                    <span className="block text-[10px] text-slate-500 mt-1 leading-snug">
                      {option.description}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className={labelClass}>Extra instructions (optional)</label>
              <textarea
                className={`${inputClass} min-h-16`}
                value={form.extraInstructions}
                onChange={(event) =>
                  setForm({ ...form, extraInstructions: event.target.value })
                }
                placeholder="Facts to include, words to avoid, a specific call to action…"
              />
            </div>

            {health &&
            !Object.values(health.providers).some((provider) => provider.configured) ? (
              <div className="flex items-start gap-2 p-3 rounded-lg border border-amber-500/30 bg-amber-500/10 text-amber-200 text-[11px]">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span className="leading-relaxed">
                  No script provider is configured. Add `GEMINI_API_KEY`,
                  `GROQ_API_KEY` or `OPENROUTER_API_KEY` to `.env`, then restart the
                  server. You can still create an empty project now.
                </span>
              </div>
            ) : null}

            <button
              onClick={() => void createProject()}
              disabled={creating}
              className="flex items-center justify-center gap-2 w-full px-4 py-2.5 rounded-md bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-slate-950 text-xs font-semibold transition-colors"
            >
              {creating ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Plus className="w-4 h-4" />
              )}
              {creating ? 'Creating project…' : 'Create project'}
            </button>
          </div>
        </div>
      ) : null}

      {view === 'editor' && project ? (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-start gap-3 min-w-0">
              <button
                onClick={backToList}
                className="p-2 rounded-md border border-slate-800 text-slate-400 hover:text-slate-200 mt-0.5"
                title="Back to projects"
              >
                <ArrowLeft className="w-4 h-4" />
              </button>
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <StatusBadge status={project.status} />
                  <span className="text-[10px] font-mono text-slate-500 uppercase">
                    {project.language} · {project.tone} · {project.videoMode} ·{' '}
                    {project.targetDurationSeconds}s
                  </span>
                </div>
                <h3 className="text-base font-bold text-slate-100 mt-1 truncate">
                  {project.topic}
                </h3>
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={() => void runGeneration()}
                disabled={generating}
                className="flex items-center gap-2 px-3 py-2 rounded-md border border-amber-500/40 text-amber-300 hover:bg-amber-500/10 disabled:opacity-50 text-xs font-semibold transition-colors"
              >
                {generating ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Wand2 className="w-3.5 h-3.5" />
                )}
                {draft ? 'Regenerate' : 'Generate script'}
              </button>
              <button
                onClick={() => void saveScript()}
                disabled={!draft || saving}
                className="flex items-center gap-2 px-3 py-2 rounded-md bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-slate-950 text-xs font-semibold transition-colors"
              >
                {saving ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Save className="w-3.5 h-3.5" />
                )}
                Save
              </button>
              <a
                href={creatorService.exportUrl(project.id)}
                className="flex items-center gap-2 px-3 py-2 rounded-md border border-slate-700 text-slate-300 hover:text-slate-100 hover:bg-slate-800/60 text-xs transition-colors"
              >
                <Download className="w-3.5 h-3.5" />
                Export
              </a>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            <div className="lg:col-span-8">
              {draft ? (
                <>
                  <ScriptEditor
                    script={draft}
                    onChange={setDraft}
                    disabled={generating}
                  />
                  <div className="mt-5">
                    <VoicePanel
                      project={project}
                      scriptSaved={JSON.stringify(draft) === JSON.stringify(project.script)}
                      onProjectChange={setProject}
                      onError={setError}
                      onNotice={setNotice}
                    />
                  </div>
                  <div className="mt-5">
                    <RenderPanel
                      project={project}
                      onProjectChange={setProject}
                      onError={setError}
                      onNotice={setNotice}
                    />
                  </div>
                  <div className="mt-5">
                    <PublishingPanel
                      project={project}
                      onProjectChange={setProject}
                      onError={setError}
                      onNotice={setNotice}
                    />
                  </div>
                </>
              ) : (
                <div className={`${cardClass} py-12 text-center space-y-3`}>
                  <Sparkles className="w-8 h-8 text-amber-400 mx-auto" />
                  <h3 className="text-sm font-semibold text-slate-100">
                    This project has no script yet
                  </h3>
                  <p className="text-xs text-slate-400 max-w-md mx-auto leading-relaxed">
                    Generate a scene-by-scene {CREATOR_LANGUAGE_OPTIONS.find((item) => item.id === project.language)?.label} script for{' '}
                    {project.targetDurationSeconds} seconds. The result is validated before
                    it is stored, so a malformed provider response never becomes a project.
                  </p>
                  <button
                    onClick={() => void runGeneration()}
                    disabled={generating}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-slate-950 text-xs font-semibold transition-colors"
                  >
                    {generating ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Wand2 className="w-4 h-4" />
                    )}
                    {generating ? 'Generating…' : 'Generate script'}
                  </button>
                </div>
              )}
            </div>

            <aside className="lg:col-span-4 space-y-4">
              <div className={`${cardClass} space-y-3`}>
                <h4 className="text-xs font-semibold text-slate-100 flex items-center gap-2">
                  <Wand2 className="w-3.5 h-3.5 text-amber-400" />
                  Script providers
                </h4>
                <div className="space-y-2">
                  {providerEntries.map((id) => {
                    const provider = health?.providers[id];
                    return (
                      <div
                        key={id}
                        className="flex items-center justify-between gap-2 text-[11px]"
                      >
                        <span className="text-slate-300 capitalize">{id}</span>
                        <span className="flex items-center gap-1.5 font-mono text-[10px] text-slate-500">
                          <span
                            className={`w-1.5 h-1.5 rounded-full ${
                              provider?.configured ? 'bg-emerald-400' : 'bg-slate-600'
                            }`}
                          />
                          {provider?.configured ? 'key set' : 'no key'}
                        </span>
                      </div>
                    );
                  })}
                  {!health ? (
                    <p className="text-[11px] text-slate-500">
                      Provider status unavailable.
                    </p>
                  ) : null}
                </div>
                <p className="text-[10px] text-slate-500 leading-relaxed border-t border-slate-800 pt-2">
                  Fallback order: Gemini → Groq → OpenRouter. Fallback happens only
                  on rate limits, outages, timeouts or invalid JSON — never on an
                  auth error.
                </p>
              </div>

              <div className={`${cardClass} space-y-3`}>
                <h4 className="text-xs font-semibold text-slate-100 flex items-center gap-2">
                  <Video className="w-3.5 h-3.5 text-amber-400" />
                  Production stages
                </h4>
                <ol className="space-y-2">
                  {[
                    {
                      icon: <FileTextIcon />,
                      label: 'Script',
                      done: Boolean(project.script),
                      detail: project.script ? 'Ready' : 'Not generated'
                    },
                    {
                      icon: <Mic className="w-3.5 h-3.5" />,
                      label: 'Voice',
                      done: voiceComplete,
                      detail: voiceComplete
                        ? 'Ready'
                        : project.voice.status === 'running'
                          ? `${voiceStoredCount}/${voiceSceneCount} scenes`
                          : project.voice.status === 'failed'
                            ? 'Failed'
                            : 'Not synthesized'
                    },
                    {
                      icon: <Film className="w-3.5 h-3.5" />,
                      label: 'Presenter',
                      done: false,
                      detail:
                        project.videoMode === 'cinematic' ? 'Not needed' : 'Avatar spike'
                    },
                    {
                      icon: <Video className="w-3.5 h-3.5" />,
                      label: 'Render',
                      done: renderComplete,
                      detail: renderComplete
                        ? 'Ready'
                        : project.render?.status === 'running'
                          ? `${project.render.completedScenes}/${project.render.totalScenes} scenes`
                          : project.render?.status === 'failed'
                            ? 'Failed'
                            : 'Not rendered'
                    },
                    {
                      icon: <Share2 className="w-3.5 h-3.5" />,
                      label: 'Publish',
                      done: publishReady,
                      detail: publishReady
                        ? 'Ready'
                        : renderComplete
                          ? 'Captions pending'
                          : 'Not ready'
                    }
                  ].map((stage) => (
                    <li
                      key={stage.label}
                      className="flex items-center justify-between gap-2 text-[11px]"
                    >
                      <span className="flex items-center gap-2 text-slate-300">
                        <span
                          className={
                            stage.done ? 'text-emerald-400' : 'text-slate-500'
                          }
                        >
                          {stage.icon}
                        </span>
                        {stage.label}
                      </span>
                      <span
                        className={`font-mono text-[10px] ${
                          stage.done ? 'text-emerald-400' : 'text-slate-500'
                        }`}
                      >
                        {stage.detail}
                      </span>
                    </li>
                  ))}
                </ol>
                <p className="text-[10px] text-slate-500 leading-relaxed border-t border-slate-800 pt-2">
                  The renderer only assembles uploaded visuals and narration. The
                  avatar/presenter stage is not wired yet; this page will not pretend
                  a video exists.
                </p>
              </div>

              <div className={`${cardClass} space-y-3`}>
                <h4 className="text-xs font-semibold text-slate-100 flex items-center gap-2">
                  <ShieldCheck className="w-3.5 h-3.5 text-amber-400" />
                  Presenter consent
                </h4>
                {project.consent?.confirmed ? (
                  <div className="flex items-start gap-2 text-[11px] text-emerald-300">
                    <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
                    <span>
                      Consent recorded for{' '}
                      <strong className="font-semibold">
                        {project.consent.presenterName}
                      </strong>{' '}
                      on {formatDate(project.consent.confirmedAt)}.
                    </span>
                  </div>
                ) : (
                  <>
                    <input
                      className={inputClass}
                      value={consentName}
                      onChange={(event) => setConsentName(event.target.value)}
                      placeholder="Presenter's full name"
                    />
                    <label className="flex items-start gap-2 text-[11px] text-slate-400 leading-relaxed">
                      <input
                        type="checkbox"
                        checked={consentChecked}
                        onChange={(event) => setConsentChecked(event.target.checked)}
                        className="mt-0.5 accent-amber-500"
                      />
                      <span>
                        I confirm this person consented to an AI-generated likeness
                        and synthetic voice being used in this project.
                      </span>
                    </label>
                    <button
                      onClick={() => void saveConsent()}
                      disabled={consentSaving}
                      className="flex items-center gap-2 px-3 py-1.5 rounded-md border border-slate-700 text-slate-300 hover:text-slate-100 text-[11px] transition-colors disabled:opacity-50"
                    >
                      {consentSaving ? (
                        <Loader2 className="w-3 h-3 animate-spin" />
                      ) : (
                        <Save className="w-3 h-3" />
                      )}
                      Save consent
                    </button>
                  </>
                )}
              </div>

              <div className={`${cardClass} space-y-3`}>
                <h4 className="text-xs font-semibold text-slate-100 flex items-center gap-2">
                  <Clapperboard className="w-3.5 h-3.5 text-amber-400" />
                  Project
                </h4>
                <dl className="space-y-1.5 text-[11px]">
                  <div className="flex justify-between gap-2">
                    <dt className="text-slate-500">Topic</dt>
                    <dd className="text-slate-300 text-right line-clamp-2 max-w-[70%]">
                      {project.topic}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt className="text-slate-500">Audience</dt>
                    <dd className="text-slate-300 text-right">
                      {project.audience || 'General'}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt className="text-slate-500">Assets</dt>
                    <dd className="text-slate-300 font-mono">{project.assets.length}</dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt className="text-slate-500">Script generated</dt>
                    <dd className="text-slate-300 font-mono text-[10px]">
                      {project.script ? formatDate(project.script.meta.generatedAt) : '—'}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt className="text-slate-500">Project id</dt>
                    <dd className="text-slate-400 font-mono text-[10px]">
                      {project.id.slice(0, 8)}
                    </dd>
                  </div>
                </dl>
                <div className="flex items-center gap-2 border-t border-slate-800 pt-3">
                  <a
                    href={creatorService.exportUrl(project.id)}
                    className="flex items-center gap-1.5 text-[11px] text-slate-300 hover:text-amber-300"
                  >
                    <Download className="w-3 h-3" />
                    Download ZIP
                  </a>
                  <span className="text-slate-700">·</span>
                  <button
                    onClick={() => void removeProject()}
                    className="flex items-center gap-1.5 text-[11px] text-slate-500 hover:text-rose-300"
                  >
                    <Trash2 className="w-3 h-3" />
                    Delete project
                  </button>
                </div>
              </div>
            </aside>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function FileTextIcon() {
  return <Film className="w-3.5 h-3.5" />;
}
