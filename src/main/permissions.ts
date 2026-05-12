import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import type { PermissionDecision, PermissionRequest } from '../shared/types';

const SERVER_SOURCE = String.raw`
const fs = require('node:fs');
const path = require('node:path');

const dir = process.argv[2];
fs.mkdirSync(path.join(dir, 'pending'), { recursive: true });
fs.mkdirSync(path.join(dir, 'decisions'), { recursive: true });

function writeMessage(message) {
  process.stdout.write(JSON.stringify(message) + '\n');
}

async function waitForDecision(id) {
  const file = path.join(dir, 'decisions', id + '.json');
  const started = Date.now();
  while (Date.now() - started < 10 * 60 * 1000) {
    if (fs.existsSync(file)) {
      return JSON.parse(fs.readFileSync(file, 'utf8'));
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return { allow: false, message: 'Permission request timed out.' };
}

async function handleToolCall(params) {
  const args = params.arguments || {};
  const id = Date.now() + '-' + Math.random().toString(16).slice(2);
  const request = {
    id,
    sessionId: path.basename(dir),
    toolName: args.tool_name || args.toolName || 'Unknown tool',
    input: args.input || {},
    createdAt: Date.now()
  };
  fs.writeFileSync(path.join(dir, 'pending', id + '.json'), JSON.stringify(request, null, 2));
  const decision = await waitForDecision(id);
  const payload = decision.allow
    ? { behavior: 'allow', updatedInput: request.input }
    : { behavior: 'deny', message: decision.message || 'Denied by user.' };
  return { content: [{ type: 'text', text: JSON.stringify(payload) }] };
}

process.stdin.setEncoding('utf8');
let buffer = '';
process.stdin.on('data', async (chunk) => {
  buffer += chunk;
  const lines = buffer.split(/\r?\n/);
  buffer = lines.pop() || '';
  for (const line of lines) {
    if (!line.trim()) continue;
    const message = JSON.parse(line);
    if (message.method === 'initialize') {
      writeMessage({
        jsonrpc: '2.0',
        id: message.id,
        result: {
          protocolVersion: message.params?.protocolVersion || '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: { name: 'srclaude-permissions', version: '0.1.0' }
        }
      });
    } else if (message.method === 'tools/list') {
      writeMessage({
        jsonrpc: '2.0',
        id: message.id,
        result: {
          tools: [{
            name: 'approval_prompt',
            description: 'Ask the SRClaude desktop user to approve or deny a Claude Code tool call.',
            inputSchema: {
              type: 'object',
              properties: {
                tool_name: { type: 'string' },
                input: { type: 'object', additionalProperties: true }
              },
              required: ['tool_name', 'input'],
              additionalProperties: true
            }
          }]
        }
      });
    } else if (message.method === 'tools/call') {
      try {
        writeMessage({ jsonrpc: '2.0', id: message.id, result: await handleToolCall(message.params || {}) });
      } catch (error) {
        writeMessage({
          jsonrpc: '2.0',
          id: message.id,
          error: { code: -32603, message: error instanceof Error ? error.message : String(error) }
        });
      }
    } else if (message.id !== undefined) {
      writeMessage({ jsonrpc: '2.0', id: message.id, result: {} });
    }
  }
});
`;

function permissionRoot(): string {
  return path.join(app.getPath('userData'), 'permission-requests');
}

export function permissionDir(sessionId: string): string {
  return path.join(permissionRoot(), sessionId);
}

export function ensurePermissionBridge(sessionId: string): { configPath: string; dir: string } {
  const dir = permissionDir(sessionId);
  fs.mkdirSync(path.join(dir, 'pending'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'decisions'), { recursive: true });

  const scriptPath = path.join(permissionRoot(), 'permission-mcp-server.cjs');
  fs.mkdirSync(path.dirname(scriptPath), { recursive: true });
  fs.writeFileSync(scriptPath, SERVER_SOURCE);

  const configPath = path.join(dir, 'mcp-config.json');
  const config = {
    mcpServers: {
      srclaude_permissions: {
        command: 'node',
        args: [scriptPath, dir]
      }
    }
  };
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  return { configPath, dir };
}

export function watchPermissionRequests(
  sessionId: string,
  onRequest: (request: PermissionRequest) => void
): () => void {
  const pendingDir = path.join(permissionDir(sessionId), 'pending');
  fs.mkdirSync(pendingDir, { recursive: true });
  const seen = new Set<string>();
  const readPending = () => {
    for (const file of fs.readdirSync(pendingDir)) {
      if (!file.endsWith('.json') || seen.has(file)) continue;
      const fullPath = path.join(pendingDir, file);
      try {
        const request = JSON.parse(fs.readFileSync(fullPath, 'utf8')) as PermissionRequest;
        seen.add(file);
        onRequest(request);
      } catch {
        // File may still be mid-write; the next watch event will retry.
      }
    }
  };
  readPending();
  const watcher = fs.watch(pendingDir, readPending);
  return () => watcher.close();
}

export function respondToPermission(decision: PermissionDecision): boolean {
  if (!fs.existsSync(permissionRoot())) return false;
  for (const sessionDir of fs.readdirSync(permissionRoot(), { withFileTypes: true })) {
    if (!sessionDir.isDirectory()) continue;
    const target = path.join(permissionRoot(), sessionDir.name, 'decisions', `${decision.requestId}.json`);
    const pending = path.join(permissionRoot(), sessionDir.name, 'pending', `${decision.requestId}.json`);
    if (!fs.existsSync(pending)) continue;
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, JSON.stringify(decision, null, 2));
    return true;
  }
  return false;
}
