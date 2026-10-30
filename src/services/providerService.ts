import {
  InferenceProvider,
  ProviderEndpointConfig,
  SynthesisJob,
  ApiKeyRecord,
  WorkerHealth
} from '../types';
import { synthesizeSpeechAudio } from '../utils/audio';

const STORAGE_KEY_PROVIDERS = 'voxindica_providers_config';
const STORAGE_KEY_API_KEYS = 'voxindica_api_keys_vault';

/** A stored "connected" flag older than this is shown as unverified, never as online. */
const FRESH_CHECK_MS = 10 * 60 * 1000;

export class ProviderService {
  private static instance: ProviderService;
  private providerConfigs: Record<InferenceProvider, ProviderEndpointConfig>;
  private apiKeys: ApiKeyRecord[] = [];

  private constructor() {
    this.providerConfigs = this.loadConfigs();
    this.apiKeys = this.loadApiKeys();
  }

  public static getInstance(): ProviderService {
    if (!ProviderService.instance) {
      ProviderService.instance = new ProviderService();
    }
    return ProviderService.instance;
  }

  private loadConfigs(): Record<InferenceProvider, ProviderEndpointConfig> {
    const defaultConfigs: Record<InferenceProvider, ProviderEndpointConfig> = {
      local: {
        provider: 'local',
        endpointUrl: 'http://127.0.0.1:8000',
        bearerToken: '',
        isConnected: false,
        statusMessage: 'Local worker not verified yet — start run_worker.py, then press Test & Save.'
      },
      huggingface: {
        provider: 'huggingface',
        endpointUrl: 'https://api-inference.huggingface.co',
        bearerToken: '',
        isConnected: false,
        statusMessage: 'Hugging Face API key not configured. Add your token (hf_...) below.'
      },
      kaggle: {
        provider: 'kaggle',
        endpointUrl: '',
        bearerToken: '',
        isConnected: false,
        statusMessage: 'Kaggle GPU worker not connected. Enter your Cloudflare or ngrok tunnel URL.'
      },
      colab: {
        provider: 'colab',
        endpointUrl: '',
        bearerToken: '',
        isConnected: false,
        statusMessage: 'Colab GPU worker not connected. Enter your Cloudflare or ngrok tunnel URL.'
      }
    };

    try {
      const stored = localStorage.getItem(STORAGE_KEY_PROVIDERS);
      if (stored) {
        const parsed = JSON.parse(stored) as Partial<Record<InferenceProvider, ProviderEndpointConfig>>;
        const merged: Record<InferenceProvider, ProviderEndpointConfig> = { ...defaultConfigs, ...parsed };

        (Object.keys(merged) as InferenceProvider[]).forEach((provider) => {
          const saved = merged[provider];
          const checkedAt = saved.lastPingAt ? Date.parse(saved.lastPingAt) : Number.NaN;
          const isFresh = Number.isFinite(checkedAt) && Date.now() - checkedAt < FRESH_CHECK_MS;
          const wasConnected = Boolean(saved.isConnected) && isFresh;

          merged[provider] = {
            ...defaultConfigs[provider],
            ...saved,
            isConnected: wasConnected,
            statusMessage: wasConnected
              ? saved.statusMessage
              : saved.isConnected
              ? `Last successful check was over ${Math.round(FRESH_CHECK_MS / 60000)} minutes ago — press Test & Save.`
              : defaultConfigs[provider].statusMessage
          };
        });

        // Local state is never restored as "connected": it is a live process probe.
        merged.local = {
          ...defaultConfigs.local,
          endpointUrl: merged.local.endpointUrl || defaultConfigs.local.endpointUrl,
          bearerToken: merged.local.bearerToken || '',
          isConnected: false,
          statusMessage: 'Local worker not verified in this session — press Test & Save.'
        };

        return merged;
      }
    } catch {
      // ignore parsing error
    }

    return defaultConfigs;
  }

  public saveConfig(config: ProviderEndpointConfig): void {
    this.providerConfigs[config.provider] = config;
    try {
      localStorage.setItem(STORAGE_KEY_PROVIDERS, JSON.stringify(this.providerConfigs));
    } catch {
      // ignore storage error
    }
  }

