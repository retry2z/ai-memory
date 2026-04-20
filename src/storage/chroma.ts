import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Collection, IncludeEnum } from "chromadb";
import { minilmEmbeddingFunction } from "../embed/index.js";
import { logger } from "../logger.js";
import type { DrawerMetadata } from "../types.js";

let cachedCollection: Collection | null = null;
let cachedCreateCollection: Collection | null = null;
let serverEnsured = false;

type WhereFilter = Record<string, unknown>;

interface ChromaGetResult {
	ids: string[];
	documents: (string | null)[];
	metadatas: (Record<string, string | number | boolean> | null)[];
}

interface ChromaQueryResult {
	ids: string[][];
	documents: (string | null)[][];
	metadatas: (Record<string, string | number | boolean> | null)[][];
	distances: (number | null)[][];
}

async function getClient(): Promise<import("chromadb").ChromaClient> {
	const { ChromaClient } = await import("chromadb");
	const { loadConfig } = await import("../config.js");
	const config = await loadConfig();
	const url = new URL(config.chromaUrl);
	return new ChromaClient({
		path: url.origin,
	});
}

async function isServerRunning(url: string): Promise<boolean> {
	const check = async (target: string) => {
		// Try v2 first (Chroma 1.x+), fall back to v1 (pre-1.x). Modern Chroma
		// returns 410 Gone on /api/v1/heartbeat, so v1-only probing falsely
		// reports the server as down.
		for (const path of ["/api/v2/heartbeat", "/api/v1/heartbeat"]) {
			try {
				const res = await fetch(`${target}${path}`, {
					signal: AbortSignal.timeout(1000),
				});
				if (res.ok) return true;
			} catch {
				// try next path
			}
		}
		return false;
	};

	if (await check(url)) return true;

	// Fallbacks for localhost issues on dual-stack systems
	const parsed = new URL(url);
	if (parsed.hostname === "localhost") {
		if (await check(url.replace("localhost", "127.0.0.1"))) return true;
		if (await check(url.replace("localhost", "[::1]"))) return true;
	}

	return false;
}

async function ensureServer(): Promise<void> {
	if (serverEnsured) return;

	const { loadConfig } = await import("../config.js");
	const config = await loadConfig();

	if (config.chromaUrl === "memory" || config.chromaUrl === "mock") {
		serverEnsured = true;
		return;
	}

	const isRunning = await isServerRunning(config.chromaUrl);
	if (isRunning) {
		serverEnsured = true;
		return;
	}

	// Not running — try to start it
	const lockFile = join(config.configDir, "chroma.lock");

	// Basic lock check to avoid multiple instances starting it at the same exact time
	if (existsSync(lockFile)) {
		try {
			const pidStr = readFileSync(lockFile, "utf-8").trim();
			const pid = parseInt(pidStr, 10);
			if (!isNaN(pid)) {
				try {
					process.kill(pid, 0); // Check if process exists
					logger.debug(
						"ChromaDB server start already in progress by another instance.",
					);
					// Wait a bit and check heartbeat
					for (let i = 0; i < 5; i++) {
						await new Promise((r) => setTimeout(r, 1000));
						if (await isServerRunning(config.chromaUrl)) {
							serverEnsured = true;
							return;
						}
					}
				} catch {
					// PID doesn't exist, stale lock
				}
			}
		} catch {
			// Malformed lock
		}
	}

	logger.info(
		`Starting ChromaDB server in background (path: ${config.palacePath})...`,
	);

	if (!existsSync(config.palacePath)) {
		mkdirSync(config.palacePath, { recursive: true });
	}

	const isWin = process.platform === "win32";
	const cmd = isWin ? "start" : "chroma";
	const args = isWin
		? ["/B", "chroma", "run", "--path", `"${config.palacePath}"`]
		: ["run", "--path", config.palacePath];

	const child = spawn(cmd, args, {
		detached: !isWin,
		stdio: "ignore",
		shell: true,
	});

	if (child.pid) {
		writeFileSync(lockFile, child.pid.toString());
		if (!isWin) child.unref();
	}

	// Wait for heartbeat
	logger.debug("Waiting for ChromaDB heartbeat...");
	let connected = false;
	// Increase wait time for Windows/slow starts
	for (let i = 0; i < 30; i++) {
		await new Promise((r) => setTimeout(r, 1000));
		if (await isServerRunning(config.chromaUrl)) {
			connected = true;
			break;
		}
	}

	if (connected) {
		logger.info("ChromaDB server is online.");
		serverEnsured = true;
	} else {
		logger.error(
			"Failed to start ChromaDB server or it took too long to respond.",
		);
	}
}

