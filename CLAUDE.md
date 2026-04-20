# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Runtime

This project **requires Bun** (not Node) at runtime, not just for scripts:

- `src/storage/knowledge-graph.ts` imports `bun:sqlite`.
- `tsup` marks `bun:sqlite`, `bun:test`, `bun` as externals and emits `#!/usr/bin/env bun` as a banner, so `dist/index.js` only runs under Bun.
- `src/cli.ts` uses `Bun.argv`.

Do not swap `bun:sqlite` for `better-sqlite3` or similar without changing the tsup externals and the CLI entry — this is a deliberate design choice (see `examples/claude_code_usage.md`).

## Common commands

```bash
bun run build             # tsup → dist/ (ESM, node20 target, bun shebang)
bun run dev               # tsup --watch
bun test                  # run all tests
bun test path/to/file     # run a single test file
bun test --watch          # watch mode
bun run lint              # biome check .
bun run lint:fix          # biome check --write .
bun run typecheck         # tsc --noEmit (strict, noUncheckedIndexedAccess)
bun run embed:download    # fetch MiniLM ONNX model + vocab (~23 MB, one-time)
bun run embed:smoke       # end-to-end sanity check for the embedder
bun run embed:migrate     # re-embed every drawer (for post-hashEmbed palaces)
bun run deploy            # uninstall global, rebuild, reinstall global
```

First-time setup: run `bun run embed:download` once. Everything else (tests, build) works without it because the ChromaDB tests use the in-memory mock collection.

Husky + lint-staged runs `biome check --write` on staged `*.ts` via the `prepare` script.

No biome config file lives at the root — Biome uses its defaults. If you need to change lint rules, add `biome.json`.

## Architecture

### Two entry points

- **`src/index.ts`** — MCP server over stdio (`memorize-server` bin). All it does is `createServer()` then `connect(StdioServerTransport)`.
- **`src/cli.ts`** — `memorize` CLI with one subcommand: `memorize mine <dir>` ingests conversation exports into the palace (see `convo-miner.ts`).

### Tool registration pattern

`src/server.ts` is the single registration point. Every file under `src/tools/*.ts` exports a `register(server: McpServer)` that calls `server.tool(name, description, zodSchema, handler)`. All exposed MCP tools are named `mem_*` (e.g. `mem_wake_up`, `mem_add_drawer`, `mem_kg_query`). If you add a new tool module, you must import+call its `register` inside `createServer()` — tools are not auto-discovered.

Tool handlers return `{ content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] }`. There's a local `ok()` helper in several tool files for this — reuse the pattern in its file rather than hoisting it until three modules need it.

### Storage: hybrid, asymmetric

Two backends, and they are **not** interchangeable:

1. **ChromaDB** (`src/storage/chroma.ts`) — vector store for drawers (memory entries). **Optional**. If the server isn't up at `CHROMA_URL`, the code tries to spawn `chroma run --path <palacePath>` (via `start /B` on Windows), then gracefully degrades: `getCollection()` returns `null` on failure and callers handle it.
2. **SQLite via `bun:sqlite`** (`src/storage/knowledge-graph.ts`) — entities + temporal triples (subject/predicate/object with `valid_from`/`valid_to`). **Mandatory** and always available.

Two non-obvious details in `chroma.ts`:

