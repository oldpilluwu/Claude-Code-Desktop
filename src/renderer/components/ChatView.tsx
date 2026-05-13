import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Brain, Check, ChevronDown, CircleStop, Code2, Command, FileText, FolderGit2, Lightbulb, Loader2, Mic, MoreHorizontal, Play, Plus, Send, ShieldCheck, SquareTerminal, Wrench, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger } from '@/components/ui/select';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import type { AppConfig, FileMentionSuggestion, ModelOption, PermissionMode, ProviderProfile, SlashSuggestion, ThinkingEffort } from '@shared/types';
import type { ActivityKind, ChatActivity, ChatMessage, ChatPart, SessionRecord } from '@/hooks/useSessions';

interface ChatViewProps {
  session: SessionRecord;
  config: AppConfig;
  profile?: ProviderProfile;
  onSendMessage: (id: string, text: string) => void | Promise<void>;
  onUpdateModel: (id: string, model: string) => void | Promise<void>;
  onUpdatePermissionMode: (id: string, permissionMode: PermissionMode) => void | Promise<void>;
  onUpdateThinkingEffort: (id: string, thinkingEffort: ThinkingEffort) => void | Promise<void>;
  onRespondPermission: (id: string, allow: boolean, message?: string) => void | Promise<void>;
  onStopRun: (id: string) => void;
  onRename: (id: string, title: string) => void | Promise<void>;
  onClose: () => void;
}

function folderOf(cwd: string): string {
  return cwd.split(/[\\/]/).filter(Boolean).pop() ?? cwd;
}

const PERMISSION_BADGES: Record<PermissionMode, { label: string; cls: string }> = {
  default: { label: 'Default', cls: 'text-emerald-300/90 ring-emerald-500/40' },
  plan: { label: 'Plan mode', cls: 'text-sky-300/90 ring-sky-500/40' },
  acceptEdits: { label: 'Accept edits', cls: 'text-amber-300/90 ring-amber-500/40' },
  bypass: { label: 'Full access', cls: 'text-rose-300/90 ring-rose-500/40' }
};

const THINKING_LABELS: Record<ThinkingEffort, string> = {
  off: 'Think: off',
  low: 'Think: low',
  medium: 'Think: medium',
  high: 'Think: high',
  xhigh: 'Think: xhigh',
  max: 'Think: max'
};

function iconFor(kind: ActivityKind) {
  if (kind === 'thinking') return Brain;
  if (kind === 'tool') return Wrench;
  if (kind === 'error') return CircleStop;
  if (kind === 'raw') return Code2;
  return SquareTerminal;
}

type CompletionTrigger = {
  kind: 'file' | 'slash';
  start: number;
  end: number;
  query: string;
};

type CompletionItem = FileMentionSuggestion | SlashSuggestion;

function detectCompletion(text: string, cursor: number): CompletionTrigger | null {
  const beforeCursor = text.slice(0, cursor);
  const tokenStart = Math.max(
    beforeCursor.lastIndexOf(' '),
    beforeCursor.lastIndexOf('\n'),
    beforeCursor.lastIndexOf('\t')
  ) + 1;
  const token = beforeCursor.slice(tokenStart);
  if (!token) return null;
  if (token.startsWith('@')) {
    return { kind: 'file', start: tokenStart, end: cursor, query: token.slice(1) };
  }
  if (token.startsWith('/')) {
    return { kind: 'slash', start: tokenStart, end: cursor, query: token.slice(1) };
  }
  return null;
}

