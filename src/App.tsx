import React, { useState, useEffect } from 'react';
import {
  Volume2,
  Sparkles,
  Play,
  RotateCcw,
  Download,
  Settings,
  Server,
  Activity,
  Layers,
  Award,
  History,
  CheckCircle2,
  AlertCircle,
  Cpu,
  Clock,
  ArrowRight,
  Sliders,
  FileText
} from 'lucide-react';
import { TopNav } from './components/TopNav';
import { WaveformPlayer } from './components/WaveformPlayer';
import { VoiceCloneModal } from './components/VoiceCloneModal';
import { ProviderModal } from './components/ProviderModal';
import { BenchmarkModal } from './components/BenchmarkModal';
import { HistoryDrawer } from './components/HistoryDrawer';
import { ModelRegistryView } from './components/ModelRegistryView';

import {
  SupportedLanguage,
  TaskType,
  InferenceProvider,
  VoicePreset,
  SynthesisJob,
  JobStatus,
  ModelCapability
} from './types';
import { VOICE_PRESETS, BENCHMARK_SENTENCES } from './data/presets';
import { MODEL_REGISTRY } from './data/models';
import { ProviderService } from './services/providerService';

const STORAGE_KEY_VOICES = 'voxindica_custom_voices';

const getInitialVoices = (): VoicePreset[] => {
  try {
    const stored = localStorage.getItem(STORAGE_KEY_VOICES);
    if (stored) {
      const parsed: VoicePreset[] = JSON.parse(stored);
      const sanitized = parsed.map((v) => ({
        ...v,
        measuredPitchHz: v.measuredPitchHz || (v.gender === 'male' ? 124 : 215),
        timbreDescription: v.timbreDescription || (v.gender === 'male' ? 'Warm grounded baritone with natural vocal texture' : 'Clear melodic vocal timbre with balanced upper harmonics')
      }));
      const presetIds = new Set(VOICE_PRESETS.map((p) => p.id));
      const customUnique = sanitized.filter((p) => !presetIds.has(p.id));
      return [...customUnique, ...VOICE_PRESETS];
    }
  } catch {
    // fallback
  }
  return VOICE_PRESETS;
};

