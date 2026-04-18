import type { NotifyD1, NotifyPreparedStatement } from "../src/types";

interface Row {
	[col: string]: unknown;
}

interface Table {
	rows: Row[];
	pk?: string[];
	unique?: string[][];
}

/**
 * Tiny in-memory D1 mock — supports the subset of SQL used by @workkit/notify:
 * CREATE TABLE / INSERT INTO ... VALUES / ON CONFLICT DO UPDATE / DELETE WHERE
 * / UPDATE ... SET ... WHERE / SELECT ... FROM ... WHERE.
 *
 * It is NOT a SQL engine — it parses a known fixed-shape statement set.
 */
export class MemoryD1 implements NotifyD1 {
	tables = new Map<string, Table>();

	prepare(query: string): NotifyPreparedStatement {
		return new MemoryStatement(this, query.trim().replace(/\s+/g, " "), []);
	}

	async batch(_statements: NotifyPreparedStatement[]): Promise<unknown[]> {
		throw new Error("batch not implemented in MemoryD1 mock");
	}
}

class MemoryStatement implements NotifyPreparedStatement {
	constructor(
		private db: MemoryD1,
		private query: string,
		private values: unknown[],
	) {}

	bind(...values: unknown[]): NotifyPreparedStatement {
		return new MemoryStatement(this.db, this.query, values);
	}

	async first<T = Record<string, unknown>>(): Promise<T | null> {
		const rows = this.executeSelect();
		return (rows[0] as T | undefined) ?? null;
	}

	async all<T = Record<string, unknown>>(): Promise<{ results?: T[] }> {
		const rows = this.executeSelect();
		return { results: rows as T[] };
	}

	async run(): Promise<{ success?: boolean; meta?: { changes?: number } }> {
		const q = this.query;
		if (q.startsWith("INSERT INTO ")) return this.executeInsert();
		if (q.startsWith("UPDATE ")) return this.executeUpdate();
		if (q.startsWith("DELETE FROM ")) return this.executeDelete();
		throw new Error(`MemoryD1: unsupported run() query: ${q}`);
	}

