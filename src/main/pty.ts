import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { app } from 'electron';
import * as pty from 'node-pty';
import { resolveBinary, buildSpawnTarget } from './binary';
import type { CreateSessionOptions, PermissionMode, ProviderProfile, SessionHandle } from '../shared/types';

const sessions = new Map<string, pty.IPty>();

// Entries under ~/.claude that we seed each per-session config dir with
// on first creation. Excludes transcripts, todos, shell snapshots, telemetry,
// and credentials — credentials are synced separately on every spawn/exit.
const SEED_ENTRIES = ['settings.json', 'CLAUDE.md', 'agents', 'commands', 'plugins'];

// Files synced bidirectionally between the user's global Claude Code state
// and each per-session config dir so that login persists across sessions.
// .claude.json lives at $HOME/.claude.json (NOT inside ~/.claude/) globally,
// but at <CLAUDE_CONFIG_DIR>/.claude.json once that env is set.
// .credentials.json lives inside ~/.claude/ in both cases.
const SHARED_AUTH_FILES = ['.claude.json', '.credentials.json'];

function globalAuthPath(name: string): string {
  if (name === '.claude.json') return path.join(os.homedir(), name);
  return path.join(os.homedir(), '.claude', name);
}

function sessionConfigDir(sessionId: string): string {
  return path.join(app.getPath('userData'), 'session-config', sessionId);
}

function syncAuthIn(dir: string): void {
  for (const name of SHARED_AUTH_FILES) {
    const src = globalAuthPath(name);
    if (!fs.existsSync(src)) continue;
    try { fs.copyFileSync(src, path.join(dir, name)); } catch { /* ignore */ }
  }
}

function syncAuthOut(dir: string): void {
  for (const name of SHARED_AUTH_FILES) {
    const src = path.join(dir, name);
    if (!fs.existsSync(src)) continue;
    const dst = globalAuthPath(name);
    try {
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      if (fs.existsSync(dst)) {
        const srcMtime = fs.statSync(src).mtimeMs;
        const dstMtime = fs.statSync(dst).mtimeMs;
        if (srcMtime <= dstMtime) continue;
      }
      fs.copyFileSync(src, dst);
    } catch { /* ignore */ }
  }
}

function ensureSessionConfigDir(sessionId: string): string {
  const dir = sessionConfigDir(sessionId);
  if (fs.existsSync(dir)) return dir;
  fs.mkdirSync(dir, { recursive: true });

  const globalDir = path.join(os.homedir(), '.claude');
  if (!fs.existsSync(globalDir)) return dir;

  for (const name of SEED_ENTRIES) {
    const src = path.join(globalDir, name);
    if (!fs.existsSync(src)) continue;
    try {
      fs.cpSync(src, path.join(dir, name), { recursive: true });
    } catch { /* best-effort seed */ }
  }
  return dir;
}

// Migrate a session's transcript from the user's global ~/.claude/projects/
// into its isolated config dir, so `--resume <id>` can find it. Needed for
// sessions created before per-session config dirs were introduced, since
// their .jsonl transcripts live in the global location.
function migrateTranscript(sessionId: string, configDir: string): void {
  const localProjects = path.join(configDir, 'projects');
  if (fs.existsSync(localProjects)) {
    for (const entry of fs.readdirSync(localProjects)) {
      if (fs.existsSync(path.join(localProjects, entry, `${sessionId}.jsonl`))) return;
    }
  }

  const globalProjects = path.join(os.homedir(), '.claude', 'projects');
  if (!fs.existsSync(globalProjects)) return;

  for (const entry of fs.readdirSync(globalProjects)) {
    const candidate = path.join(globalProjects, entry, `${sessionId}.jsonl`);
    if (!fs.existsSync(candidate)) continue;
    const dst = path.join(localProjects, entry, `${sessionId}.jsonl`);
    try {
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      fs.copyFileSync(candidate, dst);
    } catch { /* ignore */ }
    return;
  }
}

