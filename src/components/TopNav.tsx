import React from 'react';
import { Radio, Server, Activity, Volume2, Sparkles, Database } from 'lucide-react';
import { InferenceProvider, ProviderEndpointConfig } from '../types';

interface TopNavProps {
  activeTab: 'studio' | 'models' | 'benchmarks' | 'history';
  setActiveTab: (tab: 'studio' | 'models' | 'benchmarks' | 'history') => void;
  activeProvider: InferenceProvider;
  providerConfig: ProviderEndpointConfig;
  onOpenProviderModal: () => void;
  onOpenCloneModal: () => void;
}

export const TopNav: React.FC<TopNavProps> = ({
  activeTab,
  setActiveTab,
  activeProvider,
  providerConfig,
  onOpenProviderModal,
  onOpenCloneModal
}) => {
  return (
    <header className="flex items-center justify-between gap-8 px-6 py-3.5 border-b border-slate-800 bg-[#0B0F17]/95 backdrop-blur sticky top-0 z-40">
      {/* Zone 1: Single text element wordmark */}
      <div className="flex items-center gap-3 shrink-0">
        <div className="w-8 h-8 rounded-lg bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-amber-400">
          <Volume2 className="w-4 h-4" />
        </div>
        <div className="flex flex-col">
          <a
            href="/"
            onClick={(e) => {
              e.preventDefault();
              setActiveTab('studio');
            }}
            className="text-base font-bold tracking-tight text-slate-100 hover:text-white transition-colors whitespace-nowrap"
          >
            VoxIndica Studio
          </a>
        </div>
      </div>

      {/* Zone 2: Concise single-line text navigation links */}
      <nav className="hidden md:flex items-center gap-6 text-sm font-medium">
        <button
          onClick={() => setActiveTab('studio')}
          className={`transition-colors whitespace-nowrap shrink-0 py-1 border-b-2 ${
            activeTab === 'studio'
              ? 'text-amber-400 border-amber-400 font-semibold'
              : 'text-slate-400 hover:text-slate-200 border-transparent'
          }`}
        >
          Studio Workspace
        </button>

        <button
          onClick={() => setActiveTab('models')}
          className={`transition-colors whitespace-nowrap shrink-0 py-1 border-b-2 ${
            activeTab === 'models'
              ? 'text-amber-400 border-amber-400 font-semibold'
              : 'text-slate-400 hover:text-slate-200 border-transparent'
          }`}
        >
          Model Registry
        </button>

        <button
          onClick={() => setActiveTab('benchmarks')}
          className={`transition-colors whitespace-nowrap shrink-0 py-1 border-b-2 ${
            activeTab === 'benchmarks'
              ? 'text-amber-400 border-amber-400 font-semibold'
              : 'text-slate-400 hover:text-slate-200 border-transparent'
          }`}
        >
          Benchmark Matrix
        </button>

        <button
          onClick={() => setActiveTab('history')}
          className={`transition-colors whitespace-nowrap shrink-0 py-1 border-b-2 ${
            activeTab === 'history'
              ? 'text-amber-400 border-amber-400 font-semibold'
              : 'text-slate-400 hover:text-slate-200 border-transparent'
          }`}
        >
          History & Audio Lab
        </button>
      </nav>

      {/* Zone 3: Primary actions & Provider status */}
      <div className="flex items-center gap-3 shrink-0">
        <button
          onClick={onOpenProviderModal}
          className="flex items-center gap-2 px-3 py-1.5 rounded-md border border-slate-700 bg-slate-800/80 hover:bg-slate-800 text-xs text-slate-300 hover:text-slate-100 transition-colors cursor-pointer"
          title="Configure Local, Kaggle, or Google Colab provider"
        >
          <Server className="w-3.5 h-3.5 text-slate-400" />
          <span className="font-mono text-[11px]">
            {activeProvider === 'huggingface' ? 'Hugging Face' : activeProvider === 'colab' ? 'Google Colab' : activeProvider === 'kaggle' ? 'Kaggle' : 'Local'}
          </span>
          <span className="text-slate-500">·</span>
          <span className="text-[11px] text-slate-400">
            {providerConfig.isConnected ? (
              <span className="text-emerald-400 flex items-center gap-1 font-mono">
                {providerConfig.latencyMs}ms
              </span>
            ) : (
              <span className="text-rose-400">Offline</span>
            )}
          </span>
        </button>

        <button
          onClick={onOpenCloneModal}
          className="hidden sm:flex items-center gap-2 px-3.5 py-1.5 rounded-md bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-semibold transition-colors cursor-pointer"
        >
          <Sparkles className="w-3.5 h-3.5" />
          Clone Voice
        </button>
      </div>
    </header>
  );
};
