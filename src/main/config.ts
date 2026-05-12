import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import type { AppConfig } from '../shared/types';

function configPath(): string {
  return path.join(app.getPath('userData'), 'config.json');
}

const DEFAULT_CONFIG: AppConfig = {
  claudeBinary: 'claude',
  defaultProjectPath: '',
  defaultProfileId: 'default',
  defaultModel: '',
  defaultPermissionMode: 'default',
  defaultThinkingEffort: 'off',
  profiles: [
    {
      id: 'default',
      name: 'Default Claude Code',
      baseUrl: '',
      authToken: '',
      apiKey: '',
      model: '',
      extraEnv: {}
    },
    {
      id: 'ollama',
      name: 'Ollama (local)',
      baseUrl: 'http://localhost:11434',
      authToken: 'ollama',
      apiKey: '',
      model: 'qwen2.5-coder',
      extraEnv: {}
    }
  ]
};

export function loadConfig(): AppConfig {
  try {
    const raw = fs.readFileSync(configPath(), 'utf-8');
    const parsed = JSON.parse(raw) as Partial<AppConfig>;
    return { ...DEFAULT_CONFIG, ...parsed };
  } catch {
    return DEFAULT_CONFIG;
  }
}

export function saveConfig(data: AppConfig): boolean {
  fs.mkdirSync(path.dirname(configPath()), { recursive: true });
  fs.writeFileSync(configPath(), JSON.stringify(data, null, 2));
  return true;
}
