import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import type { SessionMeta } from '../shared/types';

function sessionsPath(): string {
  return path.join(app.getPath('userData'), 'sessions.json');
}

function readAll(): SessionMeta[] {
  try {
    const raw = fs.readFileSync(sessionsPath(), 'utf-8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as SessionMeta[]) : [];
  } catch {
    return [];
  }
}

function writeAll(metas: SessionMeta[]): void {
  fs.mkdirSync(path.dirname(sessionsPath()), { recursive: true });
  fs.writeFileSync(sessionsPath(), JSON.stringify(metas, null, 2));
}

export function listSessions(): SessionMeta[] {
  return readAll().sort((a, b) => b.lastActiveAt - a.lastActiveAt);
}

export function upsertSession(meta: SessionMeta): void {
  const all = readAll();
  const idx = all.findIndex((m) => m.id === meta.id);
  if (idx >= 0) all[idx] = meta;
  else all.push(meta);
  writeAll(all);
}

export function touchSession(id: string, lastActiveAt: number): void {
  const all = readAll();
  const idx = all.findIndex((m) => m.id === id);
  if (idx < 0) return;
  all[idx] = { ...all[idx], lastActiveAt };
  writeAll(all);
}

export function removeSession(id: string): void {
  const all = readAll().filter((m) => m.id !== id);
  writeAll(all);
}
