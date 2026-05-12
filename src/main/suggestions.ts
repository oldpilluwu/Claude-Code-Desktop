import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { FileMentionSuggestion, SlashSuggestion } from '../shared/types';

const IGNORED_DIRS = new Set([
  '.git',
  '.hg',
  '.svn',
  'node_modules',
  'dist',
  'build',
  'coverage',
  '.next',
  '.turbo',
  '.cache'
]);

const BUILT_IN_COMMANDS: Array<Omit<SlashSuggestion, 'source'>> = [
  { type: 'command', label: '/help', detail: 'Show Claude Code help', insertText: '/help ' },
  { type: 'command', label: '/clear', detail: 'Clear conversation context', insertText: '/clear ' },
  { type: 'command', label: '/compact', detail: 'Compact conversation context', insertText: '/compact ' },
  { type: 'command', label: '/cost', detail: 'Show current session cost', insertText: '/cost ' },
  { type: 'command', label: '/doctor', detail: 'Check Claude Code health', insertText: '/doctor ' },
  { type: 'command', label: '/init', detail: 'Create or update project memory', insertText: '/init ' },
  { type: 'command', label: '/login', detail: 'Sign in to Claude Code', insertText: '/login ' },
  { type: 'command', label: '/logout', detail: 'Sign out of Claude Code', insertText: '/logout ' },
  { type: 'command', label: '/memory', detail: 'Edit memory files', insertText: '/memory ' },
  { type: 'command', label: '/model', detail: 'Switch active model', insertText: '/model ' },
  { type: 'command', label: '/permissions', detail: 'Manage tool permissions', insertText: '/permissions ' },
  { type: 'command', label: '/resume', detail: 'Resume a conversation', insertText: '/resume ' },
  { type: 'command', label: '/review', detail: 'Review code changes', insertText: '/review ' },
  { type: 'command', label: '/status', detail: 'Show account and session status', insertText: '/status ' }
];

function normalizeQuery(query: string): string {
  return query.trim().replace(/^[@/]/, '').toLowerCase();
}

function normalizeRelativePath(root: string, file: string): string {
  return path.relative(root, file).split(path.sep).join('/');
}

function safeReadFile(file: string): string {
  try {
    return fs.readFileSync(file, 'utf-8');
  } catch {
    return '';
  }
}

function firstDescription(markdown: string): string | undefined {
  const frontmatter = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (frontmatter) {
    const description = frontmatter[1].match(/^description:\s*(.+)$/m)?.[1]?.trim();
    if (description) return description.replace(/^['"]|['"]$/g, '');
  }

  const line = markdown
    .split(/\r?\n/)
    .map((item) => item.trim())
    .find((item) => item && !item.startsWith('---') && !item.startsWith('#'));
  return line;
}

function frontmatterField(markdown: string, key: string): string | undefined {
  const frontmatter = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!frontmatter) return undefined;
  const value = frontmatter[1].match(new RegExp(`^${key}:\\s*(.+)$`, 'm'))?.[1]?.trim();
  return value?.replace(/^['"]|['"]$/g, '');
}

function walkFiles(root: string, onFile: (file: string) => void, maxFiles = 1500): void {
  if (!fs.existsSync(root)) return;
  const stack = [root];
  let seen = 0;

  while (stack.length && seen < maxFiles) {
    const dir = stack.pop();
    if (!dir) continue;

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!IGNORED_DIRS.has(entry.name)) stack.push(full);
        continue;
      }
      if (!entry.isFile()) continue;
      seen += 1;
      onFile(full);
      if (seen >= maxFiles) break;
    }
  }
}

