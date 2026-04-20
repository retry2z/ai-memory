# Gemini CLI Integration Guide

This guide explains how to set up **Memorize** as a permanent memory for the [Gemini CLI](https://github.com/google/gemini-cli).

## Prerequisites

- [Bun](https://bun.sh/) 1.0+
- Gemini CLI installed and configured

## 1. Installation & Global Setup

Build the project and install the binaries (`memorize-server` and `memorize`) to your global path.

```bash
# Install dependencies
bun install

# Build the project
bun run build

# Install globally
bun install -g .
```

## 2. Connect to Gemini CLI

Register the server. If you have an old "memorize" registration that is disconnected, remove it first.

```bash
# Remove old registration if needed
gemini mcp remove memorize

# Add the new global binary
gemini mcp add memorize -- memorize-server
```

## 3. Enable Auto-Saving (Hooks)

Memorize uses hooks to trigger saves before the conversation is compressed. Add a `PreCompress` hook to your Gemini CLI settings.

Edit your `~/.gemini/settings.json` (or use the CLI to add it):

```json
{
  "hooks": {
    "PreCompress": [
      {
        "matcher": "*",
        "hooks": [
          {
            "type": "command",
            "command": "/absolute/path/to/memorize/hooks/mempal_precompact_hook.sh"
          }
        ]
      }
    ]
  }
}
```

*Note: Make sure the hook script is executable:* `chmod +x hooks/*.sh`

## 4. Usage

Once connected, Gemini CLI will:
- **Search**: Use `mem_search` and `mem_recall` to find relevant past context.
- **Learn**: Use `mem_kg_add` to store new facts and relationships.
- **Auto-Save**: Trigger the `PreCompress` hook to preserve details before they are lost.

### Manual Mining
To ingest an existing project into your memory immediately:
```bash
memorize mine /path/to/your/project
```

### Verification
In a Gemini CLI session:
- `/mcp list`: Verify `memorize` is `Ready`.
- `/hooks panel`: Verify the `PreCompress` hook is active.
