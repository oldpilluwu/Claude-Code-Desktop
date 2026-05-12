import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import path from 'node:path';
import { loadConfig, saveConfig } from './config';
import { createSession, writeToSession, resizeSession, killSession, removeSessionConfigDir, sessionHasTranscript, BinaryNotFoundError } from './pty';
import { listSessions, upsertSession, touchSession, removeSession } from './sessions';
import type { AppConfig, CreateSessionOptions, SessionMeta } from '../shared/types';

let mainWindow: BrowserWindow | null = null;

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
      (id, data) => {
        mainWindow?.webContents.send('session:data', { id, data });
      },
      (id, exitCode) => {
        if (sessionHasTranscript(id)) {
          touchSession(id, Date.now());
        } else {
          removeSession(id);
          removeSessionConfigDir(id);
        }
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
    return handle;
  } catch (err) {
    if (err instanceof BinaryNotFoundError) {
      throw new Error(err.message);
    }
    throw err;
  }
});

ipcMain.handle('sessions:list', () => listSessions());
ipcMain.handle('sessions:remove', (_e, id: string) => {
  removeSession(id);
  removeSessionConfigDir(id);
  return true;
});

ipcMain.on('session:write', (_e, { id, data }: { id: string; data: string }) =>
  writeToSession(id, data)
);

ipcMain.on('session:resize', (_e, { id, cols, rows }: { id: string; cols: number; rows: number }) =>
  resizeSession(id, cols, rows)
);

ipcMain.on('session:kill', (_e, { id }: { id: string }) => killSession(id));
