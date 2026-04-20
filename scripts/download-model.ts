#!/usr/bin/env bun
import {
	createWriteStream,
	existsSync,
	mkdirSync,
	statSync,
	unlinkSync,
} from "node:fs";
import { dirname } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import {
	MODEL_DIR,
	MODEL_FILE,
	resolveMemorizeDir,
	VOCAB_FILE,
} from "../src/embed/index.js";

// Xenova/all-MiniLM-L6-v2 is the transformers.js-packaged fork of
// sentence-transformers/all-MiniLM-L6-v2 and is the one that actually ships
// onnx/model_quantized.onnx at a stable path.
const HF_BASE = "https://huggingface.co/Xenova/all-MiniLM-L6-v2/resolve/main";

interface ModelFile {
	label: string;
	url: string;
	dest: string;
	approxBytes: number;
}

const FILES: ModelFile[] = [
	{
		label: "model_quantized.onnx",
		url: `${HF_BASE}/onnx/model_quantized.onnx`,
		dest: MODEL_FILE,
		approxBytes: 22_900_000,
	},
	{
		label: "vocab.txt",
		url: `${HF_BASE}/vocab.txt`,
		dest: VOCAB_FILE,
		approxBytes: 231_000,
	},
];

async function download(url: string, dest: string): Promise<void> {
	mkdirSync(dirname(dest), { recursive: true });
	const tmp = `${dest}.part`;
	if (existsSync(tmp)) unlinkSync(tmp);

	const res = await fetch(url);
	if (!res.ok)
		throw new Error(`Fetch ${url} failed: ${res.status} ${res.statusText}`);
	if (!res.body) throw new Error(`Fetch ${url} returned empty body`);

	const stream = Readable.fromWeb(res.body as never);
	await pipeline(stream, createWriteStream(tmp));

	if (existsSync(dest)) unlinkSync(dest);
	const { renameSync } = await import("node:fs");
	renameSync(tmp, dest);
}

function looksValid(file: ModelFile): boolean {
	if (!existsSync(file.dest)) return false;
	const size = statSync(file.dest).size;
	const lowerBound = Math.floor(file.approxBytes * 0.5);
	return size >= lowerBound;
}

async function main(): Promise<void> {
	console.log(`memorize dir: ${resolveMemorizeDir()}`);
	console.log(`model dir:    ${MODEL_DIR}`);
	for (const file of FILES) {
		if (looksValid(file)) {
			console.log(
				`  [ok]       ${file.label} (${statSync(file.dest).size} bytes)`,
			);
			continue;
		}
		const start = Date.now();
		console.log(`  [download] ${file.label} from ${file.url}`);
		await download(file.url, file.dest);
		const size = statSync(file.dest).size;
		console.log(
			`  [done]     ${file.label} — ${size} bytes in ${Date.now() - start}ms`,
		);
	}
	console.log("\nReady. Try:  bun scripts/embed-smoke.ts");
}

main().catch((err: unknown) => {
	console.error("Download failed:", err);
	process.exit(1);
});
