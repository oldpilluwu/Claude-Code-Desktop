import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import type { SessionMeta, SessionTranscript } from '../shared/types';

function sessionsPath(): string {
  return path.join(app.getPath('userData'), 'sessions.json');
}

function transcriptPath(id: string): string {
  return path.join(app.getPath('userData'), 'chat-transcripts', `${id}.json`);
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

export function patchSession(id: string, patch: Partial<SessionMeta>): void {
  const all = readAll();
  const idx = all.findIndex((m) => m.id === id);
  if (idx < 0) return;
  all[idx] = { ...all[idx], ...patch, lastActiveAt: Date.now() };
  writeAll(all);
}

export function removeSession(id: string): void {
  const all = readAll().filter((m) => m.id !== id);
  writeAll(all);
  try { fs.rmSync(transcriptPath(id), { force: true }); } catch { /* ignore */ }
}

export function loadTranscript(id: string): SessionTranscript | null {
  try {
    return JSON.parse(fs.readFileSync(transcriptPath(id), 'utf-8')) as SessionTranscript;
  } catch {
    return null;
  }
}

export function saveTranscript(transcript: SessionTranscript): boolean {
  const file = transcriptPath(transcript.id);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(transcript, null, 2));
  const patch: Partial<SessionMeta> = {
    model: transcript.model,
    permissionMode: transcript.permissionMode
  };
  if (transcript.title !== undefined) patch.title = transcript.title;
  if (transcript.titleManual !== undefined) patch.titleManual = transcript.titleManual;
  patchSession(transcript.id, patch);
  return true;
}