export function listFileMentions(cwd: string, query: string): FileMentionSuggestion[] {
  const root = path.resolve(cwd || process.cwd());
  const q = normalizeQuery(query);
  const items: FileMentionSuggestion[] = [];

  walkFiles(root, (file) => {
    const rel = normalizeRelativePath(root, file);
    const base = path.basename(rel);
    const haystack = `${base}\n${rel}`.toLowerCase();
    if (q && !haystack.includes(q)) return;
    items.push({
      type: 'file',
      label: base,
      detail: rel,
      path: file,
      insertText: `@${rel} `
    });
  });

  return items
    .sort((a, b) => {
      const aBase = a.label.toLowerCase();
      const bBase = b.label.toLowerCase();
      const aStarts = q && aBase.startsWith(q) ? 0 : 1;
      const bStarts = q && bBase.startsWith(q) ? 0 : 1;
      return aStarts - bStarts || a.detail.length - b.detail.length || a.detail.localeCompare(b.detail);
    })
    .slice(0, 40);
}

function commandNameFromFile(root: string, file: string, commandRootOnly: boolean): string | null {
  let base = root;
  if (commandRootOnly) {
    const parts = file.split(path.sep);
    const commandIndex = parts.lastIndexOf('commands');
    if (commandIndex < 0) return null;
    base = parts.slice(0, commandIndex + 1).join(path.sep);
  }
  return normalizeRelativePath(base, file).replace(/\.md$/i, '');
}

function collectCommandFiles(
  root: string,
  source: SlashSuggestion['source'],
  items: SlashSuggestion[],
  commandRootOnly = false
): void {
  if (!fs.existsSync(root)) return;
  walkFiles(
    root,
    (file) => {
      if (!file.toLowerCase().endsWith('.md')) return;
      const name = commandNameFromFile(root, file, commandRootOnly);
      if (!name) return;
      const text = safeReadFile(file);
      items.push({
        type: 'command',
        label: `/${name}`,
        detail: firstDescription(text),
        insertText: `/${name} `,
        source
      });
    },
    300
  );
}

function collectSkillFiles(root: string, source: SlashSuggestion['source'], items: SlashSuggestion[]): void {
  if (!fs.existsSync(root)) return;
  walkFiles(
    root,
    (file) => {
      if (path.basename(file).toLowerCase() !== 'skill.md') return;
      const text = safeReadFile(file);
      const argumentHint = frontmatterField(text, 'argument-hint');
      const allowedTools = frontmatterField(text, 'allowed-tools');
      if (!argumentHint && !allowedTools) return;
      const name = frontmatterField(text, 'name') ?? path.basename(path.dirname(file));
      if (!name) return;
      items.push({
        type: 'skill',
        label: `/${name}`,
        detail: [firstDescription(text), argumentHint].filter(Boolean).join(' '),
        insertText: `/${name} `,
        source
      });
    },
    600
  );
}

export function listSlashSuggestions(cwd: string, query: string): SlashSuggestion[] {
  const root = path.resolve(cwd || process.cwd());
  const q = normalizeQuery(query);
  const items: SlashSuggestion[] = BUILT_IN_COMMANDS.map((item) => ({ ...item, source: 'built-in' }));
  const homeClaude = path.join(os.homedir(), '.claude');

  collectCommandFiles(path.join(root, '.claude', 'commands'), 'project', items);
  collectSkillFiles(path.join(root, '.claude', 'skills'), 'project', items);
  collectCommandFiles(path.join(homeClaude, 'commands'), 'user', items);
  collectSkillFiles(path.join(homeClaude, 'skills'), 'user', items);
  collectCommandFiles(path.join(homeClaude, 'plugins'), 'plugin', items, true);
  collectSkillFiles(path.join(homeClaude, 'plugins'), 'plugin', items);

  const deduped = new Map<string, SlashSuggestion>();
  for (const item of items) {
    const key = `${item.type}:${item.label}`;
    if (!deduped.has(key)) deduped.set(key, item);
  }

  return Array.from(deduped.values())
    .filter((item) => {
      const haystack = `${item.label}\n${item.detail ?? ''}\n${item.source}`.toLowerCase();
      return !q || haystack.includes(q);
    })
    .sort((a, b) => {
      const aName = a.label.toLowerCase();
      const bName = b.label.toLowerCase();
      const aStarts = q && aName.startsWith(`/${q}`) ? 0 : 1;
      const bStarts = q && bName.startsWith(`/${q}`) ? 0 : 1;
      return aStarts - bStarts || aName.localeCompare(bName);
    })
    .slice(0, 40);
}
