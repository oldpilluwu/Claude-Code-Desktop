import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import type {
  ClaudeOutputEvent,
  CreateSessionOptions,
  LaunchRequest,
  PermissionMode,
  PermissionRequest,
  PersistedChatActivity,
  PersistedChatMessage,
  PersistedChatPart,
  SessionMeta,
  SessionTranscript,
  ThinkingEffort
} from '@shared/types';

export type ChatRole = 'user' | 'assistant' | 'system';
export type ActivityKind = 'system' | 'thinking' | 'tool' | 'error' | 'raw';

export interface ChatActivity {
  id: string;
  kind: ActivityKind;
  title: string;
  text?: string;
  status?: 'running' | 'complete' | 'error';
  raw?: unknown;
  expandable?: boolean;
}

export type ChatPart =
  | { id: string; type: 'text'; text: string }
  | { id: string; type: 'trace'; activities: ChatActivity[] };

export interface ChatMessage {
  id: string;
  role: ChatRole;
  text: string;
  createdAt: number;
  activities: ChatActivity[];
  parts: ChatPart[];
}

export interface SessionRecord {
  id: string;
  messages: ChatMessage[];
  cwd: string;
  model: string;
  permissionMode: PermissionMode;
  thinkingEffort: ThinkingEffort;
  profileId: string;
  exited: boolean;
  isRunning: boolean;
  observedModel?: string;
  pendingPermission?: PermissionRequest;
  pendingToolInputs: Record<string, { activityId: string; toolName: string; partialJson: string }>;
  createdAt: number;
  currentAssistantId?: string;
  title?: string;
  titleManual?: boolean;
}

const TITLE_MAX_LEN = 60;

