import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Cpu,
  FolderOpen,
  Lightbulb,
  Play,
  ShieldCheck,
  SquareTerminal,
  Workflow
} from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger } from '@/components/ui/select';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import type { AppConfig, LaunchRequest, PermissionMode, ThinkingEffort } from '@shared/types';

interface WelcomeViewProps {
  config: AppConfig;
  onLaunch: (req: LaunchRequest) => void | Promise<void>;
  resumeError?: string | null;
}

const PERMISSION_OPTIONS: {
  value: PermissionMode;
  label: string;
  ringCls: string;
  help: string;
}[] = [
  {
    value: 'default',
    label: 'Default',
    ringCls: 'text-emerald-300/90 ring-emerald-500/40',
    help: 'Claude asks before editing files or running shell commands.'
  },
  {
    value: 'plan',
    label: 'Plan mode',
    ringCls: 'text-sky-300/90 ring-sky-500/40',
    help: 'Plan-only — read but never write or execute.'
  },
  {
    value: 'acceptEdits',
    label: 'Accept edits',
    ringCls: 'text-amber-300/90 ring-amber-500/40',
    help: 'File edits run without prompting. Shell still asks.'
  },
  {
    value: 'bypass',
    label: 'Full access',
    ringCls: 'text-rose-300/90 ring-rose-500/40',
    help: 'Skip every permission prompt. Use only in trusted folders.'
  }
];

const THINKING_OPTIONS: { value: ThinkingEffort; label: string; help: string }[] = [
  { value: 'off', label: 'Off', help: 'Extended thinking disabled.' },
  { value: 'low', label: 'Low', help: 'Small thinking budget — quickest replies.' },
  { value: 'medium', label: 'Medium', help: 'Moderate thinking budget.' },
  { value: 'high', label: 'High', help: 'Larger budget for tricky problems.' },
  { value: 'xhigh', label: 'XHigh', help: 'Very large thinking budget.' },
  { value: 'max', label: 'Max', help: 'Maximum budget the model allows.' }
];

type LastUsed = {
  projectPath?: string;
  profileId?: string;
  model?: string;
  permissionMode?: PermissionMode;
  thinkingEffort?: ThinkingEffort;
};

const LAST_USED_KEY = 'welcome:last-used';

function readLastUsed(): LastUsed {
  try {
    const raw = window.localStorage.getItem(LAST_USED_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as LastUsed) : {};
  } catch {
    return {};
  }
}

function writeLastUsed(value: LastUsed): void {
  try {
    window.localStorage.setItem(LAST_USED_KEY, JSON.stringify(value));
  } catch {
    /* ignore */
  }
}

function folderShort(p: string): string {
  if (!p) return '';
  const parts = p.split(/[\\/]/).filter(Boolean);
  if (parts.length <= 2) return p;
  return `…/${parts.slice(-2).join('/')}`;
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="block text-[10px] font-medium uppercase tracking-wide text-muted-foreground/70">
      {children}
    </span>
  );
}