function ActivityRow({ activity }: { activity: ChatActivity }) {
  const [open, setOpen] = useState(false);
  const Icon = iconFor(activity.kind);
  const canExpand = activity.expandable !== false && Boolean(activity.raw);
  const hasBody = canExpand || Boolean(activity.text);
  const isBashTool = activity.kind === 'tool' && activity.title.toLowerCase() === 'bash';
  const body = useMemo(() => {
    if (activity.text) return activity.text;
    if (activity.raw === undefined) return '';
    try {
      return JSON.stringify(activity.raw, null, 2);
    } catch {
      return String(activity.raw);
    }
  }, [activity.raw, activity.text]);

  return (
    <div className="rounded-md border border-border bg-muted/25">
      <button
        type="button"
        onClick={() => hasBody && setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-muted-foreground"
      >
        <Icon className={cn('h-3.5 w-3.5', activity.kind === 'error' && 'text-destructive')} />
        <span className="min-w-0 flex-1 truncate">
          <span>{activity.title}</span>
          {activity.text && activity.kind !== 'tool' && <span className="ml-2 text-foreground/75">{activity.text}</span>}
        </span>
        {activity.status === 'running' && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
        {canExpand && (
          <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', open && 'rotate-180')} />
        )}
      </button>
      {isBashTool && activity.text && (
        <pre className="mx-3 mb-2 overflow-x-auto rounded bg-background/80 px-2 py-1.5 font-mono text-xs leading-5 text-foreground/85">
          {activity.text}
        </pre>
      )}
      {open && canExpand && (
        <pre className="max-h-72 overflow-auto whitespace-pre-wrap border-t border-border px-3 py-2 text-xs leading-relaxed text-foreground/85">
          {body}
        </pre>
      )}
    </div>
  );
}

function TracePart({ part }: { part: Extract<ChatPart, { type: 'trace' }> }) {
  const [traceOpen, setTraceOpen] = useState(false);
  return (
    <div>
      <button
        type="button"
        onClick={() => setTraceOpen((v) => !v)}
        className="flex items-center gap-2 rounded-md px-0 py-1 text-xs text-muted-foreground hover:text-foreground"
      >
        <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', traceOpen && 'rotate-180')} />
        Thinking and tool calls
        <span className="rounded bg-muted px-1.5 py-0.5 text-[10px]">{part.activities.length}</span>
      </button>
      {traceOpen && (
        <div className="mt-2 space-y-2 border-l border-border pl-3">
          {part.activities.map((activity) =>
            activity.kind === 'thinking' ? (
              <div key={activity.id} className="whitespace-pre-wrap rounded-md bg-muted/20 px-3 py-2 text-xs leading-5 text-muted-foreground">
                {activity.text}
              </div>
            ) : (
              <ActivityRow key={activity.id} activity={activity} />
            )
          )}
        </div>
      )}
    </div>
  );
}

function MarkdownPreview({ text }: { text: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        p: ({ children }) => <p className="mb-3 last:mb-0">{children}</p>,
        h1: ({ children }) => <h1 className="mb-3 mt-5 text-xl font-semibold first:mt-0">{children}</h1>,
        h2: ({ children }) => <h2 className="mb-3 mt-5 text-lg font-semibold first:mt-0">{children}</h2>,
        h3: ({ children }) => <h3 className="mb-2 mt-4 text-base font-semibold first:mt-0">{children}</h3>,
        ul: ({ children }) => <ul className="mb-3 list-disc space-y-1 pl-5 last:mb-0">{children}</ul>,
        ol: ({ children }) => <ol className="mb-3 list-decimal space-y-1 pl-5 last:mb-0">{children}</ol>,
        li: ({ children }) => <li className="pl-1">{children}</li>,
        blockquote: ({ children }) => (
          <blockquote className="mb-3 border-l-2 border-border pl-3 text-muted-foreground last:mb-0">
            {children}
          </blockquote>
        ),
        a: ({ children, href }) => (
          <a
            href={href}
            target="_blank"
            rel="noreferrer"
            className="text-primary underline underline-offset-2"
          >
            {children}
          </a>
        ),
        code: ({ children, className }) => {
          const isBlock = Boolean(className);
          return isBlock ? (
            <code className={cn('block overflow-x-auto whitespace-pre rounded-md bg-muted px-3 py-2 font-mono text-xs leading-5', className)}>
              {children}
            </code>
          ) : (
            <code className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]">{children}</code>
          );
        },
        pre: ({ children }) => <pre className="mb-3 overflow-x-auto last:mb-0">{children}</pre>,
        table: ({ children }) => (
          <div className="mb-3 overflow-x-auto last:mb-0">
            <table className="w-full border-collapse text-sm">{children}</table>
          </div>
        ),
        th: ({ children }) => <th className="border border-border bg-muted px-2 py-1 text-left font-medium">{children}</th>,
        td: ({ children }) => <td className="border border-border px-2 py-1 align-top">{children}</td>
      }}
    >
      {text}
    </ReactMarkdown>
  );
}

