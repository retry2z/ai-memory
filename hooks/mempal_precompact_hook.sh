#!/bin/bash
# memorize PRE-COMPACT HOOK — Emergency save before compaction (Bun Version)
#
# Claude Code "PreCompact" hook. Fires RIGHT BEFORE compaction.
#
# === CONFIGURATION ===

STATE_DIR="$HOME/.memorize/hook_state"
mkdir -p "$STATE_DIR"

# Read JSON input from stdin
INPUT=$(cat)

# Use Bun for JSON parsing
SESSION_ID=$(echo "$INPUT" | bun -e "process.stdin.text().then(t => console.log(JSON.parse(t).session_id || 'unknown'))")
echo "[$(date '+%H:%M:%S')] PRE-COMPACT triggered for session $SESSION_ID" >> "$STATE_DIR/hook.log"

# Always block — compaction = save everything
cat << 'HOOKJSON'
{
  "decision": "block",
  "reason": "COMPACTION IMMINENT. Save ALL topics, decisions, quotes, code, and important context from this session to your memory system. Be thorough — after compaction, detailed context will be lost. Organize into appropriate categories. Use verbatim quotes where possible. Save everything, then allow compaction to proceed."
}
HOOKJSON
