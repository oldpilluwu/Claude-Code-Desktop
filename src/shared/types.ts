export type PermissionMode = 'default' | 'plan' | 'acceptEdits' | 'bypass';

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
  profiles: ProviderProfile[];
}

export interface CreateSessionOptions {
  sessionId: string;
  cwd: string;
  profile: ProviderProfile;
  model: string;
  permissionMode: PermissionMode;
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
  claudeBinary: string;
  createdAt: number;
  lastActiveAt: number;
}

export interface SessionDataEvent {
  id: string;
  data: string;
}

export interface SessionExitEvent {
  id: string;
  exitCode: number;
}