class MockCollection {
	private store = new Map<string, { content: string; metadata: any }>();
	public name: string;

	constructor(name: string) {
		this.name = name;
	}

	async add(params: { ids: string[]; documents: string[]; metadatas: any[] }) {
		for (let i = 0; i < params.ids.length; i++) {
			const id = params.ids[i];
			if (id === undefined) continue;
			this.store.set(id, {
				content: params.documents[i] ?? "",
				metadata: params.metadatas[i] ?? {},
			});
		}
	}

	async get(params: {
		ids?: string[];
		limit?: number;
		offset?: number;
		where?: any;
	}) {
		let entries = Array.from(this.store.entries());

		if (params.where) {
			const { wing, room } = params.where;
			if (wing) entries = entries.filter(([_, v]) => v.metadata.wing === wing);
			if (room) entries = entries.filter(([_, v]) => v.metadata.room === room);
		}

		if (params.ids) {
			entries = entries.filter(([id]) => params.ids!.includes(id));
		}

		const start = params.offset || 0;
		const end = params.limit ? start + params.limit : entries.length;
		const sliced = entries.slice(start, end);

		return {
			ids: sliced.map(([id]) => id),
			documents: sliced.map(([_, v]) => v.content),
			metadatas: sliced.map(([_, v]) => v.metadata),
		};
	}

	async update(params: {
		ids: string[];
		documents: string[];
		metadatas: any[];
	}) {
		await this.add(params);
	}

	async delete(params: { ids: string[] }) {
		for (const id of params.ids) {
			this.store.delete(id);
		}
	}

	async query(params: { queryTexts: string[]; nResults: number; where?: any }) {
		let entries = Array.from(this.store.entries());
		if (params.where) {
			const { wing, room } = params.where;
			if (wing) entries = entries.filter(([_, v]) => v.metadata.wing === wing);
			if (room) entries = entries.filter(([_, v]) => v.metadata.room === room);
		}

		// Simple keyword search fallback
		const query = (params.queryTexts[0] ?? "").toLowerCase();
		const scored = entries.map(([id, v]) => ({
			id,
			doc: v.content,
			meta: v.metadata,
			score: v.content.toLowerCase().includes(query) ? 0.1 : 0.9, // Lower is closer in Chroma
		}));

		scored.sort((a, b) => a.score - b.score);
		const top = scored.slice(0, params.nResults);

		return {
			ids: [top.map((t) => t.id)],
			documents: [top.map((t) => t.doc)],
			metadatas: [top.map((t) => t.meta)],
			distances: [top.map((t) => t.score)],
		};
	}

	async count() {
		return this.store.size;
	}
}

let mockInstance: MockCollection | null = null;

