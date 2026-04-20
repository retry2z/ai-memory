import { readFileSync } from "node:fs";

export const SPECIAL_TOKENS = {
	CLS: "[CLS]",
	SEP: "[SEP]",
	PAD: "[PAD]",
	UNK: "[UNK]",
	MASK: "[MASK]",
} as const;

export interface TokenizerConfig {
	doLowerCase: boolean;
	stripAccents: boolean;
	maxLen: number;
}

export interface EncodedInput {
	inputIds: BigInt64Array;
	attentionMask: BigInt64Array;
	tokenTypeIds: BigInt64Array;
}

export interface EncodedBatch extends EncodedInput {
	shape: [number, number];
}

const DEFAULT_CONFIG: TokenizerConfig = {
	doLowerCase: true,
	stripAccents: true,
	maxLen: 256,
};

const MAX_CHARS_PER_WORD = 100;

export class BertTokenizer {
	private readonly vocab: Map<string, number>;
	private readonly config: TokenizerConfig;
	private readonly unkId: number;
	private readonly clsId: number;
	private readonly sepId: number;
	private readonly padId: number;

	constructor(
		vocab: Map<string, number>,
		config: Partial<TokenizerConfig> = {},
	) {
		this.vocab = vocab;
		this.config = { ...DEFAULT_CONFIG, ...config };
		this.unkId = vocab.get(SPECIAL_TOKENS.UNK) ?? 100;
		this.clsId = vocab.get(SPECIAL_TOKENS.CLS) ?? 101;
		this.sepId = vocab.get(SPECIAL_TOKENS.SEP) ?? 102;
		this.padId = vocab.get(SPECIAL_TOKENS.PAD) ?? 0;
	}

	static fromVocabFile(
		path: string,
		config: Partial<TokenizerConfig> = {},
	): BertTokenizer {
		const text = readFileSync(path, "utf-8");
		const vocab = new Map<string, number>();
		const lines = text.split("\n");
		for (let i = 0; i < lines.length; i++) {
			const raw = lines[i];
			if (raw === undefined) continue;
			const token = raw.replace(/\r$/, "");
			// Skip only the trailing empty line if present
			if (i === lines.length - 1 && token.length === 0) continue;
			vocab.set(token, i);
		}
		return new BertTokenizer(vocab, config);
	}

	get vocabSize(): number {
		return this.vocab.size;
	}

	get specialTokens(): {
		clsId: number;
		sepId: number;
		padId: number;
		unkId: number;
	} {
		return {
			clsId: this.clsId,
			sepId: this.sepId,
			padId: this.padId,
			unkId: this.unkId,
		};
	}

	tokenize(text: string): string[] {
		const basic = this.basicTokenize(text);
		const out: string[] = [];
		for (const tok of basic) {
			for (const wp of this.wordpieceTokenize(tok)) out.push(wp);
		}
		return out;
	}

	encode(text: string): EncodedInput {
		const tokens = this.tokenize(text);
		const truncated = tokens.slice(0, this.config.maxLen - 2);
		const len = truncated.length + 2;

		const inputIds = new BigInt64Array(len);
		const attentionMask = new BigInt64Array(len);
		const tokenTypeIds = new BigInt64Array(len);

		inputIds[0] = BigInt(this.clsId);
		attentionMask[0] = 1n;
		for (let i = 0; i < truncated.length; i++) {
			const tok = truncated[i]!;
			inputIds[i + 1] = BigInt(this.vocab.get(tok) ?? this.unkId);
			attentionMask[i + 1] = 1n;
		}
		inputIds[len - 1] = BigInt(this.sepId);
		attentionMask[len - 1] = 1n;

		return { inputIds, attentionMask, tokenTypeIds };
	}