export function sessionHasTranscript(sessionId: string): boolean {
  const projectsDir = path.join(sessionConfigDir(sessionId), 'projects');
  if (!fs.existsSync(projectsDir)) return false;
  for (const entry of fs.readdirSync(projectsDir)) {
    if (fs.existsSync(path.join(projectsDir, entry, `${sessionId}.jsonl`))) return true;
  }
  return false;
}

export function removeSessionConfigDir(sessionId: string): void {
  const dir = sessionConfigDir(sessionId);
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
}

const PERMISSION_FLAGS: Record<PermissionMode, string[]> = {
  default: [],
  plan: ['--permission-mode', 'plan'],
  acceptEdits: ['--permission-mode', 'acceptEdits'],
  bypass: ['--dangerously-skip-permissions']
};

function buildEnv(profile: ProviderProfile, configDir: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  env.CLAUDE_CONFIG_DIR = configDir;
  if (profile.baseUrl) env.ANTHROPIC_BASE_URL = profile.baseUrl;
  if (profile.authToken) env.ANTHROPIC_AUTH_TOKEN = profile.authToken;
  if (profile.apiKey !== undefined) env.ANTHROPIC_API_KEY = profile.apiKey;
  if (profile.extraEnv) {
    for (const [k, v] of Object.entries(profile.extraEnv)) {
      if (v !== undefined && v !== null) env[k] = String(v);
    }
  }
  return env;
}

function buildArgs(
  sessionId: string,
  model: string,
  permissionMode: PermissionMode,
  resume: boolean
): string[] {
  const args: string[] = [];
  if (resume) args.push('--resume', sessionId);
  else args.push('--session-id', sessionId);
  if (model) args.push('--model', model);
  args.push(...(PERMISSION_FLAGS[permissionMode] ?? []));
  return args;
}

export class BinaryNotFoundError extends Error {
  constructor(public readonly binary: string) {
    super(`Could not locate Claude Code binary: "${binary}". Check PATH or update the binary path in Settings.`);
    this.name = 'BinaryNotFoundError';
  }
}

export function createSession(
  opts: CreateSessionOptions,
  onData: (id: string, data: string) => void,
  onExit: (id: string, exitCode: number) => void
): SessionHandle {
  const { sessionId, cwd, profile, model, permissionMode, claudeBinary, cols, rows, resume } = opts;

  const requested = (claudeBinary || 'claude').trim();
  const resolved = resolveBinary(requested);
  if (!resolved) throw new BinaryNotFoundError(requested);

  if (sessions.has(sessionId)) {
    throw new Error(`Session ${sessionId} is already running.`);
  }

  const baseArgs = buildArgs(sessionId, model, permissionMode, Boolean(resume));
  const { command, args } = buildSpawnTarget(resolved, baseArgs);

  const configDir = ensureSessionConfigDir(sessionId);
  syncAuthIn(configDir);
  if (resume) migrateTranscript(sessionId, configDir);
  const env = buildEnv(profile, configDir);
  const id = sessionId;

  const proc = pty.spawn(command, args, {
    name: 'xterm-256color',
    cols: cols || 100,
    rows: rows || 30,
    cwd: cwd || process.cwd(),
    env: env as { [key: string]: string }
  });

  sessions.set(id, proc);
  proc.onData((data) => onData(id, data));
  proc.onExit(({ exitCode }) => {
    sessions.delete(id);
    syncAuthOut(configDir);
    onExit(id, exitCode);
  });

  return { id, pid: proc.pid };
}

export function writeToSession(id: string, data: string): void {
  sessions.get(id)?.write(data);
}

export function resizeSession(id: string, cols: number, rows: number): void {
  const s = sessions.get(id);
  if (!s) return;
  try { s.resize(cols, rows); } catch { /* ignore */ }
}

export function killSession(id: string): void {
  const s = sessions.get(id);
  if (!s) return;
  try { s.kill(); } catch { /* ignore */ }
  sessions.delete(id);
}
