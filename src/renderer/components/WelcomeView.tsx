import { useEffect, useMemo, useState } from 'react';
import { FolderOpen, Play, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { api } from '@/lib/api';
import type { AppConfig, LaunchRequest, PermissionMode } from '@shared/types';

interface WelcomeViewProps {
  config: AppConfig;
  onLaunch: (req: LaunchRequest) => void | Promise<void>;
  resumeError?: string | null;
}

export function WelcomeView({ config, onLaunch, resumeError }: WelcomeViewProps) {
  const [projectPath, setProjectPath] = useState(config.defaultProjectPath);
  const [profileId, setProfileId] = useState(config.defaultProfileId);
  const [model, setModel] = useState(config.defaultModel);
  const [permissionMode, setPermissionMode] = useState<PermissionMode>(config.defaultPermissionMode);
  const [error, setError] = useState<string | null>(null);

  const profile = useMemo(
    () => config.profiles.find((p) => p.id === profileId) ?? config.profiles[0],
    [config.profiles, profileId]
  );

  useEffect(() => {
    if (profile?.model && !model) setModel(profile.model);
  }, [profile, model]);

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
    try {
      await onLaunch({
        cwd: projectPath,
        profile,
        model,
        permissionMode,
        claudeBinary: config.claudeBinary || 'claude',
        cols: 100,
        rows: 30
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div className="flex h-full items-start justify-center overflow-auto p-8">
      <Card className="w-full max-w-xl">
        <CardHeader>
          <CardTitle>Start a new Claude Code session</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Project folder</Label>
            <div className="flex gap-2">
              <Input
                value={projectPath}
                onChange={(e) => setProjectPath(e.target.value)}
                placeholder="No project selected"
                readOnly
              />
              <Button variant="outline" onClick={pickFolder}>
                <FolderOpen className="h-4 w-4" /> Choose
              </Button>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Provider profile</Label>
            <Select value={profileId} onValueChange={setProfileId}>
              <SelectTrigger>
                <SelectValue placeholder="Select profile" />
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

          <div className="space-y-2">
            <Label>Model</Label>
            <Input
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder="e.g. qwen2.5-coder, claude-sonnet-4-5"
            />
          </div>

          <div className="space-y-2">
            <Label>Permission mode</Label>
            <Select
              value={permissionMode}
              onValueChange={(v) => setPermissionMode(v as PermissionMode)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="default">Default</SelectItem>
                <SelectItem value="plan">Plan</SelectItem>
                <SelectItem value="acceptEdits">Accept edits</SelectItem>
                <SelectItem value="bypass">Bypass permissions (dangerous)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {permissionMode === 'bypass' && (
            <div className="flex gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
              <AlertTriangle className="h-4 w-4 flex-shrink-0" />
              <span>
                Bypass mode skips all permission prompts. Claude can edit files and run shell commands
                without asking. Use only in trusted directories.
              </span>
            </div>
          )}

          {(error || resumeError) && (
            <div className="flex gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
              <AlertTriangle className="h-4 w-4 flex-shrink-0" />
              <span>{error ?? resumeError}</span>
            </div>
          )}

          <Button onClick={handleLaunch} size="lg" className="w-full">
            <Play className="h-4 w-4" /> Launch Session
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
