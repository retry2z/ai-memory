# How to Use Memorize (mem) MCP Server

> [!TIP]
> **Looking for the Agent Guide?** See **[AGENTS.md](AGENTS.md)** for a prompt guide on how AI agents should use these tools.

Memorize (mem) provides persistent memory across sessions using a hybrid storage approach
: **ChromaDB** for semantic/vector search and **SQLite** for a temporal knowledge graph.

## 1. Core Concepts

- **Wings & Rooms:** Memories (drawers) are organized into *wings* (projects/categories) and *rooms* (topics/aspects like 'decisions', 'bugs').
- **Drawers:** Individual memory entries stored with metadata and vector embeddings.
- **Knowledge Graph (KG):** Stores entities (people/projects) and their relationships (triples) with temporal validity.
- **Entity Registry:** Tracks known people and projects to disambiguate common words (e.g., 'Grace' the person vs 'grace' the concept).

## 2. Advanced Features

### Memory Layers (L0 - L3)
Memorize uses a layered approach to context injection:
- **L0 (Identity):** Your core persona, loaded from `~/.memorize/identity.txt`.
- **L1 (Essential Story):** The most critical project context, auto-generated from top drawers.
- **L2 (On-demand):** Specific context retrieved by wing or room when a topic is mentioned.
- **L3 (Deep Search):** Full semantic search across the entire palace via ChromaDB.
- **Tool:** Use `mem_wake_up` at the start of a session to load L0+L1.

### AAAK Compression Dialect
The server can compress long conversations into a lossy, symbolic format called **AAAK**.
- **Tool:** `mem_compress` extracts entities, topics, key quotes, emotions, and flags into a compact string.
- **Benefits:** Reduces token usage while preserving the "essence" of a memory.

## 3. Recommended Workflows

### Initial Seeding
When starting a new project:
1.  **`mem_entity_seed`**: Define the team and the project names.
2.  **`mem_kg_add`**: Add architectural or organizational facts (e.g., "Project X -> uses -> React").

### Active Session Management
- **`mem_add_drawer`**: Store important decisions or bug root causes.
- **`mem_diary_write`**: Record your own observations as an agent (e.g., "The user prefers functional components over classes").
- **`mem_entity_learn`**: Automatically learn new people and projects from the current chat.

### Retrieval
- **`mem_search`**: Find memories by meaning (requires ChromaDB).
- **`mem_kg_timeline`**: See the history of an entity across time.
- **`mem_layer_status`**: Check how many memories are currently stored.

## 4. Storage & Troubleshooting

| Component | Storage | Status |
|---|---|---|
| **Drawers & Diary** | ChromaDB | **Optional** (Requires server at `127.0.0.1:8000`) |
| **KG & Entities** | SQLite (Bun) | **Mandatory** (Fast, local, always available) |
| **Dialect** | Logic | **Always Available** |

### Troubleshooting
- **"Failed to get ChromaDB collection"**: The vector server is not running. You can still use Knowledge Graph and Entity tools.
- **"No palace found"**: You haven't added any drawers yet. Run `mem_add_drawer` to initialize the palace.
- **"Duplicate"**: The server uses vector similarity (threshold 0.9) to prevent storing the same memory twice.
