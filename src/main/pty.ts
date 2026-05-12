import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { app } from 'electron';
import { resolveBinary, buildSpawnTarget } from './binary';
import { ensurePermissionBridge } from './permissions';
import type {
  ClaudeOutputEvent,
  CreateSessionOptions,
  PermissionMode,
  ProviderProfile,
  SessionHandle,
  ThinkingEffort
} from '../shared/types';
import { THINKING_BUDGETS } from '../shared/types';

interface RuntimeSession {
  opts: CreateSessionOptions;
  binary: string;
  configDir: string;
  proc: ChildProcessWithoutNullStreams | null;
  stdoutRemainder: string;
}

const sessions = new Map<string, RuntimeSession>();

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

function buildEnv(
  profile: ProviderProfile,
  configDir: string,
  thinkingEffort?: ThinkingEffort
): NodeJS.ProcessEnv {
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
  const budget = thinkingEffort ? THINKING_BUDGETS[thinkingEffort] : 0;
  if (budget > 0) {
    env.MAX_THINKING_TOKENS = String(budget);
  } else {
    delete env.MAX_THINKING_TOKENS;
  }
  return env;
}

function buildArgs(
  sessionId: string,
  model: string,
  permissionMode: PermissionMode,
  resume: boolean
): string[] {
  const args: string[] = [
    '--print',
    '--output-format',
    'stream-json',
    '--verbose',
    '--include-partial-messages',
    '--include-hook-events',
    '--permission-prompt-tool',
    'mcp__srclaude_permissions__approval_prompt',
    '--allowedTools',
    'mcp__srclaude_permissions__approval_prompt'
  ];
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
  _onData: (id: string, event: ClaudeOutputEvent) => void,
  _onExit: (id: string, exitCode: number) => void
): SessionHandle {
  const { sessionId, claudeBinary, resume } = opts;

  const requested = (claudeBinary || 'claude').trim();
  const resolved = resolveBinary(requested);
  if (!resolved) throw new BinaryNotFoundError(requested);

  if (sessions.has(sessionId)) {
    throw new Error(`Session ${sessionId} is already running.`);
  }

  const configDir = ensureSessionConfigDir(sessionId);
  syncAuthIn(configDir);
  if (resume) migrateTranscript(sessionId, configDir);
  const id = sessionId;

  sessions.set(id, {
    opts,
    binary: resolved,
    configDir,
    proc: null,
    stdoutRemainder: ''
  });

  return { id, pid: 0 };
}

function emitText(
  id: string,
  source: 'stdout' | 'stderr',
  text: string,
  onData: (id: string, event: ClaudeOutputEvent) => void
): void {
  if (!text) return;
  onData(id, { source, kind: 'text', text, receivedAt: Date.now() });
}

function emitStdoutChunk(
  session: RuntimeSession,
  id: string,
  chunk: string,
  onData: (id: string, event: ClaudeOutputEvent) => void
): void {
  session.stdoutRemainder += chunk;
  const lines = session.stdoutRemainder.split(/\r?\n/);
  session.stdoutRemainder = lines.pop() ?? '';

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      onData(id, {
        source: 'stdout',
        kind: 'json',
        data: JSON.parse(trimmed),
        line: trimmed,
        receivedAt: Date.now()
      });
    } catch {
      onData(id, {
        source: 'stdout',
        kind: 'parse_error',
        text: trimmed,
        line: trimmed,
        receivedAt: Date.now()
      });
    }
  }
}

export function sendMessageToSession(
  id: string,
  message: string,
  onData: (id: string, event: ClaudeOutputEvent) => void,
  onExit: (id: string, exitCode: number) => void
): void {
  const session = sessions.get(id);
  if (!session) throw new Error(`Session ${id} is not available.`);
  if (session.proc) throw new Error('Claude is still responding. Stop the current run before sending another message.');

  const resume = Boolean(session.opts.resume) || sessionHasTranscript(id);
  const args = buildArgs(id, session.opts.model, session.opts.permissionMode, resume);
  const permissionBridge = ensurePermissionBridge(id);
  args.push('--mcp-config', permissionBridge.configPath);
  const target = buildSpawnTarget(session.binary, args);
  syncAuthIn(session.configDir);
  const env = buildEnv(session.opts.profile, session.configDir, session.opts.thinkingEffort);
  session.stdoutRemainder = '';

  const proc = spawn(target.command, target.args, {
    cwd: session.opts.cwd || process.cwd(),
    env,
    windowsHide: true
  });
  session.proc = proc;

  proc.stdout.setEncoding('utf8');
  proc.stderr.setEncoding('utf8');
  proc.stdout.on('data', (data: string) => emitStdoutChunk(session, id, data, onData));
  proc.stderr.on('data', (data: string) => emitText(id, 'stderr', data, onData));
  proc.on('error', (err) => {
    onData(id, {
      source: 'stderr',
      kind: 'text',
      text: err.message,
      receivedAt: Date.now()
    });
  });
  proc.on('close', (exitCode) => {
    if (session.stdoutRemainder.trim()) {
      emitStdoutChunk(session, id, '\n', onData);
    }
    session.proc = null;
    session.opts = { ...session.opts, resume: true };
    syncAuthOut(session.configDir);
    onExit(id, exitCode ?? 0);
  });

  proc.stdin.end(message);
}

export function writeToSession(_id: string, _data: string): void {
  // Retained for older renderer builds. Chat mode sends complete messages via sendMessageToSession.
}

export function resizeSession(_id: string, _cols: number, _rows: number): void {
  // No visible terminal is attached in chat mode.
}

export function killSession(id: string): void {
  const s = sessions.get(id);
  if (!s) return;
  try { s.proc?.kill(); } catch { /* ignore */ }
  sessions.delete(id);
}

export function stopSessionRun(id: string): void {
  const s = sessions.get(id);
  if (!s?.proc) return;
  try { s.proc.kill(); } catch { /* ignore */ }
}

export function updateSessionModel(id: string, model: string): void {
  const session = sessions.get(id);
  if (!session) return;
  session.opts = { ...session.opts, model };
}

export function updateSessionPermissionMode(id: string, permissionMode: PermissionMode): void {
  const session = sessions.get(id);
  if (!session) return;
  session.opts = { ...session.opts, permissionMode };
}

export function updateSessionThinkingEffort(id: string, thinkingEffort: ThinkingEffort): void {
  const session = sessions.get(id);
  if (!session) return;
  session.opts = { ...session.opts, thinkingEffort };
}
