import { existsSync } from "node:fs";
import type { InferenceSession, Tensor } from "onnxruntime-node";
import { BertTokenizer } from "./tokenizer.js";

export interface EmbedderConfig {
	modelPath: string;
	vocabPath: string;
	maxLen?: number;
}

export const EMBEDDING_DIM = 384;

type OrtModule = typeof import("onnxruntime-node");

export class MiniLMEmbedder {
	private readonly config: EmbedderConfig;
	private readonly tokenizer: BertTokenizer;
	private session: InferenceSession | null = null;
	private ort: OrtModule | null = null;

	constructor(config: EmbedderConfig) {
		this.config = config;
		this.tokenizer = BertTokenizer.fromVocabFile(config.vocabPath, {
			maxLen: config.maxLen ?? 256,
		});
	}

	get dimensions(): number {
		return EMBEDDING_DIM;
	}

	async warmup(): Promise<void> {
		await this.ensureSession();
	}

	async embed(texts: string[]): Promise<number[][]> {
		if (texts.length === 0) return [];

		const session = await this.ensureSession();
		const ort = this.ort!;

		const { inputIds, attentionMask, tokenTypeIds, shape } =
			this.tokenizer.encodeBatch(texts);

		const feeds: Record<string, Tensor> = {
			input_ids: new ort.Tensor("int64", inputIds, shape),
			attention_mask: new ort.Tensor("int64", attentionMask, shape),
			token_type_ids: new ort.Tensor("int64", tokenTypeIds, shape),
		};

		const filteredFeeds: Record<string, Tensor> = {};
		for (const name of session.inputNames) {
			const feed = feeds[name];
			if (feed) filteredFeeds[name] = feed;
		}

		const results = await session.run(filteredFeeds);
		const outputName = session.outputNames[0]!;
		const output = results[outputName];
		if (!output)
			throw new Error(`ONNX model produced no output named ${outputName}`);

		const data = output.data as Float32Array;
		const dims = output.dims as readonly number[];
		if (dims.length !== 3) {
			throw new Error(
				`Expected 3-D output [batch, seq, hidden], got dims=[${dims.join(",")}]`,
			);
		}
		const [batch, seqLen, hidden] = dims as [number, number, number];

		const embeddings: number[][] = [];
		for (let b = 0; b < batch; b++) {
			const pooled = new Float32Array(hidden);
			let maskSum = 0;
			for (let s = 0; s < seqLen; s++) {
				if (Number(attentionMask[b * seqLen + s]) === 0) continue;
				maskSum++;
				const offset = (b * seqLen + s) * hidden;
				for (let h = 0; h < hidden; h++) pooled[h]! += data[offset + h]!;
			}
			if (maskSum > 0) {
				for (let h = 0; h < hidden; h++) pooled[h]! /= maskSum;
			}

			let norm = 0;
			for (let h = 0; h < hidden; h++) norm += pooled[h]! * pooled[h]!;
			norm = Math.sqrt(norm) || 1;

			const vec = new Array<number>(hidden);
			for (let h = 0; h < hidden; h++) vec[h] = pooled[h]! / norm;
			embeddings.push(vec);
		}

		return embeddings;
	}

	private async ensureSession(): Promise<InferenceSession> {
		if (this.session) return this.session;
		if (!existsSync(this.config.modelPath)) {
			throw new Error(
				`Model file not found at ${this.config.modelPath}. Run: bun scripts/download-model.ts`,
			);
		}
		const ort = await import("onnxruntime-node");
		this.ort = ort;
		this.session = await ort.InferenceSession.create(this.config.modelPath, {
			executionProviders: ["cpu"],
			graphOptimizationLevel: "all",
		});
		return this.session;
	}
}
