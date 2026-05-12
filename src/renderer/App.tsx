import { useMemo, useState } from 'react';
import { Sidebar, type SidebarItem } from '@/components/Sidebar';
import { WelcomeView } from '@/components/WelcomeView';
import { TerminalView } from '@/components/TerminalView';
import { SettingsView } from '@/components/SettingsView';
import { useConfig } from '@/hooks/useConfig';
import { useSessions } from '@/hooks/useSessions';
import type { AppConfig, LaunchRequest, SessionMeta } from '@shared/types';

type View = 'welcome' | 'terminal' | 'settings';

export function App() {
  const { config, save, loading } = useConfig();
  const sessions = useSessions();
  const [view, setView] = useState<View>('welcome');
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [resumeError, setResumeError] = useState<string | null>(null);

  const liveList = sessions.live();
  const sidebarItems = useMemo<SidebarItem[]>(() => {
    const liveIds = new Set(liveList.map((r) => r.id));
    const liveItems: SidebarItem[] = liveList.map((record) => ({ kind: 'live', record }));
    const archivedItems: SidebarItem[] = sessions.archived
      .filter((m) => !liveIds.has(m.id))
      .map((meta) => ({ kind: 'archived', meta }));
    return [...liveItems, ...archivedItems];
  }, [liveList, sessions.archived]);

  if (loading || !config) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Loading…
      </div>
    );
  }

  async function handleLaunch(req: LaunchRequest) {
    const session = await sessions.launch(req);
    setActiveSessionId(session.id);
    setView('terminal');
  }

  async function handleResume(meta: SessionMeta) {
    setResumeError(null);
    if (!config) return;
    const profile = config.profiles.find((p) => p.id === meta.profileId) ?? meta.providerProfile;
    if (!profile) {
      setResumeError('No provider profile available to resume this session.');
      setView('welcome');
      return;
    }
    try {
      const session = await sessions.resume(meta.id, {
        cwd: meta.cwd,
        profile,
        model: meta.model,
        permissionMode: meta.permissionMode,
        claudeBinary: meta.claudeBinary || config.claudeBinary || 'claude',
        cols: 100,
        rows: 30
      });
      setActiveSessionId(session.id);
      setView('terminal');
    } catch (e) {
      setResumeError(e instanceof Error ? e.message : String(e));
      setView('welcome');
    }
  }

  function handleSelectSession(id: string) {
    setActiveSessionId(id);
    setView('terminal');
  }

  function handleNewSession() {
    setActiveSessionId(null);
    setView('welcome');
  }

  function handleCloseSession() {
    if (activeSessionId) sessions.kill(activeSessionId);
    setActiveSessionId(null);
    setView('welcome');
  }

  async function handleSaveSettings(next: AppConfig) {
    await save(next);
    setView('welcome');
  }

  const activeSession = activeSessionId ? sessions.get(activeSessionId) : null;

  return (
    <div className="flex h-full">
      <Sidebar
        items={sidebarItems}
        activeSessionId={activeSessionId}
        onSelect={handleSelectSession}
        onResume={handleResume}
        onRemoveArchived={(id) => sessions.removeArchived(id)}
        onNew={handleNewSession}
        onOpenSettings={() => setView('settings')}
      />
      <main className="flex min-w-0 flex-1 flex-col">
        {view === 'welcome' && (
          <WelcomeView config={config} onLaunch={handleLaunch} resumeError={resumeError} />
        )}
        {view === 'terminal' && activeSession && (
          <TerminalView session={activeSession} onClose={handleCloseSession} />
        )}
        {view === 'terminal' && !activeSession && (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            Session ended
          </div>
        )}
        {view === 'settings' && (
          <SettingsView
            config={config}
            onSave={handleSaveSettings}
            onCancel={() => setView('welcome')}
          />
        )}
      </main>
    </div>
  );
}
