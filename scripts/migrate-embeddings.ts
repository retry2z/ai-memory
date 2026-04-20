#!/usr/bin/env bun
import { parseArgs } from "node:util";
import { loadConfig } from "../src/config.js";
import { findExistingModel, getDefaultEmbedder } from "../src/embed/index.js";
import { getCollection } from "../src/storage/chroma.js";
import {
	EMBEDDING_MODEL_TAG,
	migrateCollectionEmbeddings,
} from "../src/storage/migrate.js";

function rate(processed: number, startMs: number): string {
	const secs = (Date.now() - startMs) / 1000;
	if (secs < 0.01) return "—/s";
	return `${(processed / secs).toFixed(1)}/s`;
}

async function main(): Promise<void> {
	const { values } = parseArgs({
		args: Bun.argv.slice(2),
		options: {
			"dry-run": { type: "boolean", short: "d" },
			"batch-size": { type: "string", short: "b" },
			resume: { type: "boolean", short: "r" },
			help: { type: "boolean", short: "h" },
		},
	});

	if (values.help) {
		console.log(`
Usage: bun scripts/migrate-embeddings.ts [options]

Re-embed every drawer in the active ChromaDB collection with the current
MiniLM embedder. Safe to re-run. Required after the hash→MiniLM swap — any
drawer mined before the swap lives in hash vector space and can't be ranked
against MiniLM queries until it's re-embedded.

Options:
  -d, --dry-run          Preview only, no writes
  -b, --batch-size N     Drawers per batch (default: 32)
  -r, --resume           Skip drawers already tagged embedding_model=${EMBEDDING_MODEL_TAG}
  -h, --help             Show this help
`);
		process.exit(0);
	}

	const dryRun = values["dry-run"] ?? false;
	const batchSize = values["batch-size"]
		? Number.parseInt(values["batch-size"], 10)
		: 32;
	const resume = values.resume ?? false;

	if (!findExistingModel()) {
		console.error("Model not downloaded. Run: bun run embed:download");
		process.exit(1);
	}

	const config = await loadConfig();
	console.log(`Palace:     ${config.palacePath}`);
	console.log(`Collection: ${config.collectionName}`);
	console.log(`ChromaURL:  ${config.chromaUrl}`);
	console.log(
		`Mode:       ${dryRun ? "DRY RUN" : "LIVE"}  batch=${batchSize}  resume=${resume}\n`,
	);

	if (config.chromaUrl === "memory" || config.chromaUrl === "mock") {
		console.error(
			"CHROMA_URL is set to mock/memory — nothing persistent to migrate.",
		);
		process.exit(1);
	}

	const col = await getCollection();
	if (!col) {
		console.error(`Could not connect to ChromaDB at ${config.chromaUrl}.`);
		process.exit(1);
	}

	const embedder = getDefaultEmbedder();
	const started = Date.now();

	const result = await migrateCollectionEmbeddings(col, embedder, {
		batchSize,
		resume,
		dryRun,
		onProgress: (p) => {
			const pct = p.total > 0 ? Math.round((p.processed / p.total) * 100) : 0;
			process.stdout.write(
				`\r  [${p.processed}/${p.total} ${pct}%]  updated=${p.updated} skipped=${p.skipped}  ${rate(p.processed, started)}   `,
			);
		},
	});

	process.stdout.write("\n");
	console.log(`\nDone in ${(result.durationMs / 1000).toFixed(1)}s`);
	console.log(
		`  updated=${result.updated}  skipped=${result.skipped}  total=${result.total}`,
	);

	if (dryRun || result.updated === 0) return;

	// Sanity check: search the top hit using a migrated drawer's own content.
	console.log("\nVerifying...");
	const sample = (await col.get({
		limit: 1,
		// biome-ignore lint/suspicious/noExplicitAny: chroma include enum
		include: ["documents"] as any,
	})) as { ids: string[]; documents: (string | null)[] };
	const sampleId = sample.ids[0];
	const sampleDoc = sample.documents[0];
	if (!sampleId || !sampleDoc) {
		console.log("  (no drawers to verify)");
		return;
	}
	const query = sampleDoc.slice(0, 200);
	const hits = (await col.query({ queryTexts: [query], nResults: 1 })) as {
		ids: string[][];
		distances: (number | null)[][];
	};
	const topId = hits.ids[0]?.[0];
	const topDist = hits.distances[0]?.[0];
	if (topId === sampleId) {
		console.log(
			`  ✓ sample drawer is its own top hit (cosine distance=${topDist?.toFixed(4) ?? "n/a"})`,
		);
	} else {
		console.warn(
			`  ⚠ sample drawer ${sampleId} is not the top hit (got ${topId}).`,
		);
	}
}

main().catch((err: unknown) => {
	console.error("Migration failed:", err);
	process.exit(1);
});