	encodeBatch(texts: string[]): EncodedBatch {
		if (texts.length === 0) {
			return {
				inputIds: new BigInt64Array(0),
				attentionMask: new BigInt64Array(0),
				tokenTypeIds: new BigInt64Array(0),
				shape: [0, 0],
			};
		}

		const encoded = texts.map((t) => this.encode(t));
		const maxLen = encoded.reduce((m, e) => Math.max(m, e.inputIds.length), 0);
		const batchSize = texts.length;
		const total = batchSize * maxLen;

		const inputIds = new BigInt64Array(total);
		const attentionMask = new BigInt64Array(total);
		const tokenTypeIds = new BigInt64Array(total);

		const padBig = BigInt(this.padId);
		for (let b = 0; b < batchSize; b++) {
			const e = encoded[b]!;
			const base = b * maxLen;
			for (let i = 0; i < e.inputIds.length; i++) {
				inputIds[base + i] = e.inputIds[i]!;
				attentionMask[base + i] = e.attentionMask[i]!;
			}
			for (let i = e.inputIds.length; i < maxLen; i++) {
				inputIds[base + i] = padBig;
			}
		}

		return {
			inputIds,
			attentionMask,
			tokenTypeIds,
			shape: [batchSize, maxLen],
		};
	}

	// ── Basic tokenization ────────────────────────────────────────────────────

	private basicTokenize(text: string): string[] {
		const cleaned = this.cleanText(text);
		const spaced = this.padChineseChars(cleaned);
		const pieces = spaced.trim().split(/\s+/).filter(Boolean);
		const out: string[] = [];
		for (let piece of pieces) {
			if (this.config.doLowerCase) piece = piece.toLowerCase();
			if (this.config.stripAccents) piece = stripAccents(piece);
			for (const sub of splitOnPunctuation(piece)) out.push(sub);
		}
		return out;
	}

	private cleanText(text: string): string {
		let out = "";
		for (const c of text) {
			const cp = c.charCodeAt(0);
			if (cp === 0 || cp === 0xfffd || isControl(c)) continue;
			out += isWhitespace(c) ? " " : c;
		}
		return out;
	}

	private padChineseChars(text: string): string {
		let out = "";
		for (const c of text) {
			const cp = c.codePointAt(0)!;
			out += isChineseChar(cp) ? ` ${c} ` : c;
		}
		return out;
	}

	// ── WordPiece ─────────────────────────────────────────────────────────────

	private wordpieceTokenize(token: string): string[] {
		if (token.length > MAX_CHARS_PER_WORD) return [SPECIAL_TOKENS.UNK];
		const chars = [...token];
		const out: string[] = [];
		let start = 0;
		while (start < chars.length) {
			let end = chars.length;
			let match: string | null = null;
			while (start < end) {
				let sub = chars.slice(start, end).join("");
				if (start > 0) sub = `##${sub}`;
				if (this.vocab.has(sub)) {
					match = sub;
					break;
				}
				end--;
			}
			if (match === null) return [SPECIAL_TOKENS.UNK];
			out.push(match);
			start = end;
		}
		return out;
	}
}

// ── Character classification helpers ────────────────────────────────────────

function stripAccents(text: string): string {
	return text.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function isWhitespace(c: string): boolean {
	if (c === " " || c === "\t" || c === "\n" || c === "\r") return true;
	return /\s/.test(c);
}

function isControl(c: string): boolean {
	if (c === "\t" || c === "\n" || c === "\r") return false;
	const cp = c.codePointAt(0)!;
	return cp < 0x20 || (cp >= 0x7f && cp <= 0x9f);
}

function isPunctuation(c: string): boolean {
	const cp = c.codePointAt(0)!;
	if (
		(cp >= 33 && cp <= 47) ||
		(cp >= 58 && cp <= 64) ||
		(cp >= 91 && cp <= 96) ||
		(cp >= 123 && cp <= 126)
	) {
		return true;
	}
	return /[\p{P}\p{S}]/u.test(c);
}

function isChineseChar(cp: number): boolean {
	return (
		(cp >= 0x4e00 && cp <= 0x9fff) ||
		(cp >= 0x3400 && cp <= 0x4dbf) ||
		(cp >= 0x20000 && cp <= 0x2a6df) ||
		(cp >= 0x2a700 && cp <= 0x2b73f) ||
		(cp >= 0x2b740 && cp <= 0x2b81f) ||
		(cp >= 0x2b820 && cp <= 0x2ceaf) ||
		(cp >= 0xf900 && cp <= 0xfaff) ||
		(cp >= 0x2f800 && cp <= 0x2fa1f)
	);
}

function splitOnPunctuation(text: string): string[] {
	const out: string[] = [];
	let current = "";
	for (const c of text) {
		if (isPunctuation(c)) {
			if (current.length > 0) {
				out.push(current);
				current = "";
			}
			out.push(c);
		} else {
			current += c;
		}
	}
	if (current.length > 0) out.push(current);
	return out;
}
