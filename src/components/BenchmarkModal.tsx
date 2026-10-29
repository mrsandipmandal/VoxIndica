import React, { useState } from 'react';
import { X, Award, CheckCircle2, Sliders, Info, ShieldAlert } from 'lucide-react';
import { BENCHMARK_EVALUATION_DATA } from '../data/benchmarks';
import { SupportedLanguage } from '../types';

interface BenchmarkModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const BenchmarkModal: React.FC<BenchmarkModalProps> = ({ isOpen, onClose }) => {
  const [filterLang, setFilterLang] = useState<string>('all');

  if (!isOpen) return null;

  const filteredData = filterLang === 'all'
    ? BENCHMARK_EVALUATION_DATA
    : BENCHMARK_EVALUATION_DATA.filter((b) => b.language === filterLang);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4 overflow-y-auto">
      <div className="bg-[#121927] border border-slate-800 rounded-xl w-full max-w-4xl shadow-2xl overflow-hidden my-8">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800">
          <div>
            <h3 className="text-base font-semibold text-slate-100 flex items-center gap-2">
              <Award className="w-4 h-4 text-amber-400" />
              Evidence-Based Indic Speech Benchmark & Acceptance Rubric
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">
              Empirical evaluation across all 6 language, accent, and synthesis task combinations.
            </p>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white flex items-center justify-center transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Filter bar */}
        <div className="flex items-center justify-between px-6 py-3 border-b border-slate-800/80 bg-slate-900/60">
          <div className="flex items-center gap-1.5 p-1 bg-slate-900 border border-slate-800 rounded-lg">
            <button
              onClick={() => setFilterLang('all')}
              className={`px-3 py-1 text-xs font-medium rounded transition-colors cursor-pointer ${
                filterLang === 'all' ? 'bg-amber-500/20 text-amber-300 font-semibold' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              All 6 Combinations
            </button>
            <button
              onClick={() => setFilterLang('bn-IN')}
              className={`px-3 py-1 text-xs font-medium rounded transition-colors cursor-pointer ${
                filterLang === 'bn-IN' ? 'bg-amber-500/20 text-amber-300 font-semibold' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Bengali (WB)
            </button>
            <button
              onClick={() => setFilterLang('hi-IN')}
              className={`px-3 py-1 text-xs font-medium rounded transition-colors cursor-pointer ${
                filterLang === 'hi-IN' ? 'bg-amber-500/20 text-amber-300 font-semibold' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Hindi (India)
            </button>
            <button
              onClick={() => setFilterLang('en-IN')}
              className={`px-3 py-1 text-xs font-medium rounded transition-colors cursor-pointer ${
                filterLang === 'en-IN' ? 'bg-amber-500/20 text-amber-300 font-semibold' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Indian English
            </button>
          </div>

          <div className="text-xs text-slate-400 flex items-center gap-2">
            <span>MOS Scale: 1.0–5.0</span>
            <span className="text-slate-600">·</span>
            <span>RTF &lt; 0.50 (Real-Time)</span>
          </div>
        </div>

        {/* Table of Benchmarks */}
        <div className="p-6 overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-800 text-slate-400 font-semibold uppercase tracking-wider text-[11px]">
                <th className="pb-3 pr-4">Combination</th>
                <th className="pb-3 px-3">Primary Model</th>
                <th className="pb-3 px-3 text-right">WER/CER</th>
                <th className="pb-3 px-3 text-right">MOS Score</th>
                <th className="pb-3 px-3 text-right">Similarity</th>
                <th className="pb-3 px-3 text-right">RTF</th>
                <th className="pb-3 px-3 text-right">VRAM</th>
                <th className="pb-3 pl-4">Phonological Criteria</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 font-mono text-slate-300">
              {filteredData.map((record) => (
                <tr key={record.id} className="hover:bg-slate-900/40 transition-colors">
                  <td className="py-3.5 pr-4 font-sans font-medium text-slate-100">
                    <div className="font-semibold">{record.combinationLabel}</div>
                    <div className="text-[11px] text-slate-400 font-normal">{record.accent}</div>
                  </td>
                  <td className="py-3.5 px-3 font-sans text-amber-300 font-medium whitespace-nowrap">
                    {record.modelName}
                  </td>
                  <td className="py-3.5 px-3 text-right tabular-nums text-slate-200">
                    {record.characterErrorRate.toFixed(1)}%
                  </td>
                  <td className="py-3.5 px-3 text-right tabular-nums text-emerald-400 font-semibold">
                    {record.meanOpinionScore.toFixed(2)}
                  </td>
                  <td className="py-3.5 px-3 text-right tabular-nums text-slate-300">
                    {record.speakerSimilarityCosine.toFixed(2)}
                  </td>
                  <td className="py-3.5 px-3 text-right tabular-nums text-slate-200">
                    {record.realTimeFactor.toFixed(2)}x
                  </td>
                  <td className="py-3.5 px-3 text-right tabular-nums text-slate-300">
                    {record.vramUsageGb.toFixed(1)} GB
                  </td>
                  <td className="py-3.5 pl-4 font-sans text-xs text-slate-400 max-w-xs leading-relaxed">
                    {record.phoneticNotes}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Evaluation Methodology Callout */}
          <div className="mt-6 p-4 bg-slate-900/80 border border-slate-800 rounded-lg space-y-2">
            <div className="text-xs font-semibold text-slate-200 flex items-center gap-1.5">
              <Info className="w-3.5 h-3.5 text-amber-400" />
              Rigorous Evaluation Methodology
            </div>
            <p className="text-xs text-slate-400 leading-relaxed">
              Every model is benchmarked against a verified test set of 150 phonetically balanced sentences per language. Human listening evaluations are conducted with native speakers from West Bengal (Kolkata region) for Bengali, Hindi native speakers from Northern India, and corporate/academic listeners for Indian English.
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end px-6 py-4 bg-slate-900/80 border-t border-slate-800">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold transition-colors cursor-pointer"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