  public getConfig(provider: InferenceProvider): ProviderEndpointConfig {
    return this.providerConfigs[provider];
  }

  public getAllConfigs(): Record<InferenceProvider, ProviderEndpointConfig> {
    return { ...this.providerConfigs };
  }

  // --- Multi-Key Vault Management ---
  private loadApiKeys(): ApiKeyRecord[] {
    try {
      const stored = localStorage.getItem(STORAGE_KEY_API_KEYS);
      if (stored) {
        return JSON.parse(stored);
      }
    } catch {
      // ignore
    }
    return [
      {
        id: 'default-local',
        provider: 'local',
        label: 'Local Dev Session',
        keyOrToken: 'local-session-token',
        endpointUrl: 'http://127.0.0.1:8000',
        createdAt: new Date().toISOString(),
        isActive: true,
        accountDetails: 'Local Workstation Hardware'
      }
    ];
  }

  public getAllApiKeys(): ApiKeyRecord[] {
    return [...this.apiKeys];
  }

  public getKeysByProvider(provider: InferenceProvider): ApiKeyRecord[] {
    return this.apiKeys.filter((k) => k.provider === provider);
  }

  public saveApiKey(key: ApiKeyRecord): void {
    const existingIndex = this.apiKeys.findIndex((k) => k.id === key.id);
    if (existingIndex >= 0) {
      this.apiKeys[existingIndex] = key;
    } else {
      // If marked active, deactivate other keys for the same provider
      if (key.isActive) {
        this.apiKeys = this.apiKeys.map((k) => (k.provider === key.provider ? { ...k, isActive: false } : k));
      }
      this.apiKeys.push(key);
    }
    this.persistApiKeys();
  }

  public deleteApiKey(id: string): void {
    this.apiKeys = this.apiKeys.filter((k) => k.id !== id);
    this.persistApiKeys();
  }

  public setActiveApiKey(provider: InferenceProvider, keyId: string): void {
    this.apiKeys = this.apiKeys.map((k) => {
      if (k.provider === provider) {
        return { ...k, isActive: k.id === keyId };
      }
      return k;
    });
    this.persistApiKeys();

    const activeKey = this.apiKeys.find((k) => k.id === keyId);
    if (activeKey) {
      const currentConfig = { ...this.providerConfigs[provider] };
      currentConfig.bearerToken = activeKey.keyOrToken;
      if (activeKey.endpointUrl) {
        currentConfig.endpointUrl = activeKey.endpointUrl;
      }
      this.saveConfig(currentConfig);
    }
  }

  private persistApiKeys(): void {
    try {
      localStorage.setItem(STORAGE_KEY_API_KEYS, JSON.stringify(this.apiKeys));
    } catch {
      // ignore
    }
  }

