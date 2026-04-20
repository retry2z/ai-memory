import type { Collection } from "chromadb";

export const EMBEDDING_MODEL_TAG = "minilm-l6-v2";

export interface TextEmbedder {
	embed(texts: string[]): Promise<number[][]>;
	warmup?(): Promise<void>;
}

export interface MigrationOptions {
	batchSize?: number;
	resume?: boolean;
	dryRun?: boolean;
	modelTag?: string;
	onProgress?: (progress: MigrationProgress) => void;
}

export interface MigrationProgress {
	processed: number;
	updated: number;
	skipped: number;
	total: number;
}

export interface MigrationResult extends MigrationProgress {
	durationMs: number;
}

interface ChromaPage {
	ids: string[];
	documents: (string | null)[];
	metadatas: (Record<string, unknown> | null)[];
}

/**
 * Re-embed every drawer in a ChromaDB collection using the supplied embedder,
 * then stamp each drawer's metadata with the model tag so reruns can skip
 * already-migrated entries. Safe to run repeatedly.
 */
export async function migrateCollectionEmbeddings(
	col: Collection,
	embedder: TextEmbedder,
	options: MigrationOptions = {},
): Promise<MigrationResult> {
	const batchSize = options.batchSize ?? 32;
	const resume = options.resume ?? false;
	const dryRun = options.dryRun ?? false;
	const modelTag = options.modelTag ?? EMBEDDING_MODEL_TAG;
	const onProgress = options.onProgress;

	const start = Date.now();
	const total = await col.count();
	const progress: MigrationProgress = {
		processed: 0,
		updated: 0,
		skipped: 0,
		total,
	};

	if (total === 0) {
		return { ...progress, durationMs: Date.now() - start };
	}

	if (embedder.warmup) await embedder.warmup();

	let offset = 0;
	while (offset < total) {
		const page = (await col.get({
			limit: batchSize,
			offset,
			// biome-ignore lint/suspicious/noExplicitAny: chroma's include enum is awkward
			include: ["documents", "metadatas"] as any,
		})) as unknown as ChromaPage;

		if (!page.ids.length) break;

		const targetIds: string[] = [];
		const targetDocs: string[] = [];
		const targetMetas: Record<string, unknown>[] = [];

		for (let i = 0; i < page.ids.length; i++) {
			const id = page.ids[i]!;
			const doc = page.documents[i];
			const meta = (page.metadatas[i] ?? {}) as Record<string, unknown>;
			if (!doc) continue;
			if (resume && meta.embedding_model === modelTag) {
				progress.skipped++;
				continue;
			}
			targetIds.push(id);
			targetDocs.push(doc);
			targetMetas.push(meta);
		}

		if (targetIds.length > 0) {
			const newEmbeddings = await embedder.embed(targetDocs);
			const now = new Date().toISOString();
			const newMetas = targetMetas.map((m) => ({
				...m,
				embedding_model: modelTag,
				embedded_at: now,
			}));

			if (!dryRun) {
				await col.update({
					ids: targetIds,
					documents: targetDocs,
					embeddings: newEmbeddings,
					// biome-ignore lint/suspicious/noExplicitAny: chroma metadata typing is loose
					metadatas: newMetas as any,
				});
			}
			progress.updated += targetIds.length;
		}

		progress.processed += page.ids.length;
		offset += page.ids.length;

		if (onProgress) onProgress({ ...progress });
	}

	return { ...progress, durationMs: Date.now() - start };
}
