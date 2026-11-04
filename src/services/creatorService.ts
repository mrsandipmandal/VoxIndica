import type {
  ConsentRecord,
  CreateProjectInput,
  CreatorAsset,
  CreatorAssetKind,
  CreatorHealth,
  CreatorProject,
  CreatorProjectSummary,
  CreatorVoiceJobInfo,
  GeneratedThumbnail,
  RenderPreset,
  StartVoiceJobInput,
  UpdateProjectInput
} from '../types/creator';

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers || {})
    }
  });

  let payload: any = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok || payload?.ok === false) {
    const message =
      payload?.error || `Creator request failed with HTTP ${response.status} (${url}).`;
    throw new Error(message);
  }
  return payload as T;
}

export const creatorService = {
  async health(): Promise<CreatorHealth> {
    const data = await request<CreatorHealth>('/api/creator/health');
    return data;
  },

  async listProjects(): Promise<CreatorProjectSummary[]> {
    const data = await request<{ ok: true; projects: CreatorProjectSummary[] }>(
      '/api/creator/projects'
    );
    return data.projects;
  },

  async getProject(id: string): Promise<CreatorProject> {
    const data = await request<{ ok: true; project: CreatorProject }>(
      `/api/creator/projects/${encodeURIComponent(id)}`
    );
    return data.project;
  },

  async createProject(input: CreateProjectInput): Promise<CreatorProject> {
    const data = await request<{ ok: true; project: CreatorProject }>('/api/creator/projects', {
      method: 'POST',
      body: JSON.stringify(input)
    });
    return data.project;
  },

  async updateProject(id: string, patch: UpdateProjectInput): Promise<CreatorProject> {
    const data = await request<{ ok: true; project: CreatorProject }>(
      `/api/creator/projects/${encodeURIComponent(id)}`,
      {
        method: 'PATCH',
        body: JSON.stringify(patch)
      }
    );
    return data.project;
  },

  async deleteProject(id: string): Promise<void> {
    await request<{ ok: true }>(`/api/creator/projects/${encodeURIComponent(id)}`, {
      method: 'DELETE'
    });
  },

  async uploadAsset(
    projectId: string,
    input: {
      kind: CreatorAssetKind;
      fileName: string;
      mimeType: string;
      dataBase64: string;
      sceneId?: string;
      generatedBy?: string;
    }
  ): Promise<{ asset: CreatorAsset; project: CreatorProject }> {
    const data = await request<{ ok: true; asset: CreatorAsset; project: CreatorProject }>(
      `/api/creator/projects/${encodeURIComponent(projectId)}/assets`,
      {
        method: 'POST',
        body: JSON.stringify(input)
      }
    );
    return { asset: data.asset, project: data.project };
  },

  async saveConsent(
    projectId: string,
    consent: Pick<ConsentRecord, 'presenterName' | 'notes'> & { confirmed: true }
  ): Promise<CreatorProject> {
    const data = await request<{ ok: true; project: CreatorProject }>(
      `/api/creator/projects/${encodeURIComponent(projectId)}/consent`,
      {
        method: 'POST',
        body: JSON.stringify(consent)
      }
    );
    return data.project;
  },

  async generateThumbnail(projectId: string, prompt = ''): Promise<GeneratedThumbnail> {
    const data = await request<{ ok: true; thumbnail: GeneratedThumbnail }>(
      `/api/creator/projects/${encodeURIComponent(projectId)}/thumbnail/generate`,
      { method: 'POST', body: JSON.stringify({ prompt }) }
    );
    return data.thumbnail;
  },

  exportUrl(projectId: string): string {
    return `/api/creator/projects/${encodeURIComponent(projectId)}/export`;
  },

  captionsUrl(projectId: string, format: 'srt' | 'ass' = 'srt'): string {
    const base = `/api/creator/projects/${encodeURIComponent(projectId)}/captions`;
    return format === 'ass' ? `${base}?format=ass` : base;
  },

  publishingUrl(projectId: string): string {
    return `/api/creator/projects/${encodeURIComponent(projectId)}/publishing`;
  },

  assetUrl(projectId: string, assetId: string): string {
    return `/api/creator/projects/${encodeURIComponent(projectId)}/assets/${encodeURIComponent(assetId)}`;
  },

  async startVoiceJob(
    projectId: string,
    input: StartVoiceJobInput
  ): Promise<{ project: CreatorProject; job: CreatorVoiceJobInfo }> {
    const data = await request<{
      ok: true;
      project: CreatorProject;
      job: CreatorVoiceJobInfo;
    }>(`/api/creator/projects/${encodeURIComponent(projectId)}/voice`, {
      method: 'POST',
      body: JSON.stringify(input)
    });
    return { project: data.project, job: data.job };
  },

  async cancelVoiceJob(
    projectId: string
  ): Promise<{ project: CreatorProject; job: CreatorVoiceJobInfo }> {
    const data = await request<{
      ok: true;
      project: CreatorProject;
      job: CreatorVoiceJobInfo;
    }>(`/api/creator/projects/${encodeURIComponent(projectId)}/voice/cancel`, {
      method: 'POST'
    });
    return { project: data.project, job: data.job };
  },

  async startRender(
    projectId: string,
    options: { burnCaptions?: boolean; preset?: RenderPreset } = {}
  ): Promise<CreatorProject> {
    const data = await request<{ ok: true; project: CreatorProject }>(
      `/api/creator/projects/${encodeURIComponent(projectId)}/render`,
      {
        method: 'POST',
        body: JSON.stringify({
          burnCaptions: options.burnCaptions === true,
          ...(options.preset ? { preset: options.preset } : {})
        })
      }
    );
    return data.project;
  },

  async cancelRender(projectId: string): Promise<CreatorProject> {
    const data = await request<{ ok: true; project: CreatorProject }>(
      `/api/creator/projects/${encodeURIComponent(projectId)}/render/cancel`,
      { method: 'POST' }
    );
    return data.project;
  }
};
