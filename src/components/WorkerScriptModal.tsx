import React, { useState } from 'react';
import { X, Copy, Check, Terminal, FileCode, ExternalLink, Download, BookOpen } from 'lucide-react';
import { WORKER_SCRIPTS, WorkerPlatform } from '../data/workerScripts';

interface WorkerScriptModalProps {
  isOpen: boolean;
  onClose: () => void;
  platform: WorkerPlatform;
}

/**
 * Shows the exact same worker code that is committed to the repo
 * (`workers/voxindica_worker_core.py`) — generated into `src/data/workerScripts.ts`.
 * No fake fallbacks, no hand-written drifting copies.
 */
export const WorkerScriptModal: React.FC<WorkerScriptModalProps> = ({ isOpen, onClose, platform }) => {
  const [copied, setCopied] = useState(false);
  const bundle = WORKER_SCRIPTS[platform];

  if (!isOpen) return null;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(bundle.code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="fixed inset-0 z-60 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 overflow-y-auto">
      <div className="bg-[#121927] border border-slate-800 rounded-xl w-full max-w-3xl shadow-2xl overflow-hidden my-6 flex flex-col max-h-[88vh]">
        <div className="flex items-start justify-between px-6 py-4 border-b border-slate-800 shrink-0">
          <div>
            <h3 className="text-base font-semibold text-slate-100 flex items-center gap-2">
              <Terminal className="w-4 h-4 text-amber-400" />
              {bundle.label} worker setup
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">
              {platform === 'local'
                ? 'Runs on 127.0.0.1:8000 — no tunnel, no public URL.'
                : 'One paste-and-run cell. It installs, loads VoxCPM2, starts the API and opens the tunnel.'}
            </p>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white flex items-center justify-center transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6 space-y-5 overflow-y-auto flex-1">
          <ol className="space-y-2.5">
            {bundle.steps.map((step, index) => (
              <li key={step.title} className="flex gap-3 text-xs">
                <span className="w-5 h-5 shrink-0 rounded-full bg-amber-500/15 text-amber-300 border border-amber-500/30 flex items-center justify-center font-mono text-[10px]">
                  {index + 1}
                </span>
                <div className="space-y-0.5">
                  <p className="font-semibold text-slate-200">{step.title}</p>
                  <p className="text-slate-400 leading-relaxed">{step.detail}</p>
                  {step.link && (
                    <a
                      href={step.link.href}
                      target="_blank"
                      rel="noreferrer"
                      className="text-amber-400 hover:underline inline-flex items-center gap-1 text-[11px]"
                    >
                      {step.link.label} <ExternalLink className="w-3 h-3" />
                    </a>
                  )}
                </div>
              </li>
            ))}
          </ol>

          <div className="flex flex-wrap items-center gap-2">
            {bundle.notebookPath && (
              <a
                href={bundle.notebookPath}
                download
                className="px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-semibold flex items-center gap-1.5"
              >
                <Download className="w-3.5 h-3.5" />
                Download .ipynb
              </a>
            )}
            <a
              href={bundle.pythonPath}
              download
              className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-medium flex items-center gap-1.5"
            >
              <FileCode className="w-3.5 h-3.5" />
              {bundle.pythonFileName}
            </a>
            <button
              type="button"
              onClick={handleCopy}
              className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-medium flex items-center gap-1.5 cursor-pointer"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              {copied ? 'Copied' : 'Copy code'}
            </button>
            <a
              href={bundle.docsUrl}
              target="_blank"
              rel="noreferrer"
              className="px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800 text-xs font-medium flex items-center gap-1.5"
            >
              <BookOpen className="w-3.5 h-3.5" />
              Docs
            </a>
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-[11px]">
              <span className="text-slate-400 font-mono">{bundle.pythonFileName}</span>
              <span className="text-slate-500">{bundle.code.split('\n').length} lines · generated</span>
            </div>
            <pre className="bg-slate-950 border border-slate-800 rounded-lg p-3 text-[11px] leading-relaxed text-slate-300 overflow-auto max-h-[320px] font-mono">
              {bundle.code}
            </pre>
          </div>

          <div className="p-3 bg-slate-900 border border-slate-800 rounded-lg text-[11px] text-slate-400 leading-relaxed space-y-1">
            <p>
              <span className="text-slate-200 font-semibold">Generated from</span>{' '}
              <code className="font-mono text-slate-300">workers/voxindica_worker_core.py</code> — edit the core, then run{' '}
              <code className="font-mono text-slate-300">python workers/build_notebooks.py</code>.
            </p>
            <p>
              Packages: <code className="font-mono text-slate-300">{bundle.packages.join(', ')}</code>. Output is 16-bit mono
              PCM WAV at the model sample rate (24 kHz for VoxCPM2).
            </p>
            <p className="text-amber-300/80">
              If the model cannot load, the worker answers HTTP 503 with the real error — it never plays synthetic
              audio as a substitute.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