  /**
   * Health Check and ping validation
   */
  public async testConnection(
    provider: InferenceProvider,
    url: string,
    token: string,
    keyLabel?: string
  ): Promise<ProviderEndpointConfig> {
    const startTime = performance.now();
    const config = { ...this.providerConfigs[provider] };
    config.endpointUrl = url.trim();
    config.bearerToken = token.trim();

    if (provider === 'local') {
      // Real probe: the old implementation reported "connected" without any network call.
      this.providerConfigs.local = config;
      const health = await this.probeWorker(config.endpointUrl, config.bearerToken, 6000);
      const applied = this.applyWorkerHealth('local', health);

      if (health.online) {
        this.saveApiKey({
          id: 'default-local',
          provider: 'local',
          label: keyLabel?.trim() || 'Local worker',
          keyOrToken: config.bearerToken,
          endpointUrl: config.endpointUrl,
          createdAt: new Date().toISOString(),
          isActive: true,
          accountDetails: health.gpuDevice || 'Device not reported'
        });
      }

      return applied;
    }

    // --- Hugging Face Inference API validation ---
    if (provider === 'huggingface') {
      if (!token) {
        config.isConnected = false;
        config.statusMessage = 'Hugging Face User Access Token (hf_...) is required';
        this.saveConfig(config);
        return config;
      }

      if (!token.startsWith('hf_')) {
        config.isConnected = false;
        config.statusMessage = 'Invalid format. Hugging Face tokens must start with "hf_"';
        this.saveConfig(config);
        return config;
      }

      try {
        let username = 'Authenticated HF User';
        let isSuccess = false;

        try {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 4000);

          const res = await fetch('https://huggingface.co/api/whoami-v2', {
            method: 'GET',
            headers: {
              'Authorization': `Bearer ${token}`
            },
            signal: controller.signal
          });
          clearTimeout(timeoutId);

          if (res.ok) {
            const data = await res.json();
            username = data.name || data.preferred_username || 'HF Member';
            isSuccess = true;
          }
        } catch (networkError) {
          // whoami can be blocked by the browser (CORS/offline). Say so instead of
          // accepting any string that merely looks like a token.
          config.isConnected = false;
          config.statusMessage = `Could not reach huggingface.co to verify this token: ${
            networkError instanceof Error ? networkError.message : 'network error'
          }`;
          this.saveConfig(config);
          return config;
        }

        const elapsed = Math.round(performance.now() - startTime);

        if (isSuccess) {
          config.isConnected = true;
          config.lastPingAt = new Date().toISOString();
          config.latencyMs = elapsed;
          config.statusMessage = `Hugging Face token verified (${username}) · ${config.latencyMs}ms`;

          // Automatically record or update in key vault
          const keyRecord: ApiKeyRecord = {
            id: `hf-${token.slice(-6)}`,
            provider: 'huggingface',
            label: keyLabel || `HF Key (${token.slice(0, 7)}...${token.slice(-4)})`,
            keyOrToken: token,
            createdAt: new Date().toISOString(),
            isActive: true,
            accountDetails: username
          };
          this.saveApiKey(keyRecord);
        } else {
          config.isConnected = false;
          config.statusMessage = 'Hugging Face token rejected. Verify token permissions (read/inference).';
        }
      } catch (err) {
        config.isConnected = false;
        config.statusMessage = `HF Connection error: ${err instanceof Error ? err.message : 'Timeout'}`;
      }

      this.saveConfig(config);
      return config;
    }

    // --- Kaggle / Colab Worker Validation ---
    if (!url) {
      config.isConnected = false;
      config.statusMessage = 'Worker URL is required';
      this.saveConfig(config);
      return config;
    }

    try {
      new URL(url);
    } catch {
      config.isConnected = false;
      config.statusMessage = 'Worker URL is not a valid http(s) URL';
      this.saveConfig(config);
      return config;
    }

    // A trycloudflare/ngrok hostname proves nothing: only a real /health answer counts.
    this.providerConfigs[provider] = config;
    const health = await this.probeWorker(config.endpointUrl, config.bearerToken);

    if (!health.online) {
      config.isConnected = false;
      config.statusMessage = health.errorMessage || 'Worker unreachable';
      this.saveConfig(config);
      return config;
    }

    const applied = this.applyWorkerHealth(provider, health);
    this.saveApiKey({
      id: `${provider}-${Date.now()}`,
      provider,
      label: keyLabel?.trim() || `${provider.toUpperCase()} session (${new Date().toLocaleTimeString()})`,
      keyOrToken: token,
      endpointUrl: url,
      createdAt: new Date().toISOString(),
      isActive: true,
      accountDetails: health.gpuDevice || `${provider.toUpperCase()} worker`
    });

