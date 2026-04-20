# memorize

> MCP server for AI agent persistent memory — a local-first **memory palace** backed by ChromaDB for semantic recall and SQLite for a temporal knowledge graph.

`memorize` gives any MCP-capable assistant (Claude Code, Gemini CLI, Codex, etc.) a long-term memory that survives across sessions: decisions, diaries, entities, relationships, and anything else worth remembering about a project. Semantic search is performed locally by a self-hosted **all-MiniLM-L6-v2** ONNX model with a pure-TypeScript BERT tokenizer — no API keys, no outbound calls, no third-party inference.

## Highlights

- **38 MCP tools** (`mem_wake_up`, `mem_search`, `mem_add_drawer`, `mem_kg_query`, …) exposed over stdio.
- **Hybrid storage**: ChromaDB for vector drawers (semantic memory) + `bun:sqlite` for temporal triples (structured facts with `valid_from`/`valid_to`).
- **4-layer memory stack**: L0 identity → L1 essential story → L2 on-demand wing/room retrieval → L3 deep semantic search.
- **Self-hosted embeddings**: MiniLM-L6-v2 (~23 MB quantized) loaded once via `onnxruntime-node`. No Hugging Face `@transformers`, no `sharp`, no `@chroma-core/default-embed`.
- **Project-aware config**: drops a `.memorize/` into any project dir and the server automatically scopes its palace/KG to that project; otherwise falls back to `~/.memorize/`.
- **Mining from conversations**: `memorize mine <dir>` chunks and files `.md`/`.txt`/`.json`/`.jsonl` chat exports into drawers.
- **Auto-save hooks** for Claude Code / Gemini CLI / Codex in `hooks/`.

## Requirements

