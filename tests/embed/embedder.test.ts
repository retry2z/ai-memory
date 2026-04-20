import { beforeAll, describe, expect, it } from "bun:test";
import {
	EMBEDDING_DIM,
	findExistingModel,
	MiniLMEmbedder,
} from "../../src/embed/index.js";

const existing = findExistingModel();
const describeIfAssets = existing ? describe : describe.skip;

if (!existing) {
	console.warn(
		"[embedder.test] model/vocab missing in project or global .memorize/; skipping. Run: bun run embed:download",
	);
}

function cosine(a: number[], b: number[]): number {
	let s = 0;
	for (let i = 0; i < a.length; i++) s += a[i]! * b[i]!;
	return s;
}

describeIfAssets("MiniLMEmbedder", () => {
	let embedder: MiniLMEmbedder;

	beforeAll(async () => {
		embedder = new MiniLMEmbedder({
			modelPath: existing!.modelFile,
			vocabPath: existing!.vocabFile,
		});
		await embedder.warmup();
	});

	it("returns 384-dim vectors", async () => {
		const [vec] = await embedder.embed(["hello world"]);
		expect(vec).toBeDefined();
		expect(vec!.length).toBe(EMBEDDING_DIM);
	});

	it("returns L2-normalized vectors", async () => {
		const [vec] = await embedder.embed(["the quick brown fox"]);
		const norm = Math.sqrt(vec!.reduce((s, v) => s + v * v, 0));
		expect(norm).toBeCloseTo(1.0, 3);
	});

	it("ranks paraphrases higher than unrelated sentences", async () => {
		const [a, b, c] = await embedder.embed([
			"We decided to use Bun for performance",
			"Chose Bun because of perf",
			"The weather is nice today",
		]);
		const paraphrase = cosine(a!, b!);
		const unrelated = cosine(a!, c!);
		expect(paraphrase).toBeGreaterThan(unrelated);
		expect(paraphrase).toBeGreaterThan(0.55);
		expect(unrelated).toBeLessThan(0.5);
	});

	it("produces non-identical vectors for negated sentences", async () => {
		// MiniLM is known to collapse negation heavily (the "negation problem").
		// We can't expect strong separation — just that the vectors aren't bit-identical.
		const [a, b] = await embedder.embed([
			"auth rewrite is the priority",
			"auth rewrite is not the priority",
		]);
		const sim = cosine(a!, b!);
		expect(sim).toBeLessThan(0.999);
		expect(sim).toBeGreaterThan(0.8);
	});

	it("embeds a batch consistently", async () => {
		const vecs = await embedder.embed(["a", "b", "c", "d"]);
		expect(vecs).toHaveLength(4);
		for (const v of vecs) expect(v.length).toBe(EMBEDDING_DIM);
	});

	it("is deterministic across calls", async () => {
		const [v1] = await embedder.embed(["stable test sentence"]);
		const [v2] = await embedder.embed(["stable test sentence"]);
		expect(cosine(v1!, v2!)).toBeCloseTo(1.0, 5);
	});

	it("handles empty input array without calling the model", async () => {
		const vecs = await embedder.embed([]);
		expect(vecs).toEqual([]);
	});

	it("produces nearly identical vectors for single vs batched inputs", async () => {
		// Quantized INT8 inference drifts slightly across different padding lengths,
		// so we don't expect bit-exactness — just very high similarity.
		const [single] = await embedder.embed(["batching parity check"]);
		const [batched] = await embedder.embed([
			"batching parity check",
			"filler sentence",
		]);
		expect(cosine(single!, batched!)).toBeGreaterThan(0.98);
	});
});