function AssistantParts({ message }: { message: ChatMessage }) {
  const parts = message.parts.length
    ? message.parts
    : message.activities.length
      ? [{ id: 'legacy-trace', type: 'trace' as const, activities: message.activities }]
      : message.text
        ? [{ id: 'legacy-text', type: 'text' as const, text: message.text }]
        : [];

  if (parts.length === 0) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Claude is working
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {parts.map((part) =>
        part.type === 'text' ? (
          <div key={part.id} className="text-sm leading-6">
            <MarkdownPreview text={part.text} />
          </div>
        ) : (
          <TracePart key={part.id} part={part} />
        )
      )}
    </div>
  );
}

function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === 'user';
  return (
    <article className={cn('flex w-full', isUser ? 'justify-end' : 'justify-start')}>
      <div
        className={cn(
          'max-w-[min(780px,92%)] px-4 py-3',
          isUser
            ? 'rounded-lg bg-primary text-primary-foreground'
            : 'text-card-foreground'
        )}
      >
        {isUser && message.text ? (
          <div className="whitespace-pre-wrap text-sm leading-6">{message.text}</div>
        ) : (
          !isUser && <AssistantParts message={message} />
        )}

        {isUser && message.activities.length > 0 && (
          <div className="mt-3 space-y-2">
            {message.activities.map((activity) => (
              <ActivityRow key={activity.id} activity={activity} />
            ))}
          </div>
        )}
      </div>
    </article>
  );
}

function PermissionPrompt({
  session,
  onRespondPermission
}: {
  session: SessionRecord;
  onRespondPermission: (id: string, allow: boolean, message?: string) => void | Promise<void>;
}) {
  const request = session.pendingPermission;
  if (!request) return null;
  const toolName = request.toolName;
  const input = request.input && typeof request.input === 'object' ? (request.input as Record<string, unknown>) : {};
  const command = typeof input.command === 'string' ? input.command : typeof input.cmd === 'string' ? input.cmd : '';
  const fileName =
    typeof input.file_path === 'string'
      ? input.file_path
      : typeof input.path === 'string'
        ? input.path
        : typeof input.notebook_path === 'string'
          ? input.notebook_path
          : '';
  const title =
    toolName.toLowerCase() === 'bash'
      ? 'Bash'
      : fileName
        ? `${toolName} - ${fileName}`
        : toolName;

  return (
    <div className="border-t border-border bg-card px-4 py-3">
      <div className="mx-auto flex max-w-4xl items-start gap-3 rounded-md border border-amber-500/40 bg-amber-500/10 p-3">
        <Wrench className="mt-0.5 h-4 w-4 text-amber-300" />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium">Claude wants to use {title}</div>
          {toolName.toLowerCase() === 'bash' && command && (
            <pre className="mt-2 overflow-x-auto rounded bg-background/80 px-2 py-1.5 font-mono text-xs leading-5 text-foreground/85">
              {command}
            </pre>
          )}
        </div>
        <div className="flex shrink-0 gap-2">
          <Button size="sm" variant="outline" onClick={() => onRespondPermission(session.id, false, 'Denied by user.')}>
            <X className="h-4 w-4" /> Deny
          </Button>
          <Button size="sm" onClick={() => onRespondPermission(session.id, true)}>
            <Check className="h-4 w-4" /> Allow
          </Button>
        </div>
      </div>
    </div>
  );
}

