import React, { useEffect, useRef, useState } from 'react';
import {
  X,
  Server,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  Cpu,
  Key,
  Trash2,
  ExternalLink,
  Check,
  Sparkles,
  HelpCircle,
  Terminal,
  Rocket,
  Download,
  Copy,
  Wifi,
  WifiOff,
  Loader2,
  Eye,
  EyeOff,
  MousePointerClick
} from 'lucide-react';
import {
  InferenceProvider,
  ProviderEndpointConfig,
  ApiKeyRecord,
  ProviderAuthMethod,
  KaggleLaunchState,
  KaggleAuthScheme,
  WorkerHealth,
  LocalHardwareInfo
} from '../types';
import { ProviderService } from '../services/providerService';
import { detectLocalHardware, formatGpuLabel } from '../utils/hardware';
import { WORKER_SCRIPTS, WorkerPlatform } from '../data/workerScripts';
import { WorkerScriptModal } from './WorkerScriptModal';

interface ProviderModalProps {
  isOpen: boolean;
  onClose: () => void;
  activeProvider: InferenceProvider;
  onSelectProvider: (provider: InferenceProvider) => void;
}

const PROVIDER_LABELS: Record<InferenceProvider, string> = {
  local: 'Local Hardware',
  huggingface: 'Hugging Face API',
  kaggle: 'Kaggle GPU Worker',
  colab: 'Google Colab Worker'
};

const DOC_LINKS: Record<InferenceProvider, { href: string; label: string }> = {
  local: { href: '/docs/local-install.md', label: 'Local install guide' },
  huggingface: { href: '/docs/api/providers.md', label: 'Hugging Face API reference' },
  kaggle: { href: '/docs/api/providers.md', label: 'Kaggle API reference' },
  colab: { href: '/docs/providers-cli.md', label: 'Colab reality check' }
};

const formatSecret = (value: string, revealed: boolean): string => {
  if (!value) return '<not saved>';
  if (revealed) return value;
  const head = value.slice(0, 4);
  return `${head}${'•'.repeat(Math.min(24, Math.max(6, value.length - 4)))}`;
};

/** Port parsed from a saved endpoint, so CLI commands match the running worker. */
const endpointPort = (endpointUrl?: string): string => {
  try {
    const parsed = new URL(endpointUrl ?? '');
    return parsed.port || '8000';
  } catch {
    return '8000';
  }
};

const buildCliCommands = (
  provider: InferenceProvider,
  creds: { username: string; key: string; auth: KaggleAuthScheme } | null,
  config: ProviderEndpointConfig,
  revealed: boolean
): string => {
  if (provider === 'local') {
    const port = endpointPort(config.endpointUrl);
    const tokenLine = config.bearerToken
      ? `export VOXINDICA_WORKER_TOKEN="${formatSecret(config.bearerToken, revealed)}"`
      : 'export VOXINDICA_WORKER_TOKEN="<token printed by the worker>"';
    return `# one-time
bash scripts/local/install_local.sh

# every session
source .venv-worker/bin/activate
${tokenLine}
python scripts/local/run_worker.py --port ${port}

# verify from the terminal
python scripts/local/run_worker.py --check --port ${port}`;
  }

  if (provider === 'huggingface') {
    const token = formatSecret(config.bearerToken, revealed);
    return `python -m pip install -U "huggingface_hub[cli]"

export HF_TOKEN="${token}"
curl -s https://huggingface.co/api/whoami-v2 -H "Authorization: Bearer $HF_TOKEN"

curl -s -X POST https://api-inference.huggingface.co/models/facebook/mms-tts-ben \\
  -H "Authorization: Bearer $HF_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{"inputs":"নমস্কার"}' -o out.wav`;
  }

  if (provider === 'kaggle') {
    const username = creds?.username || 'your-username';
    const secret = creds ? formatSecret(creds.key, revealed) : 'your-api-key';
    // New-style access tokens are exported as KAGGLE_API_TOKEN; legacy kaggle.json
    // pairs use KAGGLE_USERNAME + KAGGLE_KEY. Emit the one the user actually saved.
    const credentialExport =
      creds?.auth === 'bearer'
        ? `export KAGGLE_API_TOKEN="${secret}"   # Generate New Token (CLI 1.8+)`
        : `export KAGGLE_KEY="${secret}"   # Create Legacy API Key (kaggle.json)`;
    return `python -m pip install --upgrade kaggle

export KAGGLE_USERNAME="${username}"
${credentialExport}

cd notebooks/kaggle
kaggle kernels push -p .
kaggle kernels status ${username}/voxindica-voxcpm2-worker
kaggle kernels output ${username}/voxindica-voxcpm2-worker -p ./worker-output`;
  }

  return `# There is no official Colab CLI or runtime API.
# Open the notebook in your browser and press "Run all",
# or use Colab Enterprise on Vertex AI (paid, GCP API).
# The Studio's Colab tab is built around the browser flow.`;
};

const platformFor = (provider: InferenceProvider): WorkerPlatform =>
  provider === 'local' ? 'local' : provider === 'kaggle' ? 'kaggle' : 'colab';

const SectionLabel: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{children}</span>
);