- **[Bun](https://bun.sh/) >= 1.0** — runtime. This project uses `bun:sqlite` for the knowledge graph, so Node alone is not enough.
- **[Python](https://www.python.org/) 3.9–3.12** — required only by ChromaDB (see below). Not used by `memorize` itself.
- **[ChromaDB](https://docs.trychroma.com/getting-started)** — vector store for drawers. **Effectively required**: without it, all drawer tools (`mem_add_drawer`, `mem_search`, `mem_diary_*`, `mem_wake_up`, mining, …) either throw or return empty. Only the SQLite-backed knowledge-graph tools (`mem_kg_*`, `mem_graph_stats`) and a few static/pure-text tools keep working — that's roughly 10 of the 38 tools. SQLite is a *separate backend*, not a fallback for Chroma.

### Install ChromaDB

ChromaDB is a Python package and runs as a separate local process.

```bash
# 1. Install with pipx (isolates Chroma's deps AND puts `chroma` on global PATH)
pipx install chromadb

# 2. Verify the CLI is reachable from any shell
chroma --version

# 3. Start the server (binds to 127.0.0.1:8000 by default)
chroma run --path ~/.memorize/palace
```

If `chroma` is on your `PATH`, `memorize` auto-spawns it on first use against the active palace. On Windows, running it manually in a separate terminal is more reliable and gives you visible logs.

> **Avoid plain `venv`** for this one — `memorize` (and the MCP host that launches it) won't have the venv activated, so `chroma` won't be on `PATH` and auto-spawn will fail. `pipx` solves this because it installs into an isolated env but exposes a global shim.
>
> `pip install --user chromadb` also works *if* `~/.local/bin` (Linux/macOS) or `%APPDATA%\Python\Scripts` (Windows) is on your `PATH`.

For **tests or throwaway scripts only**, set `CHROMA_URL=memory` to swap in an in-process `Map`-backed mock collection. **This is not persistent** — drawers are lost the moment the process exits. The SQLite knowledge graph persists regardless of `CHROMA_URL`, but if you want drawers to survive a restart you must run a real ChromaDB server.

## Install

```bash
bun install                    # dependencies
bun run embed:download         # fetch MiniLM ONNX + vocab (~23 MB, one-time)
bun run embed:smoke            # confirm local embeddings work
bun run build                  # → dist/
bun run deploy                 # install globally as `memorize` + `memorize-server`
```

## Wire it up

### Claude Code

Add to `~/.claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "memorize": {
      "command": "memorize-server"
    }
  }
}
```

Then, optionally, set up the auto-save hooks (see [`hooks/README.md`](hooks/README.md)).

### Gemini CLI, Codex, other MCP hosts

See [`examples/gemini_cli_setup.md`](examples/gemini_cli_setup.md) and [`hooks/README.md`](hooks/README.md) for transport configuration.

## Daily use

At the start of a session, have your agent call `mem_wake_up` to pre-load L0 identity + L1 essential story (~600–900 tokens). During the session the agent files decisions with `mem_add_drawer`, updates the knowledge graph with `mem_kg_add`, and recalls context with `mem_search` or `mem_kg_query`. Before ending, the agent records observations via `mem_diary_write`.

See [`AGENTS.md`](AGENTS.md) for the full agent playbook and [`USAGE.md`](USAGE.md) for concepts (wings, rooms, drawers, AAAK compression, memory layers).

## Mining existing conversations

```bash
memorize mine ./my-chat-exports          # ingest .md/.txt/.json/.jsonl
memorize mine ./.agents --wing upmonitor --dry-run    # preview first
```

The miner chunks by `>`-quoted exchange pairs (or paragraph), routes each chunk into a room (`technical`, `decisions`, `architecture`, `planning`, `problems`, `general`) via keyword scoring, and files it into the given wing.

## Migrating embeddings

If you have drawers created before switching to MiniLM (or are upgrading embedders), re-embed the whole palace:

```bash
bun run embed:migrate --dry-run          # preview
bun run embed:migrate                    # live, ~60 drawers/s
bun run embed:migrate --resume           # skip already-tagged drawers
```

Each migrated drawer gets `embedding_model: "minilm-l6-v2"` in its metadata. Content, IDs, and custom metadata are untouched.

## Configuration

`memorize` resolves its config directory in this order:

1. `MEMORIZE_CONFIG_DIR` env var (lowercase `memorize_CONFIG_DIR` is accepted for back-compat)
2. Nearest ancestor directory containing a `.memorize/` folder (walks up from `cwd`)
3. `~/.memorize/` (default)

Inside that dir:

| File | Purpose |
|---|---|
| `palace/` | ChromaDB persistent store |
| `knowledge_graph.sqlite3` | Entities + triples |
| `entity_registry.json` | Personal entity registry |
| `soul.md` | L0 identity prompt (optional) |
| `config.json` | Optional overrides: `palace_path`, `collection_name` |
| `models/minilm-l6-v2/` | Local copy of MiniLM + vocab (or falls back to `~/.memorize/models/` if absent) |

Env var overrides:

- `MEMORIZE_CONFIG_DIR` — config dir
- `MEMORIZE_PATH` — palace path (overrides `config.json`'s `palace_path`)
- `CHROMA_URL` — defaults to `http://127.0.0.1:8000`. Set to `memory` or `mock` to use the in-process mock collection (tests use this).

## Development

```bash
bun test                       # run all tests
bun test path/to/file.test.ts  # single file
bun run typecheck              # tsc --noEmit
bun run lint                   # biome check
bun run lint:fix               # biome check --write
bun run dev                    # tsup --watch
```

### Project structure (high-level)

```
src/
  index.ts           # MCP server entry (stdio)
  cli.ts             # `memorize` CLI entry (mining)
  server.ts          # Registers all tool modules
  config.ts          # Config dir resolution
  layers.ts          # L0-L3 memory stack
  convo-miner.ts     # Conversation ingestion
  dialect.ts         # AAAK compression
  entity-detector.ts # Entity classification
  entity-registry.ts # People/project registry
  embed/             # MiniLM + BERT tokenizer (self-contained)
    tokenizer.ts
    embedder.ts
    index.ts
  storage/
    chroma.ts        # ChromaDB client + mock
    knowledge-graph.ts # SQLite KG
    migrate.ts       # Embedding migration
  tools/             # 12 modules registering the 38 MCP tools
scripts/             # download-model, embed-smoke, migrate-embeddings
hooks/               # Bash hooks for auto-save from Claude Code / Gemini / Codex
tests/               # Unit, integration, performance, storage
```

See [`CLAUDE.md`](CLAUDE.md) for a deeper architecture walk-through aimed at future instances of Claude Code working in this repo.

## License

[MIT](LICENSE) © Hristo Hristow
