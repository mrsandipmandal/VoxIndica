import type { ReactNode } from 'react';
import { Film, ListOrdered, Plus, Search, Trash2 } from 'lucide-react';
import type {
  CreatorChapter,
  CreatorScene,
  ScriptDocument
} from '../../types/creator';

interface ScriptEditorProps {
  script: ScriptDocument;
  onChange: (next: ScriptDocument) => void;
  disabled?: boolean;
}

const fieldClass =
  'w-full bg-[#0B0F17] border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-amber-500/60 transition-colors';

const labelClass =
  'block text-[10px] font-mono uppercase tracking-wider text-slate-500 mb-1';

function Section({
  icon,
  title,
  count,
  children
}: {
  icon: ReactNode;
  title: string;
  count?: string;
  children: ReactNode;
}) {
  return (
    <section className="p-5 bg-[#121927] border border-slate-800 rounded-xl space-y-4">
      <header className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
          <span className="text-amber-400">{icon}</span>
          {title}
        </h3>
        {count ? <span className="text-[10px] font-mono text-slate-500">{count}</span> : null}
      </header>
      {children}
    </section>
  );
}

export function ScriptEditor({ script, onChange, disabled = false }: ScriptEditorProps) {
  const update = (patch: Partial<ScriptDocument>) => onChange({ ...script, ...patch });

  const updateScene = (id: string, patch: Partial<CreatorScene>) => {
    update({
      scenes: script.scenes.map((scene) => (scene.id === id ? { ...scene, ...patch } : scene))
    });
  };

  const addScene = () => {
    const scene: CreatorScene = {
      id: `scene-${script.scenes.length + 1}-${Date.now()}`,
      voiceText: '',
      visualPrompt: '',
      videoType: 'b-roll',
      camera: 'medium shot',
      subtitle: '',
      transition: 'cut',
      durationSeconds: 6
    };
    update({ scenes: [...script.scenes, scene] });
  };

  const removeScene = (id: string) => {
    update({ scenes: script.scenes.filter((scene) => scene.id !== id) });
  };

  const updateChapter = (index: number, patch: Partial<CreatorChapter>) => {
    update({
      chapters: script.chapters.map((chapter, i) =>
        i === index ? { ...chapter, ...patch } : chapter
      )
    });
  };

  const totalSeconds = script.scenes.reduce(
    (sum, scene) => sum + (Number(scene.durationSeconds) || 0),
    0
  );

  const wordCount = script.script.trim() ? script.script.trim().split(/\s+/).length : 0;

  return (
    <div className="space-y-5">
      <Section
        icon={<Film className="w-4 h-4" />}
        title="Narration"
        count={`${wordCount} words · ~${Math.max(1, Math.round(totalSeconds))}s planned`}
      >
        <div>
          <label className={labelClass}>Video title</label>
          <input
            className={fieldClass}
            value={script.title}
            disabled={disabled}
            onChange={(event) => update({ title: event.target.value })}
            placeholder="Title shown in the video and publishing package"
          />
        </div>
        <div>
          <label className={labelClass}>Hook — first 3 seconds</label>
          <textarea
            className={`${fieldClass} min-h-16`}
            value={script.hook}
            disabled={disabled}
            onChange={(event) => update({ hook: event.target.value })}
          />
        </div>
        <div>
          <label className={labelClass}>Full narration</label>
          <textarea
            className={`${fieldClass} min-h-40 leading-relaxed`}
            value={script.script}
            disabled={disabled}
            onChange={(event) => update({ script: event.target.value })}
          />
        </div>
      </Section>

      <Section
        icon={<ListOrdered className="w-4 h-4" />}
        title="Scenes"
        count={`${script.scenes.length} scenes · ${totalSeconds.toFixed(1)}s`}
      >
        <div className="space-y-4">
          {script.scenes.map((scene, index) => (
            <article
              key={scene.id}
              className="p-4 bg-[#0B0F17] border border-slate-800 rounded-lg space-y-3"
            >
              <header className="flex items-center justify-between gap-3">
                <span className="text-[10px] font-mono uppercase tracking-wider text-amber-400">
                  Scene {String(index + 1).padStart(2, '0')}
                </span>
                <div className="flex items-center gap-2">
                  <label className="text-[10px] font-mono text-slate-500">seconds</label>
                  <input
                    type="number"
                    min={1}
                    max={120}
                    step={0.5}
                    className="w-20 bg-[#121927] border border-slate-800 rounded-md px-2 py-1 text-xs text-slate-200 focus:outline-none focus:border-amber-500/60"
                    value={scene.durationSeconds}
                    disabled={disabled}
                    onChange={(event) =>
                      updateScene(scene.id, {
                        durationSeconds: Math.max(1, Number(event.target.value) || 1)
                      })
                    }
                  />
                  <button
                    type="button"
                    onClick={() => removeScene(scene.id)}
                    disabled={disabled || script.scenes.length <= 1}
                    className="p-1.5 rounded-md border border-slate-800 text-slate-500 hover:text-rose-300 hover:border-rose-500/40 disabled:opacity-30 transition-colors"
                    title="Remove scene"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </header>

              <div>
                <label className={labelClass}>Voice text</label>
                <textarea
                  className={`${fieldClass} min-h-20`}
                  value={scene.voiceText}
                  disabled={disabled}
                  onChange={(event) => updateScene(scene.id, { voiceText: event.target.value })}
                />
              </div>

              <div>
                <label className={labelClass}>Visual prompt</label>
                <textarea
                  className={`${fieldClass} min-h-16`}
                  value={scene.visualPrompt}
                  disabled={disabled}
                  onChange={(event) =>
                    updateScene(scene.id, { visualPrompt: event.target.value })
                  }
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className={labelClass}>Camera</label>
                  <input
                    className={fieldClass}
                    value={scene.camera}
                    disabled={disabled}
                    onChange={(event) => updateScene(scene.id, { camera: event.target.value })}
                  />
                </div>
                <div>
                  <label className={labelClass}>Video type</label>
                  <input
                    className={fieldClass}
                    value={scene.videoType}
                    disabled={disabled}
                    onChange={(event) =>
                      updateScene(scene.id, { videoType: event.target.value })
                    }
                  />
                </div>
                <div>
                  <label className={labelClass}>Transition</label>
                  <input
                    className={fieldClass}
                    value={scene.transition}
                    disabled={disabled}
                    onChange={(event) =>
                      updateScene(scene.id, { transition: event.target.value })
                    }
                  />
                </div>
              </div>

              <div>
                <label className={labelClass}>On-screen subtitle</label>
                <input
                  className={fieldClass}
                  value={scene.subtitle}
                  disabled={disabled}
                  onChange={(event) => updateScene(scene.id, { subtitle: event.target.value })}
                />
              </div>
            </article>
          ))}
        </div>

        <button
          type="button"
          onClick={addScene}
          disabled={disabled}
          className="flex items-center gap-2 px-3 py-2 rounded-lg border border-dashed border-slate-700 text-xs text-slate-400 hover:text-amber-300 hover:border-amber-500/40 transition-colors disabled:opacity-40"
        >
          <Plus className="w-3.5 h-3.5" />
          Add scene
        </button>
      </Section>

      <Section
        icon={<Search className="w-4 h-4" />}
        title="Publishing package"
        count={`${script.tags.length} tags · ${script.hashtags.length} hashtags`}
      >
        <div>
          <label className={labelClass}>Description</label>
          <textarea
            className={`${fieldClass} min-h-24`}
            value={script.description}
            disabled={disabled}
            onChange={(event) => update({ description: event.target.value })}
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className={labelClass}>Tags (comma separated)</label>
            <input
              className={fieldClass}
              value={script.tags.join(', ')}
              disabled={disabled}
              onChange={(event) =>
                update({
                  tags: event.target.value
                    .split(',')
                    .map((tag) => tag.trim())
                    .filter(Boolean)
                })
              }
            />
          </div>
          <div>
            <label className={labelClass}>Hashtags (space separated)</label>
            <input
              className={fieldClass}
              value={script.hashtags.join(' ')}
              disabled={disabled}
              onChange={(event) =>
                update({
                  hashtags: event.target.value
                    .split(/\s+/)
                    .map((tag) => tag.trim())
                    .filter(Boolean)
                })
              }
            />
          </div>
        </div>

        <div>
          <label className={labelClass}>Chapters</label>
          <div className="space-y-2">
            {script.chapters.map((chapter, index) => (
              <div key={`${chapter.timestamp}-${index}`} className="flex gap-2">
                <input
                  className={`${fieldClass} w-24 shrink-0`}
                  value={chapter.timestamp}
                  disabled={disabled}
                  placeholder="00:00"
                  onChange={(event) =>
                    updateChapter(index, { timestamp: event.target.value })
                  }
                />
                <input
                  className={fieldClass}
                  value={chapter.title}
                  disabled={disabled}
                  placeholder="Chapter title"
                  onChange={(event) => updateChapter(index, { title: event.target.value })}
                />
                <button
                  type="button"
                  onClick={() =>
                    update({ chapters: script.chapters.filter((_, i) => i !== index) })
                  }
                  disabled={disabled}
                  className="p-2 rounded-md border border-slate-800 text-slate-500 hover:text-rose-300"
                  title="Remove chapter"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={() =>
              update({
                chapters: [...script.chapters, { title: '', timestamp: '00:00' }]
              })
            }
            disabled={disabled}
            className="mt-2 text-[11px] text-amber-400 hover:text-amber-300"
          >
            + Add chapter
          </button>
        </div>

        <div>
          <label className={labelClass}>Thumbnail prompt</label>
          <textarea
            className={`${fieldClass} min-h-16`}
            value={script.thumbnailPrompt}
            disabled={disabled}
            onChange={(event) => update({ thumbnailPrompt: event.target.value })}
          />
        </div>

        <div>
          <label className={labelClass}>AI disclosure</label>
          <textarea
            className={`${fieldClass} min-h-14`}
            value={script.disclosure}
            disabled={disabled}
            onChange={(event) => update({ disclosure: event.target.value })}
          />
        </div>

        <div>
          <label className={labelClass}>Sources (one per line)</label>
          <textarea
            className={`${fieldClass} min-h-14`}
            value={script.sources.join('\n')}
            disabled={disabled}
            onChange={(event) =>
              update({
                sources: event.target.value
                  .split('\n')
                  .map((source) => source.trim())
                  .filter(Boolean)
              })
            }
          />
        </div>
      </Section>
    </div>
  );
}
