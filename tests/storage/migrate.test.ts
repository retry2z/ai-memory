import { beforeEach, describe, expect, it } from "bun:test";
import type { Collection } from "chromadb";
import { resetConfig } from "../../src/config.js";
import {
	getCollection,
	resetCollectionCache,
} from "../../src/storage/chroma.js";
import {
	EMBEDDING_MODEL_TAG,
	migrateCollectionEmbeddings,
	type TextEmbedder,
} from "../../src/storage/migrate.js";

class StubEmbedder implements TextEmbedder {
	calls: string[][] = [];
	warmupCount = 0;
	async warmup(): Promise<void> {
		this.warmupCount++;
	}
	async embed(texts: string[]): Promise<number[][]> {
		this.calls.push([...texts]);
		return texts.map((_, i) => {
			const v = new Array<number>(8).fill(0);
			v[i % v.length] = 1;
			return v;
		});
	}
}

async function freshCollection(): Promise<Collection> {
	process.env.CHROMA_URL = "memory";
	resetConfig();
	resetCollectionCache();
	const col = await getCollection(true);
	if (!col) throw new Error("mock collection should be available");
	return col;
}

async function seed(
	col: Collection,
	entries: { id: string; doc: string; meta?: Record<string, unknown> }[],
): Promise<void> {
	await col.add({
		ids: entries.map((e) => e.id),
		documents: entries.map((e) => e.doc),
		// biome-ignore lint/suspicious/noExplicitAny: chroma metadata loose typing
		metadatas: entries.map((e) => e.meta ?? {}) as any,
	});
}

describe("migrateCollectionEmbeddings", () => {
	beforeEach(async () => {
		await freshCollection();
	});

	it("returns zero counts for an empty collection and never calls embedder", async () => {
		const col = await freshCollection();
		const embedder = new StubEmbedder();
		const result = await migrateCollectionEmbeddings(col, embedder);
		expect(result.total).toBe(0);
		expect(result.processed).toBe(0);
		expect(result.updated).toBe(0);
		expect(result.skipped).toBe(0);
		expect(embedder.calls).toHaveLength(0);
		expect(embedder.warmupCount).toBe(0);
	});

	it("re-embeds every drawer and stamps metadata with the model tag", async () => {
		const col = await freshCollection();
		await seed(col, [
			{ id: "a", doc: "foo", meta: { wing: "test", room: "x" } },
			{ id: "b", doc: "bar", meta: { wing: "test", room: "y" } },
			{ id: "c", doc: "baz", meta: { wing: "test", room: "z" } },
		]);

		const embedder = new StubEmbedder();
		const result = await migrateCollectionEmbeddings(col, embedder, {
			batchSize: 2,
		});

		expect(result.total).toBe(3);
		expect(result.updated).toBe(3);
		expect(result.skipped).toBe(0);
		expect(embedder.warmupCount).toBe(1);
		expect(embedder.calls).toHaveLength(2);
		expect(embedder.calls[0]).toHaveLength(2);
		expect(embedder.calls[1]).toHaveLength(1);

		// biome-ignore lint/suspicious/noExplicitAny: chroma include enum
		const after = await col.get({
			ids: ["a", "b", "c"],
			include: ["metadatas"] as any,
		});
		for (const meta of after.metadatas) {
			expect(meta?.embedding_model).toBe(EMBEDDING_MODEL_TAG);
			expect(typeof meta?.embedded_at).toBe("string");
		}
	});

	it("preserves pre-existing metadata fields on migrated drawers", async () => {
		const col = await freshCollection();
		await seed(col, [
			{ id: "p", doc: "hi", meta: { wing: "w", room: "r", custom: 42 } },
		]);

		await migrateCollectionEmbeddings(col, new StubEmbedder());

		// biome-ignore lint/suspicious/noExplicitAny: chroma include enum
		const after = await col.get({ ids: ["p"], include: ["metadatas"] as any });
		const meta = after.metadatas[0];
		expect(meta?.wing).toBe("w");
		expect(meta?.room).toBe("r");
		expect(meta?.custom).toBe(42);
		expect(meta?.embedding_model).toBe(EMBEDDING_MODEL_TAG);
	});

	it("skips drawers already tagged when resume=true", async () => {
		const col = await freshCollection();
		await seed(col, [
			{
				id: "already",
				doc: "foo",
				meta: { wing: "a", embedding_model: EMBEDDING_MODEL_TAG },
			},
			{ id: "needs", doc: "bar", meta: { wing: "b" } },
		]);

		const embedder = new StubEmbedder();
		const result = await migrateCollectionEmbeddings(col, embedder, {
			resume: true,
		});

		expect(result.updated).toBe(1);
		expect(result.skipped).toBe(1);
		expect(embedder.calls[0]).toEqual(["bar"]);
	});

	it("without resume, re-embeds everything regardless of tag", async () => {
		const col = await freshCollection();
		await seed(col, [
			{
				id: "tagged",
				doc: "foo",
				meta: { embedding_model: EMBEDDING_MODEL_TAG },
			},
			{ id: "untagged", doc: "bar" },
		]);

		const embedder = new StubEmbedder();
		const result = await migrateCollectionEmbeddings(col, embedder, {
			resume: false,
		});

		expect(result.updated).toBe(2);
		expect(result.skipped).toBe(0);
	});

	it("dry-run calls the embedder but does not persist metadata changes", async () => {
		const col = await freshCollection();
		await seed(col, [{ id: "p", doc: "hello", meta: { wing: "dry" } }]);

		const embedder = new StubEmbedder();
		const result = await migrateCollectionEmbeddings(col, embedder, {
			dryRun: true,
		});

		expect(result.updated).toBe(1);
		expect(embedder.calls[0]).toEqual(["hello"]);

		// biome-ignore lint/suspicious/noExplicitAny: chroma include enum
		const after = await col.get({ ids: ["p"], include: ["metadatas"] as any });
		expect(after.metadatas[0]?.embedding_model).toBeUndefined();
		expect(after.metadatas[0]?.embedded_at).toBeUndefined();
	});

	it("fires onProgress once per batch with monotonically increasing counts", async () => {
		const col = await freshCollection();
		await seed(
			col,
			["a", "b", "c", "d", "e"].map((id) => ({ id, doc: id })),
		);

		const embedder = new StubEmbedder();
		const progressed: number[] = [];
		await migrateCollectionEmbeddings(col, embedder, {
			batchSize: 2,
			onProgress: (p) => progressed.push(p.processed),
		});

		expect(progressed).toEqual([2, 4, 5]);
	});

	it("respects a custom modelTag", async () => {
		const col = await freshCollection();
		await seed(col, [{ id: "x", doc: "foo" }]);

		await migrateCollectionEmbeddings(col, new StubEmbedder(), {
			modelTag: "custom-tag-v1",
		});

		// biome-ignore lint/suspicious/noExplicitAny: chroma include enum
		const after = await col.get({ ids: ["x"], include: ["metadatas"] as any });
		expect(after.metadatas[0]?.embedding_model).toBe("custom-tag-v1");
	});
});
