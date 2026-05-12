import { contextBridge, ipcRenderer } from 'electron';
import type {
  AppConfig,
  CreateSessionOptions,
  FileMentionSuggestion,
  ModelOption,
  PermissionDecision,
  PermissionMode,
  PermissionRequest,
  ProviderProfile,
  SessionDataEvent,
  SessionExitEvent,
  SessionHandle,
  SessionMeta,
  SessionTranscript,
  SlashSuggestion
} from '../shared/types';

const api = {
  loadConfig: (): Promise<AppConfig> => ipcRenderer.invoke('config:load'),
  saveConfig: (data: AppConfig): Promise<boolean> => ipcRenderer.invoke('config:save', data),
  pickDirectory: (): Promise<string | null> => ipcRenderer.invoke('dialog:pick-directory'),
  listModels: (profile: ProviderProfile): Promise<ModelOption[]> =>
    ipcRenderer.invoke('models:list', profile),
  listFileMentions: (cwd: string, query: string): Promise<FileMentionSuggestion[]> =>
    ipcRenderer.invoke('suggestions:files', { cwd, query }),
  listSlashSuggestions: (cwd: string, query: string): Promise<SlashSuggestion[]> =>
    ipcRenderer.invoke('suggestions:slash', { cwd, query }),

  createSession: (opts: CreateSessionOptions): Promise<SessionHandle> =>
    ipcRenderer.invoke('session:create', opts),
  sendMessage: (id: string, message: string): Promise<boolean> =>
    ipcRenderer.invoke('session:send-message', { id, message }),
  updateSessionModel: (id: string, model: string): Promise<boolean> =>
    ipcRenderer.invoke('session:update-model', { id, model }),
  updateSessionPermissionMode: (id: string, permissionMode: PermissionMode): Promise<boolean> =>
    ipcRenderer.invoke('session:update-permission-mode', { id, permissionMode }),
  writeSession: (id: string, data: string): void => ipcRenderer.send('session:write', { id, data }),
  resizeSession: (id: string, cols: number, rows: number): void =>
    ipcRenderer.send('session:resize', { id, cols, rows }),
  stopRun: (id: string): void => ipcRenderer.send('session:stop-run', { id }),
  killSession: (id: string): void => ipcRenderer.send('session:kill', { id }),

  listSessions: (): Promise<SessionMeta[]> => ipcRenderer.invoke('sessions:list'),
  removeSession: (id: string): Promise<boolean> => ipcRenderer.invoke('sessions:remove', id),
  loadTranscript: (id: string): Promise<SessionTranscript | null> =>
    ipcRenderer.invoke('sessions:load-transcript', id),
  saveTranscript: (transcript: SessionTranscript): Promise<boolean> =>
    ipcRenderer.invoke('sessions:save-transcript', transcript),

  onSessionData: (cb: (e: SessionDataEvent) => void): (() => void) => {
    const listener = (_e: unknown, payload: SessionDataEvent) => cb(payload);
    ipcRenderer.on('session:data', listener);
    return () => ipcRenderer.removeListener('session:data', listener);
  },
  onSessionExit: (cb: (e: SessionExitEvent) => void): (() => void) => {
    const listener = (_e: unknown, payload: SessionExitEvent) => cb(payload);
    ipcRenderer.on('session:exit', listener);
    return () => ipcRenderer.removeListener('session:exit', listener);
  },
  onPermissionRequest: (cb: (e: PermissionRequest) => void): (() => void) => {
    const listener = (_e: unknown, payload: PermissionRequest) => cb(payload);
    ipcRenderer.on('permission:request', listener);
    return () => ipcRenderer.removeListener('permission:request', listener);
  },
  respondPermission: (decision: PermissionDecision): Promise<boolean> => {
    return ipcRenderer.invoke('permission:respond', decision);
  }
};

export type DesktopApi = typeof api;

contextBridge.exposeInMainWorld('api', api);
