// Note: the `#!/usr/bin/env bun` shebang is injected by tsup at build time
// via the `banner` option — do not add one here, or dist/cli.js ends up with
// two shebangs and fails to parse.
import { parseArgs } from "node:util";
import { mineConvos } from "./convo-miner.js";
import { logger } from "./logger.js";

const { values, positionals } = parseArgs({
	args: Bun.argv.slice(2),
	options: {
		help: { type: "boolean", short: "h" },
		wing: { type: "string", short: "w" },
		agent: { type: "string", short: "a" },
		limit: { type: "string", short: "l" },
		"dry-run": { type: "boolean", short: "d" },
		version: { type: "boolean", short: "v" },
	},
	allowPositionals: true,
});

if (values.help) {
	console.log(`
Usage: memorize mine <directory> [options]

Commands:
  mine <dir>      Ingest conversations from a directory into the palace.

Options:
  -w, --wing <name>     Specify the wing to ingest into (defaults to dir name)
  -a, --agent <name>    Specify the agent name (default: memorize)
  -l, --limit <n>       Limit number of files to process
  -d, --dry-run         Show what would be done without actually mining
  -v, --version         Show version
  -h, --help            Show this help message

Other entry points (invoke with \`bun run\`):
  bun run embed:download   Fetch the local MiniLM model (~23 MB, one-time setup)
  bun run embed:smoke      Sanity-check the embedder end-to-end
  bun run embed:migrate    Re-embed every drawer in the active palace
`);
	process.exit(0);
}

if (values.version) {
	console.log("memorize v0.2.0 (Bun)");
	process.exit(0);
}

const command = positionals[0];
const dir = positionals[1];

if (command === "mine") {
	if (!dir) {
		console.error("Error: Directory required for mine command.");
		process.exit(1);
	}

	const options = {
		wing: values.wing,
		agent: values.agent,
		limit: values.limit ? parseInt(values.limit) : undefined,
		dryRun: values["dry-run"],
	};

	mineConvos(dir, options)
		.then((result) => {
			console.log("\n--- Mining Complete ---");
			console.log(`Files processed: ${result.filesProcessed}`);
			console.log(`Files skipped:   ${result.filesSkipped}`);
			console.log(`Drawers added:   ${result.drawersAdded}`);
			console.log("Room distribution:");
			for (const [room, count] of Object.entries(result.roomCounts)) {
				console.log(`  - ${room}: ${count}`);
			}
		})
		.catch((err) => {
			logger.error("Mining failed", err);
			process.exit(1);
		});
} else {
	console.log("memorize CLI — persistent memory for AI agents");
	console.log('Use "memorize --help" for usage.');
}
