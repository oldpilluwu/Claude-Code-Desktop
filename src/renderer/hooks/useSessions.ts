import { useCallback, useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { api } from '@/lib/api';
import type { CreateSessionOptions, LaunchRequest, SessionMeta } from '@shared/types';

export interface SessionRecord {
  id: string;
  term: Terminal;
  fitAddon: FitAddon;
  cwd: string;
  model: string;
  profileId: string;
  exited: boolean;
  createdAt: number;
}

function mintId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.floor(Math.random() * 16);
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export function useSessions() {
  const sessionsRef = useRef<Map<string, SessionRecord>>(new Map());
  const [archived, setArchived] = useState<SessionMeta[]>([]);
  const [, force] = useState(0);
  const rerender = useCallback(() => force((n) => n + 1), []);

  const refreshArchived = useCallback(async () => {
    const metas = await api.listSessions();
    setArchived(metas);
  }, []);

  useEffect(() => {
    refreshArchived();

    const offData = api.onSessionData(({ id, data }) => {
      sessionsRef.current.get(id)?.term.write(data);
    });
    const offExit = api.onSessionExit(({ id, exitCode }) => {
      const s = sessionsRef.current.get(id);
      if (s) {
        s.exited = true;
        s.term.write(`\r\n\x1b[33m[claude exited with code ${exitCode}]\x1b[0m\r\n`);
      }
      refreshArchived();
      rerender();
    });
    return () => {
      offData();
      offExit();
    };
  }, [refreshArchived, rerender]);

  const spawn = useCallback(
    async (opts: CreateSessionOptions): Promise<SessionRecord> => {
      const { id } = await api.createSession(opts);

      const term = new Terminal({
        cursorBlink: true,
        fontFamily: 'Menlo, Consolas, "Cascadia Code", monospace',
        fontSize: 13,
        theme: { background: '#000000', foreground: '#e5e5e5' }
      });
      const fitAddon = new FitAddon();
      term.loadAddon(fitAddon);

      term.onData((d) => api.writeSession(id, d));
      term.onResize(({ cols, rows }) => api.resizeSession(id, cols, rows));

      const record: SessionRecord = {
        id,
        term,
        fitAddon,
        cwd: opts.cwd,
        model: opts.model,
        profileId: opts.profile.id,
        exited: false,
        createdAt: Date.now()
      };
      sessionsRef.current.set(id, record);
      await refreshArchived();
      rerender();
      return record;
    },
    [refreshArchived, rerender]
  );

  const launch = useCallback(
    (req: LaunchRequest): Promise<SessionRecord> => spawn({ ...req, sessionId: mintId() }),
    [spawn]
  );

  const resume = useCallback(
    (sessionId: string, req: LaunchRequest): Promise<SessionRecord> =>
      spawn({ ...req, sessionId, resume: true }),
    [spawn]
  );

  const kill = useCallback(
    (id: string) => {
      api.killSession(id);
      const s = sessionsRef.current.get(id);
      if (s) {
        s.term.dispose();
        sessionsRef.current.delete(id);
      }
      rerender();
    },
    [rerender]
  );

  const removeArchived = useCallback(
    async (id: string) => {
      await api.removeSession(id);
      await refreshArchived();
    },
    [refreshArchived]
  );

  const get = useCallback((id: string) => sessionsRef.current.get(id), []);
  const live = useCallback(
    () => Array.from(sessionsRef.current.values()).sort((a, b) => b.createdAt - a.createdAt),
    []
  );

  return { launch, resume, kill, get, live, archived, removeArchived };
}
