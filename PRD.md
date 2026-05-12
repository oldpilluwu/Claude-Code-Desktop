# Desktop Wrapper App for Claude Code

## Summary

Build an Electron desktop app that wraps the Claude Code CLI and allows users to run Claude Code with custom environment variables, including local model providers such as Ollama or LiteLLM.

The app should provide a Claude Desktop / Codex-style interface while delegating core agent behavior, file editing, permissions, and project interaction to the existing `claude` CLI.

## Motivation

Claude Code CLI can connect to local LLM providers by configuring Anthropic-compatible environment variables:

```bash
ANTHROPIC_AUTH_TOKEN=ollama \
ANTHROPIC_API_KEY="" \
ANTHROPIC_BASE_URL=http://localhost:11434 \
claude --model qwen3.5
```

However, the official Claude Desktop app does not currently provide this local-model workflow. This app aims to fill that gap by providing a desktop interface for Claude Code CLI sessions with support for local and custom model providers.

## Goals

* Provide a desktop UI for launching and managing Claude Code CLI sessions.
* Support local model providers such as Ollama.
* Support custom Anthropic-compatible API endpoints.
* Allow per-session model and environment configuration.
* Provide project-based Claude Code sessions.
* Preserve Claude Code’s existing behavior instead of reimplementing the agent.
* Eventually support a richer GUI using Claude Code JSON / streaming JSON output.

## Non-Goals

* Do not reimplement Claude Code’s agent logic.
* Do not build a new coding agent from scratch.
* Do not bypass Claude Code’s permission model.
* Do not assume all local models will work reliably with Claude Code.
* Do not require users to use local models; normal Claude Code usage should still work.

## Tech Stack

* Electron
* Node.js
* React
* TypeScript
* Tailwind + Shadcn ui
* `node-pty` for terminal-backed sessions
* `xterm.js` for terminal rendering
* Local config storage for provider profiles and app settings

Possible future additions:

* Monaco Editor for file and diff viewing
* Git integration through simple-git or native git commands
* JSON/NDJSON streaming parser for rich Claude Code UI mode

## MVP Requirements

### 1. App Launch

When the user opens the app, they should see:

* Sessions sidebar
* New Chat / New Session button
* Project picker
* Provider/model configuration
* Main Claude Code session area

### 2. Project Picker

The user can select a local project folder.

The selected folder becomes the working directory for the Claude Code process.

### 3. Provider Profiles

The user can configure provider profiles such as:

* Default Claude Code
* Ollama
* vLLM
* LiteLLM
* Custom Anthropic-compatible endpoint

Each profile may define:

* `ANTHROPIC_BASE_URL`
* `ANTHROPIC_AUTH_TOKEN`
* `ANTHROPIC_API_KEY`
* Default model
* Additional environment variables

If no custom environment variables are provided, the app launches `claude` normally.

### 4. Model Picker

The user can choose or manually enter a model name.

Examples:

```text
qwen3.5
qwen2.5-coder
llama3.1
claude-sonnet-4-5
```

The selected model is passed to Claude Code using:

```bash
claude --model <model>
```

### 5. Session Launching

When the user sends the first message or starts a session, the app launches the Claude Code CLI in the selected project directory with the selected environment variables.

For MVP, the app should launch Claude Code through a pseudo-terminal.

Example:

```bash
ANTHROPIC_AUTH_TOKEN=ollama \
ANTHROPIC_API_KEY="" \
ANTHROPIC_BASE_URL=http://localhost:11434 \
claude --model qwen3.5
```

### 6. Terminal-Based Claude Code UI

The initial version should embed Claude Code’s terminal interface using `xterm.js`.

This allows the app to support Claude Code features without reimplementing them immediately, including:

* Interactive prompts
* Tool calls
* Permission requests
* File edits
* Shell commands
* Slash commands
* Session behavior

### 7. Permissions Manager

The app should expose Claude Code permission behavior clearly.

At minimum, the app should allow users to select a permission mode before launching a session.

Possible options:

