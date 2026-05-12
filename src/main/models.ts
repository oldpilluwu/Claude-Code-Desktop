import type { ModelOption, ProviderProfile } from '../shared/types';

const ANTHROPIC_MODELS: ModelOption[] = [
  { id: 'claude-opus-4-7', label: 'Claude Opus 4.7', source: 'anthropic' },
  { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6', source: 'anthropic' },
  { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5', source: 'anthropic' },
  { id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5 snapshot', source: 'anthropic' },
  { id: 'opus', label: 'Opus alias', source: 'anthropic' },
  { id: 'sonnet', label: 'Sonnet alias', source: 'anthropic' }
];

function isAnthropic(profile: ProviderProfile): boolean {
  const baseUrl = profile.baseUrl.trim().toLowerCase();
  return !baseUrl || baseUrl.includes('anthropic.com') || profile.id === 'default';
}

function uniqueModels(models: ModelOption[]): ModelOption[] {
  const seen = new Set<string>();
  return models.filter((model) => {
    if (!model.id || seen.has(model.id)) return false;
    seen.add(model.id);
    return true;
  });
}

function joinUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, '')}${path}`;
}

async function fetchJson(url: string, profile: ProviderProfile): Promise<unknown> {
  const headers: Record<string, string> = {};
  const token = profile.apiKey || profile.authToken;
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(url, { headers });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response.json();
}

async function fetchAnthropicModels(profile: ProviderProfile): Promise<ModelOption[]> {
  if (!profile.apiKey) return [];
  const response = await fetch('https://api.anthropic.com/v1/models', {
    headers: {
      'x-api-key': profile.apiKey,
      'anthropic-version': '2023-06-01'
    }
  });
  if (!response.ok) return [];
  const data = await response.json();
  return parseModelList(data).map((id) => ({ id, label: id, source: 'anthropic' }));
}

function parseModelList(data: unknown): string[] {
  if (!data || typeof data !== 'object') return [];
  const value = data as Record<string, unknown>;
  if (Array.isArray(value.models)) {
    return value.models
      .map((model) => {
        if (typeof model === 'string') return model;
        if (model && typeof model === 'object') {
          const record = model as Record<string, unknown>;
          return typeof record.name === 'string' ? record.name : typeof record.id === 'string' ? record.id : '';
        }
        return '';
      })
      .filter(Boolean);
  }
  if (Array.isArray(value.data)) {
    return value.data
      .map((model) => {
        if (typeof model === 'string') return model;
        if (model && typeof model === 'object') {
          const id = (model as Record<string, unknown>).id;
          return typeof id === 'string' ? id : '';
        }
        return '';
      })
      .filter(Boolean);
  }
  return [];
}

export async function listModels(profile: ProviderProfile): Promise<ModelOption[]> {
  if (isAnthropic(profile)) {
    const liveModels = await fetchAnthropicModels(profile);
    return uniqueModels([...liveModels, ...ANTHROPIC_MODELS]);
  }

  const models: ModelOption[] = [];
  if (profile.model) {
    models.push({ id: profile.model, label: `${profile.model} (profile default)`, source: 'profile' });
  }

  const baseUrl = profile.baseUrl.trim();
  if (!baseUrl) return uniqueModels(models);

  const candidates = ['/api/tags', '/v1/models', '/models'];
  for (const path of candidates) {
    try {
      const data = await fetchJson(joinUrl(baseUrl, path), profile);
      models.push(
        ...parseModelList(data).map<ModelOption>((id) => ({
          id,
          label: id,
          source: path === '/api/tags' ? 'local' : 'custom'
        }))
      );
      if (models.length > 0) break;
    } catch {
      // Try the next common provider endpoint.
    }
  }

  return uniqueModels(models);
}