export default function App() {
  const providerService = ProviderService.getInstance();

  // Navigation State
  const [activeTab, setActiveTab] = useState<'studio' | 'models' | 'benchmarks' | 'history'>('studio');

  // Studio Workspace State
  const [selectedLanguage, setSelectedLanguage] = useState<SupportedLanguage>('bn-IN');
  const [selectedTask, setSelectedTask] = useState<TaskType>('tts');
  const [voices, setVoices] = useState<VoicePreset[]>(getInitialVoices);
  const [selectedVoiceId, setSelectedVoiceId] = useState<string>('voice-bn-arpita');
  const [selectedModelId, setSelectedModelId] = useState<string>('voxcpm-2');
  const [activeProvider, setActiveProvider] = useState<InferenceProvider>('local');
  const [autoRoutingEnabled, setAutoRoutingEnabled] = useState<boolean>(false);

  // Script & Parameters
  const [inputText, setInputText] = useState<string>(
    'নমস্কার। ভক্সইন্ডিকা স্টুডিওতে আপনাকে স্বাগতম। বাংলা ভাষার শুদ্ধ ও প্রাঞ্জল উচ্চারণে আমরা স্পিচ সিন্থেসিস সম্পন্ন করছি।'
  );
  const [speed, setSpeed] = useState<number>(1.0);
  const [pitch, setPitch] = useState<number>(1.0);

  // Job Execution State
  const [jobStatus, setJobStatus] = useState<JobStatus>('idle');
  const [progressPercent, setProgressPercent] = useState<number>(0);
  const [statusMessage, setStatusMessage] = useState<string>('');
  const [activeAudioUrl, setActiveAudioUrl] = useState<string | null>(null);
  const [activeDuration, setActiveDuration] = useState<number>(0);
  const [activeSampleRate, setActiveSampleRate] = useState<number>(24000);
  const [historyJobs, setHistoryJobs] = useState<SynthesisJob[]>([]);

  // Modals
  const [isProviderModalOpen, setIsProviderModalOpen] = useState(false);
  const [isCloneModalOpen, setIsCloneModalOpen] = useState(false);
  const [isBenchmarkModalOpen, setIsBenchmarkModalOpen] = useState(false);
  const [isHistoryDrawerOpen, setIsHistoryDrawerOpen] = useState(false);

  // Active voice & model helpers
  const currentVoice = voices.find((v) => v.id === selectedVoiceId) || voices[0];
  const currentModel = MODEL_REGISTRY.find((m) => m.id === selectedModelId) || MODEL_REGISTRY[0];
  const providerConfig = providerService.getConfig(activeProvider);

  // Update voice list and default text when language changes
  const handleLanguageChange = (lang: SupportedLanguage) => {
    setSelectedLanguage(lang);
    const available = voices.filter((v) => v.language === lang);
    if (available.length > 0) {
      setSelectedVoiceId(available[0].id);
      setInputText(available[0].samplePrompt);
      setSpeed(available[0].speedDefault);
      setPitch(available[0].pitchDefault);
    }

    // Auto-select best model for the language
    const suitableModel = MODEL_REGISTRY.find((m) => m.supportedLanguages.includes(lang));
    if (suitableModel) {
      setSelectedModelId(suitableModel.id);
    }
  };

  const handleVoiceSelect = (voice: VoicePreset) => {
    setSelectedVoiceId(voice.id);
    setSelectedLanguage(voice.language);
    setSpeed(voice.speedDefault);
    setPitch(voice.pitchDefault);
    if (voice.samplePrompt) {
      setInputText(voice.samplePrompt);
    }
  };

  const handleVoiceCreated = (newVoice: VoicePreset) => {
    const updated = [newVoice, ...voices.filter((v) => v.id !== newVoice.id)];
    setVoices(updated);
    try {
      const customOnly = updated.filter((v) => v.isCloned);
      localStorage.setItem(STORAGE_KEY_VOICES, JSON.stringify(customOnly));
    } catch {
      // ignore
    }
    setSelectedVoiceId(newVoice.id);
    setSelectedLanguage(newVoice.language);
    setSelectedTask('voice_clone');
    // Ensure model supports voice cloning
    const cloneModel = MODEL_REGISTRY.find((m) => m.supportedTasks.includes('voice_clone'));
    if (cloneModel) {
      setSelectedModelId(cloneModel.id);
    }
  };

  const handleInsertBenchmarkSentence = (sentence: string) => {
    setInputText(sentence);
  };

  // Dispatch Speech Synthesis Job
  const handleSynthesize = async () => {
    if (!inputText.trim()) return;

    // Check auto-routing logic if enabled by user
    let effectiveProvider = activeProvider;
    if (autoRoutingEnabled) {
      const hfConfig = providerService.getConfig('huggingface');
      const kaggleConfig = providerService.getConfig('kaggle');
      const colabConfig = providerService.getConfig('colab');
      if (hfConfig.isConnected) {
        effectiveProvider = 'huggingface';
      } else if (kaggleConfig.isConnected) {
        effectiveProvider = 'kaggle';
      } else if (colabConfig.isConnected) {
        effectiveProvider = 'colab';
      } else {
        effectiveProvider = 'local';
      }
    }

    const newJob: SynthesisJob = {
      id: `job-${Date.now()}`,
      text: inputText,
      language: selectedLanguage,
      accent: currentVoice.accent,
      task: selectedTask,
      voice: currentVoice,
      modelId: selectedModelId,
      provider: effectiveProvider,
      speed,
      pitch,
      status: 'queued',
      progressPercent: 5,
      sampleRate: 24000,
      createdAt: new Date().toISOString()
    };

    setJobStatus('running');
    setProgressPercent(10);
    setStatusMessage('Queued synthesis task...');

    try {
      const result = await providerService.executeJob(newJob, (percent, msg) => {
        setProgressPercent(percent);
        setStatusMessage(msg);
      });

      const completedJob: SynthesisJob = {
        ...newJob,
        status: 'completed',
        progressPercent: 100,
        audioUrl: result.audioUrl,
        audioDurationSeconds: result.durationSeconds,
        latencyMs: result.latencyMs,
        completedAt: new Date().toISOString()
      };

      setActiveAudioUrl(result.audioUrl);
      setActiveDuration(result.durationSeconds);
      setActiveSampleRate(24000);
      setJobStatus('completed');
      setStatusMessage(`Synthesis completed in ${result.latencyMs}ms`);

      setHistoryJobs([completedJob, ...historyJobs]);
    } catch (err) {
      setJobStatus('failed');
      setStatusMessage(err instanceof Error ? err.message : 'Synthesis pipeline failed');
    }
  };

  const handleDownloadWav = () => {
    if (!activeAudioUrl) return;
    const a = document.createElement('a');
    a.href = activeAudioUrl;
    a.download = `voxindica_${selectedLanguage}_${currentVoice.id}_${Date.now()}.wav`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const handlePlayHistoricalJob = (job: SynthesisJob) => {
    if (job.audioUrl) {
      setActiveAudioUrl(job.audioUrl);
      setActiveDuration(job.audioDurationSeconds || 5.0);
      setActiveSampleRate(job.sampleRate || 24000);
      setSelectedLanguage(job.language);
      setSelectedVoiceId(job.voice.id);
      setIsHistoryDrawerOpen(false);
      setActiveTab('studio');
    }
  };

  return (
    <div className="min-h-screen bg-[#0B0F17] text-slate-100 flex flex-col font-sans">
      {/* 3-Zone Top Navigation Bar */}
      <TopNav
        activeTab={activeTab}
        setActiveTab={(tab) => {
          if (tab === 'benchmarks') {
            setIsBenchmarkModalOpen(true);
          } else if (tab === 'history') {
            setIsHistoryDrawerOpen(true);
          } else {
            setActiveTab(tab);
          }
        }}
        activeProvider={activeProvider}
        providerConfig={providerConfig}
        onOpenProviderModal={() => setIsProviderModalOpen(true)}
        onOpenCloneModal={() => setIsCloneModalOpen(true)}
      />

      {/* Main Workspace Viewport */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {activeTab === 'models' ? (
          <ModelRegistryView
            selectedModelId={selectedModelId}
            onSelectModel={(id) => {
              setSelectedModelId(id);
              setActiveTab('studio');
            }}
          />
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* Left 8 Columns: Script Studio & Parameters */}
            <div className="lg:col-span-8 space-y-6">
              {/* Task & Language Selection Bar */}
              <div className="p-4 bg-[#121927] border border-slate-800 rounded-xl space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-4">
                  {/* Language Selector */}
                  <div className="flex items-center gap-1.5 p-1 bg-slate-900 border border-slate-800 rounded-lg text-xs font-medium">
                    <button
                      onClick={() => handleLanguageChange('bn-IN')}
                      className={`px-3 py-1.5 rounded transition-colors cursor-pointer ${
                        selectedLanguage === 'bn-IN'
                          ? 'bg-amber-500 text-slate-950 font-bold shadow-sm'
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      Bengali (বাংলা · West Bengal)
                    </button>
                    <button
                      onClick={() => handleLanguageChange('hi-IN')}
                      className={`px-3 py-1.5 rounded transition-colors cursor-pointer ${
                        selectedLanguage === 'hi-IN'
                          ? 'bg-amber-500 text-slate-950 font-bold shadow-sm'
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      Hindi (हिन्दी · Indian Target)
                    </button>
                    <button
                      onClick={() => handleLanguageChange('en-IN')}
                      className={`px-3 py-1.5 rounded transition-colors cursor-pointer ${
                        selectedLanguage === 'en-IN'
                          ? 'bg-amber-500 text-slate-950 font-bold shadow-sm'
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      Indian English
                    </button>
                  </div>

                  {/* Task Mode Toggle */}
                  <div className="flex items-center gap-1 p-1 bg-slate-900 border border-slate-800 rounded-lg text-xs font-medium">
                    <button
                      onClick={() => setSelectedTask('tts')}
                      className={`px-3 py-1.5 rounded transition-colors cursor-pointer ${
                        selectedTask === 'tts'
                          ? 'bg-slate-800 text-amber-300 font-semibold'
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      Text-to-Speech
                    </button>
                    <button
                      onClick={() => setSelectedTask('voice_clone')}
                      className={`px-3 py-1.5 rounded transition-colors cursor-pointer ${
                        selectedTask === 'voice_clone'
                          ? 'bg-slate-800 text-amber-300 font-semibold'
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      Voice Cloning
                    </button>
                  </div>
                </div>

                {/* Voice Presets Carousel */}
                <div>
                  <div className="flex items-center justify-between text-xs text-slate-400 mb-2">
                    <span className="font-medium text-slate-300">
                      Available Voices ({selectedLanguage})
                    </span>
                    <button
                      onClick={() => setIsCloneModalOpen(true)}
                      className="text-amber-400 hover:underline cursor-pointer"
                    >
                      + Clone New Voice
                    </button>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                    {voices
                      .filter((v) => v.language === selectedLanguage)
                      .map((voice) => {
                        const isSelected = selectedVoiceId === voice.id;
                        return (
                          <div
                            key={voice.id}
                            onClick={() => handleVoiceSelect(voice)}
                            className={`p-3 rounded-lg border text-left cursor-pointer transition-all ${
                              isSelected
                                ? 'bg-amber-500/10 border-amber-500/60 shadow-sm'
                                : 'bg-slate-900/60 border-slate-800 hover:border-slate-700'
                            }`}
                          >
                            <div className="flex items-center justify-between">
                              <span className="text-xs font-bold text-slate-100 flex items-center gap-1.5 truncate">
                                {voice.isCloned && (
                                  <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" />
                                )}
                                <span className="truncate">{voice.name}</span>
                              </span>
                              <span className="text-[10px] font-mono text-slate-400 capitalize shrink-0 ml-1">
                                {voice.gender}
                              </span>
                            </div>
                            <div className="text-[11px] text-slate-400 truncate mt-0.5">
                              {voice.isCloned && voice.measuredPitchHz ? (
                                <span className="text-amber-300/90 font-mono text-[10px]">
                                  F0: {Math.round(voice.measuredPitchHz)}Hz · {voice.tag}
                                </span>
                              ) : (
                                voice.tag
                              )}
                            </div>
                            <div className="text-[10px] text-amber-400/80 font-mono mt-1">
                              {voice.accent}
                            </div>
                          </div>
                        );
                      })}
                  </div>
                </div>
              </div>

              {/* Script Editor Card */}
              <div className="p-5 bg-[#121927] border border-slate-800 rounded-xl space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <FileText className="w-4 h-4 text-amber-400" />
                    <label className="text-sm font-semibold text-slate-200">
                      Speech Script Input
                    </label>
                  </div>
                  <div className="text-xs text-slate-400 font-mono tabular-nums">
                    <span>{inputText.length} chars</span>
                    <span className="text-slate-600 mx-1.5">·</span>
                    <span>{inputText.trim() ? inputText.trim().split(/\s+/).length : 0} words</span>
                  </div>
                </div>

                {currentVoice.isCloned && (
                  <div className="p-2.5 bg-amber-500/10 border border-amber-500/30 rounded-lg flex items-center justify-between text-xs text-amber-300">
                    <div className="flex items-center gap-2 truncate">
                      <Sparkles className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                      <span className="truncate">
                        Custom Cloned Voice Active: <strong>{currentVoice.name}</strong>
                        {currentVoice.measuredPitchHz && ` · F0: ${Math.round(currentVoice.measuredPitchHz)}Hz`}
                        {' · '}{currentVoice.timbreDescription || 'Custom Acoustic Persona'}
                      </span>
                    </div>
                    <span className="text-[10px] font-mono bg-amber-500/20 px-2 py-0.5 rounded text-amber-300 shrink-0 ml-2">
                      Voice Design Active
                    </span>
                  </div>
                )}

                <textarea
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                  placeholder="Enter text to synthesize in Bengali, Hindi, or Indian English..."
                  rows={4}
                  className="w-full bg-slate-950/70 border border-slate-800 rounded-lg p-3.5 text-sm text-slate-100 placeholder:text-slate-600 focus:outline-none focus:border-amber-400/80 leading-relaxed font-sans"
                />

                {/* Phonetically Balanced Quick Benchmark Prompts */}
                <div>
                  <span className="text-[11px] uppercase tracking-wider text-slate-500 font-semibold block mb-1.5">
                    Verified Benchmark Sentences ({selectedLanguage})
                  </span>
                  <div className="flex flex-wrap gap-2">
                    {BENCHMARK_SENTENCES[selectedLanguage]?.map((item, idx) => (
                      <button
                        key={idx}
                        onClick={() => handleInsertBenchmarkSentence(item.text)}
                        className="text-left p-2 rounded bg-slate-900 border border-slate-800/80 hover:border-slate-700 text-xs text-slate-300 transition-colors cursor-pointer group"
                        title={item.phoneticFocus}
                      >
                        <span className="font-medium text-amber-300/90 group-hover:text-amber-200 block text-[11px]">
                          {item.title}
                        </span>
                        <span className="text-[11px] text-slate-400 line-clamp-1">
                          "{item.text}"
                        </span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Audio Synthesis Progress & Trigger */}
                <div className="pt-2 flex flex-col sm:flex-row items-center justify-between gap-4 border-t border-slate-800/80">
                  <div className="w-full sm:w-auto text-xs font-mono">
                    {jobStatus === 'running' && (
                      <div className="flex items-center gap-2 text-amber-400">
                        <Activity className="w-3.5 h-3.5 animate-spin" />
                        <span>{statusMessage} ({progressPercent}%)</span>
                      </div>
                    )}
                    {jobStatus === 'completed' && (
                      <div className="flex items-center gap-2 text-emerald-400">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span>{statusMessage}</span>
                      </div>
                    )}
                    {jobStatus === 'failed' && (
                      <div className="flex items-center gap-2 text-rose-400">
                        <AlertCircle className="w-3.5 h-3.5" />
                        <span>{statusMessage}</span>
                      </div>
                    )}
                    {jobStatus === 'idle' && (
                      <span className="text-slate-500">Awaiting generation trigger</span>
                    )}
                  </div>

                  <button
                    onClick={handleSynthesize}
                    disabled={jobStatus === 'running' || !inputText.trim()}
                    className={`w-full sm:w-auto px-6 py-2.5 rounded-lg text-xs font-bold flex items-center justify-center gap-2 transition-all cursor-pointer ${
                      jobStatus === 'running' || !inputText.trim()
                        ? 'bg-slate-800 text-slate-500 cursor-not-allowed border border-slate-700/50'
                        : 'bg-amber-500 hover:bg-amber-400 text-slate-950 shadow-lg shadow-amber-500/20 active:scale-[0.98]'
                    }`}
                  >
                    <Play className="w-3.5 h-3.5 fill-current" />
                    {jobStatus === 'running' ? 'Synthesizing...' : 'Synthesize Audio'}
                  </button>
                </div>
              </div>

              {/* Waveform Player Section */}
              <WaveformPlayer
                audioUrl={activeAudioUrl}
                durationSeconds={activeDuration}
                sampleRate={activeSampleRate}
                voiceName={currentVoice.name}
                languageLabel={selectedLanguage === 'bn-IN' ? 'Bengali (West Bengal)' : selectedLanguage === 'hi-IN' ? 'Hindi (India)' : 'Indian English'}
                text={inputText}
                language={selectedLanguage}
                speed={speed}
                pitch={pitch}
                gender={currentVoice.gender}
                onDownloadWav={handleDownloadWav}
              />
            </div>

            {/* Right 4 Columns: Provider Engine, Models & Parameters */}
            <div className="lg:col-span-4 space-y-6">
              {/* Provider Status & Routing Card */}
              <div className="p-5 bg-[#121927] border border-slate-800 rounded-xl space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Server className="w-4 h-4 text-amber-400" />
                    <h3 className="text-sm font-semibold text-slate-100">Inference Provider</h3>
                  </div>
                  <button
                    onClick={() => setIsProviderModalOpen(true)}
                    className="text-xs text-amber-400 hover:underline cursor-pointer"
                  >
                    Configure
                  </button>
                </div>

                <div className="p-3 bg-slate-900 border border-slate-800 rounded-lg space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-slate-400">Active Provider:</span>
                    <span className="font-semibold text-slate-200 font-mono">
                      {activeProvider === 'huggingface' ? 'Hugging Face API' : activeProvider === 'colab' ? 'Google Colab' : activeProvider === 'kaggle' ? 'Kaggle' : 'Local'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-slate-400">Status:</span>
                    <span className="font-mono text-[11px]">
                      {providerConfig.isConnected ? (
                        <span className="text-emerald-400 flex items-center gap-1">
                          Online ({providerConfig.latencyMs}ms)
                        </span>
                      ) : (
                        <span className="text-rose-400">Disconnected</span>
                      )}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-slate-400">Device Target:</span>
                    <span className="text-[11px] text-slate-300 font-mono truncate max-w-[170px]" title={providerConfig.gpuDeviceName}>
                      {providerConfig.gpuDeviceName}
                    </span>
                  </div>
                </div>

                {/* Explicit Auto-Routing Checkbox */}
                <div className="pt-2 border-t border-slate-800/80">
                  <label className="flex items-start gap-2.5 text-xs text-slate-300 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={autoRoutingEnabled}
                      onChange={(e) => setAutoRoutingEnabled(e.target.checked)}
                      className="mt-0.5 rounded border-slate-700 accent-amber-500 cursor-pointer"
                    />
                    <span>
                      <strong className="text-slate-200 block">Dynamic Provider Auto-Routing</strong>
                      Automatically route to remote Kaggle/Colab GPU workers when online, falling back to local hardware.
                    </span>
                  </label>
                </div>
              </div>

              {/* Model Router Card */}
              <div className="p-5 bg-[#121927] border border-slate-800 rounded-xl space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Layers className="w-4 h-4 text-amber-400" />
                    <h3 className="text-sm font-semibold text-slate-100">Model Routing</h3>
                  </div>
                  <button
                    onClick={() => setActiveTab('models')}
                    className="text-xs text-amber-400 hover:underline cursor-pointer"
                  >
                    View All
                  </button>
                </div>

                <div className="space-y-2">
                  <label className="block text-xs text-slate-400">Selected Model</label>
                  <select
                    value={selectedModelId}
                    onChange={(e) => setSelectedModelId(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-100 focus:outline-none focus:border-amber-400"
                  >
                    {MODEL_REGISTRY.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name} (v{m.version})
                      </option>
                    ))}
                  </select>
                </div>

                <div className="p-3 bg-slate-900/60 border border-slate-800 rounded-lg text-xs space-y-1.5 font-mono">
                  <div className="flex justify-between">
                    <span className="text-slate-500">License:</span>
                    <span className="text-slate-300">{currentModel.license}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Min VRAM:</span>
                    <span className="text-slate-300">{(currentModel.minVramMb / 1024).toFixed(1)} GB</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Est. MOS:</span>
                    <span className="text-emerald-400 font-semibold">{currentModel.meanOpinionScore.toFixed(2)} / 5</span>
                  </div>
                </div>
              </div>

              {/* Acoustic Speech Controls */}
              <div className="p-5 bg-[#121927] border border-slate-800 rounded-xl space-y-4">
                <div className="flex items-center gap-2">
                  <Sliders className="w-4 h-4 text-amber-400" />
                  <h3 className="text-sm font-semibold text-slate-100">Speech Controls</h3>
                </div>

                {/* Speed Slider */}
                <div className="space-y-1.5">
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-400">Speaking Rate</span>
                    <span className="font-mono text-slate-200 tabular-nums">{speed.toFixed(2)}x</span>
                  </div>
                  <input
                    type="range"
                    min="0.5"
                    max="1.8"
                    step="0.05"
                    value={speed}
                    onChange={(e) => setSpeed(parseFloat(e.target.value))}
                    className="w-full accent-amber-500 cursor-pointer"
                  />
                </div>

                {/* Pitch Slider */}
                <div className="space-y-1.5">
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-400">Pitch Shift</span>
                    <span className="font-mono text-slate-200 tabular-nums">{pitch.toFixed(2)}x</span>
                  </div>
                  <input
                    type="range"
                    min="0.75"
                    max="1.35"
                    step="0.05"
                    value={pitch}
                    onChange={(e) => setPitch(parseFloat(e.target.value))}
                    className="w-full accent-amber-500 cursor-pointer"
                  />
                </div>

                <div className="pt-2 flex justify-between">
                  <button
                    onClick={() => {
                      setSpeed(currentVoice.speedDefault);
                      setPitch(currentVoice.pitchDefault);
                    }}
                    className="text-[11px] text-slate-400 hover:text-slate-200 flex items-center gap-1 cursor-pointer transition-colors"
                  >
                    <RotateCcw className="w-3 h-3" />
                    Reset to Voice Defaults
                  </button>
                </div>
              </div>

              {/* Honest Worker Policy Card */}
              <div className="p-4 bg-slate-900/40 border border-slate-800 rounded-xl text-xs text-slate-400 space-y-2">
                <div className="font-semibold text-slate-300 flex items-center gap-1.5">
                  <Clock className="w-3.5 h-3.5 text-amber-400" />
                  Honest Worker Heartbeat Policy
                </div>
                <p className="text-[11px] text-slate-400 leading-relaxed">
                  VoxIndica Studio communicates with remote workers via 30-second ping heartbeats. When a notebook kernel disconnects, status transitions honestly to Offline without fabricating remaining cloud quotas.
                </p>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Interactive Modals */}
      <ProviderModal
        isOpen={isProviderModalOpen}
        onClose={() => setIsProviderModalOpen(false)}
        activeProvider={activeProvider}
        onSelectProvider={(p) => setActiveProvider(p)}
      />

      <VoiceCloneModal
        isOpen={isCloneModalOpen}
        onClose={() => setIsCloneModalOpen(false)}
        onVoiceCreated={handleVoiceCreated}
      />

      <BenchmarkModal
        isOpen={isBenchmarkModalOpen}
        onClose={() => setIsBenchmarkModalOpen(false)}
      />

      <HistoryDrawer
        isOpen={isHistoryDrawerOpen}
        onClose={() => setIsHistoryDrawerOpen(false)}
        jobs={historyJobs}
        onPlayJob={handlePlayHistoricalJob}
        onClearHistory={() => setHistoryJobs([])}
      />
    </div>
  );
}
