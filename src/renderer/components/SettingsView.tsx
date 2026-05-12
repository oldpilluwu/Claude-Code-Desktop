import { useState } from 'react';
import { Trash2, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { AppConfig, PermissionMode, ProviderProfile } from '@shared/types';

interface SettingsViewProps {
  config: AppConfig;
  onSave: (config: AppConfig) => void | Promise<void>;
  onCancel: () => void;
}

export function SettingsView({ config, onSave, onCancel }: SettingsViewProps) {
  const [draft, setDraft] = useState<AppConfig>(() => structuredClone(config));

  function update<K extends keyof AppConfig>(key: K, value: AppConfig[K]) {
    setDraft((prev) => ({ ...prev, [key]: value }));
  }

  function updateProfile(idx: number, patch: Partial<ProviderProfile>) {
    setDraft((prev) => {
      const profiles = prev.profiles.map((p, i) => (i === idx ? { ...p, ...patch } : p));
      return { ...prev, profiles };
    });
  }

  function addProfile() {
    setDraft((prev) => ({
      ...prev,
      profiles: [
        ...prev.profiles,
        {
          id: `profile-${Date.now()}`,
          name: 'New profile',
          baseUrl: '',
          authToken: '',
          apiKey: '',
          model: '',
          extraEnv: {}
        }
      ]
    }));
  }

  function removeProfile(idx: number) {
    setDraft((prev) => ({ ...prev, profiles: prev.profiles.filter((_, i) => i !== idx) }));
  }

  return (
    <div className="flex h-full items-start justify-center overflow-auto p-8">
      <Card className="w-full max-w-2xl">
        <CardHeader>
          <CardTitle>Settings</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Claude binary path</Label>
            <Input
              value={draft.claudeBinary}
              onChange={(e) => update('claudeBinary', e.target.value)}
              placeholder="claude"
            />
          </div>

          <div className="space-y-2">
            <Label>Default project path</Label>
            <Input
              value={draft.defaultProjectPath}
              onChange={(e) => update('defaultProjectPath', e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label>Default model</Label>
            <Input
              value={draft.defaultModel}
              onChange={(e) => update('defaultModel', e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label>Default permission mode</Label>
            <Select
              value={draft.defaultPermissionMode}
              onValueChange={(v) => update('defaultPermissionMode', v as PermissionMode)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="default">Default</SelectItem>
                <SelectItem value="plan">Plan</SelectItem>
                <SelectItem value="acceptEdits">Accept edits</SelectItem>
                <SelectItem value="bypass">Bypass permissions</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="pt-2">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-sm font-semibold">Provider Profiles</h3>
              <Button variant="outline" size="sm" onClick={addProfile}>
                <Plus className="h-4 w-4" /> Add
              </Button>
            </div>
            <div className="space-y-3">
              {draft.profiles.map((profile, idx) => (
                <div
                  key={profile.id}
                  className="space-y-2 rounded-md border border-border bg-background p-3"
                >
                  <div className="flex gap-2">
                    <Input
                      value={profile.name}
                      onChange={(e) => updateProfile(idx, { name: e.target.value })}
                      placeholder="Profile name"
                    />
                    <Button variant="ghost" size="icon" onClick={() => removeProfile(idx)}>
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                  <Input
                    value={profile.baseUrl}
                    onChange={(e) => updateProfile(idx, { baseUrl: e.target.value })}
                    placeholder="ANTHROPIC_BASE_URL"
                  />
                  <div className="flex gap-2">
                    <Input
                      value={profile.authToken}
                      onChange={(e) => updateProfile(idx, { authToken: e.target.value })}
                      placeholder="ANTHROPIC_AUTH_TOKEN"
                    />
                    <Input
                      value={profile.apiKey}
                      onChange={(e) => updateProfile(idx, { apiKey: e.target.value })}
                      placeholder="ANTHROPIC_API_KEY"
                    />
                  </div>
                  <Input
                    value={profile.model}
                    onChange={(e) => updateProfile(idx, { model: e.target.value })}
                    placeholder="Default model (optional)"
                  />
                </div>
              ))}
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={onCancel}>
              Cancel
            </Button>
            <Button onClick={() => onSave(draft)}>Save</Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
