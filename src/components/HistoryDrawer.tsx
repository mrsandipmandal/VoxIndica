import React from 'react';
import { History, Play, Download, Trash2, Clock, CheckCircle2, AlertCircle, Volume2 } from 'lucide-react';
import { SynthesisJob } from '../types';

interface HistoryDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  jobs: SynthesisJob[];
  onPlayJob: (job: SynthesisJob) => void;
  onClearHistory: () => void;
}

export const HistoryDrawer: React.FC<HistoryDrawerProps> = ({
  isOpen,
  onClose,
  jobs,
  onPlayJob,
  onClearHistory
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-y-0 right-0 z-50 w-full max-w-md bg-[#121927] border-l border-slate-800 shadow-2xl flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800">
        <div className="flex items-center gap-2">
          <History className="w-4 h-4 text-amber-400" />
          <h3 className="text-sm font-semibold text-slate-100">Generation History & Audio Lab</h3>
        </div>
        <div className="flex items-center gap-2">
          {jobs.length > 0 && (
            <button
              onClick={onClearHistory}
              className="text-xs text-rose-400 hover:text-rose-300 flex items-center gap-1 transition-colors px-2 py-1 rounded hover:bg-rose-500/10 cursor-pointer"
              title="Clear all history"
            >
              <Trash2 className="w-3 h-3" />
              Clear
            </button>
          )}
          <button
            onClick={onClose}
            className="text-xs text-slate-400 hover:text-white px-2 py-1 rounded hover:bg-slate-800 transition-colors cursor-pointer"
          >
            Close
          </button>
        </div>
      </div>

      {/* History Items List */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {jobs.length === 0 ? (
          <div className="h-64 flex flex-col items-center justify-center text-center text-slate-500 p-6">
            <Volume2 className="w-8 h-8 text-slate-600 mb-2" />
            <p className="text-xs font-medium text-slate-400">No generation history yet</p>
            <p className="text-[11px] text-slate-500 mt-1">
              Synthesized audio tracks and cloned speech jobs will appear here for instant replay and download.
            </p>
          </div>
        ) : (
          jobs.map((job) => (
            <div
              key={job.id}
              className="p-3.5 bg-slate-900 border border-slate-800 rounded-lg space-y-2.5 hover:border-slate-700 transition-colors"
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="text-xs font-semibold text-slate-200 flex items-center gap-1.5">
                    <span>{job.voice.name}</span>
                    <span className="text-slate-600">·</span>
                    <span className="text-[11px] text-slate-400 font-normal uppercase">{job.language}</span>
                  </div>
                  <div className="text-[11px] text-slate-500 font-mono mt-0.5">
                    {new Date(job.createdAt).toLocaleTimeString()} · {job.provider.toUpperCase()} · {job.voice.accent}
                  </div>
                </div>

                <span
                  className={`text-[10px] font-mono px-1.5 py-0.5 rounded capitalize ${
                    job.status === 'completed'
                      ? 'bg-emerald-500/15 text-emerald-300'
                      : job.status === 'running'
                      ? 'bg-amber-500/15 text-amber-300'
                      : 'bg-rose-500/15 text-rose-300'
                  }`}
                >
                  {job.status}
                </span>
              </div>

              {/* Text Preview */}
              <p className="text-xs text-slate-300 line-clamp-2 leading-relaxed bg-slate-950/50 p-2 rounded border border-slate-800/60 font-sans">
                "{job.text}"
              </p>

              {/* Action row */}
              <div className="flex items-center justify-between pt-1 text-[11px] font-mono text-slate-400">
                <div className="flex items-center gap-2">
                  {job.audioDurationSeconds && (
                    <span>{job.audioDurationSeconds.toFixed(1)}s</span>
                  )}
                  {job.latencyMs && (
                    <>
                      <span className="text-slate-600">·</span>
                      <span className="text-slate-400">{job.latencyMs}ms latency</span>
                    </>
                  )}
                </div>

                {job.audioUrl && (
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => onPlayJob(job)}
                      className="px-2.5 py-1 rounded bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 font-medium flex items-center gap-1 transition-colors cursor-pointer"
                    >
                      <Play className="w-3 h-3 fill-current" />
                      Play
                    </button>
                    <a
                      href={job.audioUrl}
                      download={`voxindica_${job.voice.id}_${Date.now()}.wav`}
                      className="p-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition-colors"
                      title="Download WAV"
                    >
                      <Download className="w-3 h-3" />
                    </a>
                  </div>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};
