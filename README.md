# Claude Code Desktop

Claude Code Desktop is an Electron desktop wrapper for the Claude Code CLI. It is designed for people who want the normal Claude Code terminal workflow in a desktop app while using local or custom Anthropic-compatible model providers such as Ollama, LiteLLM, vLLM, or a remote compatible endpoint.

The app does not reimplement Claude Code. It launches the `claude` CLI in a pseudo-terminal, applies the selected project, model, provider profile, and permission mode, then lets Claude Code handle the actual coding session.

## What This App Is For

- Run Claude Code from a desktop UI.
- Use local models through Anthropic-compatible endpoints.
- Save provider profiles for Ollama, LiteLLM, vLLM, or custom servers.
- Pick a local project folder before starting a Claude Code session.
- Keep Claude Code's existing tool use, permission prompts, terminal UI, and session behavior.

## Requirements

- Node.js 20 or newer.
- npm.
- Claude Code CLI installed and available as `claude`, or configured in the app settings.
- A local or remote model provider if you are not using the default Claude Code provider.

For local model use, you also need a provider that exposes an Anthropic-compatible API. Common options are Ollama through a compatibility proxy, LiteLLM, vLLM, or a custom gateway.

## Local Model Example

An Ollama-style provider profile may look like this:

```text
ANTHROPIC_BASE_URL=http://localhost:11434
ANTHROPIC_AUTH_TOKEN=ollama
ANTHROPIC_API_KEY=
```

Then choose a model in the app, for example:

```text
qwen3.5
qwen2.5-coder
llama3.1
```

The app launches Claude Code with the selected model:

```bash
claude --model qwen3.5
```

## Development Setup

Install dependencies:

```bash
npm install
```

Run the app in development mode:

```bash
npm run dev
```

Run type checks:

```bash
npm run typecheck
```

Build the Electron main process and renderer:

```bash
npm run build
```

Start the built app locally:

```bash
npm start
```

## Build On Windows

1. Install Node.js 20 or newer.
2. Install the Claude Code CLI.
3. Install Visual Studio Build Tools with the Desktop development with C++ workload. This is needed because `node-pty` uses native modules.
4. Install Python 3 and make sure it is available on `PATH`.
5. Open PowerShell in the project folder.
6. Install dependencies:

```powershell
npm install
```

7. Rebuild native Electron dependencies if needed:

```powershell
npm run rebuild:native
```

8. Build the app:

```powershell
npm run build
```

9. Start the built app:

```powershell
npm start
```

The compiled files are written to `dist/main` and `dist/renderer`.

## Build On Linux

1. Install Node.js 20 or newer.
2. Install the Claude Code CLI.
3. Install native build tools for `node-pty`.

For Debian or Ubuntu:

```bash
sudo apt update
sudo apt install -y build-essential python3 make g++
```

For Fedora:

```bash
sudo dnf install -y gcc-c++ make python3
```

4. Install dependencies:

```bash
npm install
```

5. Rebuild native Electron dependencies if needed:

```bash
npm run rebuild:native
```

6. Build the app:

```bash
npm run build
```

7. Start the built app:

```bash
npm start
```

The compiled files are written to `dist/main` and `dist/renderer`.

## Packaging For Easy Installation

The current project build creates compiled Electron files, but it does not yet create a one-click installer. To distribute the app to users who do not want to run code or commands, package it as normal desktop installer files and publish those files in a release.

Recommended release artifacts:

- Windows: `.exe` installer or portable `.exe`.
- Linux: `.AppImage` for broad compatibility.
- Linux: `.deb` for Debian and Ubuntu users.
- Linux: `.rpm` for Fedora, RHEL, and openSUSE users.

### Recommended Packager

Use Electron Builder or Electron Forge. Electron Builder is a good fit if you want simple `.exe`, `.AppImage`, `.deb`, and `.rpm` outputs from one configuration.

Example package scripts to add later:

```json
{
  "scripts": {
    "dist": "npm run build && electron-builder",
    "dist:win": "npm run build && electron-builder --win",
    "dist:linux": "npm run build && electron-builder --linux"
  }
}
```

Example Electron Builder configuration:

```json
{
  "build": {
    "appId": "com.srclaude.claude-code-desktop",
    "productName": "Claude Code Desktop",
    "directories": {
      "output": "release"
    },
    "files": [
      "dist/**/*",
      "package.json"
    ],
    "win": {
      "target": ["nsis", "portable"]
    },
    "linux": {
      "target": ["AppImage", "deb", "rpm"],
      "category": "Development"
    }
  }
}
```

After packaging is configured, maintainers can create release installers from each target platform and upload the generated files from the release output directory.

## Installing Without Running Commands

For end users, the easiest installation flow should be:

1. Open the project's Releases page.
2. Download the installer for your operating system.
3. Install and open the app.
4. Open Settings.
5. Confirm the Claude Code CLI path if the app does not detect it automatically.
6. Add a provider profile for your local model provider if needed.
7. Select a project folder and start a new session.

### Windows User Guide

Download the Windows `.exe` installer from Releases. Double-click it and follow the installer. After installation, launch Claude Code Desktop from the Start menu.

If Windows SmartScreen appears, choose More info and run the app only if you trust the release source. For a smoother public release, sign the installer with a trusted code-signing certificate.

### Linux User Guide

Download the `.AppImage` from Releases for the simplest install experience. Mark it as executable from your file manager if prompted, then double-click it.

For Debian or Ubuntu, download the `.deb` package and install it with your system package installer. For Fedora, RHEL, or openSUSE, download the `.rpm` package and install it with your system package installer.

## Notes For Local Models

Local models vary a lot in reliability. Claude Code depends on strong instruction following, tool use, long context, and structured output. If a model struggles, try a stronger coding model, a larger context window, or a provider gateway with better Anthropic API compatibility.

The desktop app should make permission modes visible before launching a session. Be careful with permissive modes because Claude Code can edit files and run shell commands in the selected project.
