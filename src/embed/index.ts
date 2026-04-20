import { existsSync, lstatSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { IEmbeddingFunction } from "chromadb";
import { MiniLMEmbedder } from "./embedder.js";

export type { EmbedderConfig } from "./embedder.js";
export { EMBEDDING_DIM, MiniLMEmbedder } from "./embedder.js";
export type {
	EncodedBatch,
	EncodedInput,
	TokenizerConfig,
} from "./tokenizer.js";
export { BertTokenizer, SPECIAL_TOKENS } from "./tokenizer.js";

const GLOBAL_MEMORIZE_DIR = join(homedir(), ".memorize");
const MODEL_SUBPATH = join("models", "minilm-l6-v2");

function findProjectMemorizeDir(startDir: string): string | null {
	let cur = startDir;
	while (true) {
		const target = join(cur, ".memorize");
		try {
			if (existsSync(target) && lstatSync(target).isDirectory()) return target;
		} catch {
			// unreadable — keep walking up
		}
		const parent = dirname(cur);
		if (parent === cur) return null;
		cur = parent;
	}
}

/**
 * Resolve the active memorize directory. Mirrors src/config.ts:
 *   1. $MEMORIZE_CONFIG_DIR (lowercase `memorize_CONFIG_DIR` accepted for back-compat)
 *   2. Nearest ancestor .memorize/ walking up from cwd
 *   3. ~/.memorize/
 */
export function resolveMemorizeDir(): string {
	return (
		process.env.MEMORIZE_CONFIG_DIR ??
		process.env.memorize_CONFIG_DIR ??
		findProjectMemorizeDir(process.cwd()) ??
		GLOBAL_MEMORIZE_DIR
	);
}

export interface ModelPaths {
	modelDir: string;
	modelFile: string;
	vocabFile: string;
}

/** Where a fresh download would land — respects project-local .memorize/. */
export function getPreferredModelPaths(): ModelPaths {
	const modelDir = join(resolveMemorizeDir(), MODEL_SUBPATH);
	return {
		modelDir,
		modelFile: join(modelDir, "model_quantized.onnx"),
		vocabFile: join(modelDir, "vocab.txt"),
	};
}

/**
 * First existing model location, searched in order: preferred (project-local
 * or env-override), then global (~/.memorize/). Returns null if neither has
 * both files. This lets a globally-cached model be reused inside project
 * contexts without re-downloading.
 */
export function findExistingModel(): ModelPaths | null {
	const preferred = getPreferredModelPaths();
	if (existsSync(preferred.modelFile) && existsSync(preferred.vocabFile)) {
		return preferred;
	}
	const globalDir = join(GLOBAL_MEMORIZE_DIR, MODEL_SUBPATH);
	if (preferred.modelDir === globalDir) return null;
	const fallback: ModelPaths = {
		modelDir: globalDir,
		modelFile: join(globalDir, "model_quantized.onnx"),
		vocabFile: join(globalDir, "vocab.txt"),
	};
	if (existsSync(fallback.modelFile) && existsSync(fallback.vocabFile)) {
		return fallback;
	}
	return null;
}

// Module-load snapshot of the preferred paths. Kept for callers that want
// constants; for code that needs to react to cwd changes, use the functions.
const _initial = getPreferredModelPaths();
export const MODEL_DIR = _initial.modelDir;
export const MODEL_FILE = _initial.modelFile;
export const VOCAB_FILE = _initial.vocabFile;

let cachedEmbedder: MiniLMEmbedder | null = null;

export function getDefaultEmbedder(): MiniLMEmbedder {
	if (cachedEmbedder) return cachedEmbedder;
	const existing = findExistingModel();
	if (!existing) {
		const preferred = getPreferredModelPaths();
		const globalPath = join(
			GLOBAL_MEMORIZE_DIR,
			MODEL_SUBPATH,
			"model_quantized.onnx",
		);
		const checked =
			preferred.modelDir === join(GLOBAL_MEMORIZE_DIR, MODEL_SUBPATH)
				? `  - ${preferred.modelFile}`
				: `  - ${preferred.modelFile}\n  - ${globalPath}`;
		throw new Error(
			`MiniLM model not found. Checked:\n${checked}\nRun: bun run embed:download`,
		);
	}
	cachedEmbedder = new MiniLMEmbedder({
		modelPath: existing.modelFile,
		vocabPath: existing.vocabFile,
	});
	return cachedEmbedder;
}

export function resetDefaultEmbedder(): void {
	cachedEmbedder = null;
}

export const minilmEmbeddingFunction: IEmbeddingFunction = {
	generate: async (texts: string[]) => getDefaultEmbedder().embed(texts),
};