export function WelcomeView({ config, onLaunch, resumeError }: WelcomeViewProps) {
  const initial = useMemo(readLastUsed, []);
  const [projectPath, setProjectPath] = useState(initial.projectPath || config.defaultProjectPath);
  const [profileId, setProfileId] = useState(initial.profileId || config.defaultProfileId);
  const [model, setModel] = useState(initial.model ?? config.defaultModel);
  const [permissionMode, setPermissionMode] = useState<PermissionMode>(
    initial.permissionMode ?? config.defaultPermissionMode
  );
  const [thinkingEffort, setThinkingEffort] = useState<ThinkingEffort>(
    initial.thinkingEffort ?? config.defaultThinkingEffort ?? 'off'
  );
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const profile = useMemo(
    () => config.profiles.find((p) => p.id === profileId) ?? config.profiles[0],
    [config.profiles, profileId]
  );

  useEffect(() => {
    if (profile?.model && !model) setModel(profile.model);
  }, [profile, model]);

  useEffect(() => {
    writeLastUsed({ projectPath, profileId, model, permissionMode, thinkingEffort });
  }, [projectPath, profileId, model, permissionMode, thinkingEffort]);

  async function pickFolder() {
    const dir = await api.pickDirectory();
    if (dir) setProjectPath(dir);
  }

  async function handleLaunch() {
    setError(null);
    if (!projectPath) {
      setError('Please choose a project folder.');
      return;
    }
    if (!profile) return;
    setSubmitting(true);
    try {
      await onLaunch({
        cwd: projectPath,
        profile,
        model,
        permissionMode,
        thinkingEffort,
        claudeBinary: config.claudeBinary || 'claude',
        cols: 100,
        rows: 30
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  }

  const permission = PERMISSION_OPTIONS.find((o) => o.value === permissionMode) ?? PERMISSION_OPTIONS[0];
  const thinking = THINKING_OPTIONS.find((o) => o.value === thinkingEffort) ?? THINKING_OPTIONS[0];
  const thinkingActive = thinkingEffort !== 'off';
  const modelDisplay = model.trim() || profile?.model || 'profile default';
  const message = error ?? resumeError ?? null;

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="flex min-h-0 flex-1 flex-col items-center justify-end overflow-y-auto px-6 pt-12">
        <div className="mx-auto flex max-w-2xl flex-1 flex-col items-center justify-center text-center">
          <SquareTerminal className="mb-4 h-10 w-10 text-primary" />
          <h1 className="text-xl font-semibold">Start a new Claude Code session</h1>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            Pick a working directory, choose the provider profile and model, then decide how much
            freedom and thinking budget Claude gets before you launch.
          </p>
        </div>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void handleLaunch();
        }}
        className="px-5 pb-5 pt-2"
      >
        <div className="mx-auto max-w-4xl space-y-2">
          {permissionMode === 'bypass' && (
            <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
              <span>
                Bypass mode skips all permission prompts. Claude can edit files and run shell
                commands without asking. Use only in trusted directories.
              </span>
            </div>
          )}

          {message && (
            <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
              <span>{message}</span>
            </div>
          )}

          <div className="rounded-2xl border border-border/60 bg-card/70 px-3 py-3 shadow-sm">
            <div className="px-1">
              <FieldLabel>Working directory</FieldLabel>
              <button
                type="button"
                onClick={pickFolder}
                className="mt-1 flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm text-foreground/90 transition-colors hover:bg-accent/60"
              >
                <FolderOpen className="h-4 w-4 text-muted-foreground" />
                {projectPath ? (
                  <span className="min-w-0 flex-1 truncate" title={projectPath}>
                    {folderShort(projectPath)}
                  </span>
                ) : (
                  <span className="flex-1 truncate text-muted-foreground/80">
                    Choose a project folder…
                  </span>
                )}
                <span className="shrink-0 rounded-full bg-muted/60 px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                  {projectPath ? 'Change' : 'Browse'}
                </span>
              </button>
            </div>

            <div className="mt-3 grid grid-cols-1 gap-3 border-t border-border/40 pt-3 sm:grid-cols-2">
              <div className="space-y-1">
                <FieldLabel>Provider profile</FieldLabel>
                <Select value={profileId} onValueChange={setProfileId}>
                  <SelectTrigger
                    className="h-8 gap-1.5 rounded-full border-0 bg-transparent px-3 text-xs text-foreground/85 ring-1 ring-inset ring-border/60 focus:ring-2 focus:ring-offset-0 hover:bg-accent/60"
                  >
                    <Workflow className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="truncate">{profile?.name ?? 'Pick profile'}</span>
                  </SelectTrigger>
                  <SelectContent>
                    {config.profiles.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1">
                <FieldLabel>Model</FieldLabel>
                <div className="flex h-8 items-center gap-1.5 rounded-full bg-transparent px-3 ring-1 ring-inset ring-border/60 focus-within:ring-2">
                  <Cpu className="h-3.5 w-3.5 text-muted-foreground" />
                  <input
                    value={model}
                    onChange={(e) => setModel(e.target.value)}
                    placeholder="claude-sonnet-4-5 — leave blank for profile default"
                    className="h-full flex-1 bg-transparent text-xs text-foreground/90 outline-none placeholder:text-muted-foreground/60"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <FieldLabel>Permissions</FieldLabel>
                <Select
                  value={permissionMode}
                  onValueChange={(v) => setPermissionMode(v as PermissionMode)}
                >
                  <SelectTrigger
                    title={permission.help}
                    className={cn(
                      'h-8 gap-1.5 rounded-full border-0 bg-transparent px-3 text-xs ring-1 ring-inset focus:ring-2 focus:ring-offset-0',
                      permission.ringCls
                    )}
                  >
                    <ShieldCheck className="h-3.5 w-3.5" />
                    <span className="truncate">{permission.label}</span>
                  </SelectTrigger>
                  <SelectContent>
                    {PERMISSION_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        <div className="flex flex-col">
                          <span>{opt.label}</span>
                          <span className="text-[11px] text-muted-foreground">{opt.help}</span>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1">
                <FieldLabel>Thinking effort</FieldLabel>
                <Select
                  value={thinkingEffort}
                  onValueChange={(v) => setThinkingEffort(v as ThinkingEffort)}
                >
                  <SelectTrigger
                    title={thinking.help}
                    className={cn(
                      'h-8 gap-1.5 rounded-full border-0 bg-transparent px-3 text-xs ring-1 ring-inset focus:ring-2 focus:ring-offset-0',
                      thinkingActive
                        ? 'text-violet-300/90 ring-violet-500/40'
                        : 'text-muted-foreground ring-border/60'
                    )}
                  >
                    <Lightbulb className="h-3.5 w-3.5" />
                    <span className="truncate">{thinking.label}</span>
                  </SelectTrigger>
                  <SelectContent>
                    {THINKING_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        <div className="flex flex-col">
                          <span>{opt.label}</span>
                          <span className="text-[11px] text-muted-foreground">{opt.help}</span>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="mt-3 flex items-center justify-between gap-3 border-t border-border/40 pt-3">
              <p className="min-w-0 flex-1 truncate text-[11px] leading-5 text-muted-foreground">
                {profile?.name ?? 'No profile'} · {modelDisplay} · {permission.label.toLowerCase()} ·
                thinking {thinking.label.toLowerCase()}
              </p>
              <button
                type="submit"
                disabled={!projectPath || submitting}
                className="flex h-9 shrink-0 items-center gap-1.5 rounded-full bg-primary px-5 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-40"
                title="Launch session"
              >
                <Play className="h-3.5 w-3.5" />
                <span>{submitting ? 'Launching…' : 'Launch session'}</span>
              </button>
            </div>
          </div>

          <p className="px-1 text-[11px] text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
              These selections are remembered for next time — change them per session whenever you
              like.
            </span>
          </p>
        </div>
      </form>
    </div>
  );
}
