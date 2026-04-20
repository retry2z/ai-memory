import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

export const PALACE_PROTOCOL = `IMPORTANT — memorize Memory Protocol:
1. ON WAKE-UP: Call mem_status to load palace overview + AAAK spec.
2. BEFORE RESPONDING about any person, project, or past event: call mem_kg_query or mem_search FIRST. Never guess — verify.
3. IF UNSURE about a fact (name, gender, age, relationship): say "let me check" and query the palace. Wrong is worse than slow.
4. AFTER EACH SESSION: call mem_diary_write to record what happened, what you learned, what matters.
5. WHEN FACTS CHANGE: call mem_kg_invalidate on the old fact, mem_kg_add for the new one.

This protocol ensures the AI KNOWS before it speaks. Storage is not memory — but storage + this protocol = memory.`;

export const AAAK_SPEC = `AAAK is a compressed memory dialect that memorize uses for efficient storage.
It is designed to be readable by both humans and LLMs without decoding.

FORMAT:
  ENTITIES: 3-letter uppercase codes. ALC=Alice, JOR=Jordan, RIL=Riley, MAX=Max, BEN=Ben.
  EMOTIONS: *action markers* before/during text. *warm*=joy, *fierce*=determined, *raw*=vulnerable, *bloom*=tenderness.
  STRUCTURE: Pipe-separated fields. FAM: family | PROJ: projects | warnings/reminders.
  DATES: ISO format (2026-03-31). COUNTS: Nx = N mentions (e.g., 570x).
  IMPORTANCE: 1-5 scale.
  HALLS: hall_facts, hall_events, hall_discoveries, hall_preferences, hall_advice.
  WINGS: wing_user, wing_agent, wing_team, wing_code, wing_myproject, wing_hardware, wing_ue5, wing_ai_research.
  ROOMS: Hyphenated slugs representing named ideas (e.g., chromadb-setup, gpu-pricing).

EXAMPLE:
  FAM: ALC->JOR | 2D(kids): RIL(18,sports) MAX(11,chess+swimming) | BEN(contributor)

Read AAAK naturally — expand codes mentally, treat *markers* as emotional context.
When WRITING AAAK: use entity codes, mark emotions, keep structure tight.`;

export function register(server: McpServer): void {
  server.tool(
    'mem_get_aaak_spec',
    'Get the AAAK dialect specification — the compressed memory format memorize uses',
    {},
    async () => {
      return {
        content: [
          { type: 'text' as const, text: JSON.stringify({ aaak_spec: AAAK_SPEC }, null, 2) },
        ],
      };
    },
  );
}
