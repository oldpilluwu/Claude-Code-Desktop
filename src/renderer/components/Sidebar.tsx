import { Plus, Settings, Sparkles, RotateCcw, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
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

function folderName(cwd: string): string {
  return cwd.split(/[\\/]/).filter(Boolean).pop() ?? cwd;
}

function liveLabel(s: SessionRecord): string {
  return `${folderName(s.cwd)} - ${s.model || 'default'}`;
}

function archivedLabel(m: SessionMeta): string {
  return `${folderName(m.cwd)} - ${m.model || 'default'}`;
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
  return (
    <aside className="flex w-64 flex-shrink-0 flex-col border-r border-border bg-card">
      <div className="border-b border-border p-4">
        <div className="mb-3 flex items-center gap-2 text-primary">
          <Sparkles className="h-4 w-4" />
          <h1 className="text-sm font-semibold">Claude Code</h1>
        </div>
        <Button onClick={onNew} className="w-full" size="sm">
          <Plus className="h-4 w-4" /> New Session
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        <div className="px-2 pb-2 pt-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Sessions
        </div>
        {items.length === 0 && (
          <div className="px-2 py-4 text-xs text-muted-foreground">No sessions yet</div>
        )}
        <ul className="space-y-1">
          {items.map((item) =>
            item.kind === 'live' ? (
              <li key={item.record.id}>
                <button
                  onClick={() => onSelect(item.record.id)}
                  className={cn(
                    'flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors hover:bg-accent',
                    activeSessionId === item.record.id && 'bg-accent text-accent-foreground'
                  )}
                >
                  <span className="truncate">{liveLabel(item.record)}</span>
                  <span
                    className={cn(
                      'shrink-0 rounded px-1.5 py-0.5 text-[9px] font-medium uppercase',
                      item.record.exited
                        ? 'bg-destructive/20 text-destructive'
                        : item.record.isRunning
                          ? 'bg-amber-500/20 text-amber-300'
                          : 'bg-emerald-500/20 text-emerald-400'
                    )}
                  >
                    {item.record.exited ? 'ended' : item.record.isRunning ? 'busy' : 'ready'}
                  </span>
                </button>
              </li>
            ) : (
              <li key={item.meta.id} className="group">
                <div className="flex w-full items-center gap-1 rounded-md px-2 py-1.5 text-xs transition-colors hover:bg-accent">
                  <span className="flex-1 truncate text-muted-foreground" title={item.meta.cwd}>
                    {archivedLabel(item.meta)}
                  </span>
                  <button
                    onClick={() => onResume(item.meta)}
                    title="Resume session"
                    className="rounded p-1 text-muted-foreground hover:bg-background hover:text-foreground"
                  >
                    <RotateCcw className="h-3 w-3" />
                  </button>
                  <button
                    onClick={() => onRemoveArchived(item.meta.id)}
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
      </div>

      <div className="border-t border-border p-3">
        <Button variant="ghost" size="sm" className="w-full justify-start" onClick={onOpenSettings}>
          <Settings className="h-4 w-4" /> Settings
        </Button>
      </div>
    </aside>
  );
}
