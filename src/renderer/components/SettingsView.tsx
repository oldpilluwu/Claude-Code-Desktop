import { useState } from 'react';
import { FolderOpen, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { api } from '@/lib/api';
import type { AppConfig, PermissionMode, ProviderProfile, ThinkingEffort } from '@shared/types';

interface SettingsViewProps {
  config: AppConfig;
  onSave: (config: AppConfig) => void | Promise<void>;
  onCancel: () => void;
}

const PERMISSION_MODE_OPTIONS: { value: PermissionMode; label: string; help: string }[] = [
  {
    value: 'default',
    label: 'Default',
    help: 'Claude asks before every file edit or shell command.'
  },
  {
    value: 'plan',
    label: 'Plan mode',
    help: 'Claude proposes a plan and reads, but never writes or runs commands.'
  },
  {
    value: 'acceptEdits',
    label: 'Auto-accept edits',
    help: 'File edits run without prompting. Shell commands still ask.'
  },
  {
    value: 'bypass',
    label: 'Full access (bypass)',
    help: 'Skip all permission prompts. Only use in trusted directories.'
  }
];

const THINKING_OPTIONS: { value: ThinkingEffort; label: string; help: string }[] = [
  { value: 'off', label: 'Off', help: 'Extended thinking disabled.' },
  { value: 'low', label: 'Low', help: 'Small thinking budget — faster responses.' },
  { value: 'medium', label: 'Medium', help: 'Moderate thinking budget.' },
  { value: 'high', label: 'High', help: 'Larger thinking budget for complex tasks.' },
  { value: 'xhigh', label: 'XHigh', help: 'Very large thinking budget.' },
  { value: 'max', label: 'Max', help: 'Maximum thinking budget the model allows.' }
];

function Section({
  title,
  description,
  children
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="border-b border-border/40 pb-6 last:border-b-0 last:pb-0">
      <header className="mb-4">
        <h2 className="text-base font-semibold text-foreground">{title}</h2>
        {description && (
          <p className="mt-1 text-xs leading-5 text-muted-foreground">{description}</p>
        )}
      </header>
      <div className="space-y-5">{children}</div>
    </section>
  );
}

function Field({
  label,
  help,
  children,
  htmlFor
}: {
  label: string;
  help?: string;
  children: React.ReactNode;
  htmlFor?: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={htmlFor} className="text-sm font-medium text-foreground">
        {label}
      </Label>
      {help && <p className="text-xs leading-5 text-muted-foreground">{help}</p>}
      <div className="pt-1">{children}</div>
    </div>
  );
}

export function SettingsView({ config, onSave, onCancel }: SettingsViewProps) {
  const [draft, setDraft] = useState<AppConfig>(() => structuredClone(config));
  const [saving, setSaving] = useState(false);

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

  async function pickDefaultFolder() {
    const dir = await api.pickDirectory();
    if (dir) update('defaultProjectPath', dir);
  }

  async function handleSave() {
    setSaving(true);
    try {
      await onSave(draft);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <header className="flex items-center justify-between border-b border-border/60 px-8 py-5">
        <div>
          <h1 className="text-lg font-semibold">Settings</h1>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Configure the Claude Code CLI binary, the defaults for new sessions, and provider profiles.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : 'Save changes'}
          </Button>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-2xl space-y-8 px-8 py-8">
          <Section
            title="Claude Code CLI"
            description="The desktop app shells out to the Claude Code CLI. Point this at the binary on your machine."
          >
            <Field
              label="Claude binary"
              help={
                'Path or command name. "claude" works if it is on your PATH; otherwise use an absolute path like C:\\Users\\you\\AppData\\Roaming\\npm\\claude.cmd.'
              }
            >
              <Input
                value={draft.claudeBinary}
                onChange={(e) => update('claudeBinary', e.target.value)}
                placeholder="claude"
              />
            </Field>
          </Section>

          <Section
            title="Session defaults"
            description="These values pre-fill the new-session screen. You can still override any of them per session."
          >
            <Field
              label="Default project folder"
              help="Used as the working directory for new sessions until you pick a different one."
            >
              <div className="flex gap-2">
                <Input
                  value={draft.defaultProjectPath}
                  onChange={(e) => update('defaultProjectPath', e.target.value)}
                  placeholder="No default folder"
                />
                <Button variant="outline" onClick={pickDefaultFolder}>
                  <FolderOpen className="h-4 w-4" /> Browse
                </Button>
              </div>
            </Field>

            <Field
              label="Default profile"
              help="The provider profile that gets selected first on the new-session screen."
            >
              <Select
                value={draft.defaultProfileId}
                onValueChange={(v) => update('defaultProfileId', v)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Pick a profile" />
                </SelectTrigger>
                <SelectContent>
                  {draft.profiles.map((profile) => (
                    <SelectItem key={profile.id} value={profile.id}>
                      {profile.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <Field
              label="Default model"
              help="Model ID passed via --model. Leave empty to use the model on the selected profile."
            >
              <Input
                value={draft.defaultModel}
                onChange={(e) => update('defaultModel', e.target.value)}
                placeholder="e.g. claude-sonnet-4-5"
              />
            </Field>

            <Field
              label="Default permission mode"
              help={
                PERMISSION_MODE_OPTIONS.find((o) => o.value === draft.defaultPermissionMode)?.help ??
                'Controls how aggressively Claude can edit files and run shell commands.'
              }
            >
              <Select
                value={draft.defaultPermissionMode}
                onValueChange={(v) => update('defaultPermissionMode', v as PermissionMode)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PERMISSION_MODE_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <Field
              label="Default thinking effort"
              help={
                THINKING_OPTIONS.find((o) => o.value === (draft.defaultThinkingEffort ?? 'off'))
                  ?.help ??
                'Sets MAX_THINKING_TOKENS for the Claude Code process. Only thinking-capable models use this.'
              }
            >
              <Select
                value={draft.defaultThinkingEffort ?? 'off'}
                onValueChange={(v) => update('defaultThinkingEffort', v as ThinkingEffort)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {THINKING_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </Section>

          <Section
            title="Provider profiles"
            description="Each profile maps to a set of environment variables the CLI runs with. Use them to switch between Anthropic, a self-hosted gateway, or a local model server."
          >
            <div className="space-y-4">
              {draft.profiles.map((profile, idx) => (
                <div
                  key={profile.id}
                  className="space-y-4 rounded-lg border border-border/60 bg-card/40 p-4"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1">
                      <Field
                        label="Display name"
                        help="Shown in the profile dropdown and the new-session screen."
                      >
                        <Input
                          value={profile.name}
                          onChange={(e) => updateProfile(idx, { name: e.target.value })}
                          placeholder="e.g. Anthropic, Ollama, internal gateway"
                        />
                      </Field>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => removeProfile(idx)}
                      title="Remove this profile"
                      className="mt-7"
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>

                  <Field
                    label="Base URL"
                    help="Sets ANTHROPIC_BASE_URL. Leave blank to use Anthropic's default endpoint."
                  >
                    <Input
                      value={profile.baseUrl}
                      onChange={(e) => updateProfile(idx, { baseUrl: e.target.value })}
                      placeholder="https://api.anthropic.com"
                    />
                  </Field>

                  <Field
                    label="Auth token"
                    help="Sets ANTHROPIC_AUTH_TOKEN. Used by gateways that take a bearer token (e.g. Ollama uses any non-empty value)."
                  >
                    <Input
                      type="password"
                      value={profile.authToken}
                      onChange={(e) => updateProfile(idx, { authToken: e.target.value })}
                      placeholder="bearer token (optional)"
                    />
                  </Field>

                  <Field
                    label="API key"
                    help="Sets ANTHROPIC_API_KEY. Use this for direct Anthropic API access."
                  >
                    <Input
                      type="password"
                      value={profile.apiKey}
                      onChange={(e) => updateProfile(idx, { apiKey: e.target.value })}
                      placeholder="sk-ant-…"
                    />
                  </Field>

                  <Field
                    label="Default model for this profile"
                    help="Falls back to this when the new-session screen has no model set. Optional."
                  >
                    <Input
                      value={profile.model}
                      onChange={(e) => updateProfile(idx, { model: e.target.value })}
                      placeholder="e.g. claude-sonnet-4-5, qwen2.5-coder"
                    />
                  </Field>
                </div>
              ))}

              <Button variant="outline" onClick={addProfile} className="w-full">
                <Plus className="h-4 w-4" /> Add another profile
              </Button>
            </div>
          </Section>
        </div>
      </div>
    </div>
  );
}