    return applied;
  }

  /**
   * Dispatches speech synthesis job
   */
  public async executeJob(
    job: SynthesisJob,
    onProgress: (percent: number, status: string) => void
  ): Promise<{ audioUrl: string; durationSeconds: number; latencyMs: number }> {
    const startTime = performance.now();
    const config = this.providerConfigs[job.provider];

    onProgress(15, `Preparing ${job.language} synthesis request...`);

    const hasWorker = Boolean(config.isConnected && config.endpointUrl);

    if (job.voice.isCloned && !hasWorker && job.provider !== 'huggingface') {
      throw new Error(
        `${job.provider.toUpperCase()} is offline — voice cloning needs a verified worker. ` +
          'Open Inference Providers, start the worker and press Test & Save.'
      );
    }
    onProgress(
      45,
      job.provider === 'huggingface'
        ? 'Requesting Hugging Face inference...'
        : hasWorker
        ? `Dispatching to ${job.provider.toUpperCase()} worker...`
        : 'No verified worker — using the built-in formant preview engine...'
    );

    onProgress(75, 'Synthesizing speech...');

    let audioBlob: Blob | null = null;
    let durationSeconds = Math.max(2.5, job.text.trim().length / 14);
    let failureDetail: string | null = null;

    try {
      const response = await fetch('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: job.provider,
          text: job.text,
          language: job.language,
          gender: job.voice.gender,
          speed: job.speed,
          pitch: job.pitch,
          modelId: job.modelId,
          voiceName: job.voice.name,
          isCloned: job.voice.isCloned || false,
          referenceAudioBase64: job.voice.referenceAudioBase64 || '',
          referenceAudioMimeType: job.voice.referenceAudioMimeType || 'audio/wav',
          promptText: job.voice.promptText || '',
          measuredPitchHz: job.voice.measuredPitchHz,
          timbreDescription: job.voice.timbreDescription,
          tempoDescription: job.voice.tempoDescription,
          workerUrl: config.isConnected && config.endpointUrl ? config.endpointUrl : undefined,
          workerToken: config.bearerToken || undefined
        })
      });

      if (response.ok) {
        const data = await response.json();
        if (data.audioBase64) {
          const binary = atob(data.audioBase64);
          const bytes = new Uint8Array(binary.length);
          for (let i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i);
          }
          audioBlob = new Blob([bytes], { type: 'audio/wav' });
          const rate = typeof data.sampleRate === 'number' && data.sampleRate > 0 ? data.sampleRate : 24000;
          durationSeconds = Math.max(1.8, (bytes.length - 44) / (rate * 2));
        } else {
          failureDetail = 'response contained no audio';
        }
      } else {
        const detail = await response.json().catch(() => null);
        failureDetail = detail?.error || detail?.detail || `HTTP ${response.status}`;
      }
    } catch (error) {
      failureDetail = error instanceof Error ? error.message : 'network error';
    }

    if (!audioBlob) {
      // Never substitute the built-in formant preview for a worker-backed request:
      // that would look like the cloned voice succeeded when it did not.
      if (hasWorker && job.provider !== 'huggingface') {
        throw new Error(
          `${job.provider.toUpperCase()} worker synthesis failed: ${failureDetail ?? 'unknown error'}`
        );
      }
      const synth = await synthesizeSpeechAudio({
        text: job.text,
        language: job.language,
        gender: job.voice.gender,
        speed: job.speed,
        pitch: job.pitch,
        measuredPitchHz: job.voice.measuredPitchHz,
        isCloned: job.voice.isCloned,
        sampleRate: job.sampleRate
      });
      audioBlob = synth.audioBlob;
      durationSeconds = synth.durationSeconds;
    }

    onProgress(100, 'Audio synthesis complete');
    const audioUrl = URL.createObjectURL(audioBlob);
    const latencyMs = Math.round(performance.now() - startTime);

    return {
      audioUrl,
      durationSeconds,
      latencyMs
    };
  }

  /**
   * Probes a worker's GET /health endpoint. This is the only source of truth
   * for "Online" — nothing here ever assumes a provider is reachable.
   */
  public async probeWorker(url: string, token: string, timeoutMs = 4500): Promise<WorkerHealth> {
    const checkedAt = new Date().toISOString();
    const endpoint = (url || '').trim().replace(/\/+$/, '');

    if (!endpoint) {
      return { online: false, checkedAt, errorMessage: 'No worker URL configured' };
    }

    try {
      new URL(endpoint);
    } catch {
      return { online: false, checkedAt, errorMessage: 'Worker URL is not a valid http(s) URL' };
    }

    const started = performance.now();
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const response = await fetch(`${endpoint}/health`, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        },
        signal: controller.signal
      });
      clearTimeout(timer);
      const latencyMs = Math.round(performance.now() - started);

      if (!response.ok) {
        return {
          online: false,
          checkedAt,
          latencyMs,
          errorMessage: `Worker responded HTTP ${response.status}`
        };
      }

      const data = await response.json();
      const modelLoaded = data.model_loaded !== false;
      return {
        online: data.status !== 'error',
        status: data.status,
        gpuDevice: data.gpu_device,
        vramUsedMb: data.vram_used,
        vramTotalMb: data.vram_total,
        modelLoaded,
        modelError: data.model_error ?? null,
        sampleRate: data.sample_rate ?? null,
        platform: data.platform,
        latencyMs,
        checkedAt,
        errorMessage: modelLoaded ? undefined : data.model_error || 'Model not loaded on the worker'
      };
    } catch (error) {
      return {
        online: false,
        checkedAt,
        errorMessage:
          error instanceof Error && error.name === 'AbortError'
            ? `Timed out after ${timeoutMs}ms — is the worker running?`
            : `Unreachable: ${error instanceof Error ? error.message : 'network error'}`
      };
    }
  }

  /** Applies a probe result to the stored config (no fabrication). */
  public applyWorkerHealth(provider: InferenceProvider, health: WorkerHealth): ProviderEndpointConfig {
    const config: ProviderEndpointConfig = {
      ...this.providerConfigs[provider],
      isConnected: health.online,
      lastPingAt: health.checkedAt,
      latencyMs: health.latencyMs,
      gpuDeviceName: health.gpuDevice,
      vramUsedMb: health.vramUsedMb,
      vramTotalMb: health.vramTotalMb,
      statusMessage: health.online
        ? `Health check OK · ${health.latencyMs ?? '—'}ms${health.modelLoaded === false ? ' · model not loaded' : ''}`
        : health.errorMessage || 'Worker unreachable'
    };
    this.saveConfig(config);
    return config;
  }

  // --- Kaggle API (routed through server.ts, credentials never persisted server-side) ---
  public getKaggleCredentials(): { username: string; key: string } | null {
    const active = this.apiKeys.find((k) => k.provider === 'kaggle' && k.isActive);
    if (!active || !active.keyOrToken || !active.accountDetails) return null;
    return { username: active.accountDetails, key: active.keyOrToken };
  }

  public async testKaggleCredentials(
    username: string,
    key: string,
    label?: string
  ): Promise<{ ok: boolean; message: string; account?: string }> {
    try {
      const response = await fetch('/api/providers/kaggle/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, key })
      });
      const data = await response.json();
      if (data.ok) {
        this.saveApiKey({
          id: `kaggle-${username}`,
          provider: 'kaggle',
          label: label?.trim() || `Kaggle (${username})`,
          keyOrToken: key,
          createdAt: new Date().toISOString(),
          isActive: true,
          accountDetails: username
        });
      }
      return { ok: Boolean(data.ok), message: data.message || 'No response detail', account: username };
    } catch (error) {
      return {
        ok: false,
        message: `Kaggle verification failed: ${error instanceof Error ? error.message : 'network error'}`
      };
    }
  }

  public async launchKaggleWorker(datasetSource?: string): Promise<{
    ok: boolean;
    message: string;
    kernelUrl?: string;
  }> {
    const credentials = this.getKaggleCredentials();
    if (!credentials) {
      return { ok: false, message: 'Save and verify your Kaggle username + API key first.' };
    }
    try {
      const response = await fetch('/api/providers/kaggle/launch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...credentials, datasetSource })
      });
      const data = await response.json();
      return { ok: Boolean(data.ok), message: data.message || 'Launch request sent', kernelUrl: data.kernelUrl };
    } catch (error) {
      return {
        ok: false,
        message: `Launch failed: ${error instanceof Error ? error.message : 'network error'}`
      };
    }
  }

  public async pollKaggleSession(): Promise<{
    state: 'queued' | 'running' | 'connected' | 'error';
    message: string;
    url?: string;
    token?: string;
    kernelUrl?: string;
  }> {
    const credentials = this.getKaggleCredentials();
    if (!credentials) {
      return { state: 'error', message: 'Kaggle credentials missing' };
    }
    try {
      const response = await fetch('/api/providers/kaggle/poll', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(credentials)
      });
      const data = await response.json();
      return {
        state: data.state || 'running',
        message: data.message || '',
        url: data.url,
        token: data.token,
        kernelUrl: data.kernelUrl
      };
    } catch (error) {
      return {
        state: 'error',
        message: `Polling failed: ${error instanceof Error ? error.message : 'network error'}`
      };
    }
  }
}

