import fs from 'node:fs';
import path from 'node:path';

const IS_WIN = process.platform === 'win32';
const PATH_SEP = IS_WIN ? ';' : ':';

function isExecutable(file: string): boolean {
  try {
    const stat = fs.statSync(file);
    if (!stat.isFile()) return false;
    if (IS_WIN) return true;
    fs.accessSync(file, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function getPathExtensions(): string[] {
  if (!IS_WIN) return [''];
  const raw = process.env.PATHEXT || '.COM;.EXE;.BAT;.CMD';
  return ['', ...raw.split(';').map((e) => e.toLowerCase())];
}

/**
 * Resolves a binary name or path to an absolute executable path.
 * - Absolute paths: probed with PATHEXT on Windows if no extension matches.
 * - Bare names: searched across PATH entries with PATHEXT on Windows.
 * Returns null if no executable file is found.
 */
export function resolveBinary(input: string): string | null {
  const name = input.trim();
  if (!name) return null;

  const exts = getPathExtensions();

  const tryWithExtensions = (base: string): string | null => {
    for (const ext of exts) {
      const candidate = ext && !base.toLowerCase().endsWith(ext) ? base + ext : base;
      if (isExecutable(candidate)) return candidate;
    }
    return null;
  };

  if (path.isAbsolute(name) || name.includes('/') || (IS_WIN && name.includes('\\'))) {
    return tryWithExtensions(name);
  }

  const pathDirs = (process.env.PATH || '').split(PATH_SEP).filter(Boolean);
  for (const dir of pathDirs) {
    const found = tryWithExtensions(path.join(dir, name));
    if (found) return found;
  }
  return null;
}

/**
 * Returns the spawn target for a resolved binary. On Windows, `.cmd`/`.bat`
 * files must be invoked via `cmd.exe /c`, since ConPTY's CreateProcess
 * cannot execute script shims directly.
 */
export function buildSpawnTarget(
  binary: string,
  args: string[]
): { command: string; args: string[] } {
  if (IS_WIN) {
    const lower = binary.toLowerCase();
    if (lower.endsWith('.cmd') || lower.endsWith('.bat')) {
      return { command: 'cmd.exe', args: ['/c', binary, ...args] };
    }
  }
  return { command: binary, args };
}
