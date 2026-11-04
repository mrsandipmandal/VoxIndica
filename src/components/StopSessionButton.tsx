import React, { useState } from 'react';
import { Power, Loader2, AlertCircle, CheckCircle2 } from 'lucide-react';
import { InferenceProvider } from '../types';
import { ProviderService } from '../services/providerService';

interface StopSessionButtonProps {
  provider: InferenceProvider;
  onStopped?: (result: { ok: boolean; message: string }) => void;
}

const SESSION_LABELS: Partial<Record<InferenceProvider, string>> = {
  kaggle: 'Kaggle GPU',
  colab: 'Colab GPU',
  local: 'local worker'
};

/**
 * Stops a hosted worker session without leaving the Studio.
 *
 * Kaggle is cancelled through the Kaggle API first, so a worker that predates
 * /shutdown can still be stopped. The worker /shutdown endpoint is the fallback
 * (and the only route for Colab).
 */
export const StopSessionButton: React.FC<StopSessionButtonProps> = ({ provider, onStopped }) => {
  const [confirming, setConfirming] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  if (provider === 'huggingface') return null;

  const sessionLabel = SESSION_LABELS[provider] ?? 'worker';

  const handleStop = async () => {
    setStopping(true);
    setResult(null);
    const response = await ProviderService.getInstance().stopSession(provider);
    setStopping(false);
    setConfirming(false);
    setResult(response);
    onStopped?.(response);
  };

  return (
    <div className="space-y-2">
      {!confirming ? (
        <button
          type="button"
          onClick={() => {
            setResult(null);
            setConfirming(true);
          }}
          disabled={stopping}
          className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg border border-rose-500/40 bg-rose-500/5 text-rose-300 hover:bg-rose-500/10 hover:border-rose-500/60 text-xs font-semibold transition-colors cursor-pointer disabled:opacity-50"
        >
          <Power className="w-3.5 h-3.5" />
          Stop session
        </button>
      ) : (
        <div className="rounded-lg border border-rose-500/40 bg-rose-500/5 p-3 space-y-2">
          <p className="text-[11px] text-slate-300 leading-relaxed">
            Stop the {sessionLabel} session? The worker and its tunnel close, and GPU hours stop accruing. This
            cannot be undone.
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setConfirming(false)}
              disabled={stopping}
              className="flex-1 px-3 py-1.5 rounded-lg border border-slate-700 bg-slate-900 text-slate-300 hover:bg-slate-800 text-xs font-semibold transition-colors cursor-pointer disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void handleStop()}
              disabled={stopping}
              className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-500 hover:bg-rose-400 text-white text-xs font-semibold transition-colors cursor-pointer disabled:opacity-60"
            >
              {stopping ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Power className="w-3.5 h-3.5" />}
              {stopping ? 'Stopping…' : 'Yes, stop'}
            </button>
          </div>
        </div>
      )}

      {result && (
        <p
          className={`flex items-start gap-1.5 text-[11px] leading-relaxed ${
            result.ok ? 'text-emerald-400' : 'text-rose-300'
          }`}
        >
          {result.ok ? (
            <CheckCircle2 className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          ) : (
            <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          )}
          <span>{result.message}</span>
        </p>
      )}
    </div>
  );
};