	private executeInsert(): { success: boolean; meta: { changes: number } } {
		// "INSERT INTO <name>(col,col)... VALUES (?,?,...) [ON CONFLICT(...) DO UPDATE SET ...]"
		const m = /^INSERT INTO (\w+)\(([^)]+)\) VALUES \(([^)]+)\)(.*)$/.exec(this.query);
		if (!m) throw new Error(`MemoryD1: cannot parse INSERT: ${this.query}`);
		const tableName = m[1]!;
		const cols = m[2]!.split(",").map((s) => s.trim());
		const tail = m[4] ?? "";
		const table = this.ensureTable(tableName);
		const row: Row = {};
		for (let i = 0; i < cols.length; i++) row[cols[i]!] = this.values[i];

		// UNIQUE collisions:
		const collisions = (table.unique ?? []).find(
			(cols) =>
				cols.every((c) => row[c] !== undefined) &&
				table.rows.some((r) => cols.every((c) => r[c] === row[c])),
		);
		if (collisions) {
			// ON CONFLICT DO UPDATE handled below; otherwise throw a UNIQUE-style error.
			const onConflict = /ON CONFLICT\(([^)]+)\) DO UPDATE SET (.+)$/.exec(tail);
			if (onConflict) {
				const conflictCols = onConflict[1]!.split(",").map((s) => s.trim());
				const setExpr = onConflict[2]!;
				const target = table.rows.find((r) => conflictCols.every((c) => r[c] === row[c]));
				if (target) {
					applySet(setExpr, target, row);
					return { success: true, meta: { changes: 1 } };
				}
			}
			const err = new Error(`UNIQUE constraint failed on ${tableName}`);
			throw err;
		}
		// PK collisions (not modeled separately) — same treatment as UNIQUE.
		if (table.pk && table.pk.length > 0) {
			const pkExisting = table.rows.find((r) => table.pk!.every((c) => r[c] === row[c]));
			if (pkExisting) {
				const onConflict = /ON CONFLICT\(([^)]+)\) DO UPDATE SET (.+)$/.exec(tail);
				if (onConflict) {
					applySet(onConflict[2]!, pkExisting, row);
					return { success: true, meta: { changes: 1 } };
				}
				throw new Error(`UNIQUE constraint failed on ${tableName} (pk)`);
			}
		}

		table.rows.push(row);
		return { success: true, meta: { changes: 1 } };
	}

	private executeUpdate(): { success: boolean; meta: { changes: number } } {
		// "UPDATE <name> SET <set-expr> WHERE <where-expr>"
		const m = /^UPDATE (\w+) SET (.+) WHERE (.+)$/.exec(this.query);
		if (!m) throw new Error(`MemoryD1: cannot parse UPDATE: ${this.query}`);
		const table = this.ensureTable(m[1]!);
		const setExpr = m[2]!;
		const whereExpr = m[3]!;
		const setSegs = splitTopLevelCommas(setExpr);
		const setOps: Array<{ col: string; usesParam: boolean; coalesce?: { col: string } }> = [];
		for (const seg of setSegs) {
			const eq = seg.indexOf("=");
			const col = seg.slice(0, eq).trim();
			const rhs = seg.slice(eq + 1).trim();
			const coalesceMatch = /^COALESCE\(\?,\s*(\w+)\)$/.exec(rhs);
			if (coalesceMatch) {
				setOps.push({ col, usesParam: true, coalesce: { col: coalesceMatch[1]! } });
			} else if (rhs === "?") {
				setOps.push({ col, usesParam: true });
			} else {
				throw new Error(`MemoryD1: unsupported SET expression: ${seg}`);
			}
		}
		const whereParts = splitWhere(whereExpr);
		// Values in `this.values`: SET params first (one per setOp.usesParam), then WHERE params.
		const setParamCount = setOps.filter((s) => s.usesParam).length;
		const setValues = this.values.slice(0, setParamCount);
		const whereValues = this.values.slice(setParamCount);

		let changes = 0;
		for (const r of table.rows) {
			if (!matchWhere(r, whereParts, whereValues)) continue;
			let pIdx = 0;
			for (const op of setOps) {
				const incoming = setValues[pIdx++];
				if (op.coalesce) {
					if (incoming !== null && incoming !== undefined) r[op.col] = incoming;
				} else {
					r[op.col] = incoming;
				}
			}
			changes += 1;
		}
		return { success: true, meta: { changes } };
	}

	private executeDelete(): { success: boolean; meta: { changes: number } } {
		const m = /^DELETE FROM (\w+) WHERE (.+)$/.exec(this.query);
		if (!m) throw new Error(`MemoryD1: cannot parse DELETE: ${this.query}`);
		const table = this.ensureTable(m[1]!);
		const whereParts = splitWhere(m[2]!);
		const before = table.rows.length;
		table.rows = table.rows.filter((r) => !matchWhere(r, whereParts, this.values));
		return { success: true, meta: { changes: before - table.rows.length } };
	}

	private executeSelect(): Row[] {
		// "SELECT <cols> FROM <name> WHERE <where> [LIMIT N]"
		const m = /^SELECT (.+?) FROM (\w+)(?: WHERE (.+?))?(?: LIMIT (\d+))?$/i.exec(this.query);
		if (!m) throw new Error(`MemoryD1: cannot parse SELECT: ${this.query}`);
		const colsExpr = m[1]!.trim();
		const table = this.ensureTable(m[2]!);
		const whereParts = m[3] ? splitWhere(m[3]!) : [];
		const limit = m[4] ? Number(m[4]!) : undefined;
		const matched = table.rows.filter((r) => matchWhere(r, whereParts, this.values));
		const sliced = limit !== undefined ? matched.slice(0, limit) : matched;
		return sliced.map((r) => projectColumns(colsExpr, r));
	}

	private ensureTable(name: string): Table {
		let t = this.db.tables.get(name);
		if (!t) {
			t = { rows: [], pk: defaultPk(name), unique: defaultUnique(name) };
			this.db.tables.set(name, t);
		}
		return t;
	}
}

function defaultPk(table: string): string[] | undefined {
	if (table === "notification_prefs") return ["user_id", "notification_id"];
	if (table === "notification_optouts") return ["user_id", "channel", "notification_id"];
	if (table === "notification_deliveries") return ["id"];
	return undefined;
}

function defaultUnique(table: string): string[][] | undefined {
	if (table === "notification_deliveries") return [["idempotency_key"]];
	return undefined;
}

function splitTopLevelCommas(input: string): string[] {
	const out: string[] = [];
	let depth = 0;
	let buf = "";
	for (const ch of input) {
		if (ch === "(") depth += 1;
		if (ch === ")") depth -= 1;
		if (ch === "," && depth === 0) {
			out.push(buf.trim());
			buf = "";
			continue;
		}
		buf += ch;
	}
	if (buf.trim().length > 0) out.push(buf.trim());
	return out;
}

