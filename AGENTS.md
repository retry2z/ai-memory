# Prompt Guide: Autonomous Memory Management

> [!TIP]
> **Looking for the User Guide?** See **[USAGE.md](USAGE.md)** for core concepts, memory layers, and troubleshooting.

This guide provides instructions for AI agents on how and when to utilize the `memorize` MCP server
 to maintain project context and continuity.

## 1. Initialization (Session Start)

**Directive:** Always "wake up" your memory at the start of a session or when switching to a new project wing.

- **Action:** Call `mem_wake_up({ "wing": "project-name" })`.
- **Reason:** This loads Layer 0 (your identity) and Layer 1 (essential project story), preventing "context amnesia" and reducing the need for the user to repeat basic project facts.

## 2. Entity Recognition (Ongoing)

**Directive:** Proactively update the **Entity Registry** when the user introduces new people, projects, or specialized terminology.

- **Trigger:** "Talk to [Name]", "We are starting [Project]", "[Term] is our internal tool for X".
- **Action:**
    1. Use `mem_entity_seed` for high-confidence people/projects.
    2. Use `mem_entity_lookup` to check if a word is already known before asking for clarification.
    3. Use `mem_kg_add` to link these entities (e.g., `Person` -> `works_on` -> `Project`).

## 3. Decision Persistence (High Value)

**Directive:** Every significant architectural, design, or strategic decision MUST be filed in a "decisions" room.

- **Trigger:** "Let's go with X", "We decided to Y", "We are switching from A to B".
- **Action:** Call `mem_add_drawer` with:
    - `wing`: Current project.
    - `room`: "decisions".
    - `content`: Summary of the decision and the *rationale*.
- **Note:** Decisions are the most valuable long-term memories for future agents.

## 4. Knowledge Retrieval (Reactive)

**Directive:** When the user asks "Why", "How did we", or "Who is", prioritize searching memory before admitting ignorance.

- **Action:**
    1. Use `mem_search` for semantic queries (e.g., "Why did we choose SQLite?").
    2. Use `mem_kg_query` for relationship queries (e.g., "What does Riley work on?").
    3. Use `mem_kg_timeline` for historical queries (e.g., "What is the history of the storage-layer?").

## 5. Session Reflection (Closure)

**Directive:** Before ending a task or session, record your "Agent Observations" to pass the torch to the next version of yourself.

- **Action:** Call `mem_diary_write`.
- **Focus:** User preferences ("User prefers concise code"), environment quirks ("The local dev server is flaky"), and pending items ("We left off halfway through the schema migration").

## 6. AAAK Compression (Context Efficiency)

**Directive:** If the current chat history is becoming too long, "compress" the essence of the previous exchanges before they roll off the context window.

- **Action:** Use `mem_compress` to turn long dialogue into a dense AAAK string, then save that string in a `history` or `archive` room.

## 7. Operational Safety

- **Privacy:** Never store secrets, API keys, or credentials in the memory palace.
- **Deduplication:** The server handles vector-based deduplication; do not worry about "double-filing" the same fact—the server will reject the duplicate.
- **Graceful Failure:** If ChromaDB is down (connection error), fallback to SQLite-backed Knowledge Graph tools (`mem_kg_*`).
