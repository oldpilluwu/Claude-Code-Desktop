import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import path from 'node:path';
import { loadConfig, saveConfig } from './config';
import { listModels } from './models';
import { respondToPermission, watchPermissionRequests } from './permissions';
import { createSession, sendMessageToSession, writeToSession, resizeSession, killSession, stopSessionRun, updateSessionModel, updateSessionPermissionMode, removeSessionConfigDir, sessionHasTranscript, BinaryNotFoundError } from './pty';
import { listSessions, upsertSession, touchSession, patchSession, removeSession, loadTranscript, saveTranscript } from './sessions';
import { listFileMentions, listSlashSuggestions } from './suggestions';
import type { AppConfig, CreateSessionOptions, PermissionDecision, PermissionMode, ProviderProfile, SessionMeta, SessionTranscript } from '../shared/types';

let mainWindow: BrowserWindow | null = null;
const permissionWatchers = new Map<string, () => void>();

const isDev = process.env.NODE_ENV === 'development';
const DEV_URL = 'http://localhost:5173';

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    title: 'Claude Code Desktop',
    backgroundColor: '#0a0a0a',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  if (isDev) {
    mainWindow.loadURL(DEV_URL);
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', '..', 'renderer', 'index.html'));
  }
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

ipcMain.handle('config:load', () => loadConfig());
ipcMain.handle('config:save', (_e, data: AppConfig) => saveConfig(data));
ipcMain.handle('models:list', (_e, profile: ProviderProfile) => listModels(profile));
ipcMain.handle('suggestions:files', (_e, { cwd, query }: { cwd: string; query: string }) =>
  listFileMentions(cwd, query)
);
ipcMain.handle('suggestions:slash', (_e, { cwd, query }: { cwd: string; query: string }) =>
  listSlashSuggestions(cwd, query)
);

ipcMain.handle('dialog:pick-directory', async () => {
  if (!mainWindow) return null;
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory']
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

ipcMain.handle('session:create', (_e, opts: CreateSessionOptions) => {
  try {
    const handle = createSession(
      opts,
      (id, event) => {
        mainWindow?.webContents.send('session:data', { id, event });
      },
      (id, exitCode) => {
        mainWindow?.webContents.send('session:exit', { id, exitCode });
      }
    );
    const now = Date.now();
    const meta: SessionMeta = {
      id: handle.id,
      cwd: opts.cwd,
      profileId: opts.profile.id,
      providerProfile: opts.profile,
      model: opts.model,
      permissionMode: opts.permissionMode,
      claudeBinary: opts.claudeBinary,
      createdAt: opts.resume ? now : now,
      lastActiveAt: now
    };
    if (opts.resume) {
      touchSession(handle.id, now);
    } else {
      upsertSession(meta);
    }
    permissionWatchers.get(handle.id)?.();
    permissionWatchers.set(
      handle.id,
      watchPermissionRequests(handle.id, (request) => {
        mainWindow?.webContents.send('permission:request', request);
      })
    );
    return handle;
  } catch (err) {
    if (err instanceof BinaryNotFoundError) {
      throw new Error(err.message);
    }
    throw err;
  }
});

ipcMain.handle('sessions:list', () => listSessions());
ipcMain.handle('sessions:load-transcript', (_e, id: string) => loadTranscript(id));
ipcMain.handle('sessions:save-transcript', (_e, transcript: SessionTranscript) =>
  saveTranscript(transcript)
);
ipcMain.handle('sessions:remove', (_e, id: string) => {
  removeSession(id);
  removeSessionConfigDir(id);
  return true;
});

ipcMain.on('session:write', (_e, { id, data }: { id: string; data: string }) =>
  writeToSession(id, data)
);

ipcMain.handle('session:send-message', (_e, { id, message }: { id: string; message: string }) => {
  touchSession(id, Date.now());
  sendMessageToSession(
    id,
    message,
    (sessionId, event) => {
      mainWindow?.webContents.send('session:data', { id: sessionId, event });
    },
    (sessionId, exitCode) => {
      if (sessionHasTranscript(sessionId)) {
        touchSession(sessionId, Date.now());
      }
      mainWindow?.webContents.send('session:exit', { id: sessionId, exitCode });
    }
  );
  return true;
});

ipcMain.handle('session:update-model', (_e, { id, model }: { id: string; model: string }) => {
  updateSessionModel(id, model);
  patchSession(id, { model });
  return true;
});

ipcMain.handle('session:update-permission-mode', (_e, { id, permissionMode }: { id: string; permissionMode: PermissionMode }) => {
  updateSessionPermissionMode(id, permissionMode);
  patchSession(id, { permissionMode });
  return true;
});

ipcMain.on('session:resize', (_e, { id, cols, rows }: { id: string; cols: number; rows: number }) =>
  resizeSession(id, cols, rows)
);

ipcMain.on('session:kill', (_e, { id }: { id: string }) => {
  permissionWatchers.get(id)?.();
  permissionWatchers.delete(id);
  killSession(id);
});
ipcMain.on('session:stop-run', (_e, { id }: { id: string }) => stopSessionRun(id));

ipcMain.handle('permission:respond', (_e, decision: PermissionDecision) =>
  respondToPermission(decision)
);
