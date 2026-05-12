export type PermissionMode = 'default' | 'plan' | 'acceptEdits' | 'bypass';

export type ThinkingEffort = 'off' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export const THINKING_BUDGETS: Record<ThinkingEffort, number> = {
  off: 0,
  low: 4000,
  medium: 10000,
  high: 16000,
  xhigh: 24000,
  max: 31999
};

export interface ModelOption {
  id: string;
  label: string;
  source: 'anthropic' | 'local' | 'custom' | 'profile';
}

export interface FileMentionSuggestion {
  type: 'file';
  label: string;
  detail: string;
  path: string;
  insertText: string;
}

export interface SlashSuggestion {
  type: 'command' | 'skill';
  label: string;
  detail?: string;
  insertText: string;
  source: 'built-in' | 'project' | 'user' | 'plugin';
}

export interface ProviderProfile {
  id: string;
  name: string;
  baseUrl: string;
  authToken: string;
  apiKey: string;
  model: string;
  extraEnv: Record<string, string>;
}

export interface AppConfig {
  claudeBinary: string;
  defaultProjectPath: string;
  defaultProfileId: string;
  defaultModel: string;
  defaultPermissionMode: PermissionMode;
  defaultThinkingEffort?: ThinkingEffort;
  profiles: ProviderProfile[];
}

export interface CreateSessionOptions {
  sessionId: string;
  cwd: string;
  profile: ProviderProfile;
  model: string;
  permissionMode: PermissionMode;
  thinkingEffort?: ThinkingEffort;
  claudeBinary: string;
  cols: number;
  rows: number;
  resume?: boolean;
}

export type LaunchRequest = Omit<CreateSessionOptions, 'sessionId' | 'resume'>;

export interface SessionHandle {
  id: string;
  pid: number;
}

export interface SessionMeta {
  id: string;
  cwd: string;
  profileId: string;
  providerProfile?: ProviderProfile;
  model: string;
  permissionMode: PermissionMode;
  thinkingEffort?: ThinkingEffort;
  claudeBinary: string;
  createdAt: number;
  lastActiveAt: number;
  title?: string;
  titleManual?: boolean;
}

export interface PersistedChatActivity {
  id: string;
  kind: string;
  title: string;
  text?: string;
  status?: 'running' | 'complete' | 'error';
  expandable?: boolean;
}

export type PersistedChatPart =
  | { id: string; type: 'text'; text: string }
  | { id: string; type: 'trace'; activities: PersistedChatActivity[] };

export interface PersistedChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  text: string;
  createdAt: number;
  activities: PersistedChatActivity[];
  parts: PersistedChatPart[];
}

export interface SessionTranscript {
  id: string;
  messages: PersistedChatMessage[];
  model: string;
  observedModel?: string;
  permissionMode: PermissionMode;
  thinkingEffort?: ThinkingEffort;
  updatedAt: number;
  title?: string;
  titleManual?: boolean;
}

export interface SessionDataEvent {
  id: string;
  event: ClaudeOutputEvent;
}

export interface SessionExitEvent {
  id: string;
  exitCode: number;
}

export interface ClaudeOutputEvent {
  source: 'stdout' | 'stderr';
  kind: 'json' | 'text' | 'parse_error';
  receivedAt: number;
  data?: unknown;
  text?: string;
  line?: string;
}

export interface PermissionRequest {
  id: string;
  sessionId: string;
  toolName: string;
  input: unknown;
  createdAt: number;
}

export interface PermissionDecision {
  requestId: string;
  allow: boolean;
  message?: string;
}
