#!/usr/bin/env bun
import {
	findExistingModel,
	getDefaultEmbedder,
	resolveMemorizeDir,
} from "../src/embed/index.js";

function cosine(a: number[], b: number[]): number {
	let s = 0;
	for (let i = 0; i < a.length; i++) s += a[i]! * b[i]!;
	return s;
}

async function main(): Promise<void> {
	console.log(`memorize dir: ${resolveMemorizeDir()}`);
	const existing = findExistingModel();
	if (!existing) {
		console.error("No model found. Run: bun run embed:download");
		process.exit(1);
	}
	console.log(`using model:  ${existing.modelFile}\n`);

	const embedder = getDefaultEmbedder();

	const sentences = [
		"We decided to use Bun for performance",
		"Chose Bun because of perf",
		"auth rewrite is the priority",
		"auth rewrite is not the priority",
		"The weather is nice today",
	];

	console.log("Warming up ONNX session...");
	const w0 = Date.now();
	await embedder.warmup();
	console.log(`  session ready in ${Date.now() - w0}ms\n`);

	const t0 = Date.now();
	const vecs = await embedder.embed(sentences);
	const t1 = Date.now();

	console.log(`Embedded ${sentences.length} sentences in ${t1 - t0}ms`);
	console.log(`Dim: ${vecs[0]!.length}`);
	console.log(
		`Sample (first 5 of vec[0]): [${vecs[0]!
			.slice(0, 5)
			.map((v) => v.toFixed(4))
			.join(", ")}]\n`,
	);

	console.log("Pairwise cosine similarities:");
	for (let i = 0; i < sentences.length; i++) {
		for (let j = i + 1; j < sentences.length; j++) {
			const s = cosine(vecs[i]!, vecs[j]!);
			const a =
				sentences[i]!.length > 32
					? `${sentences[i]!.slice(0, 30)}…`
					: sentences[i]!;
			const b =
				sentences[j]!.length > 32
					? `${sentences[j]!.slice(0, 30)}…`
					: sentences[j]!;
			console.log(`  ${s.toFixed(3)}  "${a}"  vs  "${b}"`);
		}
	}

	console.log("\nExpected rough pattern:");
	console.log("  [0]↔[1] high   (paraphrase about Bun)");
	console.log("  [2]↔[3] medium (same topic, opposite polarity)");
	console.log("  [*]↔[4] low    (unrelated weather sentence)");
}

main().catch((err: unknown) => {
	console.error("Smoke test failed:", err);
	process.exit(1);
});
