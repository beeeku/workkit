// @ts-nocheck — Mock implementation uses loose typing intentionally
/* eslint-disable */

interface MockD1Meta {
	changed_db: boolean;
	changes: number;
	duration: number;
	last_row_id: number;
	rows_read: number;
	rows_written: number;
	size_after: number;
}

function mockMeta(overrides?: Partial<MockD1Meta>): MockD1Meta {
	return {
		changed_db: false,
		changes: 0,
		duration: 0.1,
		last_row_id: 0,
		rows_read: 0,
		rows_written: 0,
		size_after: 0,
		...overrides,
	};
}

interface TableData {
	rows: Record<string, unknown>[];
	autoIncrement: number;
}

/**
 * In-memory D1Database mock for unit testing.
 * Supports basic SQL: SELECT, INSERT, UPDATE, DELETE, CREATE TABLE, DROP TABLE.
 */
export function createMockD1(
	initialTables?: Record<string, Record<string, unknown>[]>,
): D1Database {
	const tables = new Map<string, TableData>();

	if (initialTables) {
		for (const [name, rows] of Object.entries(initialTables)) {
			tables.set(name, { rows: [...rows], autoIncrement: rows.length + 1 });
		}
	}

	function getOrCreateTable(name: string): TableData {
		if (!tables.has(name)) {
			tables.set(name, { rows: [], autoIncrement: 1 });
		}
		return tables.get(name)!;
	}

	function executeSQL(
		sql: string,
		params: unknown[],
	): { results: Record<string, unknown>[]; meta: MockD1Meta } {
		const trimmed = sql.trim();

		if (/^CREATE\s+TABLE/i.test(trimmed)) {
			const match = trimmed.match(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?["`]?(\w+)["`]?/i);
			if (match) getOrCreateTable(match[1]);
			return { results: [], meta: mockMeta({ changed_db: true }) };
		}

		if (/^CREATE\s+(UNIQUE\s+)?INDEX/i.test(trimmed)) {
			return { results: [], meta: mockMeta({ changed_db: true }) };
		}

		if (/^INSERT\s+INTO/i.test(trimmed)) return executeInsert(trimmed, params);
		if (/^SELECT/i.test(trimmed)) return executeSelect(trimmed, params);
		if (/^UPDATE/i.test(trimmed)) return executeUpdate(trimmed, params);
		if (/^DELETE\s+FROM/i.test(trimmed)) return executeDelete(trimmed, params);

		if (/^DROP\s+TABLE/i.test(trimmed)) {
			const match = trimmed.match(/DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?["`]?(\w+)["`]?/i);
			if (match) tables.delete(match[1]);
			return { results: [], meta: mockMeta({ changed_db: true }) };
		}

		return { results: [], meta: mockMeta() };
	}

	function executeInsert(
		sql: string,
		params: unknown[],
	): { results: Record<string, unknown>[]; meta: MockD1Meta } {
		const tableMatch = sql.match(/INSERT\s+(?:OR\s+\w+\s+)?INTO\s+["`]?(\w+)["`]?/i);
		if (!tableMatch) throw new Error(`Could not parse INSERT: ${sql}`);
		const table = getOrCreateTable(tableMatch[1]);

		const colsMatch = sql.match(/\(([^)]+)\)\s*VALUES/i);
		if (!colsMatch) throw new Error(`Could not parse columns in INSERT: ${sql}`);
		const columns = colsMatch[1].split(",").map((c) => c.trim().replace(/["`]/g, ""));

		const valuesSection = sql.slice(sql.indexOf("VALUES") + 6);
		const groups = valuesSection.match(/\([^)]*\)/g) || [];

		const insertedRows: Record<string, unknown>[] = [];
		let paramIdx = 0;

		for (const _group of groups) {
			const row: Record<string, unknown> = { id: table.autoIncrement++ };
			for (const col of columns) {
				if (col === "id") {
					row.id = params[paramIdx++] ?? row.id;
				} else {
					row[col] = params[paramIdx++] ?? null;
				}
			}
			table.rows.push(row);
			insertedRows.push(row);
		}

		if (/RETURNING/i.test(sql)) {
			return {
				results: insertedRows,
				meta: mockMeta({
					changed_db: true,
					changes: insertedRows.length,
					last_row_id: (insertedRows[insertedRows.length - 1]?.id as number) ?? 0,
					rows_written: insertedRows.length,
				}),
			};
		}

		return {
			results: [],
			meta: mockMeta({
				changed_db: true,
				changes: insertedRows.length,
				last_row_id: (insertedRows[insertedRows.length - 1]?.id as number) ?? 0,
				rows_written: insertedRows.length,
			}),
		};
	}

	function executeSelect(
		sql: string,
		params: unknown[],
	): { results: Record<string, unknown>[]; meta: MockD1Meta } {
		const isCount = /SELECT\s+COUNT\(\*\)\s+as\s+count/i.test(sql);

		const fromMatch = sql.match(/FROM\s+["`]?(\w+)["`]?/i);
		if (!fromMatch) throw new Error(`Could not parse FROM in SELECT: ${sql}`);
		const tableName = fromMatch[1];
		const table = tables.get(tableName);
		if (!table) throw new Error(`no such table: ${tableName}`);

		let results = [...table.rows];
		results = applyWhere(results, sql, params);

		const orderMatch = sql.match(/ORDER\s+BY\s+["`]?(\w+)["`]?\s*(ASC|DESC)?/i);
		if (orderMatch) {
			const col = orderMatch[1];
			const dir = (orderMatch[2] || "ASC").toUpperCase();
			results.sort((a, b) => {
				const av = a[col];
				const bv = b[col];
				if (av == null && bv == null) return 0;
				if (av == null) return dir === "ASC" ? -1 : 1;
				if (bv == null) return dir === "ASC" ? 1 : -1;
				if (av < bv) return dir === "ASC" ? -1 : 1;
				if (av > bv) return dir === "ASC" ? 1 : -1;
				return 0;
			});
		}

		const limitMatch = sql.match(/LIMIT\s+\?/i);
		const offsetMatch = sql.match(/OFFSET\s+\?/i);

		let paramIdx = countWhereParams(sql);
		if (limitMatch) {
			const limit = params[paramIdx++] as number;
			if (offsetMatch) {
				const offset = params[paramIdx++] as number;
				results = results.slice(offset, offset + limit);
			} else {
				results = results.slice(0, limit);
			}
		}

		const colMatch = sql.match(/SELECT\s+(.*?)\s+FROM/i);
		if (colMatch && colMatch[1].trim() !== "*" && !isCount) {
			const cols = colMatch[1].split(",").map((c) => c.trim().replace(/["`]/g, ""));
			results = results.map((row) => {
				const filtered: Record<string, unknown> = {};
				for (const col of cols) {
					if (col in row) filtered[col] = row[col];
				}
				return filtered;
			});
		}

		if (isCount) {
			return {
				results: [{ count: results.length }],
				meta: mockMeta({ rows_read: results.length }),
			};
		}

		return { results, meta: mockMeta({ rows_read: results.length }) };
	}

	function executeUpdate(
		sql: string,
		params: unknown[],
	): { results: Record<string, unknown>[]; meta: MockD1Meta } {
		const tableMatch = sql.match(/UPDATE\s+["`]?(\w+)["`]?/i);
		if (!tableMatch) throw new Error(`Could not parse UPDATE: ${sql}`);
		const table = tables.get(tableMatch[1]);
		if (!table) throw new Error(`no such table: ${tableMatch[1]}`);

		const setMatch = sql.match(/SET\s+(.*?)(?:\s+WHERE|RETURNING|$)/i);
		if (!setMatch) throw new Error(`Could not parse SET in UPDATE: ${sql}`);
		const setCols = setMatch[1]
			.split(",")
			.map((s) => s.trim().split("=")[0].trim().replace(/["`]/g, ""));

		let paramIdx = 0;
		const setValues: Record<string, unknown> = {};
		for (const col of setCols) {
			setValues[col] = params[paramIdx++];
		}

		const remaining = params.slice(paramIdx);
		const matches = applyWhere(table.rows, sql, remaining);

		const matchIds = new Set(matches.map((r) => JSON.stringify(r)));
		let changes = 0;
		const updatedRows: Record<string, unknown>[] = [];
		for (const row of table.rows) {
			if (matchIds.has(JSON.stringify(row))) {
				Object.assign(row, setValues);
				changes++;
				updatedRows.push(row);
			}
		}

		if (/RETURNING/i.test(sql)) {
			return {
				results: updatedRows,
				meta: mockMeta({ changed_db: changes > 0, changes, rows_written: changes }),
			};
		}

		return {
			results: [],
			meta: mockMeta({ changed_db: changes > 0, changes, rows_written: changes }),
		};
	}

	function executeDelete(
		sql: string,
		params: unknown[],
	): { results: Record<string, unknown>[]; meta: MockD1Meta } {
		const tableMatch = sql.match(/DELETE\s+FROM\s+["`]?(\w+)["`]?/i);
		if (!tableMatch) throw new Error(`Could not parse DELETE: ${sql}`);
		const table = tables.get(tableMatch[1]);
		if (!table) throw new Error(`no such table: ${tableMatch[1]}`);

		const matches = applyWhere(table.rows, sql, params);
		const matchSet = new Set(matches.map((r) => JSON.stringify(r)));

		const deleted = table.rows.filter((r) => matchSet.has(JSON.stringify(r)));
		table.rows = table.rows.filter((r) => !matchSet.has(JSON.stringify(r)));

		if (/RETURNING/i.test(sql)) {
			return {
				results: deleted,
				meta: mockMeta({
					changed_db: deleted.length > 0,
					changes: deleted.length,
					rows_written: deleted.length,
				}),
			};
		}

		return {
			results: [],
			meta: mockMeta({
				changed_db: deleted.length > 0,
				changes: deleted.length,
				rows_written: deleted.length,
			}),
		};
	}

	interface ParsedCondition {
		column: string;
		operator: string;
		joiner: "AND" | "OR";
		isNull: boolean;
		isNotNull: boolean;
		inCount?: number;
		betweenFlag?: boolean;
	}

	function applyWhere(
		rows: Record<string, unknown>[],
		sql: string,
		params: unknown[],
	): Record<string, unknown>[] {
		const whereMatch = sql.match(
			/WHERE\s+(.*?)(?:\s+ORDER|\s+LIMIT|\s+GROUP|\s+HAVING|\s+RETURNING|$)/i,
		);
		if (!whereMatch) return rows;

		const whereClause = whereMatch[1].trim();
		const conditions = parseWhereConditions(whereClause);

		const resolvedConditions: Array<ParsedCondition & { values: unknown[] }> = [];
		let paramIdx = 0;
		for (const cond of conditions) {
			let values: unknown[] = [];
			if (cond.isNull || cond.isNotNull) {
				// no params
			} else if (cond.inCount && cond.inCount > 0) {
				values = params.slice(paramIdx, paramIdx + cond.inCount);
				paramIdx += cond.inCount;
			} else if (cond.betweenFlag) {
				values = [params[paramIdx++], params[paramIdx++]];
			} else {
				values = [params[paramIdx++]];
			}
			resolvedConditions.push({ ...cond, values });
		}

		return rows.filter((row) => {
			let result = true;
			for (const rc of resolvedConditions) {
				let match: boolean;

				if (rc.isNull) {
					match = row[rc.column] === null || row[rc.column] === undefined;
				} else if (rc.isNotNull) {
					match = row[rc.column] !== null && row[rc.column] !== undefined;
				} else if (rc.inCount && rc.inCount > 0) {
					match =
						rc.operator === "NOT IN"
							? !rc.values.includes(row[rc.column])
							: rc.values.includes(row[rc.column]);
				} else if (rc.betweenFlag) {
					match =
						(row[rc.column] as any) >= (rc.values[0] as any) &&
						(row[rc.column] as any) <= (rc.values[1] as any);
				} else {
					const val = rc.values[0];
					switch (rc.operator) {
						case "=":
							match = row[rc.column] === val;
							break;
						case "!=":
							match = row[rc.column] !== val;
							break;
						case ">":
							match = (row[rc.column] as any) > (val as any);
							break;
						case "<":
							match = (row[rc.column] as any) < (val as any);
							break;
						case ">=":
							match = (row[rc.column] as any) >= (val as any);
							break;
						case "<=":
							match = (row[rc.column] as any) <= (val as any);
							break;
						case "LIKE": {
							const pattern = String(val).replace(/%/g, ".*").replace(/_/g, ".");
							match = new RegExp(`^${pattern}$`, "i").test(String(row[rc.column]));
							break;
						}
						case "NOT LIKE": {
							const pattern2 = String(val).replace(/%/g, ".*").replace(/_/g, ".");
							match = !new RegExp(`^${pattern2}$`, "i").test(String(row[rc.column]));
							break;
						}
						default:
							match = row[rc.column] === val;
					}
				}

				if (rc.joiner === "OR") {
					result = result || match;
				} else {
					result = result && match;
				}
			}
			return result;
		});
	}

	function parseWhereConditions(whereClause: string): ParsedCondition[] {
		const conditions: ParsedCondition[] = [];
		// First extract IN/NOT IN clauses and replace with placeholders to protect their parentheses
		const inClauses: string[] = [];
		let clause = whereClause.replace(/\b(\w+)\s+(NOT\s+IN|IN)\s*\(([^)]*)\)/gi, (match) => {
			inClauses.push(match);
			return `__IN_PLACEHOLDER_${inClauses.length - 1}__`;
		});
		// Now safe to strip wrapping parens around individual conditions
		clause = clause.replace(/\(([^()]+)\)/g, "$1");
		// Also protect BETWEEN ... AND ... from being split on AND
		const betweenClauses: string[] = [];
		clause = clause.replace(/\b(\w+)\s+BETWEEN\s+\?\s+AND\s+\?/gi, (match) => {
			betweenClauses.push(match);
			return `__BETWEEN_PLACEHOLDER_${betweenClauses.length - 1}__`;
		});
		// Restore IN clauses
		clause = clause.replace(
			/__IN_PLACEHOLDER_(\d+)__/g,
			(_, idx) => inClauses[Number.parseInt(idx)],
		);
		const tokens = clause.split(/\s+(AND|OR)\s+/i);
		// Restore BETWEEN clauses in each token
		for (let i = 0; i < tokens.length; i++) {
			tokens[i] = tokens[i].replace(
				/__BETWEEN_PLACEHOLDER_(\d+)__/g,
				(_, idx) => betweenClauses[Number.parseInt(idx)],
			);
		}

		const parts: { sql: string; joiner: "AND" | "OR" }[] = [];
		for (let i = 0; i < tokens.length; i++) {
			if (/^(AND|OR)$/i.test(tokens[i])) continue;
			const joiner = i > 0 && /^OR$/i.test(tokens[i - 1]) ? ("OR" as const) : ("AND" as const);
			parts.push({ sql: tokens[i].trim(), joiner });
		}

		for (const part of parts) {
			const sql = part.sql.trim();

			const isNotNullMatch = sql.match(/["`]?(\w+)["`]?\s+IS\s+NOT\s+NULL/i);
			if (isNotNullMatch) {
				conditions.push({
					column: isNotNullMatch[1],
					operator: "IS NOT NULL",
					joiner: part.joiner,
					isNull: false,
					isNotNull: true,
				});
				continue;
			}

			const isNullMatch = sql.match(/["`]?(\w+)["`]?\s+IS\s+NULL/i);
			if (isNullMatch) {
				conditions.push({
					column: isNullMatch[1],
					operator: "IS NULL",
					joiner: part.joiner,
					isNull: true,
					isNotNull: false,
				});
				continue;
			}

			const inMatch = sql.match(/["`]?(\w+)["`]?\s+(NOT\s+IN|IN)\s*\(([^)]*)\)/i);
			if (inMatch) {
				const placeholders = inMatch[3].split(",").filter((p) => p.trim() === "?");
				conditions.push({
					column: inMatch[1],
					operator: inMatch[2].toUpperCase().replace(/\s+/, " "),
					joiner: part.joiner,
					isNull: false,
					isNotNull: false,
					inCount: placeholders.length,
				});
				continue;
			}

			const betweenMatch = sql.match(/["`]?(\w+)["`]?\s+BETWEEN\s+\?\s+AND\s+\?/i);
			if (betweenMatch) {
				conditions.push({
					column: betweenMatch[1],
					operator: "BETWEEN",
					joiner: part.joiner,
					isNull: false,
					isNotNull: false,
					betweenFlag: true,
				});
				continue;
			}

			const compMatch = sql.match(/["`]?(\w+)["`]?\s*(!=|<>|<=|>=|<|>|=|LIKE|NOT\s+LIKE)\s*\?/i);
			if (compMatch) {
				conditions.push({
					column: compMatch[1],
					operator: compMatch[2].toUpperCase().replace(/\s+/g, " "),
					joiner: part.joiner,
					isNull: false,
					isNotNull: false,
				});
			}
		}

		return conditions;
	}

	function countWhereParams(sql: string): number {
		const whereMatch = sql.match(
			/WHERE\s+(.*?)(?:\s+ORDER|\s+LIMIT|\s+GROUP|\s+HAVING|\s+RETURNING|$)/i,
		);
		if (!whereMatch) return 0;
		return (whereMatch[1].match(/\?/g) || []).length;
	}

	function createStatement(sql: string, boundParams?: unknown[]) {
		return {
			bind(...newParams: unknown[]) {
				return createStatement(sql, newParams);
			},
			async first<T = Record<string, unknown>>(colName?: string): Promise<T | null> {
				const result = executeSQL(sql, boundParams ?? []);
				const row = result.results[0] ?? null;
				if (row && colName) return (row as any)[colName] ?? null;
				return row as T | null;
			},
			async all<T = Record<string, unknown>>(): Promise<{
				results: T[];
				success: boolean;
				meta: MockD1Meta;
			}> {
				const result = executeSQL(sql, boundParams ?? []);
				return { results: result.results as T[], success: true, meta: result.meta };
			},
			async run(): Promise<{ success: boolean; meta: MockD1Meta }> {
				const result = executeSQL(sql, boundParams ?? []);
				return { success: true, meta: result.meta };
			},
			async raw<T = unknown[]>(): Promise<T[]> {
				const result = executeSQL(sql, boundParams ?? []);
				return result.results.map((r) => Object.values(r)) as T[];
			},
			_sql: sql,
			_params: boundParams ?? [],
		};
	}

	const db = {
		prepare(sql: string) {
			const stmt = createStatement(sql);
			const originalBind = stmt.bind.bind(stmt);
			stmt.bind = (...params: unknown[]) => {
				const bound = originalBind(...params);
				(bound as any)._sql = sql;
				(bound as any)._params = params;
				return bound;
			};
			return stmt;
		},
		async batch(statements: any[]): Promise<any[]> {
			const results: any[] = [];
			for (const stmt of statements) {
				if (stmt._sql !== undefined) {
					const result = executeSQL(stmt._sql, stmt._params ?? []);
					results.push({ results: result.results, success: true, meta: result.meta });
				} else if (typeof stmt.all === "function") {
					results.push(await stmt.all());
				} else {
					results.push({ results: [], success: true, meta: mockMeta() });
				}
			}
			return results;
		},
		async exec(sql: string): Promise<{ count: number; duration: number }> {
			const statements = sql
				.split(";")
				.map((s) => s.trim())
				.filter((s) => s.length > 0);
			for (const stmt of statements) {
				executeSQL(stmt, []);
			}
			return { count: statements.length, duration: 0.1 };
		},
		dump: async () => new ArrayBuffer(0),
	};

	return db as unknown as D1Database;
}

/**
 * D1 mock that throws on every operation. Useful for testing error handling.
 */
export function createFailingD1(error: Error | string): D1Database {
	const err = typeof error === "string" ? new Error(error) : error;

	const failStmt = {
		bind(..._params: unknown[]) {
			return failStmt;
		},
		first: async () => {
			throw err;
		},
		all: async () => {
			throw err;
		},
		run: async () => {
			throw err;
		},
		raw: async () => {
			throw err;
		},
	};

	return {
		prepare: () => failStmt,
		batch: async () => {
			throw err;
		},
		exec: async () => {
			throw err;
		},
		dump: async () => {
			throw err;
		},
	} as unknown as D1Database;
}
