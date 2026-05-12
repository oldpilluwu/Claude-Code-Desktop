import { useMemo, useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  Folder,
  Pencil,
  Plug,
  RotateCcw,
  Search,
  Settings,
  Trash2,
  Workflow
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { SessionRecord } from '@/hooks/useSessions';
import type { SessionMeta } from '@shared/types';

export type SidebarItem =
  | { kind: 'live'; record: SessionRecord }
  | { kind: 'archived'; meta: SessionMeta };

interface SidebarProps {
  items: SidebarItem[];
  activeSessionId: string | null;
  onSelect: (id: string) => void;
  onResume: (meta: SessionMeta) => void;
  onRemoveArchived: (id: string) => void;
  onNew: () => void;
  onOpenSettings: () => void;
}

interface NormalizedEntry {
  id: string;
  cwd: string;
  title: string;
  model: string;
  lastActiveAt: number;
  status: 'busy' | 'ready' | 'ended' | 'archived';
  item: SidebarItem;
}

interface ProjectGroup {
  key: string;
  name: string;
  cwd: string;
  entries: NormalizedEntry[];
  lastActiveAt: number;
}

function folderName(cwd: string): string {
  return cwd.split(/[\\/]/).filter(Boolean).pop() ?? cwd;
}

function fallbackTitle(cwd: string, model: string): string {
  return `${folderName(cwd)} · ${model || 'default'}`;
}

function relativeTime(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return 'now';
  const m = Math.floor(diff / 60_000);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d`;
  const mo = Math.floor(d / 30);
  if (mo < 12) return `${mo}mo`;
  return `${Math.floor(mo / 12)}y`;
}

function normalize(item: SidebarItem): NormalizedEntry {
  if (item.kind === 'live') {
    const r = item.record;
    const model = r.observedModel || r.model;
    return {
      id: r.id,
      cwd: r.cwd,
      title: r.title?.trim() || fallbackTitle(r.cwd, model),
      model,
      lastActiveAt: r.createdAt,
      status: r.exited ? 'ended' : r.isRunning ? 'busy' : 'ready',
      item
    };
  }
  const m = item.meta;
  return {
    id: m.id,
    cwd: m.cwd,
    title: m.title?.trim() || fallbackTitle(m.cwd, m.model),
    model: m.model,
    lastActiveAt: m.lastActiveAt ?? m.createdAt,
    status: 'archived',
    item
  };
}

function StatusDot({ status }: { status: NormalizedEntry['status'] }) {
  const cls =
    status === 'busy'
      ? 'bg-amber-400'
      : status === 'ready'
        ? 'bg-emerald-400'
        : status === 'ended'
          ? 'bg-destructive'
          : 'bg-muted-foreground/40';
  return <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', cls)} />;
}

export function Sidebar({
  items,
  activeSessionId,
  onSelect,
  onResume,
  onRemoveArchived,
  onNew,
  onOpenSettings
}: SidebarProps) {
  const [query, setQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const groups = useMemo<ProjectGroup[]>(() => {
    const map = new Map<string, ProjectGroup>();
    for (const item of items) {
      const entry = normalize(item);
      const key = entry.cwd;
      let group = map.get(key);
      if (!group) {
        group = {
          key,
          name: folderName(entry.cwd),
          cwd: entry.cwd,
          entries: [],
          lastActiveAt: 0
        };
        map.set(key, group);
      }
      group.entries.push(entry);
      if (entry.lastActiveAt > group.lastActiveAt) group.lastActiveAt = entry.lastActiveAt;
    }
    const list = Array.from(map.values());
    for (const g of list) g.entries.sort((a, b) => b.lastActiveAt - a.lastActiveAt);
    list.sort((a, b) => b.lastActiveAt - a.lastActiveAt);
    return list;
  }, [items]);

  const filteredGroups = useMemo<ProjectGroup[]>(() => {
    const q = query.trim().toLowerCase();
    if (!q) return groups;
    return groups
      .map((g) => {
        const matchesGroup = g.name.toLowerCase().includes(q) || g.cwd.toLowerCase().includes(q);
        const entries = matchesGroup
          ? g.entries
          : g.entries.filter(
              (e) => e.title.toLowerCase().includes(q) || e.model.toLowerCase().includes(q)
            );
        return entries.length ? { ...g, entries } : null;
      })
      .filter((g): g is ProjectGroup => Boolean(g));
  }, [groups, query]);

  const activeGroupKey = useMemo(() => {
    if (!activeSessionId) return null;
    return groups.find((g) => g.entries.some((e) => e.id === activeSessionId))?.key ?? null;
  }, [groups, activeSessionId]);

  function defaultExpanded(key: string): boolean {
    return key === activeGroupKey || filteredGroups.length <= 4;
  }

  function isExpanded(key: string): boolean {
    if (query.trim()) return true;
    if (key in collapsed) return !collapsed[key];
    return defaultExpanded(key);
  }

  function toggle(key: string) {
    setCollapsed((prev) => {
      const current = key in prev ? !prev[key] : defaultExpanded(key);
      return { ...prev, [key]: current };
    });
  }

  return (
    <aside className="flex w-64 flex-shrink-0 flex-col border-r border-border/60 bg-sidebar">
      <div className="px-3 pt-3">
        <button
          onClick={onNew}
          className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-sm text-foreground/90 transition-colors hover:bg-accent/60"
        >
          <Pencil className="h-4 w-4" />
          <span className="font-medium">New chat</span>
        </button>

        <div className="mt-1">
          <button
            onClick={() => setSearchOpen((v) => !v)}
            className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-sm text-foreground/80 transition-colors hover:bg-accent/60"
          >
            <Search className="h-4 w-4" />
            <span>Search</span>
          </button>
          {searchOpen && (
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter sessions..."
              className="mx-1 mt-1 block w-[calc(100%-0.5rem)] rounded-md border border-border/60 bg-background/40 px-2 py-1.5 text-xs outline-none focus:border-border"
            />
          )}
        </div>
      </div>

      <div className="mt-3 flex-1 overflow-y-auto px-2 pb-3">
        <div className="px-2 pb-1 pt-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground/70">
          Projects
        </div>

        {filteredGroups.length === 0 && (
          <div className="px-2 py-4 text-xs text-muted-foreground">
            {query ? 'No matches' : 'No projects yet'}
          </div>
        )}

        <ul className="space-y-0.5">
          {filteredGroups.map((group) => {
            const expanded = isExpanded(group.key);
            const isActive = group.key === activeGroupKey;
            return (
              <li key={group.key}>
                <button
                  onClick={() => toggle(group.key)}
                  title={group.cwd}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent/60',
                    isActive && 'text-foreground'
                  )}
                >
                  {expanded ? (
                    <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                  ) : (
                    <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                  )}
                  <Folder className="h-4 w-4 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate">{group.name}</span>
                </button>

                {expanded && (
                  <ul className="mt-0.5 space-y-0.5">
                    {group.entries.map((entry) =>
                      entry.item.kind === 'live' ? (
                        <li key={entry.id}>
                          <button
                            onClick={() => onSelect(entry.id)}
                            className={cn(
                              'group flex w-full items-center gap-2 rounded-md py-1.5 pl-8 pr-2 text-left text-xs transition-colors hover:bg-accent/60',
                              activeSessionId === entry.id && 'bg-accent text-accent-foreground'
                            )}
                          >
                            <StatusDot status={entry.status} />
                            <span className="min-w-0 flex-1 truncate">{entry.title}</span>
                            <span className="shrink-0 text-[10px] text-muted-foreground">
                              {relativeTime(entry.lastActiveAt)}
                            </span>
                          </button>
                        </li>
                      ) : (
                        <li key={entry.id} className="group">
                          <div className="flex w-full items-center gap-2 rounded-md py-1.5 pl-8 pr-1 text-xs transition-colors hover:bg-accent/60">
                            <StatusDot status={entry.status} />
                            <span
                              className="min-w-0 flex-1 truncate text-muted-foreground"
                              title={entry.cwd}
                            >
                              {entry.title}
                            </span>
                            <span className="shrink-0 text-[10px] text-muted-foreground">
                              {relativeTime(entry.lastActiveAt)}
                            </span>
                            <button
                              onClick={() => onResume((entry.item as Extract<SidebarItem, { kind: 'archived' }>).meta)}
                              title="Resume session"
                              className="rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-background hover:text-foreground group-hover:opacity-100"
                            >
                              <RotateCcw className="h-3 w-3" />
                            </button>
                            <button
                              onClick={() => onRemoveArchived(entry.id)}
                              title="Remove from history"
                              className="rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-background hover:text-destructive group-hover:opacity-100"
                            >
                              <Trash2 className="h-3 w-3" />
                            </button>
                          </div>
                        </li>
                      )
                    )}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      </div>

      <div className="border-t border-border/60 px-2 py-2">
        <button
          onClick={onOpenSettings}
          className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-sm text-foreground/80 transition-colors hover:bg-accent/60"
        >
          <Settings className="h-4 w-4" />
          <span>Settings</span>
        </button>
      </div>
    </aside>
  );
}