interface WherePart {
	col: string;
	op: "=" | "IS NULL" | "<";
	rhs: "?" | "NULL" | { kind: "col-or-null"; otherCol?: string };
}

function splitWhere(expr: string): WherePart[] {
	// supports: `col = ?` | `col = ? OR col IS NULL` | `col IS NULL` | `(col = ? OR col IS NULL)`
	// Strip outer parens for simple cases.
	const cleaned = expr.replace(/^\(|\)$/g, "");
	// Naive split on " AND "
	const parts = cleaned.split(/\s+AND\s+/i);
	const out: WherePart[] = [];
	for (const part of parts) {
		const orParts = part.split(/\s+OR\s+/i).map((s) => s.replace(/^\(|\)$/g, "").trim());
		// Match the canonical "col = ? OR col IS NULL" pattern produced by isOptedOut
		const colorNullMatch = orParts.find((p) => /IS NULL$/i.test(p));
		if (orParts.length > 1 && colorNullMatch) {
			const eqPart = orParts.find((p) => /=\s*\?$/.test(p));
			if (eqPart) {
				const col = eqPart.split("=")[0]!.trim();
				out.push({ col, op: "=", rhs: { kind: "col-or-null" } });
				continue;
			}
		}
		const trimmed = part.trim();
		if (/=\s*\?$/.test(trimmed)) {
			const col = trimmed.split("=")[0]!.trim();
			out.push({ col, op: "=", rhs: "?" });
			continue;
		}
		if (/<\s*\?$/.test(trimmed)) {
			const col = trimmed.split("<")[0]!.trim();
			out.push({ col, op: "<", rhs: "?" });
			continue;
		}
		if (/IS NULL$/i.test(trimmed)) {
			const col = trimmed.split(/\s+IS\s+NULL/i)[0]!.trim();
			out.push({ col, op: "IS NULL", rhs: "NULL" });
			continue;
		}
		throw new Error(`MemoryD1: unsupported WHERE clause: ${trimmed}`);
	}
	return out;
}

function matchWhere(row: Row, parts: WherePart[], values: unknown[]): boolean {
	let vi = 0;
	for (const p of parts) {
		if (p.op === "IS NULL") {
			if (row[p.col] !== null && row[p.col] !== undefined) return false;
			continue;
		}
		if (p.rhs === "?") {
			const expected = values[vi++];
			if (row[p.col] !== expected) {
				if (p.op === "<") {
					if (typeof row[p.col] === "number" && typeof expected === "number") {
						if (!((row[p.col] as number) < (expected as number))) return false;
						continue;
					}
				}
				return false;
			}
			continue;
		}
		if (typeof p.rhs === "object" && p.rhs.kind === "col-or-null") {
			const expected = values[vi++];
			const cell = row[p.col];
			if (cell === null || cell === undefined) continue;
			if (cell !== expected) return false;
		}
	}
	return true;
}

function projectColumns(colsExpr: string, row: Row): Row {
	if (colsExpr === "*") return { ...row };
	const parts = colsExpr.split(",").map((s) => s.trim());
	const out: Row = {};
	for (const p of parts) {
		const asMatch = /^(\S+)\s+AS\s+(\S+)$/i.exec(p);
		if (asMatch) {
			out[asMatch[2]!] = row[asMatch[1]!];
			continue;
		}
		// constant aliases like "1 AS hit"
		if (/^\d+$/.test(p)) {
			out.value = Number(p);
			continue;
		}
		const numAsMatch = /^(\d+)\s+AS\s+(\S+)$/i.exec(p);
		if (numAsMatch) {
			out[numAsMatch[2]!] = Number(numAsMatch[1]!);
			continue;
		}
		out[p] = row[p];
	}
	return out;
}

function applySet(setExpr: string, target: Row, incoming: Row): void {
	const segs = splitTopLevelCommas(setExpr);
	for (const seg of segs) {
		const eq = seg.indexOf("=");
		const col = seg.slice(0, eq).trim();
		const rhs = seg.slice(eq + 1).trim();
		const excludedMatch = /^excluded\.(\w+)$/.exec(rhs);
		if (excludedMatch) target[col] = incoming[excludedMatch[1]!];
	}
}

/** Convenience helper to seed initial rows. */
export function seed(db: MemoryD1, table: string, rows: Row[]): void {
	const t = db.tables.get(table) ?? {
		rows: [],
		pk: defaultPk(table),
		unique: defaultUnique(table),
	};
	t.rows.push(...rows);
	db.tables.set(table, t);
}