- The embedding function is `minilmEmbeddingFunction` from `src/embed/`. It runs **all-MiniLM-L6-v2** locally via `onnxruntime-node` with a self-written BERT WordPiece tokenizer — no `@huggingface/transformers`, no `@chroma-core/default-embed`, no `sharp`. First-time setup requires `bun run embed:download` to pull the quantized ONNX (~23 MB) and vocab into `<memorize-dir>/models/minilm-l6-v2/`. Calling the embedder before the model is downloaded throws a clear error that points at the script.
- **Model path resolution mirrors config resolution** (`src/embed/index.ts:resolveMemorizeDir`): env var → nearest ancestor `.memorize/` → `~/.memorize/`. So a project-local `.memorize/` gets a project-local model; otherwise models live globally. `findExistingModel()` checks the preferred location first and falls back to the global cache — meaning a globally-cached model is reusable across projects without redownloading. Tests use `findExistingModel()` for their skip checks so they work with either layout.
- Setting `CHROMA_URL=memory` or `mock` swaps in an in-process `MockCollection` that never invokes the embedding function (it keyword-matches instead). Tests rely on this, which is why `bun test` works without the ONNX model present.
- **Migration**: drawers created before the MiniLM swap were embedded with a bag-of-words hash and can't be ranked against MiniLM queries. Run `bun run embed:migrate` to re-embed the whole `mem_drawers` collection. The script is idempotent, batches (default 32), supports `--dry-run` and `--resume`, and stamps each drawer's metadata with `embedding_model: "minilm-l6-v2"` so reruns can skip work. Core logic is in `src/storage/migrate.ts` (pure function, takes any `TextEmbedder`); the script in `scripts/migrate-embeddings.ts` is a thin CLI wrapper.

### Config resolution

`src/config.ts` resolves the active config dir in this priority order:

1. `$MEMORIZE_CONFIG_DIR` env var (legacy lowercase `memorize_CONFIG_DIR` accepted as fallback)
2. Nearest ancestor directory containing a `.memorize/` folder (walks up from `cwd`)
3. `~/.memorize/` (default)

The resolved `configDir` determines `palacePath`, `kgPath`, and where `config.json` / `soul.md` are loaded from. Config is cached per process — tests call `resetConfig()` / `resetCollectionCache()` / `resetIdentityCache()` to reset.

### Domain model

- **Wing** — project/category namespace (e.g. `ai-memory`).
- **Room** — topic within a wing (e.g. `decisions`, `bugs`, `meetings`).
- **Drawer** — a single memory entry stored in ChromaDB with `wing`/`room`/timestamps in metadata.
- **Knowledge graph** — entities + temporal triples in SQLite; independent of drawers.
- **4-layer memory stack** (`src/layers.ts`): L0 identity (from `soul.md`), L1 essential story (top-N drawers by importance), L2 on-demand wing/room filtered, L3 deep semantic search. `mem_wake_up` returns L0+L1 concatenated.
- **AAAK** — a lossy symbolic compression dialect (`src/dialect.ts`) for packing long conversations into structured strings; exposed via the `mem_compress` / `mem_decode_aaak` tools.

`USAGE.md` is the end-user concept guide and `AGENTS.md` is the prompt guide for AI agents — keep both in sync when the tool surface changes.

### Hooks directory

`hooks/*.sh` are **bash scripts that host tools (Claude Code, Gemini CLI, Codex) invoke** — they read JSONL transcripts, count exchanges, and emit `{"decision": "block", "reason": "..."}` to force the AI to save. They are not called from the TypeScript code; they shell out to `memorize mine`. `hooks/README.md` has the install snippets.

## Tests

`bun test` picks up everything under `tests/`. Three subdirectories have different characteristics:

- `tests/*.test.ts` — unit tests, fast.
- `tests/integration/mcp-protocol.test.ts` — spins up the MCP server and speaks stdio to it.
- `tests/integration/migration-roundtrip.test.ts` — exercises the embedding migration against a real ChromaDB and real MiniLM. Auto-skips (with a warning) if Chroma isn't reachable at `CHROMA_URL_INTEGRATION` (default `http://127.0.0.1:8000`) or the MiniLM model isn't downloaded. Force-skip with `SKIP_INTEGRATION=1`. To run it: `chroma run --path ./tmp-palace` in another terminal, `bun run embed:download` once, then `bun test`.
- `tests/performance/tools.perf.test.ts` — perf smoke tests; slower.
- `tests/storage/` — exercises the ChromaDB and SQLite backends. Chroma tests use the `mock`/`memory` URL swap from `chroma.ts`, so they don't require a running Chroma server.

When a test touches config or caches, it must reset them (`resetConfig`, `resetCollectionCache`, `resetIdentityCache`) in `beforeEach` — otherwise state from earlier tests leaks.
