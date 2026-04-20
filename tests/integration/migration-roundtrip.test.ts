import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import type { ChromaClient, Collection } from "chromadb";
import {
	findExistingModel,
	getDefaultEmbedder,
	minilmEmbeddingFunction,
} from "../../src/embed/index.js";
import {
	EMBEDDING_MODEL_TAG,
	migrateCollectionEmbeddings,
} from "../../src/storage/migrate.js";

const CHROMA_URL =
	process.env.CHROMA_URL_INTEGRATION ?? "http://127.0.0.1:8000";
const TEST_COLLECTION = `mem_migrate_integration_${Date.now()}`;
const SKIP = process.env.SKIP_INTEGRATION === "1";

async function heartbeat(url: string): Promise<boolean> {
	for (const path of ["/api/v1/heartbeat", "/api/v2/heartbeat"]) {
		try {
			const res = await fetch(`${url}${path}`, {
				signal: AbortSignal.timeout(2000),
			});
			if (res.ok) return true;
		} catch {
			// try next path
		}
	}
	return false;
}

const modelPresent = findExistingModel() !== null;
const chromaUp = !SKIP && modelPresent ? await heartbeat(CHROMA_URL) : false;
const shouldRun = modelPresent && !SKIP && chromaUp;

if (!modelPresent) {
	console.warn(
		"[integration/migration] MiniLM model missing in project or global .memorize/; skipping. Run: bun run embed:download",
	);
} else if (SKIP) {
	console.warn("[integration/migration] SKIP_INTEGRATION=1; skipping");
} else if (!chromaUp) {
	console.warn(
		`[integration/migration] ChromaDB not reachable at ${CHROMA_URL}; skipping. Start one with: chroma run --path ./tmp-palace`,
	);
}

const describeIfReady = shouldRun ? describe : describe.skip;

// Deterministic-ish junk vector: unit-normalized pseudo-random 384-dim.
// Simulates a pre-swap hash-embedded drawer: same dim, totally different space
// from MiniLM outputs. 384-dim random unit vectors are near-orthogonal to any
// given MiniLM query, so cosine similarity should sit near zero.
function junkVector(seed: number, dim = 384): number[] {
	const v = new Array<number>(dim);
	let s = seed;
	for (let i = 0; i < dim; i++) {
		s = (s * 1103515245 + 12345) & 0x7fffffff;
		v[i] = (s / 0x7fffffff) * 2 - 1;
	}
	let norm = 0;
	for (const x of v) norm += x * x;
	norm = Math.sqrt(norm) || 1;
	return v.map((x) => x / norm);
}

describeIfReady("migration roundtrip — real ChromaDB + real MiniLM", () => {
	let client: ChromaClient;
	let col: Collection;

	const drawers = [
		{
			id: "d1",
			content:
				"We decided to switch from Python to TypeScript for the server rewrite.",
		},
		{
			id: "d2",
			content:
				"The knowledge graph is stored in SQLite via bun:sqlite with a WAL journal.",
		},
		{
			id: "d3",
			content:
				"Authentication uses OAuth 2.0 with the PKCE code flow for browser clients.",
		},
	];

	beforeAll(async () => {
		const { ChromaClient } = await import("chromadb");
		client = new ChromaClient({ path: new URL(CHROMA_URL).origin });

		// Clean any stale collection from a previous interrupted run.
		try {
			await client.deleteCollection({ name: TEST_COLLECTION });
		} catch {
			// doesn't exist — fine
		}

		col = await client.getOrCreateCollection({
			name: TEST_COLLECTION,
			metadata: { "hnsw:space": "cosine" },
			embeddingFunction: minilmEmbeddingFunction,
		});

		// Seed drawers with JUNK vectors — simulates a palace that was filled
		// before the hash→MiniLM swap. Collection's embeddingFunction is MiniLM,
		// but since we're passing embeddings directly, Chroma stores what we
		// give it. Queries then embed via MiniLM and search against junk.
		await col.add({
			ids: drawers.map((d) => d.id),
			documents: drawers.map((d) => d.content),
			embeddings: drawers.map((_, i) => junkVector(i + 1)),
			// biome-ignore lint/suspicious/noExplicitAny: chroma metadata typing
			metadatas: drawers.map(() => ({
				wing: "integration",
				seeded: "junk",
			})) as any,
		});
	}, 60000);

	afterAll(async () => {
		if (client) {
			try {
				await client.deleteCollection({ name: TEST_COLLECTION });
			} catch {
				// best-effort cleanup
			}
		}
	});

	it("semantic search misses the right drawer before migration", async () => {
		const hits = (await col.query({
			queryTexts: ["moved the backend to TypeScript"],
			nResults: 3,
		})) as { ids: string[][]; distances: (number | null)[][] };

		// All similarities should be near zero — random 384-dim vectors are
		// effectively orthogonal to any MiniLM embedding. Threshold is
		// deliberately loose: in practice top sim sits around 0.00–0.05.
		const dists = hits.distances[0] ?? [];
		const sims = dists.map((d) => (d != null ? 1 - d : -Infinity));
		const maxSim = Math.max(...sims);
		expect(maxSim).toBeLessThan(0.3);
	});

	it("migrates all drawers and stamps metadata", async () => {
		const embedder = getDefaultEmbedder();
		await embedder.warmup();

		const result = await migrateCollectionEmbeddings(col, embedder, {
			batchSize: 2,
		});

		expect(result.total).toBe(drawers.length);
		expect(result.updated).toBe(drawers.length);
		expect(result.skipped).toBe(0);

		const after = (await col.get({
			ids: drawers.map((d) => d.id),
			// biome-ignore lint/suspicious/noExplicitAny: chroma include enum
			include: ["metadatas"] as any,
		})) as { metadatas: (Record<string, unknown> | null)[] };
		for (const meta of after.metadatas) {
			expect(meta?.embedding_model).toBe(EMBEDDING_MODEL_TAG);
			expect(typeof meta?.embedded_at).toBe("string");
			// Original fields preserved
			expect(meta?.wing).toBe("integration");
		}
	}, 30000);

	it("semantic search finds the right drawer after migration", async () => {
		const hits = (await col.query({
			queryTexts: ["moved the backend to TypeScript"],
			nResults: 1,
		})) as { ids: string[][]; distances: (number | null)[][] };

		const topId = hits.ids[0]?.[0];
		const topDist = hits.distances[0]?.[0];
		const topSim = topDist != null ? 1 - topDist : -Infinity;

		expect(topId).toBe("d1");
		expect(topSim).toBeGreaterThan(0.3);
	});

	it("rerun with --resume skips already-tagged drawers", async () => {
		const embedder = getDefaultEmbedder();
		const result = await migrateCollectionEmbeddings(col, embedder, {
			batchSize: 2,
			resume: true,
		});
		expect(result.total).toBe(drawers.length);
		expect(result.updated).toBe(0);
		expect(result.skipped).toBe(drawers.length);
	});
});
