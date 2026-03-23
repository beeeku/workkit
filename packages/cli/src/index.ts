import { executeCatalog, formatCatalog } from "./commands/catalog";
import { executeCheck } from "./commands/check";
import { executeGenClient } from "./commands/gen-client";
import { executeGenDocs } from "./commands/gen-docs";
import { executeInit, parseFeatures } from "./commands/init";
import type { Template } from "./commands/init";
import { buildMigrationPlan, formatMigrationStatus } from "./commands/migrate";
import { executeSeed } from "./commands/seed";
import { VERSION, bold, createNodeFs, cyan, dim, error, log, parseArgs, success } from "./utils";

const HELP = `
${bold("workkit")} ${dim(`v${VERSION}`)} — Cloudflare Workers utility CLI

${bold("USAGE")}
  workkit <command> [options]

${bold("COMMANDS")}
  ${cyan("init")}             Scaffold a new Workers project
  ${cyan("add")}              Add workkit packages to an existing project
  ${cyan("check")}            Validate bindings against env schema
  ${cyan("d1 migrate")}       Run D1 migrations
  ${cyan("d1 seed")}          Seed D1 from fixture files
  ${cyan("gen client")}       Generate typed API client
  ${cyan("gen docs")}         Generate OpenAPI docs
  ${cyan("catalog")}          Show package catalog

${bold("OPTIONS")}
  --help, -h       Show help
  --version, -v    Show version

${bold("EXAMPLES")}
  workkit init --template hono --features env,d1
  workkit init  ${dim("(interactive mode)")}
  workkit add kv auth
  workkit add  ${dim("(interactive mode)")}
  workkit check
  workkit d1 migrate --dir ./migrations
  workkit d1 seed --file ./seeds/users.json --table users
  workkit gen client ./src/api --output ./src/generated/client.ts
  workkit gen docs ./src/api --output ./docs/openapi.json
  workkit catalog
`;

export async function run(argv: string[]): Promise<void> {
	const { positionals, flags } = parseArgs(argv);

	if (flags.version || flags.v) {
		log(VERSION);
		return;
	}

	if (flags.help || flags.h || positionals.length === 0) {
		log(HELP);
		return;
	}

	const command = positionals[0];
	const subcommand = positionals[1];
	const fs = createNodeFs();
	const cwd = process.cwd();

	try {
		switch (command) {
			case "init": {
				const template = (flags.template as string) ?? (flags.t as string);
				const featuresStr = (flags.features as string) ?? (flags.f as string);
				const name = (flags.name as string) ?? (flags.n as string);
				const dir = (flags.dir as string) ?? undefined;

				// If all required flags are present, use direct mode (backward compat)
				if (template && featuresStr) {
					await executeInit(
						{
							name,
							template: template as Template,
							features: parseFeatures(featuresStr),
							dir: dir ?? cwd,
						},
						fs,
					);
				} else {
					// Interactive mode — pass flags through so provided ones skip prompts
					await executeInit(
						{
							name,
							template: template as Template | undefined,
							features: featuresStr ? parseFeatures(featuresStr) : undefined,
							dir,
						},
						fs,
						flags,
					);
				}
				break;
			}

			case "add": {
				const { executeAdd } = await import("./commands/add");
				const packages = positionals.slice(1);
				const nodeFs = await import("node:fs");
				const result = await executeAdd({ packages, cwd }, nodeFs);
				if (result.added.length > 0) {
					success(`Added: ${result.added.join(", ")}`);
					log("\nRun: bun install");
				}
				break;
			}

			case "check": {
				const dir = positionals[1] ?? cwd;
				const result = await executeCheck(dir, fs);

				if (result.valid) {
					log("All bindings valid.");
				} else {
					for (const err of result.errors) {
						error(err.message);
					}
				}

				for (const w of result.warnings) {
					log(`  Warning: ${w.message}`);
				}

				if (!result.valid) {
					process.exitCode = 1;
				}
				break;
			}

			case "d1": {
				if (subcommand === "migrate") {
					const dir = (flags.dir as string) ?? "./migrations";
					const plan = await buildMigrationPlan({ dir }, fs);
					log(formatMigrationStatus(plan));
				} else if (subcommand === "seed") {
					const file = flags.file as string;
					const table = flags.table as string;

					if (!file || !table) {
						error("Usage: workkit d1 seed --file <path> --table <name>");
						process.exitCode = 1;
						break;
					}

					const result = await executeSeed({ file, table }, fs);
					log(
						`Generated ${result.statements.length} INSERT statements for table "${result.table}"`,
					);
					for (const stmt of result.statements) {
						log(stmt);
					}
				} else {
					error(`Unknown d1 subcommand: ${subcommand}`);
					process.exitCode = 1;
				}
				break;
			}

			case "gen": {
				if (subcommand === "client") {
					const sourceDir = positionals[2] ?? "./src/api";
					const output =
						(flags.output as string) ?? (flags.o as string) ?? "./src/generated/client.ts";
					await executeGenClient({ sourceDir, output }, fs);
					log(`Client generated at ${output}`);
				} else if (subcommand === "docs") {
					const sourceDir = positionals[2] ?? "./src/api";
					const output = (flags.output as string) ?? (flags.o as string) ?? "./docs/openapi.json";
					const title = (flags.title as string) ?? "API";
					const version = (flags.version as string) ?? "0.0.1";
					await executeGenDocs({ sourceDir, output, title, version }, fs);
					log(`OpenAPI spec generated at ${output}`);
				} else {
					error(`Unknown gen subcommand: ${subcommand}`);
					process.exitCode = 1;
				}
				break;
			}

			case "catalog": {
				const dir = positionals[1] ?? cwd;
				const packages = await executeCatalog(dir, fs);
				log(formatCatalog(packages));
				break;
			}

			default:
				error(`Unknown command: ${command}`);
				log(HELP);
				process.exitCode = 1;
		}
	} catch (err) {
		error(err instanceof Error ? err.message : String(err));
		process.exitCode = 1;
	}
}

// CLI entry point
const args = process.argv.slice(2);
run(args).catch((err) => {
	error(err instanceof Error ? err.message : String(err));
	process.exitCode = 1;
});

export { parseArgs, createNodeFs } from "./utils";
export type { ParsedArgs, FileSystem } from "./utils";