export async function getCollection(
	create = false,
): Promise<Collection | null> {
	try {
		const { loadConfig } = await import("../config.js");
		const config = await loadConfig();

		if (config.chromaUrl === "memory" || config.chromaUrl === "mock") {
			if (!mockInstance)
				mockInstance = new MockCollection(config.collectionName);
			return mockInstance as unknown as Collection;
		}

		await ensureServer();

		if (!create && cachedCollection) return cachedCollection;
		if (create && cachedCreateCollection) return cachedCreateCollection;

		const client = await getClient();

		if (create) {
			const col = await client.getOrCreateCollection({
				name: config.collectionName,
				metadata: { "hnsw:space": "cosine" },
				embeddingFunction: minilmEmbeddingFunction,
			});
			cachedCreateCollection = col;
			cachedCollection = col;
			return col;
		}

		const col = await client.getCollection({
			name: config.collectionName,
			embeddingFunction: minilmEmbeddingFunction,
		});
		cachedCollection = col;
		return col;
	} catch (error) {
		logger.error(
			`ChromaDB error: ${error instanceof Error ? error.message : String(error)}`,
		);
		return null;
	}
}

export async function addDocument(
	id: string,
	content: string,
	metadata: DrawerMetadata,
): Promise<void> {
	const col = await getCollection(true);
	if (!col) throw new Error("Failed to get ChromaDB collection");
	await col.add({
		ids: [id],
		documents: [content],
		metadatas: [metadata as Record<string, string | number | boolean>],
	});
}

export async function getDocument(
	id: string,
): Promise<{ id: string; content: string; metadata: DrawerMetadata } | null> {
	const col = await getCollection();
	if (!col) return null;

	const result = (await col.get({
		ids: [id],
		include: ["documents" as IncludeEnum, "metadatas" as IncludeEnum],
	})) as unknown as ChromaGetResult;

	if (!result.ids.length) return null;

	return {
		id: result.ids[0]!,
		content: result.documents[0] ?? "",
		metadata: (result.metadatas[0] ?? {}) as unknown as DrawerMetadata,
	};
}

export async function updateDocument(
	id: string,
	content: string,
	metadata: DrawerMetadata,
): Promise<void> {
	const col = await getCollection();
	if (!col) throw new Error("Failed to get ChromaDB collection");
	await col.update({
		ids: [id],
		documents: [content],
		metadatas: [metadata as Record<string, string | number | boolean>],
	});
}

export async function deleteDocument(id: string): Promise<void> {
	const col = await getCollection();
	if (!col) throw new Error("Failed to get ChromaDB collection");
	await col.delete({ ids: [id] });
}

export async function queryByText(
	queryText: string,
	nResults: number,
	where?: WhereFilter,
): Promise<ChromaQueryResult> {
	const col = await getCollection();
	if (!col)
		return {
			ids: [[]],
			documents: [[]],
			metadatas: [[]],
			distances: [[]],
		};

	const params: Record<string, unknown> = {
		queryTexts: [queryText],
		nResults,
		include: [
			"documents" as IncludeEnum,
			"metadatas" as IncludeEnum,
			"distances" as IncludeEnum,
		],
	};
	if (where) params.where = where;

	return (await col.query(params as any)) as unknown as ChromaQueryResult;
}

export async function getByFilter(
	where?: WhereFilter,
	limit = 10000,
): Promise<ChromaGetResult> {
	const col = await getCollection();
	if (!col) return { ids: [], documents: [], metadatas: [] };

	const params: Record<string, unknown> = {
		include: ["documents" as IncludeEnum, "metadatas" as IncludeEnum],
		limit,
	};
	if (where) params.where = where;

	return (await col.get(params)) as unknown as ChromaGetResult;
}

export async function getCount(): Promise<number> {
	const col = await getCollection();
	if (!col) return 0;
	return await col.count();
}

export async function getAllMetadata(
	limit = 10000,
): Promise<(Record<string, string | number | boolean> | null)[]> {
	const col = await getCollection();
	if (!col) return [];
	const result = (await col.get({
		include: ["metadatas" as IncludeEnum],
		limit,
	})) as unknown as ChromaGetResult;
	return result.metadatas;
}

/** Reset cached collections — for testing. */
export function resetCollectionCache(): void {
	cachedCollection = null;
	cachedCreateCollection = null;
	mockInstance = null;
}
