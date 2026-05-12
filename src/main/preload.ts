import { contextBridge, ipcRenderer } from 'electron';
import type {
  AppConfig,
  CreateSessionOptions,
  SessionDataEvent,
  SessionExitEvent,
  SessionHandle,
  SessionMeta
} from '../shared/types';

const api = {
  loadConfig: (): Promise<AppConfig> => ipcRenderer.invoke('config:load'),
  saveConfig: (data: AppConfig): Promise<boolean> => ipcRenderer.invoke('config:save', data),
  pickDirectory: (): Promise<string | null> => ipcRenderer.invoke('dialog:pick-directory'),

  createSession: (opts: CreateSessionOptions): Promise<SessionHandle> =>
    ipcRenderer.invoke('session:create', opts),
  writeSession: (id: string, data: string): void => ipcRenderer.send('session:write', { id, data }),
  resizeSession: (id: string, cols: number, rows: number): void =>
    ipcRenderer.send('session:resize', { id, cols, rows }),
  killSession: (id: string): void => ipcRenderer.send('session:kill', { id }),

  listSessions: (): Promise<SessionMeta[]> => ipcRenderer.invoke('sessions:list'),
  removeSession: (id: string): Promise<boolean> => ipcRenderer.invoke('sessions:remove', id),

  onSessionData: (cb: (e: SessionDataEvent) => void): (() => void) => {
    const listener = (_e: unknown, payload: SessionDataEvent) => cb(payload);
    ipcRenderer.on('session:data', listener);
    return () => ipcRenderer.removeListener('session:data', listener);
  },
  onSessionExit: (cb: (e: SessionExitEvent) => void): (() => void) => {
    const listener = (_e: unknown, payload: SessionExitEvent) => cb(payload);
    ipcRenderer.on('session:exit', listener);
    return () => ipcRenderer.removeListener('session:exit', listener);
  }
};

export type DesktopApi = typeof api;

contextBridge.exposeInMainWorld('api', api);
