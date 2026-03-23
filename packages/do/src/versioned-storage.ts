import { ValidationError } from "@workkit/errors";
import type { TypedDurableObjectStorage } from "@workkit/types";
import { typedStorage } from "./storage";
import type { TypedStorageWrapper } from "./types";

const SCHEMA_VERSION_KEY = "__schema_version";

/** A single forward migration step */
export interface Migration {
	from: number;
	to: number;
	migrate: (storage: TypedDurableObjectStorage) => Promise<void>;
}

/** Options for versioned storage */
export interface VersionedStorageOptions<
	_TSchema extends Record<string, unknown> = Record<string, unknown>,
> {
	version: number;
	migrations: Migration[];
}

/**
 * Wraps `typedStorage` with schema version tracking and forward-only migrations.
 *
 * On first use, stores the current version. On subsequent uses, runs any needed
 * migrations sequentially in a transaction. If any migration fails, the entire
 * transaction is rolled back.
 *
 * ```ts
 * const store = await versionedStorage<MySchema>(state.storage, {
 *   version: 3,
 *   migrations: [
 *     { from: 1, to: 2, migrate: async (s) => { ... } },
 *     { from: 2, to: 3, migrate: async (s) => { ... } },
 *   ],
 * })
 * ```
 */
export async function versionedStorage<TSchema extends Record<string, unknown>>(
	raw: TypedDurableObjectStorage,
	options: VersionedStorageOptions<TSchema>,
): Promise<TypedStorageWrapper<TSchema>> {
	const { version: targetVersion, migrations } = options;

	const storedVersion = (await raw.get<number>(SCHEMA_VERSION_KEY)) ?? 1;

	if (storedVersion < targetVersion) {
		// Filter to needed migrations
		const needed = migrations
			.filter((m) => m.from >= storedVersion && m.to <= targetVersion)
			.sort((a, b) => a.from - b.from);

		// Validate contiguous chain
		validateMigrationChain(needed, storedVersion, targetVersion);

		// Run migrations in a transaction
		await raw.transaction(async (txn) => {
			for (const migration of needed) {
				await migration.migrate(txn);
			}
			await txn.put(SCHEMA_VERSION_KEY, targetVersion);
		});
	} else if (storedVersion === 1 && !(await raw.get<number>(SCHEMA_VERSION_KEY))) {
		// Fresh storage — write the version
		await raw.put(SCHEMA_VERSION_KEY, targetVersion);
	}

	return typedStorage<TSchema>(raw);
}

function validateMigrationChain(migrations: Migration[], from: number, to: number): void {
	if (migrations.length === 0 && from < to) {
		throw new ValidationError(`No migrations provided for version ${from} to ${to}`, [
			{ path: ["migrations"], message: `Missing migrations from ${from} to ${to}` },
		]);
	}

	let expected = from;
	for (const migration of migrations) {
		if (migration.from !== expected) {
			throw new ValidationError(
				`Non-contiguous migration chain: expected migration from ${expected}, got from ${migration.from}`,
				[
					{
						path: ["migrations"],
						message: `Gap in migration chain at version ${expected}`,
					},
				],
			);
		}
		expected = migration.to;
	}

	if (expected !== to) {
		throw new ValidationError(
			`Migration chain incomplete: ends at version ${expected}, target is ${to}`,
			[
				{
					path: ["migrations"],
					message: `Chain ends at ${expected}, expected ${to}`,
				},
			],
		);
	}
}
