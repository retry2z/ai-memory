#!/bin/bash
# memorize SAVE HOOK — Auto-save every N exchanges (Bun Version)
#
# Claude Code "Stop" hook. After every assistant response:
# 1. Counts human messages in the session transcript
# 2. Every SAVE_INTERVAL messages, BLOCKS the AI from stopping
# 3. Returns a reason telling the AI to save structured diary + palace entries
#
# === CONFIGURATION ===

SAVE_INTERVAL=15
STATE_DIR="$HOME/.memorize/hook_state"
mkdir -p "$STATE_DIR"

# Read JSON input from stdin
INPUT=$(cat)

# Use Bun for JSON parsing
SESSION_ID=$(echo "$INPUT" | bun -e "process.stdin.text().then(t => console.log(JSON.parse(t).session_id || 'unknown'))")
SESSION_ID=$(echo "$SESSION_ID" | tr -cd 'a-zA-Z0-9_-')
[ -z "$SESSION_ID" ] && SESSION_ID="unknown"

STOP_HOOK_ACTIVE=$(echo "$INPUT" | bun -e "process.stdin.text().then(t => console.log(JSON.parse(t).stop_hook_active))")
TRANSCRIPT_PATH=$(echo "$INPUT" | bun -e "process.stdin.text().then(t => console.log(JSON.parse(t).transcript_path || ''))")

# Expand ~ in path
TRANSCRIPT_PATH="${TRANSCRIPT_PATH/#\~/$HOME}"

# If already in a save cycle, let through
if [ "$STOP_HOOK_ACTIVE" = "true" ]; then
    echo "{}"
    exit 0
fi

# Count human messages
if [ -f "$TRANSCRIPT_PATH" ]; then
    EXCHANGE_COUNT=$(bun -e "
      const fs = require('fs');
      const lines = fs.readFileSync(process.argv[1], 'utf8').split('\n').filter(Boolean);
      let count = 0;
      for (const line of lines) {
        try {
          const entry = JSON.parse(line);
          const msg = entry.message || {};
          if (msg.role === 'user' && typeof msg.content === 'string' && !msg.content.includes('<command-message>')) {
            count++;
          }
        } catch (e) {}
      }
      console.log(count);
    " "$TRANSCRIPT_PATH")
else
    EXCHANGE_COUNT=0
fi

# Track last save
LAST_SAVE_FILE="$STATE_DIR/${SESSION_ID}_last_save"
LAST_SAVE=0
[ -f "$LAST_SAVE_FILE" ] && LAST_SAVE=$(cat "$LAST_SAVE_FILE")

SINCE_LAST=$((EXCHANGE_COUNT - LAST_SAVE))
echo "[$(date '+%H:%M:%S')] Session $SESSION_ID: $EXCHANGE_COUNT exchanges, $SINCE_LAST since last save" >> "$STATE_DIR/hook.log"

if [ "$SINCE_LAST" -ge "$SAVE_INTERVAL" ] && [ "$EXCHANGE_COUNT" -gt 0 ]; then
    echo "$EXCHANGE_COUNT" > "$LAST_SAVE_FILE"
    echo "[$(date '+%H:%M:%S')] TRIGGERING SAVE at exchange $EXCHANGE_COUNT" >> "$STATE_DIR/hook.log"

    cat << 'HOOKJSON'
{
  "decision": "block",
  "reason": "AUTO-SAVE checkpoint. Save key topics, decisions, quotes, and code from this session to your memory system. Organize into appropriate categories. Use verbatim quotes where possible. Continue conversation after saving."
}
HOOKJSON
else
    echo "{}"
fi