function deriveTitleFromText(text: string): string {
  const firstLine = text.split(/\r?\n/).map((s) => s.trim()).find((s) => s.length > 0) ?? '';
  if (firstLine.length <= TITLE_MAX_LEN) return firstLine;
  return `${firstLine.slice(0, TITLE_MAX_LEN - 1).trimEnd()}…`;
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

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

function isHiddenToolName(value: unknown): boolean {
  return typeof value === 'string' && value.toLowerCase() === 'rate_limit_event';
}

function compactToolInput(toolName: string, input: unknown): string | undefined {
  const data = asRecord(input);
  if (!data) return undefined;
  const normalized = toolName.toLowerCase();

  const firstString = (...keys: string[]): string | undefined => {
    for (const key of keys) {
      const value = data[key];
      if (typeof value === 'string' && value.trim()) return value.trim();
    }
    return undefined;
  };

  if (normalized === 'bash') return firstString('command', 'cmd');
  if (['read', 'write', 'edit', 'multiedit', 'notebookread', 'notebookedit'].includes(normalized)) {
    return firstString('file_path', 'path', 'notebook_path');
  }
  if (['grep', 'glob', 'ls'].includes(normalized)) {
    return firstString('pattern', 'path', 'query');
  }
  if (normalized.includes('webfetch')) return firstString('url');
  if (normalized.includes('websearch')) return firstString('query');
  if (normalized.includes('todowrite')) return 'Updating task list';
  return firstString('file_path', 'path', 'command', 'query', 'url', 'pattern');
}

function formatToolTitle(toolName: string, input: unknown): string {
  if (toolName.toLowerCase() === 'bash') return toolName;
  const detail = compactToolInput(toolName, input);
  return detail ? `${toolName} - ${detail}` : toolName;
}

function toolInlineText(toolName: string, input: unknown): string | undefined {
  if (toolName.toLowerCase() !== 'bash') return undefined;
  return compactToolInput(toolName, input);
}

function compactToolInputFromPartial(toolName: string, partialJson: string): string | undefined {
  try {
    return compactToolInput(toolName, JSON.parse(partialJson));
  } catch {
    const normalized = toolName.toLowerCase();
    const keys =
      normalized === 'bash'
        ? ['command', 'cmd']
        : ['file_path', 'path', 'notebook_path', 'command', 'query', 'url', 'pattern'];
    for (const key of keys) {
      const match = partialJson.match(new RegExp(`"${key}"\\s*:\\s*"((?:\\\\.|[^"\\\\])*)"`));
      if (!match?.[1]) continue;
      try {
        return JSON.parse(`"${match[1]}"`);
      } catch {
        return match[1];
      }
    }
    return undefined;
  }
}

function permissionTitle(prefix: string, request: PermissionRequest): string {
  return `${prefix}: ${formatToolTitle(request.toolName, request.input)}`;
}

function finishRunningActivities(record: SessionRecord): void {
  const assistant = record.messages.find((m) => m.id === record.currentAssistantId);
  if (!assistant) return;
  for (const activity of assistant.activities) {
    if (activity.status === 'running') activity.status = 'complete';
  }
}

function getCurrentAssistant(record: SessionRecord): ChatMessage {
  const existing = record.messages.find((m) => m.id === record.currentAssistantId);
  if (existing) return existing;
  const assistant: ChatMessage = {
    id: mintId(),
    role: 'assistant',
    text: '',
    createdAt: Date.now(),
    activities: [],
    parts: []
  };
  record.messages.push(assistant);
  record.currentAssistantId = assistant.id;
  return assistant;
}

function getCurrentTracePart(message: ChatMessage): Extract<ChatPart, { type: 'trace' }> {
  const last = message.parts[message.parts.length - 1];
  if (last?.type === 'trace') return last;
  const part: Extract<ChatPart, { type: 'trace' }> = { id: mintId(), type: 'trace', activities: [] };
  message.parts.push(part);
  return part;
}

function getCurrentTextPart(message: ChatMessage): Extract<ChatPart, { type: 'text' }> {
  const last = message.parts[message.parts.length - 1];
  if (last?.type === 'text') return last;
  const part: Extract<ChatPart, { type: 'text' }> = { id: mintId(), type: 'text', text: '' };
  message.parts.push(part);
  return part;
}

function pushActivity(
  record: SessionRecord,
  kind: ActivityKind,
  title: string,
  text?: string,
  raw?: unknown,
  status: ChatActivity['status'] = 'complete',
  expandable?: boolean
): ChatActivity {
  const assistant = getCurrentAssistant(record);
  const activity: ChatActivity = {
    id: mintId(),
    kind,
    title,
    text,
    raw,
    status,
    expandable
  };
  assistant.activities.push(activity);
  getCurrentTracePart(assistant).activities.push(activity);
  return activity;
}

function appendThinking(record: SessionRecord, text: string): void {
  if (!text) return;
  const assistant = getCurrentAssistant(record);
  const tracePart = getCurrentTracePart(assistant);
  const last = tracePart.activities[tracePart.activities.length - 1];
  if (last?.kind === 'thinking') {
    last.text = `${last.text ?? ''}${text}`;
    return;
  }
  const activity: ChatActivity = {
    id: mintId(),
    kind: 'thinking',
    title: 'Thinking',
    text,
    status: 'running'
  };
  assistant.activities.push(activity);
  tracePart.activities.push(activity);
}

function streamEventKey(event: Record<string, unknown> | null): string {
  const index = event?.index;
  if (typeof index === 'number' || typeof index === 'string') return String(index);
  return 'current';
}

function updateToolActivityFromPartial(
  record: SessionRecord,
  key: string,
  partialJson: string
): void {
  const pending = record.pendingToolInputs[key] ?? record.pendingToolInputs.current;
  if (!pending) return;
  pending.partialJson += partialJson;
  const detail = compactToolInputFromPartial(pending.toolName, pending.partialJson);
  if (!detail) return;

  const assistant = getCurrentAssistant(record);
  const activity = assistant.activities.find((item) => item.id === pending.activityId);
  if (!activity) return;
  if (pending.toolName.toLowerCase() === 'bash') activity.text = detail;
  else activity.title = `${pending.toolName} - ${detail}`;
}

function appendAssistantText(record: SessionRecord, text: string): void {
  if (!text) return;
  const assistant = getCurrentAssistant(record);
  assistant.text += text;
  getCurrentTextPart(assistant).text += text;
}

function setObservedModel(record: SessionRecord, value: unknown): void {
  if (typeof value === 'string' && value.trim()) {
    record.observedModel = value;
  }
}

function sanitizeActivity(activity: ChatActivity): PersistedChatActivity {
  return {
    id: activity.id,
    kind: activity.kind,
    title: activity.title,
    text: activity.text,
    status: activity.status === 'running' ? 'complete' : activity.status,
    expandable: activity.expandable
  };
}

function sanitizePart(part: ChatPart): PersistedChatPart {
  if (part.type === 'text') return { ...part };
  return {
    id: part.id,
    type: 'trace',
    activities: part.activities.map(sanitizeActivity)
  };
}

function sanitizeMessage(message: ChatMessage): PersistedChatMessage {
  return {
    id: message.id,
    role: message.role,
    text: message.text,
    createdAt: message.createdAt,
    activities: message.activities.map(sanitizeActivity),
    parts: message.parts.map(sanitizePart)
  };
}

function transcriptFromRecord(record: SessionRecord): SessionTranscript {
  return {
    id: record.id,
    messages: record.messages.map(sanitizeMessage),
    model: record.model,
    observedModel: record.observedModel,
    permissionMode: record.permissionMode,
    thinkingEffort: record.thinkingEffort,
    updatedAt: Date.now(),
    title: record.title,
    titleManual: record.titleManual
  };
}

function activityFromPersisted(activity: PersistedChatActivity): ChatActivity {
  return {
    id: activity.id,
    kind: activity.kind as ActivityKind,
    title: activity.title,
    text: activity.text,
    status: activity.status === 'running' ? 'complete' : activity.status,
    expandable: activity.expandable
  };
}

function partFromPersisted(part: PersistedChatPart): ChatPart {
  if (part.type === 'text') return { ...part };
  return {
    id: part.id,
    type: 'trace',
    activities: part.activities.map(activityFromPersisted)
  };
}

function messagesFromTranscript(transcript: SessionTranscript | null): ChatMessage[] {
  if (!transcript) return [];
  return transcript.messages.map((message) => ({
    id: message.id,
    role: message.role,
    text: message.text,
    createdAt: message.createdAt,
    activities: message.activities.map(activityFromPersisted),
    parts: message.parts.map(partFromPersisted)
  }));
}

function addAssistantSnapshot(record: SessionRecord, message: Record<string, unknown>): void {
  const assistant = getCurrentAssistant(record);
  setObservedModel(record, message.model);
  if (assistant.parts.length > 0) return;
  const content = Array.isArray(message.content) ? message.content : [];
  for (const block of content) {
    const b = asRecord(block);
    if (!b) continue;
    if (b.type === 'text') {
      const text = typeof b.text === 'string' ? b.text : '';
      if (text && !assistant.text) appendAssistantText(record, text);
    }
    if (b.type === 'thinking') {
      const thinking = typeof b.thinking === 'string' ? b.thinking : typeof b.text === 'string' ? b.text : '';
      if (thinking && !assistant.activities.some((a) => a.kind === 'thinking' && a.text === thinking)) {
        pushActivity(record, 'thinking', 'Thinking', thinking, b);
      }
    }
    if (b.type === 'tool_use') {
      const name = typeof b.name === 'string' ? b.name : 'Tool call';
      if (isHiddenToolName(name)) continue;
      pushActivity(record, 'tool', formatToolTitle(name, b.input), toolInlineText(name, b.input));
    }
  }
}

function applyJsonEvent(record: SessionRecord, data: unknown): void {
  const item = asRecord(data);
  if (!item) return;
  setObservedModel(record, item.model);

  if (item.type === 'stream_event') {
    const event = asRecord(item.event);
    const message = asRecord(event?.message);
    setObservedModel(record, message?.model);
    const delta = asRecord(event?.delta);
    const contentBlock = asRecord(event?.content_block);
    const key = streamEventKey(event);
    if (delta?.type === 'text_delta' && typeof delta.text === 'string') {
      appendAssistantText(record, delta.text);
      return;
    }
    if (delta?.type === 'thinking_delta' && typeof delta.thinking === 'string') {
      appendThinking(record, delta.thinking);
      return;
    }
    if (delta?.type === 'input_json_delta' && typeof delta.partial_json === 'string') {
      updateToolActivityFromPartial(record, key, delta.partial_json);
      return;
    }
    if (contentBlock?.type === 'tool_use') {
      const name = typeof contentBlock.name === 'string' ? contentBlock.name : 'Tool call';
      if (isHiddenToolName(name)) return;
      const activity = pushActivity(
        record,
        'tool',
        formatToolTitle(name, contentBlock.input),
        toolInlineText(name, contentBlock.input),
        undefined,
        'running'
      );
      record.pendingToolInputs[key] = {
        activityId: activity.id,
        toolName: name,
        partialJson: ''
      };
      record.pendingToolInputs.current = record.pendingToolInputs[key];
      return;
    }
    return;
  }

  if (item.type === 'assistant') {
    const message = asRecord(item.message);
    if (message) addAssistantSnapshot(record, message);
    return;
  }

  if (item.type === 'user') {
    return;
  }

  if (item.type === 'system') {
    const subtype = typeof item.subtype === 'string' ? item.subtype : 'system';
    if (subtype === 'rate_limit_event') return;
    if (subtype === 'api_retry') {
      const text = typeof item.message === 'string' ? item.message : undefined;
      pushActivity(record, 'error', 'Claude API retry', text, item, 'error');
    }
    return;
  }

  if (item.type === 'result') {
    finishRunningActivities(record);
    record.pendingToolInputs = {};
    const assistant = getCurrentAssistant(record);
    if (!assistant.text && typeof item.result === 'string') appendAssistantText(record, item.result);
    record.isRunning = false;
    record.currentAssistantId = undefined;
    return;
  }

  if (item.type === 'rate_limit_event') return;

  pushActivity(record, 'raw', String(item.type ?? 'Claude event'), undefined, item);
}

function applyOutputEvent(record: SessionRecord, event: ClaudeOutputEvent): void {
  if (event.kind === 'json') {
    applyJsonEvent(record, event.data);
    return;
  }
  const text = event.text ?? event.line ?? '';
  pushActivity(
    record,
    event.source === 'stderr' || event.kind === 'parse_error' ? 'error' : 'raw',
    event.kind === 'parse_error' ? 'Unparsed Claude output' : event.source,
    text,
    event,
    event.source === 'stderr' ? 'error' : 'complete'
  );
}

export function useSessions() {
  const sessionsRef = useRef<Map<string, SessionRecord>>(new Map());
  const [archived, setArchived] = useState<SessionMeta[]>([]);
  const [, force] = useState(0);
  const rerender = useCallback(() => force((n) => n + 1), []);
  const saveTimersRef = useRef<Map<string, number>>(new Map());

  const refreshArchived = useCallback(async () => {
    const metas = await api.listSessions();
    setArchived(metas);
  }, []);

  const saveNow = useCallback((record: SessionRecord) => {
    if (record.messages.length === 0) return;
    void api.saveTranscript(transcriptFromRecord(record));
  }, []);

  const scheduleSave = useCallback(
    (record: SessionRecord) => {
      const existing = saveTimersRef.current.get(record.id);
      if (existing) window.clearTimeout(existing);
      const timer = window.setTimeout(() => {
        saveTimersRef.current.delete(record.id);
        saveNow(record);
      }, 250);
      saveTimersRef.current.set(record.id, timer);
    },
    [saveNow]
  );

  useEffect(() => {
    refreshArchived();

    const offData = api.onSessionData(({ id, event }) => {
      const session = sessionsRef.current.get(id);
      if (!session) return;
      applyOutputEvent(session, event);
      scheduleSave(session);
      rerender();
    });
    const offExit = api.onSessionExit(({ id, exitCode }) => {
      const s = sessionsRef.current.get(id);
      if (s) {
        finishRunningActivities(s);
        s.isRunning = false;
        if (exitCode !== 0) {
          pushActivity(s, 'error', 'Claude exited', `Exit code ${exitCode}`, { exitCode }, 'error');
        }
        s.currentAssistantId = undefined;
        if (s.messages.length > 0) saveNow(s);
      }
      refreshArchived();
      rerender();
    });
    const offPermission = api.onPermissionRequest((request) => {
      const session = sessionsRef.current.get(request.sessionId);
      if (!session) return;
      session.pendingPermission = request;
      pushActivity(
        session,
        'system',
        permissionTitle('Permission requested', request),
        undefined,
        undefined,
        'running',
        false
      );
      scheduleSave(session);
      rerender();
    });
    return () => {
      offData();
      offExit();
      offPermission();
      for (const timer of saveTimersRef.current.values()) window.clearTimeout(timer);
      saveTimersRef.current.clear();
    };
  }, [refreshArchived, rerender, saveNow, scheduleSave]);

  const spawn = useCallback(
    async (opts: CreateSessionOptions): Promise<SessionRecord> => {
      const { id } = await api.createSession(opts);
      const transcript = await api.loadTranscript(id);
      const messages = messagesFromTranscript(transcript);

      const record: SessionRecord = {
        id,
        messages,
        cwd: opts.cwd,
        model: transcript?.model ?? opts.model,
        observedModel: transcript?.observedModel,
        permissionMode: transcript?.permissionMode ?? opts.permissionMode,
        thinkingEffort: transcript?.thinkingEffort ?? opts.thinkingEffort ?? 'off',
        profileId: opts.profile.id,
        exited: false,
        isRunning: false,
        pendingToolInputs: {},
        createdAt: Date.now(),
        title: transcript?.title,
        titleManual: transcript?.titleManual
      };
      sessionsRef.current.set(id, record);
      if (record.messages.length > 0) saveNow(record);
      await refreshArchived();
      rerender();
      return record;
    },
    [refreshArchived, rerender, saveNow]
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

  const sendMessage = useCallback(
    async (id: string, text: string) => {
      const session = sessionsRef.current.get(id);
      if (!session || session.isRunning) return;
      session.messages.push({
        id: mintId(),
        role: 'user',
        text,
        createdAt: Date.now(),
        activities: [],
        parts: [{ id: mintId(), type: 'text', text }]
      });
      if (!session.titleManual && !session.title) {
        const derived = deriveTitleFromText(text);
        if (derived) session.title = derived;
      }
      session.currentAssistantId = undefined;
      session.pendingToolInputs = {};
      getCurrentAssistant(session);
      session.isRunning = true;
      scheduleSave(session);
      rerender();
      try {
        await api.sendMessage(id, text);
      } catch (e) {
        session.isRunning = false;
        pushActivity(
          session,
          'error',
          'Unable to start Claude',
          e instanceof Error ? e.message : String(e),
          e,
          'error'
        );
        saveNow(session);
        rerender();
      }
    },
    [rerender, saveNow, scheduleSave]
  );

  const updateModel = useCallback(
    async (id: string, model: string) => {
      const session = sessionsRef.current.get(id);
      if (!session || session.isRunning) return;
      session.model = model;
      session.observedModel = undefined;
      await api.updateSessionModel(id, model);
      saveNow(session);
      rerender();
    },
    [rerender]
  );

  const updatePermissionMode = useCallback(
    async (id: string, permissionMode: PermissionMode) => {
      const session = sessionsRef.current.get(id);
      if (!session || session.isRunning) return;
      session.permissionMode = permissionMode;
      await api.updateSessionPermissionMode(id, permissionMode);
      saveNow(session);
      rerender();
    },
    [rerender, saveNow]
  );

  const updateThinkingEffort = useCallback(
    async (id: string, thinkingEffort: ThinkingEffort) => {
      const session = sessionsRef.current.get(id);
      if (!session || session.isRunning) return;
      session.thinkingEffort = thinkingEffort;
      await api.updateSessionThinkingEffort(id, thinkingEffort);
      saveNow(session);
      rerender();
    },
    [rerender, saveNow]
  );

  const respondPermission = useCallback(
    async (id: string, allow: boolean, message?: string) => {
      const session = sessionsRef.current.get(id);
      const request = session?.pendingPermission;
      if (!session || !request) return;
      await api.respondPermission({ requestId: request.id, allow, message });
      session.pendingPermission = undefined;
      pushActivity(
        session,
        allow ? 'system' : 'error',
        permissionTitle(allow ? 'Approved' : 'Denied', request),
        message,
        undefined,
        allow ? 'complete' : 'error',
        false
      );
      saveNow(session);
      rerender();
    },
    [rerender, saveNow]
  );

  const kill = useCallback(
    (id: string) => {
      api.killSession(id);
      const s = sessionsRef.current.get(id);
      if (s) {
        s.exited = true;
        sessionsRef.current.delete(id);
      }
      rerender();
    },
    [rerender, saveNow]
  );

  const stopRun = useCallback(
    (id: string) => {
      api.stopRun(id);
      const s = sessionsRef.current.get(id);
      if (s) {
        s.isRunning = false;
        finishRunningActivities(s);
        pushActivity(s, 'error', 'Run stopped', 'The Claude process was stopped.', undefined, 'error');
        saveNow(s);
      }
      rerender();
    },
    [rerender, saveNow]
  );

  const removeArchived = useCallback(
    async (id: string) => {
      await api.removeSession(id);
      await refreshArchived();
    },
    [refreshArchived]
  );

  const renameSession = useCallback(
    async (id: string, rawTitle: string) => {
      const title = rawTitle.trim();
      const session = sessionsRef.current.get(id);
      if (session) {
        if (title) {
          session.title = title;
          session.titleManual = true;
        } else {
          session.title = session.messages.find((m) => m.role === 'user')
            ? deriveTitleFromText(session.messages.find((m) => m.role === 'user')!.text)
            : undefined;
          session.titleManual = false;
        }
        saveNow(session);
        rerender();
      } else {
        const transcript = await api.loadTranscript(id);
        if (!transcript) return;
        const next: SessionTranscript = {
          ...transcript,
          title: title || undefined,
          titleManual: title ? true : false,
          updatedAt: Date.now()
        };
        await api.saveTranscript(next);
      }
      await refreshArchived();
    },
    [refreshArchived, rerender, saveNow]
  );

  const get = useCallback((id: string) => sessionsRef.current.get(id), []);
  const live = useCallback(
    () => Array.from(sessionsRef.current.values()).sort((a, b) => b.createdAt - a.createdAt),
    []
  );

  return {
    launch,
    resume,
    sendMessage,
    updateModel,
    updatePermissionMode,
    updateThinkingEffort,
    respondPermission,
    stopRun,
    kill,
    get,
    live,
    archived,
    removeArchived,
    renameSession
  };
}
