import React, { useState } from 'react';
import {
  X,
  Server,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  Cpu,
  Key,
  Trash2,
  Plus,
  ExternalLink,
  ShieldCheck,
  Check,
  Sparkles,
  HelpCircle
} from 'lucide-react';
import { InferenceProvider, ProviderEndpointConfig, ApiKeyRecord } from '../types';
import { ProviderService } from '../services/providerService';

interface ProviderModalProps {
  isOpen: boolean;
  onClose: () => void;
  activeProvider: InferenceProvider;
  onSelectProvider: (provider: InferenceProvider) => void;
}

export const ProviderModal: React.FC<ProviderModalProps> = ({
  isOpen,
  onClose,
  activeProvider,
  onSelectProvider
}) => {
  const providerService = ProviderService.getInstance();
  const [selectedTab, setSelectedTab] = useState<InferenceProvider>(activeProvider);
  const [configs, setConfigs] = useState<Record<InferenceProvider, ProviderEndpointConfig>>(
    providerService.getAllConfigs()
  );
  const [savedKeys, setSavedKeys] = useState<ApiKeyRecord[]>(providerService.getAllApiKeys());
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);

  // New Key input states
  const [newKeyLabel, setNewKeyLabel] = useState('');
  const [showTunnelExplainer, setShowTunnelExplainer] = useState(false);

  if (!isOpen) return null;

  const currentConfig = configs[selectedTab];
  const keysForCurrentTab = savedKeys.filter((k) => k.provider === selectedTab);

  const handleUrlChange = (val: string) => {
    setConfigs({
      ...configs,
      [selectedTab]: {
        ...configs[selectedTab],
        endpointUrl: val
      }
    });
  };

  const handleTokenChange = (val: string) => {
    setConfigs({
      ...configs,
      [selectedTab]: {
        ...configs[selectedTab],
        bearerToken: val
      }
    });
  };

  const handleTestConnection = async () => {
    setIsTesting(true);
    setTestResult(null);
    try {
      const updated = await providerService.testConnection(
        selectedTab,
        currentConfig.endpointUrl,
        currentConfig.bearerToken,
        newKeyLabel.trim() || undefined
      );
      setConfigs({
        ...configs,
        [selectedTab]: updated
      });
      setSavedKeys(providerService.getAllApiKeys());
      setTestResult(updated.statusMessage || (updated.isConnected ? 'Connection verified!' : 'Connection failed'));
      if (updated.isConnected) {
        setNewKeyLabel('');
      }
    } finally {
      setIsTesting(false);
    }
  };

  const handleActivateSavedKey = (keyId: string) => {
    providerService.setActiveApiKey(selectedTab, keyId);
    setSavedKeys(providerService.getAllApiKeys());
    setConfigs(providerService.getAllConfigs());
    setTestResult('Key activated successfully');
  };

  const handleDeleteSavedKey = (keyId: string) => {
    providerService.deleteApiKey(keyId);
    setSavedKeys(providerService.getAllApiKeys());
  };

  const handleSaveAndActivate = () => {
    providerService.saveConfig(currentConfig);
    onSelectProvider(selectedTab);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4 overflow-y-auto">
      <div className="bg-[#121927] border border-slate-800 rounded-xl w-full max-w-3xl shadow-2xl overflow-hidden my-6 flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 shrink-0">
          <div>
            <h3 className="text-base font-semibold text-slate-100 flex items-center gap-2">
              <Server className="w-4 h-4 text-amber-400" />
              Inference Provider & API Key Manager
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">
              Configure Local, Hugging Face API, Kaggle, or Google Colab with multi-key storage.
            </p>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white flex items-center justify-center transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Provider Tabs */}
        <div className="flex border-b border-slate-800 bg-slate-900/60 px-6 pt-2 overflow-x-auto shrink-0">
          {(['local', 'huggingface', 'kaggle', 'colab'] as InferenceProvider[]).map((p) => {
            const isCurrent = activeProvider === p;
            const isTabActive = selectedTab === p;
            const label =
              p === 'local'
                ? 'Local Hardware'
                : p === 'huggingface'
                ? 'Hugging Face API'
                : p === 'kaggle'
                ? 'Kaggle GPU Worker'
                : 'Google Colab Worker';

            return (
              <button
                key={p}
                onClick={() => {
                  setSelectedTab(p);
                  setTestResult(null);
                }}
                className={`px-4 py-2.5 text-xs font-semibold capitalize border-b-2 transition-all flex items-center gap-2 cursor-pointer whitespace-nowrap ${
                  isTabActive
                    ? 'border-amber-400 text-amber-400'
                    : 'border-transparent text-slate-400 hover:text-slate-200'
                }`}
              >
                <span>{label}</span>
                {isCurrent && (
                  <span className="text-[10px] px-1.5 py-0.2 bg-amber-500/20 text-amber-300 rounded font-mono">
                    Active
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Tab Body */}
        <div className="p-6 space-y-5 overflow-y-auto flex-1">
          {/* TAB 1: LOCAL */}
          {selectedTab === 'local' && (
            <div className="space-y-4">
              <div className="p-4 bg-slate-900 border border-slate-800 rounded-lg">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <Cpu className="w-4 h-4 text-emerald-400" />
                    <span className="text-sm font-semibold text-slate-100">Local Hardware Execution</span>
                  </div>
                  <span className="text-xs text-emerald-400 font-medium">Ready</span>
                </div>
                <p className="text-xs text-slate-400 leading-relaxed mb-3">
                  Runs directly on this computer's browser & host runtime with zero external API dependencies. Compatible with Apple Silicon MPS, NVIDIA CUDA, or CPU fallback.
                </p>
                <div className="grid grid-cols-2 gap-3 text-xs font-mono">
                  <div className="bg-slate-950/70 p-2.5 rounded border border-slate-800/80">
                    <span className="text-slate-500 block text-[11px]">Primary Engine</span>
                    <span className="text-slate-200 font-semibold">{currentConfig.gpuDeviceName}</span>
                  </div>
                  <div className="bg-slate-950/70 p-2.5 rounded border border-slate-800/80">
                    <span className="text-slate-500 block text-[11px]">Measured Latency</span>
                    <span className="text-emerald-400 font-semibold tabular-nums">{currentConfig.latencyMs}ms</span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: HUGGING FACE */}
          {selectedTab === 'huggingface' && (
            <div className="space-y-5">
              <div className="p-4 bg-gradient-to-r from-amber-500/10 to-orange-500/5 border border-amber-500/20 rounded-lg text-xs text-slate-300 space-y-2">
                <div className="flex items-center justify-between font-semibold text-amber-300">
                  <span className="flex items-center gap-1.5">
                    <Sparkles className="w-4 h-4 text-amber-400" />
                    Hugging Face Direct Serverless Inference
                  </span>
                  <a
                    href="https://huggingface.co/settings/tokens"
                    target="_blank"
                    rel="noreferrer"
                    className="text-amber-400 hover:underline flex items-center gap-1 font-normal text-[11px]"
                  >
                    Get HF Access Token <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
                <p className="text-slate-400 leading-relaxed">
                  No tunnel or notebook needed! Hugging Face provides direct, high-availability cloud inference for Indic-TTS, MMS, and multilingual speech models using your personal or organization User Access Token (<code className="text-amber-300 font-mono">hf_...</code>).
                </p>
              </div>

              {/* Input for Key */}
              <div className="space-y-3 p-4 bg-slate-900 border border-slate-800 rounded-lg">
                <span className="text-xs font-semibold text-slate-200 block">Add / Update Hugging Face Key</span>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="sm:col-span-1">
                    <label className="block text-[11px] font-medium text-slate-400 mb-1">
                      Key Label / Name
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. Personal Token, Team Pro"
                      value={newKeyLabel}
                      onChange={(e) => setNewKeyLabel(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-100 placeholder:text-slate-600 focus:outline-none focus:border-amber-400"
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="block text-[11px] font-medium text-slate-400 mb-1">
                      Hugging Face Access Token (hf_...)
                    </label>
                    <input
                      type="password"
                      placeholder="hf_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                      value={currentConfig.bearerToken}
                      onChange={(e) => handleTokenChange(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-100 placeholder:text-slate-600 focus:outline-none focus:border-amber-400 font-mono"
                    />
                  </div>
                </div>

                <div className="flex justify-end pt-1">
                  <button
                    type="button"
                    onClick={handleTestConnection}
                    disabled={isTesting || !currentConfig.bearerToken}
                    className="px-3.5 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${isTesting ? 'animate-spin' : ''}`} />
                    {isTesting ? 'Verifying HF Token...' : 'Test & Save Token'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* TAB 3 & 4: KAGGLE / COLAB */}
          {(selectedTab === 'kaggle' || selectedTab === 'colab') && (
            <div className="space-y-4">
              {/* Explainer for why trycloudflare tunnel is needed */}
              <div className="p-3.5 bg-slate-900 border border-slate-800 rounded-lg text-xs space-y-2">
                <div className="flex items-center justify-between text-slate-200 font-semibold">
                  <span>How {selectedTab === 'kaggle' ? 'Kaggle' : 'Google Colab'} Worker Works:</span>
                  <button
                    onClick={() => setShowTunnelExplainer(!showTunnelExplainer)}
                    className="text-amber-400 hover:underline flex items-center gap-1 text-[11px] font-normal cursor-pointer"
                  >
                    <HelpCircle className="w-3 h-3" />
                    Why is trycloudflare / ngrok URL needed?
                  </button>
                </div>

                {showTunnelExplainer ? (
                  <div className="p-3 bg-slate-950 rounded border border-amber-500/20 text-slate-300 space-y-1.5 text-[11px] leading-relaxed">
                    <p className="font-semibold text-amber-300">
                      কেন trycloudflare.com টানেল URL লাগে? (Why Tunnel is Required):
                    </p>
                    <p>
                      Kaggle এবং Google Colab সাধারণ ওয়েব সার্ভার নয়। এগুলি Google ও Kaggle-এর ফায়ারওয়ালের ভেতরে চলা ক্লাউড নোটবুক। এগুলির নিজস্ব কোনো পাবলিক আইপি বা পোর্ট ওপেন থাকে না যাতে বাইরের কোনো ব্রাউজার সরাসরি কল করতে পারে।
                    </p>
                    <p>
                      তাই নোটবুকের ভেতর চলা পাইথন FastAPI সার্ভারটিকে আমাদের স্টুডিওর সাথে সুরক্ষিতভাবে কানেক্ট করতে ক্লাউডফ্লেয়ার টানেল (Cloudflare Tunnel) একটি ফ্রি বহির্মুখী সুড়ঙ্গ তৈরি করে সাময়িক পাবলিক লিঙ্ক (<code className="text-amber-300">https://xyz.trycloudflare.com</code>) প্রদান করে।
                    </p>
                  </div>
                ) : (
                  <ol className="list-decimal list-inside space-y-1 text-slate-400 leading-relaxed text-[11px]">
                    <li>Open your VoxIndica worker notebook in {selectedTab === 'kaggle' ? 'Kaggle' : 'Google Colab'}.</li>
                    <li>Run the startup cell to launch the FastAPI server and Cloudflare/ngrok reverse tunnel.</li>
                    <li>Copy the resulting tunnel URL and bearer token into the fields below.</li>
                  </ol>
                )}
              </div>

              {/* Tunnel URL & Token Inputs */}
              <div className="space-y-3 p-4 bg-slate-900 border border-slate-800 rounded-lg">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="sm:col-span-1">
                    <label className="block text-[11px] font-medium text-slate-400 mb-1">
                      Session / Key Label
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. Session 1 (Tesla T4)"
                      value={newKeyLabel}
                      onChange={(e) => setNewKeyLabel(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-100 placeholder:text-slate-600 focus:outline-none focus:border-amber-400"
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="block text-[11px] font-medium text-slate-400 mb-1">
                      Secure Tunnel URL
                    </label>
                    <input
                      type="text"
                      placeholder="https://voxindica-worker.trycloudflare.com"
                      value={currentConfig.endpointUrl}
                      onChange={(e) => handleUrlChange(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-100 placeholder:text-slate-600 focus:outline-none focus:border-amber-400 font-mono"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-[11px] font-medium text-slate-400 mb-1">
                    Worker Bearer Token
                  </label>
                  <input
                    type="password"
                    placeholder="Paste authentication token from notebook cell"
                    value={currentConfig.bearerToken}
                    onChange={(e) => handleTokenChange(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-100 placeholder:text-slate-600 focus:outline-none focus:border-amber-400 font-mono"
                  />
                </div>

                <div className="flex justify-end pt-1">
                  <button
                    type="button"
                    onClick={handleTestConnection}
                    disabled={isTesting || !currentConfig.endpointUrl}
                    className="px-3.5 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${isTesting ? 'animate-spin' : ''}`} />
                    {isTesting ? 'Pinging Worker...' : 'Test & Save Session'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Test Result Callout */}
          {testResult && (
            <div
              className={`p-3 rounded-lg text-xs flex items-center gap-2 ${
                currentConfig.isConnected
                  ? 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-300'
                  : 'bg-rose-500/10 border border-rose-500/30 text-rose-300'
              }`}
            >
              {currentConfig.isConnected ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              ) : (
                <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
              )}
              <span>{testResult}</span>
            </div>
          )}

          {/* MULTI-KEY VAULT LIST */}
          <div className="space-y-3 pt-2 border-t border-slate-800">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-200 flex items-center gap-1.5">
                <Key className="w-3.5 h-3.5 text-amber-400" />
                Saved API Keys & Sessions for {selectedTab.toUpperCase()} ({keysForCurrentTab.length})
              </span>
              <span className="text-[11px] text-slate-500">Stored safely in local browser storage</span>
            </div>

            {keysForCurrentTab.length === 0 ? (
              <div className="p-3 bg-slate-900/40 border border-dashed border-slate-800 rounded-lg text-xs text-slate-500 text-center">
                No saved keys for this provider yet. Add a key above and click "Test & Save".
              </div>
            ) : (
              <div className="space-y-2">
                {keysForCurrentTab.map((k) => (
                  <div
                    key={k.id}
                    className={`p-3 rounded-lg border text-xs flex items-center justify-between gap-3 transition-colors ${
                      k.isActive
                        ? 'bg-amber-500/10 border-amber-500/50'
                        : 'bg-slate-900/80 border-slate-800 hover:border-slate-700'
                    }`}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-slate-200 truncate">{k.label}</span>
                        {k.isActive && (
                          <span className="text-[10px] px-1.5 py-0.2 bg-amber-500/20 text-amber-300 rounded font-mono">
                            Active
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] font-mono text-slate-400 truncate mt-0.5">
                        {k.keyOrToken
                          ? `${k.keyOrToken.slice(0, 7)}••••••••${k.keyOrToken.slice(-4)}`
                          : 'No token stored'}
                        {k.endpointUrl && ` · ${k.endpointUrl}`}
                        {k.accountDetails && ` · ${k.accountDetails}`}
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      {!k.isActive && (
                        <button
                          type="button"
                          onClick={() => handleActivateSavedKey(k.id)}
                          className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 text-[11px] font-medium border border-slate-700 transition-colors cursor-pointer"
                        >
                          Activate
                        </button>
                      )}
                      {k.id !== 'default-local' && (
                        <button
                          type="button"
                          onClick={() => handleDeleteSavedKey(k.id)}
                          className="p-1 rounded text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 transition-colors cursor-pointer"
                          title="Delete key"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-3 px-6 py-4 bg-slate-900/90 border-t border-slate-800 shrink-0">
          <div className="text-xs text-slate-500 font-mono">
            {currentConfig.isConnected ? (
              <span className="text-emerald-400 font-semibold">Ready to synthesize</span>
            ) : (
              <span>Provider Offline</span>
            )}
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={onClose}
              className="px-4 py-2 text-xs font-medium text-slate-400 hover:text-slate-200 transition-colors cursor-pointer"
            >
              Close
            </button>
            <button
              onClick={handleSaveAndActivate}
              className="px-4 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer shadow-lg shadow-amber-500/20"
            >
              <Check className="w-3.5 h-3.5" />
              Activate Provider
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