function ModelPicker({
  session,
  profile,
  onUpdateModel
}: {
  session: SessionRecord;
  profile?: ProviderProfile;
  onUpdateModel: (id: string, model: string) => void | Promise<void>;
}) {
  const [models, setModels] = useState<ModelOption[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!profile) return;
    let cancelled = false;
    setLoading(true);
    api
      .listModels(profile)
      .then((items) => {
        if (!cancelled) setModels(items);
      })
      .catch(() => {
        if (!cancelled)
          setModels(profile.model ? [{ id: profile.model, label: profile.model, source: 'profile' }] : []);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [profile]);

  const modelInList = models.some((model) => model.id === session.model);
  const displayLabel =
    session.observedModel ||
    models.find((m) => m.id === session.model)?.label ||
    session.model ||
    'default';

  return (
    <Select
      value={modelInList ? session.model : '__custom__'}
      disabled={session.isRunning || loading}
      onValueChange={(value) => {
        if (value === '__custom__') return;
        void onUpdateModel(session.id, value);
      }}
    >
      <SelectTrigger
        title={`Requested: ${session.model || 'default'}\nActual: ${
          session.observedModel || (session.isRunning ? 'waiting for stream' : 'not reported yet')
        }`}
        className="h-7 gap-1 rounded-full border-transparent bg-transparent px-2 text-xs text-foreground/85 hover:bg-accent/60 focus:ring-0 focus:ring-offset-0"
      >
        <span className="truncate">{loading ? 'Loading…' : displayLabel}</span>
      </SelectTrigger>
      <SelectContent>
        {models.map((model) => (
          <SelectItem key={model.id} value={model.id}>
            {model.label}
          </SelectItem>
        ))}
        <SelectItem value="__custom__">
          {!modelInList && session.model ? session.model : 'Custom model'}
        </SelectItem>
      </SelectContent>
    </Select>
  );
}

function PermissionModePicker({
  session,
  onUpdatePermissionMode
}: {
  session: SessionRecord;
  onUpdatePermissionMode: (id: string, permissionMode: PermissionMode) => void | Promise<void>;
}) {
  const badge = PERMISSION_BADGES[session.permissionMode];
  return (
    <Select
      value={session.permissionMode}
      disabled={session.isRunning}
      onValueChange={(value) => onUpdatePermissionMode(session.id, value as PermissionMode)}
    >
      <SelectTrigger
        className={cn(
          'h-7 gap-1.5 rounded-full border-0 bg-transparent px-2.5 text-xs ring-1 ring-inset focus:ring-2 focus:ring-offset-0',
          badge.cls
        )}
      >
        <ShieldCheck className="h-3.5 w-3.5" />
        <span className="truncate">{badge.label}</span>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="default">Default</SelectItem>
        <SelectItem value="plan">Plan</SelectItem>
        <SelectItem value="acceptEdits">Accept edits</SelectItem>
        <SelectItem value="bypass">Full access (bypass)</SelectItem>
      </SelectContent>
    </Select>
  );
}

function ThinkingEffortPicker({
  session,
  onUpdateThinkingEffort
}: {
  session: SessionRecord;
  onUpdateThinkingEffort: (id: string, thinkingEffort: ThinkingEffort) => void | Promise<void>;
}) {
  const value = session.thinkingEffort ?? 'off';
  const label = THINKING_LABELS[value];
  const active = value !== 'off';
  return (
    <Select
      value={value}
      disabled={session.isRunning}
      onValueChange={(v) => onUpdateThinkingEffort(session.id, v as ThinkingEffort)}
    >
      <SelectTrigger
        title="Extended thinking budget (MAX_THINKING_TOKENS)"
        className={cn(
          'h-7 gap-1.5 rounded-full border-0 bg-transparent px-2.5 text-xs ring-1 ring-inset focus:ring-2 focus:ring-offset-0',
          active
            ? 'text-violet-300/90 ring-violet-500/40'
            : 'text-muted-foreground ring-border/60'
        )}
      >
        <Lightbulb className="h-3.5 w-3.5" />
        <span className="truncate">{label}</span>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="off">Off</SelectItem>
        <SelectItem value="low">Low</SelectItem>
        <SelectItem value="medium">Medium</SelectItem>
        <SelectItem value="high">High</SelectItem>
        <SelectItem value="xhigh">XHigh</SelectItem>
        <SelectItem value="max">Max</SelectItem>
      </SelectContent>
    </Select>
  );
}

function CompletionMenu({
  trigger,
  items,
  selectedIndex,
  onSelect
}: {
  trigger: CompletionTrigger | null;
  items: CompletionItem[];
  selectedIndex: number;
  onSelect: (item: CompletionItem) => void;
}) {
  if (!trigger || items.length === 0) return null;

  return (
    <div className="absolute bottom-full left-0 z-20 mb-2 max-h-72 w-full overflow-y-auto rounded-md border border-border bg-popover p-1 shadow-lg">
      {items.map((item, index) => {
        const isFile = item.type === 'file';
        const Icon = isFile ? FileText : item.type === 'skill' ? Brain : Command;
        const detail = isFile ? item.detail : item.detail;
        return (
          <button
            key={`${item.type}-${item.insertText}-${index}`}
            type="button"
            onMouseDown={(e) => {
              e.preventDefault();
              onSelect(item);
            }}
            className={cn(
              'flex w-full items-start gap-2 rounded px-2 py-2 text-left text-sm',
              selectedIndex === index ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/70'
            )}
          >
            <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium">{isFile ? item.label : item.label}</span>
              {detail && <span className="block truncate text-xs text-muted-foreground">{detail}</span>}
            </span>
            {!isFile && (
              <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase text-muted-foreground">
                {item.type === 'skill' ? 'skill' : item.source}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

export function ChatView({
  session,
  config,
  profile,
  onSendMessage,
  onUpdateModel,
  onUpdatePermissionMode,
  onUpdateThinkingEffort,
  onRespondPermission,
  onStopRun,
  onRename,
  onClose
}: ChatViewProps) {
  const [draft, setDraft] = useState('');
  const [completion, setCompletion] = useState<CompletionTrigger | null>(null);
  const [fileSuggestions, setFileSuggestions] = useState<FileMentionSuggestion[]>([]);
  const [slashSuggestions, setSlashSuggestions] = useState<SlashSuggestion[]>([]);
  const [selectedCompletion, setSelectedCompletion] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [renameDraft, setRenameDraft] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);

  const completionItems: CompletionItem[] =
    completion?.kind === 'file' ? fileSuggestions : completion?.kind === 'slash' ? slashSuggestions : [];

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [session.messages, session.isRunning]);

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [draft]);

  useEffect(() => {
    inputRef.current?.focus();
    setMenuOpen(false);
    setRenaming(false);
  }, [session.id]);

  useEffect(() => {
    if (!menuOpen) return;
    function onPointerDown(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [menuOpen]);

  useEffect(() => {
    if (renaming) {
      renameInputRef.current?.focus();
      renameInputRef.current?.select();
    }
  }, [renaming]);

  const headerTitle = session.title?.trim() || folderOf(session.cwd);

  function beginRename() {
    setRenameDraft(session.title ?? '');
    setRenaming(true);
    setMenuOpen(false);
  }

  async function commitRename() {
    const next = renameDraft.trim();
    setRenaming(false);
    if (next === (session.title ?? '').trim()) return;
    await onRename(session.id, next);
  }

  useEffect(() => {
    let cancelled = false;
    if (!completion) {
      setFileSuggestions([]);
      setSlashSuggestions([]);
      setSelectedCompletion(0);
      return;
    }

    setSelectedCompletion(0);
    if (completion.kind === 'file') {
      api.listFileMentions(session.cwd, completion.query).then((items) => {
        if (!cancelled) setFileSuggestions(items);
      }).catch(() => {
        if (!cancelled) setFileSuggestions([]);
      });
      return () => {
        cancelled = true;
      };
    }

    api.listSlashSuggestions(session.cwd, completion.query).then((items) => {
      if (!cancelled) setSlashSuggestions(items);
    }).catch(() => {
      if (!cancelled) setSlashSuggestions([]);
    });
    return () => {
      cancelled = true;
    };
  }, [completion?.kind, completion?.query, session.cwd]);

  function refreshCompletion(value: string, cursor: number | null) {
    setCompletion(cursor === null ? null : detectCompletion(value, cursor));
  }

  function applyCompletion(item: CompletionItem) {
    if (!completion) return;
    const next = `${draft.slice(0, completion.start)}${item.insertText}${draft.slice(completion.end)}`;
    const cursor = completion.start + item.insertText.length;
    setDraft(next);
    setCompletion(null);
    window.requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.setSelectionRange(cursor, cursor);
    });
  }

  async function submit(e?: FormEvent) {
    e?.preventDefault();
    const text = draft.trim();
    if (!text || session.isRunning) return;
    setDraft('');
    await onSendMessage(session.id, text);
  }

  const folder = folderOf(session.cwd);
  const resolvedProfile = profile ?? config.profiles.find((p) => p.id === session.profileId);

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <header className="flex items-center justify-between gap-3 border-b border-border/60 px-5 py-3">
        <div className="relative flex min-w-0 items-center gap-2" ref={menuRef}>
          {renaming ? (
            <input
              ref={renameInputRef}
              value={renameDraft}
              onChange={(e) => setRenameDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void commitRename();
                } else if (e.key === 'Escape') {
                  e.preventDefault();
                  setRenaming(false);
                }
              }}
              onBlur={() => void commitRename()}
              placeholder="Conversation title"
              className="min-w-[12rem] max-w-[28rem] flex-1 rounded-md border border-border/60 bg-background/40 px-2 py-1 text-sm font-medium outline-none focus:border-border"
            />
          ) : (
            <h1 className="truncate text-sm font-medium text-foreground/95" title={session.cwd}>
              {headerTitle}
            </h1>
          )}
          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            title="Conversation options"
            className={cn(
              'rounded p-1 text-muted-foreground hover:bg-accent/60 hover:text-foreground',
              menuOpen && 'bg-accent/60 text-foreground'
            )}
          >
            <MoreHorizontal className="h-4 w-4" />
          </button>
          {menuOpen && (
            <div className="absolute left-0 top-full z-30 mt-1 w-48 overflow-hidden rounded-md border border-border bg-popover shadow-lg">
              <button
                type="button"
                onClick={beginRename}
                className="block w-full px-3 py-2 text-left text-sm hover:bg-accent/70"
              >
                Rename conversation
              </button>
              {session.titleManual && (
                <button
                  type="button"
                  onClick={async () => {
                    setMenuOpen(false);
                    await onRename(session.id, '');
                  }}
                  className="block w-full px-3 py-2 text-left text-sm text-muted-foreground hover:bg-accent/70 hover:text-foreground"
                >
                  Reset to auto title
                </button>
              )}
            </div>
          )}
        </div>
        <div className="flex items-center gap-1">
          {session.isRunning && (
            <button
              type="button"
              onClick={() => onStopRun(session.id)}
              title="Stop run"
              className="rounded-md p-1.5 text-muted-foreground hover:bg-accent/60 hover:text-foreground"
            >
              <CircleStop className="h-4 w-4" />
            </button>
          )}
          {!session.isRunning && (
            <button
              type="button"
              onClick={() => inputRef.current?.focus()}
              title="Focus input"
              className="rounded-md p-1.5 text-muted-foreground hover:bg-accent/60 hover:text-foreground"
            >
              <Play className="h-4 w-4" />
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            title="End session"
            className="rounded-md p-1.5 text-muted-foreground hover:bg-accent/60 hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </header>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-5 py-6">
        {session.messages.length === 0 ? (
          <div className="mx-auto flex h-full max-w-2xl flex-col justify-center text-center">
            <SquareTerminal className="mx-auto mb-4 h-9 w-9 text-primary" />
            <h2 className="text-xl font-semibold">Start chatting with Claude Code</h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              Messages run through the Claude Code CLI in the background. Tool calls, thinking,
              streaming text, and raw events appear here as the run unfolds.
            </p>
          </div>
        ) : (
          <div className="mx-auto flex max-w-4xl flex-col gap-4">
            {session.messages.map((message) => (
              <MessageBubble key={message.id} message={message} />
            ))}
          </div>
        )}
      </div>

      <PermissionPrompt session={session} onRespondPermission={onRespondPermission} />

      <form onSubmit={submit} className="px-5 pb-3 pt-2">
        <div className="mx-auto max-w-4xl">
          <div className="relative rounded-2xl border border-border/60 bg-card/70 shadow-sm focus-within:border-border">
            <CompletionMenu
              trigger={completion}
              items={completionItems}
              selectedIndex={selectedCompletion}
              onSelect={applyCompletion}
            />
            <textarea
              ref={inputRef}
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value);
                refreshCompletion(e.target.value, e.target.selectionStart);
              }}
              onClick={(e) => refreshCompletion(e.currentTarget.value, e.currentTarget.selectionStart)}
              onKeyUp={(e) => {
                if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) {
                  refreshCompletion(e.currentTarget.value, e.currentTarget.selectionStart);
                }
              }}
              onKeyDown={(e) => {
                if (completion && completionItems.length > 0) {
                  if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    setSelectedCompletion((index) => (index + 1) % completionItems.length);
                    return;
                  }
                  if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    setSelectedCompletion(
                      (index) => (index - 1 + completionItems.length) % completionItems.length
                    );
                    return;
                  }
                  if ((e.key === 'Enter' && !e.shiftKey) || e.key === 'Tab') {
                    e.preventDefault();
                    applyCompletion(completionItems[Math.min(selectedCompletion, completionItems.length - 1)]);
                    return;
                  }
                }
                if (e.key === 'Escape' && completion) {
                  e.preventDefault();
                  setCompletion(null);
                  return;
                }
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void submit();
                }
              }}
              placeholder="Ask for follow-up changes"
              rows={1}
              disabled={session.isRunning}
              style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
              className="block min-h-12 w-full resize-none overflow-hidden rounded-2xl bg-transparent px-4 pb-12 pt-3 text-sm leading-6 outline-none placeholder:text-muted-foreground/70 disabled:cursor-not-allowed disabled:opacity-60 [&::-webkit-scrollbar]:hidden"
            />

            <div className="pointer-events-none absolute inset-x-2 bottom-1.5 flex items-center justify-between gap-2">
              <div className="pointer-events-auto flex items-center gap-1">
                <button
                  type="button"
                  title="Add context"
                  className="flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground hover:bg-accent/60 hover:text-foreground"
                >
                  <Plus className="h-4 w-4" />
                </button>
                <PermissionModePicker
                  session={session}
                  onUpdatePermissionMode={onUpdatePermissionMode}
                />
                <ThinkingEffortPicker
                  session={session}
                  onUpdateThinkingEffort={onUpdateThinkingEffort}
                />
              </div>
              <div className="pointer-events-auto flex items-center gap-1">
                <ModelPicker
                  session={session}
                  profile={resolvedProfile}
                  onUpdateModel={onUpdateModel}
                />
                <button
                  type="submit"
                  disabled={!draft.trim() || session.isRunning}
                  className="flex h-8 w-12 items-center justify-center rounded-full bg-primary text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-40"
                  title="Send"
                >
                  {session.isRunning ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Send className="h-4 w-4" />
                  )}
                </button>
              </div>
            </div>
          </div>

          <div className="mt-2 flex items-center justify-between px-1 text-[11px] text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
              Work locally
            </span>
            <span
              className="inline-flex max-w-[60%] items-center gap-1.5 truncate"
              title={session.cwd}
            >
              <FolderGit2 className="h-3.5 w-3.5" />
              <span className="truncate">{folder}</span>
            </span>
          </div>
        </div>
      </form>
    </div>
  );
}