const StatusDot: React.FC<{ online: boolean; checking?: boolean }> = ({ online, checking }) => {
  if (checking) return <Loader2 className="w-3.5 h-3.5 text-slate-400 animate-spin" />;
  return online ? (
    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
  ) : (
    <AlertCircle className="w-3.5 h-3.5 text-rose-400" />
  );
};

export const ProviderModal: React.FC<ProviderModalProps> = ({
  isOpen,
  onClose,
  activeProvider,
  onSelectProvider
}) => {
  const providerService = ProviderService.getInstance();

  const [selectedTab, setSelectedTab] = useState<InferenceProvider>(activeProvider);
  const [configs, setConfigs] = useState<Record<InferenceProvider, ProviderEndpointConfig>>(() =>
    providerService.getAllConfigs()
  );
  const [savedKeys, setSavedKeys] = useState<ApiKeyRecord[]>(() => providerService.getAllApiKeys());
  const [authMethod, setAuthMethod] = useState<ProviderAuthMethod>('api');

  const [hardware] = useState<LocalHardwareInfo>(() => detectLocalHardware());
  const [health, setHealth] = useState<Partial<Record<InferenceProvider, WorkerHealth>>>({});
  const [probing, setProbing] = useState<InferenceProvider | null>(null);
  const [feedback, setFeedback] = useState<{ ok: boolean; message: string; provider: InferenceProvider } | null>(
    null
  );

  const [newKeyLabel, setNewKeyLabel] = useState('');
  const [kaggleUsername, setKaggleUsername] = useState(
    () => providerService.getKaggleCredentials()?.username ?? ''
  );
  const [kaggleKey, setKaggleKey] = useState('');
  const [datasetSource, setDatasetSource] = useState('');
  const [launch, setLaunch] = useState<KaggleLaunchState>({ phase: 'idle', message: '' });
  const [isVerifyingKaggle, setIsVerifyingKaggle] = useState(false);

  const [showTunnelExplainer, setShowTunnelExplainer] = useState(false);
  const [showScriptModal, setShowScriptModal] = useState(false);
  const [copied, setCopied] = useState(false);
  const [revealCli, setRevealCli] = useState(false);

  const pollTimer = useRef<number | null>(null);
  const launchedAt = useRef<number>(0);

  const currentConfig = configs[selectedTab];
  const currentHealth = health[selectedTab];
  const keysForCurrentTab = savedKeys.filter((k) => k.provider === selectedTab);
  const bundle = WORKER_SCRIPTS[platformFor(selectedTab)];

  const stopPolling = () => {
    if (pollTimer.current !== null) {
      window.clearTimeout(pollTimer.current);
      pollTimer.current = null;
    }
  };

  useEffect(() => () => stopPolling(), []);

  const updateConfig = (patch: Partial<ProviderEndpointConfig>) => {
    setConfigs((prev) => ({
      ...prev,
      [selectedTab]: { ...prev[selectedTab], ...patch }
    }));
  };

  const runProbe = async (provider: InferenceProvider, url: string, token: string): Promise<WorkerHealth> => {
    setProbing(provider);
    const result = await providerService.probeWorker(url, token);
    const updated = providerService.applyWorkerHealth(provider, result);
    setHealth((prev) => ({ ...prev, [provider]: result }));
    setConfigs((prev) => ({ ...prev, [provider]: updated }));
    setProbing(null);
    return result;
  };

  // Real probe whenever a worker-backed tab is opened with a saved endpoint.
  useEffect(() => {
    if (!isOpen) return;
    if (selectedTab === 'huggingface') return;
    const cfg = providerService.getAllConfigs()[selectedTab];
    if (!cfg?.endpointUrl) return;
    void (async () => {
      setProbing(selectedTab);
      const result = await providerService.probeWorker(cfg.endpointUrl, cfg.bearerToken);
      const updated = providerService.applyWorkerHealth(selectedTab, result);
      setHealth((prev) => ({ ...prev, [selectedTab]: result }));
      setConfigs((prev) => ({ ...prev, [selectedTab]: updated }));
      setProbing(null);
    })();
  }, [isOpen, selectedTab]);

  const copyToClipboard = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
      setFeedback({ ok: true, message: `${label} copied to clipboard`, provider: selectedTab });
    } catch {
      setFeedback({ ok: false, message: 'Clipboard access was blocked by the browser', provider: selectedTab });
    }
  };

  const handleTestConnection = async () => {
    setFeedback(null);

    if (selectedTab === 'huggingface') {
      const updated = await providerService.testConnection(
        'huggingface',
        currentConfig.endpointUrl,
        currentConfig.bearerToken,
        newKeyLabel.trim() || undefined
      );
      setConfigs((prev) => ({ ...prev, huggingface: updated }));
      setSavedKeys(providerService.getAllApiKeys());
      setFeedback({
        ok: updated.isConnected,
        message: updated.statusMessage || (updated.isConnected ? 'Token verified' : 'Token rejected'),
        provider: 'huggingface'
      });
      if (updated.isConnected) setNewKeyLabel('');
      return;
    }

    if (!currentConfig.endpointUrl) {
      setFeedback({ ok: false, message: 'Enter the worker endpoint URL first', provider: selectedTab });
      return;
    }

    const result = await runProbe(selectedTab, currentConfig.endpointUrl, currentConfig.bearerToken);
    setFeedback({
      ok: result.online,
      message: result.online
        ? `Worker online · ${result.gpuDevice || 'GPU unknown'}${
            result.modelLoaded === false ? ' · model NOT loaded' : ''
          } · ${result.latencyMs ?? '—'}ms`
        : result.errorMessage || 'Worker unreachable',
      provider: selectedTab
    });
    setSavedKeys(providerService.getAllApiKeys());
  };

  const handleVerifyKaggle = async () => {
    setIsVerifyingKaggle(true);
    setFeedback(null);
    const result = await providerService.testKaggleCredentials(
      kaggleUsername.trim(),
      kaggleKey.trim(),
      newKeyLabel.trim() || undefined
    );
    setSavedKeys(providerService.getAllApiKeys());
    setFeedback({ ok: result.ok, message: result.message, provider: 'kaggle' });
    setIsVerifyingKaggle(false);
  };

  const applySession = (url: string, token: string) => {
    const next = { ...configs.kaggle, endpointUrl: url, bearerToken: token };
    setConfigs((prev) => ({ ...prev, kaggle: next }));
    providerService.saveConfig(next);
    void runProbe('kaggle', url, token);
  };

  const pollKaggleSession = async (attempt: number) => {
    if (!isOpen) return;
    const result = await providerService.pollKaggleSession();
    const elapsed = Math.round((Date.now() - launchedAt.current) / 1000);

    if (result.state === 'connected' && result.url && result.token) {
      setLaunch({
        phase: 'connected',
        message: 'Worker reachable — URL and token filled in automatically.',
        kernelUrl: result.kernelUrl,
        elapsedSeconds: elapsed
      });
      applySession(result.url, result.token);
      return;
    }

    setLaunch((prev) => ({
      ...prev,
      phase: result.state,
      message: result.message,
      kernelUrl: result.kernelUrl ?? prev.kernelUrl,
      elapsedSeconds: elapsed
    }));

    if (result.state === 'error' || attempt >= 120) return;
    pollTimer.current = window.setTimeout(() => void pollKaggleSession(attempt + 1), 15000);
  };

  const handleLaunchKaggle = async () => {
    stopPolling();
    // A stale "this URL is dead" error from a previous session would otherwise
    // sit under the launch controls while the new kernel is starting.
    setFeedback(null);
    setLaunch({ phase: 'pushing', message: 'Pushing the worker notebook to Kaggle…' });
    launchedAt.current = Date.now();

    const result = await providerService.launchKaggleWorker(datasetSource.trim() || undefined);
    if (!result.ok) {
      setLaunch({ phase: 'error', message: result.message, kernelUrl: result.kernelUrl });
      return;
    }

    setLaunch({
      phase: 'queued',
      message: result.message,
      kernelUrl: result.kernelUrl
    });
    pollTimer.current = window.setTimeout(() => void pollKaggleSession(1), 15000);
  };

  const handleRefreshKaggleSession = async () => {
    stopPolling();
    setLaunch({
      phase: 'queued',
      message: 'Fetching session from Kaggle…',
      kernelUrl: launch.kernelUrl,
    });
    launchedAt.current = Date.now();
    pollKaggleSession(1);
  };

  const handleActivateSavedKey = (keyId: string) => {
    providerService.setActiveApiKey(selectedTab, keyId);
    setSavedKeys(providerService.getAllApiKeys());
    setConfigs(providerService.getAllConfigs());
    setFeedback({ ok: true, message: 'Key activated', provider: selectedTab });
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

  const renderSessionInputs = () => (
    <div className="space-y-3 p-4 bg-slate-900 border border-slate-800 rounded-lg">
      <SectionLabel>Session endpoint</SectionLabel>
      <p className="text-[11px] text-slate-500 leading-relaxed -mt-1">
        These two boxes hold the address of a worker that is running <em>right now</em>. Every run prints a new
        one. <span className="text-slate-300">Launch on Kaggle</span> fills them automatically; if it cannot, copy
        the <span className="font-mono">TUNNEL URL</span> and <span className="font-mono">BEARER TOKEN</span> lines
        from the notebook output. A URL from an earlier session will always fail.
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="sm:col-span-2">
          <label className="block text-[11px] font-medium text-slate-400 mb-1">Tunnel URL</label>
          <input
            type="text"
            placeholder="https://voxindica-worker.trycloudflare.com"
            value={currentConfig.endpointUrl}
            onChange={(e) => updateConfig({ endpointUrl: e.target.value })}
            className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-100 placeholder:text-slate-600 focus:outline-none focus:border-amber-400 font-mono"
          />
        </div>
        <div className="sm:col-span-1">
          <label className="block text-[11px] font-medium text-slate-400 mb-1">Session label</label>
          <input
            type="text"
            placeholder="e.g. T4 session 1"
            value={newKeyLabel}
            onChange={(e) => setNewKeyLabel(e.target.value)}
            className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-100 placeholder:text-slate-600 focus:outline-none focus:border-amber-400"
          />
        </div>
      </div>

      <div>
        <label className="block text-[11px] font-medium text-slate-400 mb-1">Worker bearer token</label>
        <input
          type="password"
          placeholder="BEARER TOKEN printed by the notebook"
          value={currentConfig.bearerToken}
          onChange={(e) => updateConfig({ bearerToken: e.target.value })}
          className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-100 placeholder:text-slate-600 focus:outline-none focus:border-amber-400 font-mono"
        />
      </div>

      <div className="flex items-center justify-between gap-3 pt-1">
        <div className="text-[11px] text-slate-500 flex items-center gap-1.5">
          <StatusDot online={!!currentHealth?.online} checking={probing === selectedTab} />
          {currentHealth
            ? currentHealth.online
              ? `Online · ${currentHealth.gpuDevice || 'device unknown'} · ${currentHealth.latencyMs ?? '—'}ms`
              : currentHealth.errorMessage || 'Disconnected'
            : 'Not checked yet'}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void handleTestConnection()}
            disabled={probing === selectedTab || !currentConfig.endpointUrl}
            className="px-3.5 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${probing === selectedTab ? 'animate-spin' : ''}`} />
            {probing === selectedTab ? 'Probing /health…' : 'Test & Save'}
          </button>
          {selectedTab === 'kaggle' && (
            <button
              type="button"
              onClick={() => void handleRefreshKaggleSession()}
              disabled={launch.phase === 'pushing' || launch.phase === 'queued' || launch.phase === 'running'}
              className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-semibold flex items-center gap-1.5 disabled:opacity-50 cursor-pointer"
            >
              <RefreshCw className="w-3 h-3 shrink-0" />
              Re-fetch from Kaggle
            </button>
          )}
        </div>
      </div>
    </div>
  );

  const kaggleCreds = providerService.getKaggleCredentials();
  const cliText = buildCliCommands(selectedTab, kaggleCreds, currentConfig, revealCli);
  const hasSavedSecret = selectedTab === 'kaggle' ? Boolean(kaggleCreds) : Boolean(currentConfig.bearerToken);

  const renderCliGuide = () => (
    <div className="p-4 bg-slate-900 border border-slate-800 rounded-lg space-y-3">
      <div className="flex items-center justify-between gap-2">
        <SectionLabel>Optional CLI path · {PROVIDER_LABELS[selectedTab]}</SectionLabel>
        <div className="flex items-center gap-2">
          {hasSavedSecret && (
            <button
              type="button"
              onClick={() => setRevealCli((prev) => !prev)}
              className="text-[11px] text-slate-300 hover:text-white px-2 py-1 rounded border border-slate-700 hover:border-slate-600 flex items-center gap-1 cursor-pointer"
              title="Show or hide the saved secret inside the commands"
            >
              {revealCli ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
              {revealCli ? 'Hide' : 'Show'}
            </button>
          )}
          <a
            href={DOC_LINKS[selectedTab].href}
            target="_blank"
            rel="noreferrer"
            className="text-[11px] text-amber-400 hover:underline flex items-center gap-1"
          >
            {DOC_LINKS[selectedTab].label} <ExternalLink className="w-3 h-3" />
          </a>
          <button
            type="button"
            onClick={() => void copyToClipboard(cliText, 'Commands')}
            className="text-[11px] text-slate-300 hover:text-white px-2 py-1 rounded border border-slate-700 hover:border-slate-600 flex items-center gap-1 cursor-pointer"
          >
            {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
            Copy
          </button>
        </div>
      </div>
      <pre className="bg-slate-950 border border-slate-800 rounded-lg p-3 text-[11px] leading-relaxed text-slate-300 overflow-x-auto font-mono whitespace-pre">
        {cliText}
      </pre>
      <p className="text-[11px] text-slate-500 leading-relaxed">
        {hasSavedSecret
          ? 'Pre-filled with your saved values. Secrets stay masked until you press Show, so a copied command is only runnable after you reveal them.'
          : 'Nothing is saved yet, so the placeholders stay as-is. Add a credential in the API tab and these commands fill themselves in.'}
      </p>
      <div className="flex flex-wrap items-center gap-2 pt-1">
        <button
          type="button"
          onClick={() => {
            setAuthMethod('api');
            setFeedback({
              ok: true,
              message: 'API path selected — every command here has a one-click equivalent above.',
              provider: selectedTab
            });
          }}
          className="px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 text-[11px] font-semibold flex items-center gap-1.5 cursor-pointer"
        >
          <MousePointerClick className="w-3.5 h-3.5" />
          Run this via API instead
        </button>
        <span className="text-[11px] text-slate-500">
          No terminal needed — these commands call the same endpoints the buttons above already use.
        </span>
      </div>
    </div>
  );

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4 overflow-y-auto">
      <div className="bg-[#121927] border border-slate-800 rounded-xl w-full max-w-3xl shadow-2xl overflow-hidden my-6 flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 shrink-0">
          <div>
            <h3 className="text-base font-semibold text-slate-100 flex items-center gap-2">
              <Server className="w-4 h-4 text-amber-400" />
              Inference Providers & API
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">
              API-first setup for Local, Hugging Face, Kaggle and Colab — every status below comes from a real probe.
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
            return (
              <button
                key={p}
                onClick={() => {
                  stopPolling();
                  setSelectedTab(p);
                  setFeedback(null);
                }}
                className={`px-4 py-2.5 text-xs font-semibold border-b-2 transition-all flex items-center gap-2 cursor-pointer whitespace-nowrap ${
                  isTabActive
                    ? 'border-amber-400 text-amber-400'
                    : 'border-transparent text-slate-400 hover:text-slate-200'
                }`}
              >
                <span>{PROVIDER_LABELS[p]}</span>
                {isCurrent && (
                  <span className="text-[10px] px-1.5 py-0.2 bg-amber-500/20 text-amber-300 rounded font-mono">
                    Active
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Mode switch */}
        <div className="flex items-center justify-between gap-3 px-6 py-2.5 border-b border-slate-800 bg-slate-950/50 shrink-0">
          <div className="flex items-center gap-1 bg-slate-900 border border-slate-800 rounded-lg p-0.5">
            <button
              type="button"
              onClick={() => setAuthMethod('api')}
              className={`px-2.5 py-1 rounded text-[11px] font-semibold transition-colors cursor-pointer ${
                authMethod === 'api' ? 'bg-amber-500/20 text-amber-300' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              API
            </button>
            <button
              type="button"
              onClick={() => setAuthMethod('cli')}
              className={`px-2.5 py-1 rounded text-[11px] font-semibold flex items-center gap-1 transition-colors cursor-pointer ${
                authMethod === 'cli' ? 'bg-amber-500/20 text-amber-300' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Terminal className="w-3 h-3" />
              CLI
            </button>
          </div>
          <a
            href={DOC_LINKS[selectedTab].href}
            target="_blank"
            rel="noreferrer"
            className="text-[11px] text-slate-400 hover:text-amber-300 flex items-center gap-1"
          >
            {DOC_LINKS[selectedTab].label} <ExternalLink className="w-3 h-3" />
          </a>
        </div>

        {/* Tab Body */}
        <div className="p-6 space-y-5 overflow-y-auto flex-1">
          {/* LOCAL */}
          {selectedTab === 'local' && authMethod === 'api' && (
            <div className="space-y-4">
              <div className="p-4 bg-slate-900 border border-slate-800 rounded-lg space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Cpu className="w-4 h-4 text-emerald-400" />
                    <span className="text-sm font-semibold text-slate-100">This machine (browser report)</span>
                  </div>
                  <span className="text-[11px] text-slate-500">read from WebGL / navigator</span>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                  <div className="bg-slate-950/70 p-2.5 rounded border border-slate-800/80 col-span-2">
                    <span className="text-slate-500 block text-[11px]">GPU</span>
                    <span className="text-slate-200 font-semibold font-mono break-words">{formatGpuLabel(hardware)}</span>
                    {hardware.softwareRendering && (
                      <span className="block text-[10px] text-amber-400 mt-0.5">software renderer — not usable for inference</span>
                    )}
                  </div>
                  <div className="bg-slate-950/70 p-2.5 rounded border border-slate-800/80">
                    <span className="text-slate-500 block text-[11px]">CPU threads</span>
                    <span className="text-slate-200 font-semibold font-mono tabular-nums">
                      {hardware.cpuThreads || 'unknown'}
                    </span>
                  </div>
                  <div className="bg-slate-950/70 p-2.5 rounded border border-slate-800/80">
                    <span className="text-slate-500 block text-[11px]">Device RAM</span>
                    <span className="text-slate-200 font-semibold font-mono tabular-nums">
                      {hardware.deviceMemoryGb ? `${hardware.deviceMemoryGb} GB` : 'not exposed'}
                    </span>
                  </div>
                  <div className="bg-slate-950/70 p-2.5 rounded border border-slate-800/80">
                    <span className="text-slate-500 block text-[11px]">Platform</span>
                    <span className="text-slate-200 font-semibold font-mono">
                      {hardware.platform}
                      {hardware.architecture ? ` · ${hardware.architecture}` : ''}
                    </span>
                  </div>
                  <div className="bg-slate-950/70 p-2.5 rounded border border-slate-800/80">
                    <span className="text-slate-500 block text-[11px]">WebGPU / WASM</span>
                    <span className="text-slate-200 font-semibold font-mono">
                      {hardware.webgpu ? 'yes' : 'no'} / {hardware.wasm ? 'yes' : 'no'}
                    </span>
                  </div>
                </div>
                <p className="text-[11px] text-slate-500 leading-relaxed">
                  The browser can only describe its own GPU. Speech synthesis runs in the local worker process
                  below, and the device shown next is the one that worker reports from <code className="font-mono text-slate-400">/health</code>.
                </p>
              </div>

              <div className="p-4 bg-slate-900 border border-slate-800 rounded-lg space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Wifi className="w-4 h-4 text-sky-400" />
                    <span className="text-sm font-semibold text-slate-100">Local worker</span>
                  </div>
                  <span
                    className={`text-[11px] font-semibold flex items-center gap-1.5 ${
                      currentHealth?.online ? 'text-emerald-400' : 'text-slate-400'
                    }`}
                  >
                    {currentHealth?.online ? <Wifi className="w-3.5 h-3.5" /> : <WifiOff className="w-3.5 h-3.5" />}
                    {probing === 'local' ? 'Checking…' : currentHealth?.online ? 'Online' : 'Disconnected'}
                  </span>
                </div>

                {currentHealth?.online ? (
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                    <div className="bg-slate-950/70 p-2.5 rounded border border-slate-800/80 col-span-2">
                      <span className="text-slate-500 block text-[11px]">Worker device</span>
                      <span className="text-slate-200 font-semibold font-mono break-words">
                        {currentHealth.gpuDevice || 'not reported'}
                      </span>
                    </div>
                    <div className="bg-slate-950/70 p-2.5 rounded border border-slate-800/80">
                      <span className="text-slate-500 block text-[11px]">VRAM</span>
                      <span className="text-slate-200 font-semibold font-mono tabular-nums">
                        {currentHealth.vramTotalMb ? `${currentHealth.vramTotalMb} MB` : 'n/a'}
                      </span>
                    </div>
                    <div className="bg-slate-950/70 p-2.5 rounded border border-slate-800/80">
                      <span className="text-slate-500 block text-[11px]">Latency</span>
                      <span className="text-emerald-400 font-semibold font-mono tabular-nums">
                        {currentHealth.latencyMs ?? '—'}ms
                      </span>
                    </div>
                  </div>
                ) : (
                  <p className="text-[11px] text-slate-400 leading-relaxed">
                    {currentHealth?.errorMessage ||
                      'Start the worker, then press Recheck. Nothing is reported online until /health answers.'}
                  </p>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] font-medium text-slate-400 mb-1">Worker URL</label>
                    <input
                      type="text"
                      placeholder="http://127.0.0.1:8000"
                      value={currentConfig.endpointUrl}
                      onChange={(e) => updateConfig({ endpointUrl: e.target.value })}
                      className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-100 placeholder:text-slate-600 focus:outline-none focus:border-amber-400 font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-slate-400 mb-1">Bearer token</label>
                    <input
                      type="password"
                      placeholder="printed by run_worker.py"
                      value={currentConfig.bearerToken}
                      onChange={(e) => updateConfig({ bearerToken: e.target.value })}
                      className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-100 placeholder:text-slate-600 focus:outline-none focus:border-amber-400 font-mono"
                    />
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                  <div className="flex items-center gap-2">
                    <a
                      href={WORKER_SCRIPTS.local.pythonPath}
                      download
                      className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-medium flex items-center gap-1.5"
                    >
                      <Download className="w-3.5 h-3.5" />
                      Download worker .py
                    </a>
                    <button
                      type="button"
                      onClick={() => void copyToClipboard(WORKER_SCRIPTS.local.code, 'Worker script')}
                      className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-medium flex items-center gap-1.5 cursor-pointer"
                    >
                      <Copy className="w-3.5 h-3.5" />
                      Copy script
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={() => void handleTestConnection()}
                    disabled={probing === 'local' || !currentConfig.endpointUrl}
                    className="px-3.5 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${probing === 'local' ? 'animate-spin' : ''}`} />
                    {probing === 'local' ? 'Probing /health…' : 'Test & Save'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* HUGGING FACE */}
          {selectedTab === 'huggingface' && authMethod === 'api' && (
            <div className="space-y-4">
              <div className="p-4 bg-gradient-to-r from-amber-500/10 to-orange-500/5 border border-amber-500/20 rounded-lg text-xs text-slate-300 space-y-2">
                <div className="flex items-center justify-between font-semibold text-amber-300">
                  <span className="flex items-center gap-1.5">
                    <Sparkles className="w-4 h-4 text-amber-400" />
                    Hugging Face HTTP inference
                  </span>
                  <a
                    href="https://huggingface.co/settings/tokens"
                    target="_blank"
                    rel="noreferrer"
                    className="text-amber-400 hover:underline flex items-center gap-1 font-normal text-[11px]"
                  >
                    Create token <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
                <p className="text-slate-400 leading-relaxed">
                  Pure HTTP, no CLI: the Studio calls <code className="text-amber-300 font-mono">huggingface.co/api/whoami-v2</code> to
                  verify the key and <code className="text-amber-300 font-mono">api-inference.huggingface.co</code> for
                  speech. Serverless models are small and may cold-start; VoxCPM2-class cloning needs an Inference
                  Endpoint or the Kaggle/Colab worker.
                </p>
              </div>

              <div className="space-y-3 p-4 bg-slate-900 border border-slate-800 rounded-lg">
                <SectionLabel>Add / update token</SectionLabel>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="sm:col-span-1">
                    <label className="block text-[11px] font-medium text-slate-400 mb-1">Label</label>
                    <input
                      type="text"
                      placeholder="Personal / Team"
                      value={newKeyLabel}
                      onChange={(e) => setNewKeyLabel(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-100 placeholder:text-slate-600 focus:outline-none focus:border-amber-400"
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="block text-[11px] font-medium text-slate-400 mb-1">Access token (hf_...)</label>
                    <input
                      type="password"
                      placeholder="hf_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                      value={currentConfig.bearerToken}
                      onChange={(e) => updateConfig({ bearerToken: e.target.value })}
                      className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-100 placeholder:text-slate-600 focus:outline-none focus:border-amber-400 font-mono"
                    />
                  </div>
                </div>
                <div className="flex justify-end pt-1">
                  <button
                    type="button"
                    onClick={() => void handleTestConnection()}
                    disabled={!currentConfig.bearerToken}
                    className="px-3.5 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    Verify & Save token
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* KAGGLE */}
          {selectedTab === 'kaggle' && authMethod === 'api' && (
            <div className="space-y-4">
              <div className="p-4 bg-slate-900 border border-slate-800 rounded-lg space-y-3">
                <div className="flex items-center justify-between">
                  <SectionLabel>Kaggle credentials</SectionLabel>
                  <a
                    href="https://www.kaggle.com/settings/api"
                    target="_blank"
                    rel="noreferrer"
                    className="text-[11px] text-amber-400 hover:underline flex items-center gap-1"
                  >
                    Open API settings <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] font-medium text-slate-400 mb-1">Username</label>
                    <input
                      type="text"
                      placeholder="your-kaggle-username"
                      value={kaggleUsername}
                      onChange={(e) => setKaggleUsername(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-100 placeholder:text-slate-600 focus:outline-none focus:border-amber-400 font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-slate-400 mb-1">
                      API key or access token
                    </label>
                    <input
                      type="password"
                      placeholder="from kaggle.json or Generate New Token"
                      value={kaggleKey}
                      onChange={(e) => setKaggleKey(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-100 placeholder:text-slate-600 focus:outline-none focus:border-amber-400 font-mono"
                    />
                  </div>
                </div>
                <p className="text-[11px] text-slate-500 leading-relaxed">
                  On kaggle.com/settings/api press <span className="text-slate-300">Generate New Token</span> and paste the{' '}
                  <span className="font-mono">KGAT_…</span> value with your username. That token powers both the REST
                  calls and the live kernel log stream, which is how the tunnel URL fills itself in. A legacy{' '}
                  <span className="font-mono">kaggle.json</span> pair also works, but Kaggle hides live logs from it, so
                  you would have to copy the tunnel URL out of the notebook yourself.
                </p>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] text-slate-500">
                    Sent per request to this app's server; never stored server-side.
                  </span>
                  <button
                    type="button"
                    onClick={() => void handleVerifyKaggle()}
                    disabled={isVerifyingKaggle || !kaggleUsername.trim() || !kaggleKey.trim()}
                    className="px-3.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-100 border border-slate-700 text-xs font-semibold flex items-center gap-1.5 disabled:opacity-50 cursor-pointer"
                  >
                    {isVerifyingKaggle ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Key className="w-3.5 h-3.5" />}
                    {isVerifyingKaggle ? 'Verifying…' : 'Verify & save'}
                  </button>
                </div>
              </div>

              <div className="p-4 bg-slate-900 border border-slate-800 rounded-lg space-y-3">
                <div className="flex items-center justify-between">
                  <SectionLabel>Launch the worker kernel</SectionLabel>
                  <a
                    href={WORKER_SCRIPTS.kaggle.notebookPath ?? '#'}
                    download
                    className="text-[11px] text-slate-400 hover:text-amber-300 flex items-center gap-1"
                  >
                    <Download className="w-3 h-3" /> notebook
                  </a>
                </div>
                <input
                  type="text"
                  placeholder="Optional dataset source, e.g. mrsandipmandal/sample-file"
                  value={datasetSource}
                  onChange={(e) => setDatasetSource(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-100 placeholder:text-slate-600 focus:outline-none focus:border-amber-400 font-mono"
                />
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void handleLaunchKaggle()}
                    disabled={launch.phase === 'pushing' || !providerService.getKaggleCredentials()}
                    className="px-3.5 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-semibold flex items-center gap-1.5 disabled:opacity-50 cursor-pointer"
                  >
                    <Rocket className="w-3.5 h-3.5" />
                    Launch on Kaggle
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowScriptModal(true)}
                    className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-medium flex items-center gap-1.5 cursor-pointer"
                  >
                    <Terminal className="w-3.5 h-3.5" /> Manual setup
                  </button>
                  {launch.kernelUrl && (
                    <a
                      href={launch.kernelUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-[11px] text-amber-400 hover:underline flex items-center gap-1"
                    >
                      Open kernel <ExternalLink className="w-3 h-3" />
                    </a>
                  )}
                </div>

                {launch.phase !== 'idle' && (
                  <div
                    className={`p-3 rounded-lg text-[11px] flex items-start gap-2 ${
                      launch.phase === 'connected'
                        ? 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-300'
                        : launch.phase === 'error'
                        ? 'bg-rose-500/10 border border-rose-500/30 text-rose-300'
                        : 'bg-slate-950 border border-slate-800 text-slate-300'
                    }`}
                  >
                    {launch.phase === 'connected' ? (
                      <CheckCircle2 className="w-4 h-4 shrink-0" />
                    ) : launch.phase === 'error' ? (
                      <AlertCircle className="w-4 h-4 shrink-0" />
                    ) : (
                      <Loader2 className="w-4 h-4 shrink-0 animate-spin" />
                    )}
                    <div className="space-y-1">
                      <p className="font-semibold capitalize">
                        {launch.phase}
                        {launch.elapsedSeconds ? ` · ${launch.elapsedSeconds}s` : ''}
                      </p>
                      <p className="leading-relaxed text-slate-400">{launch.message}</p>
                      {(launch.phase === 'queued' || launch.phase === 'running') && (
                        <p className="text-slate-500 leading-relaxed">
                          Kaggle only exposes a running kernel's output after it finishes, and a worker kernel never
                          finishes. If the URL never appears here, open the kernel log and paste it below — that is a
                          Kaggle limitation, not a Studio bug.
                        </p>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {renderSessionInputs()}
            </div>
          )}

          {/* COLAB */}
          {selectedTab === 'colab' && authMethod === 'api' && (
            <div className="space-y-4">
              <div className="p-4 bg-slate-900 border border-slate-800 rounded-lg space-y-2.5 text-xs">
                <div className="flex items-center justify-between">
                  <span className="text-slate-200 font-semibold">How the Colab worker works</span>
                  <button
                    onClick={() => setShowTunnelExplainer(!showTunnelExplainer)}
                    className="text-amber-400 hover:underline flex items-center gap-1 text-[11px] cursor-pointer"
                  >
                    <HelpCircle className="w-3 h-3" /> Why a tunnel?
                  </button>
                </div>
                {showTunnelExplainer ? (
                  <p className="text-[11px] text-slate-400 leading-relaxed">
                    Colab and Kaggle run behind their own firewalls with no inbound port. The notebook starts a
                    FastAPI server on <code className="font-mono text-slate-300">127.0.0.1:8000</code> and opens an
                    outbound Cloudflare tunnel, giving it a temporary{' '}
                    <code className="font-mono text-slate-300">https://*.trycloudflare.com</code> URL. The bearer
                    token is the only access control — restarting the notebook invalidates both.
                  </p>
                ) : (
                  <ol className="list-decimal list-inside space-y-1 text-[11px] text-slate-400 leading-relaxed">
                    <li>Open the notebook and enable the GPU (Runtime → Change runtime type → T4).</li>
                    <li>Run all cells: install, reference clip, worker start.</li>
                    <li>Paste TUNNEL URL and BEARER TOKEN below, then Test &amp; Save.</li>
                  </ol>
                )}
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <a
                    href={WORKER_SCRIPTS.colab.notebookPath ?? '#'}
                    download
                    className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-medium flex items-center gap-1.5"
                  >
                    <Download className="w-3.5 h-3.5" /> Download .ipynb
                  </a>
                  <button
                    type="button"
                    onClick={() => setShowScriptModal(true)}
                    className="px-3 py-1.5 rounded-lg bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 border border-amber-500/30 text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
                  >
                    <Terminal className="w-3.5 h-3.5" /> One-cell script
                  </button>
                  <a
                    href="https://colab.research.google.com/"
                    target="_blank"
                    rel="noreferrer"
                    className="text-[11px] text-slate-400 hover:text-amber-300 flex items-center gap-1"
                  >
                    Open Colab <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
                <p className="text-[11px] text-slate-500 leading-relaxed">
                  Consumer Colab has no runtime API and no official CLI, so there is nothing honest to automate here.
                  Use the Kaggle tab if you want the Studio to start the GPU itself.
                </p>
              </div>

              {renderSessionInputs()}
            </div>
          )}

          {/* CLI mode */}
          {authMethod === 'cli' && renderCliGuide()}

          {/* Feedback */}
          {feedback && feedback.provider === selectedTab && (
            <div
              className={`p-3 rounded-lg text-xs flex items-start gap-2 ${
                feedback.ok
                  ? 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-300'
                  : 'bg-rose-500/10 border border-rose-500/30 text-rose-300'
              }`}
            >
              {feedback.ok ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              ) : (
                <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
              )}
              <span className="leading-relaxed">{feedback.message}</span>
            </div>
          )}

          {/* Vault */}
          <div className="space-y-3 pt-2 border-t border-slate-800">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-200 flex items-center gap-1.5">
                <Key className="w-3.5 h-3.5 text-amber-400" />
                Saved credentials for {PROVIDER_LABELS[selectedTab]} ({keysForCurrentTab.length})
              </span>
              <span className="text-[11px] text-slate-500">local browser storage only</span>
            </div>

            {keysForCurrentTab.length === 0 ? (
              <div className="p-3 bg-slate-900/40 border border-dashed border-slate-800 rounded-lg text-xs text-slate-500 text-center">
                No saved credentials for this provider yet.
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
                          title="Delete credential"
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
          <div className="text-xs text-slate-500 font-mono flex items-center gap-2">
            <StatusDot online={currentConfig.isConnected} checking={probing === selectedTab} />
            {currentConfig.isConnected ? (
              <span className="text-emerald-400 font-semibold">Ready to synthesize</span>
            ) : (
              <span>Provider offline</span>
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
              Activate provider
            </button>
          </div>
        </div>
      </div>

      <WorkerScriptModal
        isOpen={showScriptModal}
        onClose={() => setShowScriptModal(false)}
        platform={platformFor(selectedTab)}
      />
    </div>
  );
};
