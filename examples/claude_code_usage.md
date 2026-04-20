# Example: Agentic Usage (Claude Code / Gemini CLI)

This example demonstrates how an AI agent should autonomously use the `memorize` MCP server to maintain context throughout a project lifecycle.

## 1. Session Start: The "Wake Up"

When the agent first enters a workspace, it should load its identity and essential project context.

**Agent Thought:** *I am entering the `ai-memory` project. I should load my project-specific memories to see what I worked on last.*

```json
// Tool Call
mem_wake_up({ "wing": "ai-memory" })
```

**Response:**
> ## L0 — IDENTITY
> I am an expert software engineer assistant specializing in TypeScript and MCP.
>
> ## L1 — ESSENTIAL STORY
> Project: ai-memory (memorize-mcp)
> Goal: Rewrite the Python memory server in TypeScript using Bun and ChromaDB.
> Latest: Fixed the triple-slash URL bug in the ChromaDB client.

---

## 2. In-Conversation Learning

As the user introduces new people or concepts, the agent should update its registry.

**User:** "Hey, talk to Riley about the new SQLite schema. She's the lead on the storage layer."

**Agent Thought:** *The user mentioned 'Riley' as the lead on the storage layer. I should add her to my entity registry and link her to the project in the knowledge graph.*

```json
// Step 1: Add to Entity Registry
mem_entity_seed({
  "people": [{ "name": "Riley", "relationship": "Storage Lead", "context": "Lead for SQLite storage layer." }]
})

// Step 2: Link in Knowledge Graph
mem_kg_add({
  "subject": "Riley",
  "predicate": "leads",
  "object": "storage-layer"
})
```

---

## 3. Recording a Key Decision

When a technical decision is reached, the agent should "file" it into a drawer for long-term retrieval.

**User:** "Let's use Bun's native SQLite instead of `better-sqlite3` for better performance."

**Agent Thought:** *This is a significant architectural decision. I'll store it in the 'decisions' room.*

```json
// Tool Call
mem_add_drawer({
  "wing": "ai-memory",
  "room": "decisions",
  "content": "Decision: Use Bun:sqlite for the knowledge graph storage. Rationale: Performance and native integration with the Bun runtime.",
  "metadata": { "status": "approved", "priority": "high" }
})
```

---

## 4. On-Demand Retrieval

When a related topic comes up later, the agent can "recall" specific context.

**User:** "Wait, why did we choose Bun for the database again?"

**Agent Thought:** *The user is asking for rationale on a past decision. I'll search the 'decisions' room.*

```json
// Tool Call
mem_search({
  "query": "Bun SQLite vs better-sqlite3",
  "wing": "ai-memory",
  "room": "decisions"
})
```

---

## 5. Session End: Agent Diary

Before finishing a task, the agent records its own observations for the "next version" of itself.

**Agent Thought:** *I've finished the audit. I should record my observations about the current state of the ChromaDB server so I don't forget next time I'm initialized.*

```json
// Tool Call
mem_diary_write({
  "agent_name": "Gemini-CLI",
  "topic": "environment-setup",
  "entry": "Observation: The local ChromaDB server at 127.0.0.1:8000 is currently down. I've updated the client to handle this gracefully, but full search will be unavailable until it's restarted."
})
```
