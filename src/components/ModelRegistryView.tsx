import React, { useState } from 'react';
import { Cpu, HardDrive, ShieldCheck, Zap, AlertCircle, CheckCircle2, Layers } from 'lucide-react';
import { MODEL_REGISTRY } from '../data/models';
import { ModelCapability, SupportedLanguage, TaskType } from '../types';

interface ModelRegistryViewProps {
  selectedModelId: string;
  onSelectModel: (modelId: string) => void;
}

export const ModelRegistryView: React.FC<ModelRegistryViewProps> = ({
  selectedModelId,
  onSelectModel
}) => {
  const [taskFilter, setTaskFilter] = useState<'all' | TaskType>('all');
  const [langFilter, setLangFilter] = useState<'all' | SupportedLanguage>('all');

  const filteredModels = MODEL_REGISTRY.filter((m) => {
    if (taskFilter !== 'all' && !m.supportedTasks.includes(taskFilter)) return false;
    if (langFilter !== 'all' && !m.supportedLanguages.includes(langFilter)) return false;
    return true;
  });

  return (
    <div className="space-y-6">
      {/* View Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-800">
        <div>
          <h2 className="text-lg font-bold text-slate-100 flex items-center gap-2">
            <Layers className="w-5 h-5 text-amber-400" />
            Model Capability Registry
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            Verified neural speech models with phonological accent targets and resource bounds.
          </p>
        </div>

        {/* Filters */}
        <div className="flex items-center gap-2">
          {/* Task filter */}
          <div className="flex items-center p-0.5 bg-slate-900 border border-slate-800 rounded-lg text-xs">
            <button
              onClick={() => setTaskFilter('all')}
              className={`px-3 py-1 rounded transition-colors cursor-pointer ${
                taskFilter === 'all' ? 'bg-amber-500/20 text-amber-300 font-semibold' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              All Tasks
            </button>
            <button
              onClick={() => setTaskFilter('tts')}
              className={`px-3 py-1 rounded transition-colors cursor-pointer ${
                taskFilter === 'tts' ? 'bg-amber-500/20 text-amber-300 font-semibold' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              TTS Only
            </button>
            <button
              onClick={() => setTaskFilter('voice_clone')}
              className={`px-3 py-1 rounded transition-colors cursor-pointer ${
                taskFilter === 'voice_clone' ? 'bg-amber-500/20 text-amber-300 font-semibold' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Cloning Only
            </button>
          </div>
        </div>
      </div>

      {/* Model Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {filteredModels.map((model) => {
          const isSelected = selectedModelId === model.id;
          return (
            <div
              key={model.id}
              className={`p-5 rounded-xl border transition-all ${
                isSelected
                  ? 'bg-slate-900/90 border-amber-500/50 shadow-lg shadow-amber-500/5 ring-1 ring-amber-500/20'
                  : 'bg-[#121927] border-slate-800 hover:border-slate-700'
              }`}
            >
              <div className="flex items-start justify-between gap-3 mb-3">
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-bold text-slate-100">{model.name}</h3>
                    <span className="text-[11px] font-mono text-slate-500">v{model.version}</span>
                  </div>
                  <div className="text-xs text-amber-400 font-mono mt-0.5">
                    {model.supportedTasks.map((t) => (t === 'tts' ? 'Text-to-Speech' : 'Voice Cloning')).join(' · ')}
                  </div>
                </div>

                <button
                  onClick={() => onSelectModel(model.id)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                    isSelected
                      ? 'bg-amber-500 text-slate-950 shadow-sm'
                      : 'bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700'
                  }`}
                >
                  {isSelected ? 'Active Model' : 'Select'}
                </button>
              </div>

              {/* Accent Coverage */}
              <div className="space-y-1.5 mb-4 text-xs">
                <span className="text-slate-400 font-medium text-[11px] uppercase tracking-wider block">
                  Verified Accent Targets
                </span>
                {Object.entries(model.verifiedAccents).map(([lang, accent]) => (
                  <div key={lang} className="text-slate-300 flex items-start gap-1.5">
                    <span className="text-amber-400 font-mono text-[11px] shrink-0 uppercase">{lang}:</span>
                    <span className="text-slate-300 text-xs">{accent}</span>
                  </div>
                ))}
              </div>

              {/* Hardware & Provider Specs */}
              <div className="grid grid-cols-3 gap-2 p-2.5 bg-slate-950/70 border border-slate-800/80 rounded-lg text-xs font-mono mb-3">
                <div>
                  <span className="text-slate-500 block text-[10px]">Min VRAM</span>
                  <span className="text-slate-200 font-semibold tabular-nums">{(model.minVramMb / 1024).toFixed(1)} GB</span>
                </div>
                <div>
                  <span className="text-slate-500 block text-[10px]">Real-Time Factor</span>
                  <span className="text-slate-200 font-semibold tabular-nums">{model.realTimeFactor}x</span>
                </div>
                <div>
                  <span className="text-slate-500 block text-[10px]">MOS Rating</span>
                  <span className="text-emerald-400 font-semibold tabular-nums">{model.meanOpinionScore.toFixed(2)} / 5</span>
                </div>
              </div>

              {/* License & Providers */}
              <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-400 pt-2 border-t border-slate-800/70">
                <div className="flex items-center gap-1.5">
                  <ShieldCheck className="w-3.5 h-3.5 text-slate-400" />
                  <span>License: {model.license}</span>
                </div>
                <div className="flex items-center gap-1 font-mono uppercase text-[10px] text-slate-400">
                  <span>Providers:</span>
                  <span>{model.providerCompatibility.join(', ')}</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