* Default
* Plan
* Accept edits
* Auto
* Don’t ask
* Bypass permissions

Dangerous modes should include clear warnings.

### 8. Settings Page

The app should include a settings page for:

* Provider profiles
* Environment variables
* Default model
* Default project path
* Claude binary path
* Permission mode
* Local model provider settings

## Future Requirements

### 1. Rich GUI Mode

After the PTY-based MVP works, the app can add a richer GUI mode using Claude Code’s headless and JSON output features.

Claude Code supports:

```bash
claude -p "Summarize this project" --output-format json
```

And real-time NDJSON streaming:

```bash
claude -p "Explain this repo" \
  --output-format stream-json \
  --verbose \
  --include-partial-messages
```

The richer GUI mode may use:

* `--output-format stream-json`
* `--input-format stream-json`
* `--permission-prompt-tool`
* `--resume`
* `--session-id`

This mode could enable:

* Chat-style message rendering
* Tool call cards
* File edit previews
* Permission modals
* Session replay
* Better diff visualization

### 2. File Mention Support

The app should allow users to mention files from the selected project.

Example:

```text
Explain @src/main.ts
```

For MVP, this can be passed directly into the Claude Code terminal.

In rich GUI mode, the app may provide autocomplete for project files.

### 3. File Upload Support

The app should support attaching files to a session.

Possible implementation:

* Copy uploaded files into a temporary session directory.
* Reference them in the Claude prompt.
* Optionally clean up temporary files after the session ends.

### 4. Git Branch Picker

The app may show the current Git branch for the selected project.

Future functionality:

* Switch branches
* Create new branches
* Warn about dirty working tree
* Show changed files
* Show commit history

### 5. Git Diff / File Diff Viewer

The app should eventually provide a visual diff viewer for changes made during a Claude Code session.

Possible features:

* Show changed files
* Show line-by-line diff
* Accept/reject file changes
* Open changed file in editor
* Stage selected changes

## User Flow

1. User opens the app.
2. User selects a project folder.
3. User selects a provider profile.
4. User selects or enters a model.
5. User clicks “New Session.”
6. App launches Claude Code CLI in the project directory.
7. User interacts with Claude Code through the embedded terminal.
8. Claude Code requests permissions when needed.
9. User approves or denies actions.
10. App displays session history in the sidebar.
11. User can reopen or resume previous sessions.

## Local Model Example

For Ollama, the user may configure:

```bash
ANTHROPIC_BASE_URL=http://localhost:11434
ANTHROPIC_AUTH_TOKEN=ollama
ANTHROPIC_API_KEY=
```

Then launch:

```bash
claude --model qwen3.5
```

## Risks and Challenges

### Local Model Compatibility

Not all local models will work well with Claude Code. Claude Code depends on strong instruction following, tool use, long-context reasoning, and reliable structured output.

### Permissions

Claude Code can edit files and run shell commands. The app must make permission modes visible and avoid unsafe defaults.

### JSON GUI Complexity

A rich GUI using `stream-json` may require custom handling of:

* Tool calls
* Partial messages
* Permission prompts
* Session state
* Errors
* File edits
* Process interruptions

This should be implemented after the PTY-based version is stable.

### Cross-Platform Behavior

The app should handle differences across:

* macOS
* Linux
* Windows
* WSL
* Different shell environments
* Different Claude CLI installation paths

## Success Criteria

The MVP is successful when:

* A user can select a project folder.
* A user can configure an Ollama provider profile.
* A user can launch Claude Code with a local model.
* The embedded terminal behaves like the normal Claude Code CLI.
* Claude Code can read and edit files in the selected project.
* Permission prompts are visible and usable.
* The user can start multiple sessions from the desktop app.

## MVP Scope

The first version should include:

* Electron app shell
* Project picker
* Provider/model settings
* Embedded Claude Code terminal
* Session sidebar
* Basic session persistence
* Permission mode selector

The first version should not include:

* Full custom chat UI
* Custom tool rendering
* Advanced file upload handling
* Full Git diff viewer
* Branch switching
* Custom permission-prompt tool
