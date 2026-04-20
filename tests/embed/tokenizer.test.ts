import { beforeAll, describe, expect, it } from "bun:test";
import { BertTokenizer, findExistingModel } from "../../src/embed/index.js";

const existing = findExistingModel();
const describeIfVocab = existing ? describe : describe.skip;

if (!existing) {
	console.warn(
		"[tokenizer.test] model/vocab missing in project or global .memorize/; skipping. Run: bun run embed:download",
	);
}

describeIfVocab("BertTokenizer", () => {
	let tok: BertTokenizer;

	beforeAll(() => {
		tok = BertTokenizer.fromVocabFile(existing!.vocabFile);
	});

	it("loads a BERT-sized vocab", () => {
		expect(tok.vocabSize).toBeGreaterThan(30000);
	});

	it("has canonical special-token IDs", () => {
		const { padId, unkId, clsId, sepId } = tok.specialTokens;
		expect(padId).toBe(0);
		expect(unkId).toBe(100);
		expect(clsId).toBe(101);
		expect(sepId).toBe(102);
	});

	it("tokenizes simple ASCII", () => {
		expect(tok.tokenize("hello world")).toEqual(["hello", "world"]);
	});

	it("lowercases input", () => {
		expect(tok.tokenize("HELLO")).toEqual(["hello"]);
	});

	it("strips accents", () => {
		expect(tok.tokenize("café")).toEqual(["cafe"]);
	});

	it("splits on punctuation", () => {
		expect(tok.tokenize("don't")).toEqual(["don", "'", "t"]);
	});

	it("breaks rare compounds into WordPiece subwords", () => {
		const tokens = tok.tokenize("tokenization");
		expect(tokens.length).toBeGreaterThan(0);
		for (const t of tokens.slice(1)) expect(t.startsWith("##")).toBe(true);
	});

	it("wraps encoded sequence with [CLS] and [SEP]", () => {
		const { inputIds } = tok.encode("hello");
		expect(Number(inputIds[0])).toBe(101);
		expect(Number(inputIds[inputIds.length - 1])).toBe(102);
	});

	it("fills attention mask with 1s for real tokens", () => {
		const { attentionMask } = tok.encode("hello world");
		for (let i = 0; i < attentionMask.length; i++) {
			expect(Number(attentionMask[i])).toBe(1);
		}
	});

	it("pads shorter sequences when batching", () => {
		const batch = tok.encodeBatch(["hi", "hello world how are you friends"]);
		const [b, len] = batch.shape;
		expect(b).toBe(2);
		expect(len).toBeGreaterThan(0);

		let firstOnes = 0;
		let secondOnes = 0;
		for (let i = 0; i < len; i++) {
			firstOnes += Number(batch.attentionMask[i]);
			secondOnes += Number(batch.attentionMask[len + i]);
		}
		expect(firstOnes).toBeLessThan(secondOnes);

		// Pad slots are filled with PAD id
		const lastMaskFirst = Number(batch.attentionMask[len - 1]);
		if (lastMaskFirst === 0) {
			expect(Number(batch.inputIds[len - 1])).toBe(0);
		}
	});

	it("truncates beyond maxLen (including CLS/SEP)", () => {
		const short = BertTokenizer.fromVocabFile(existing!.vocabFile, {
			maxLen: 10,
		});
		const { inputIds } = short.encode("word ".repeat(50));
		expect(inputIds.length).toBeLessThanOrEqual(10);
		expect(Number(inputIds[inputIds.length - 1])).toBe(102);
	});

	it("falls back to [UNK] for pathologically long words", () => {
		const tokens = tok.tokenize("a".repeat(200));
		expect(tokens).toContain("[UNK]");
	});

	it("encodes empty string as just [CLS] [SEP]", () => {
		const { inputIds } = tok.encode("");
		expect(inputIds.length).toBe(2);
		expect(Number(inputIds[0])).toBe(101);
		expect(Number(inputIds[1])).toBe(102);
	});

	it("handles empty batch", () => {
		const batch = tok.encodeBatch([]);
		expect(batch.shape).toEqual([0, 0]);
		expect(batch.inputIds.length).toBe(0);
	});

	it("produces identical output across calls (deterministic)", () => {
		const a = tok.encode("the quick brown fox jumps over the lazy dog");
		const b = tok.encode("the quick brown fox jumps over the lazy dog");
		expect(Array.from(a.inputIds).map(String)).toEqual(
			Array.from(b.inputIds).map(String),
		);
	});
});
