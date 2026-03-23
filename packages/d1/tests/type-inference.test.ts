import { describe, expectTypeOf, it } from "vitest";
import type {
	BoundStatement,
	D1RunResult,
	DeleteBuilder,
	InsertBuilder,
	ReturningBuilder,
	SelectBuilder,
	TypedD1,
	TypedPreparedStatement,
	UpdateBuilder,
} from "../src/types";

// Type used for testing
interface User {
	id: number;
	name: string;
	email: string;
	active: boolean;
}

// We test the TYPE-LEVEL behavior of the interfaces.
// These tests compile or fail at the type level -- no runtime assertions needed.
// The expectTypeOf assertions verify that the return types are correct.

describe("TypedD1 type inference", () => {
	it("first returns T | null by default", () => {
		// Default generic: Record<string, unknown> | null
		type DefaultResult = Awaited<ReturnType<TypedD1["first"]>>;
		expectTypeOf<DefaultResult>().toEqualTypeOf<Record<string, unknown> | null>();
	});

	it("all returns T[] by default", () => {
		type DefaultResult = Awaited<ReturnType<TypedD1["all"]>>;
		expectTypeOf<DefaultResult>().toEqualTypeOf<Record<string, unknown>[]>();
	});

	it("run returns Promise<D1RunResult>", () => {
		expectTypeOf<TypedD1["run"]>().returns.toEqualTypeOf<Promise<D1RunResult>>();
	});

	it("prepare returns TypedPreparedStatement", () => {
		type DefaultStmt = ReturnType<TypedD1["prepare"]>;
		expectTypeOf<DefaultStmt>().toMatchTypeOf<TypedPreparedStatement<Record<string, unknown>>>();
	});

	it("select returns SelectBuilder", () => {
		type DefaultSel = ReturnType<TypedD1["select"]>;
		expectTypeOf<DefaultSel>().toMatchTypeOf<SelectBuilder<Record<string, unknown>>>();
	});

	it("insert returns InsertBuilder", () => {
		expectTypeOf<TypedD1["insert"]>().returns.toMatchTypeOf<InsertBuilder>();
	});

	it("update returns UpdateBuilder", () => {
		expectTypeOf<TypedD1["update"]>().returns.toMatchTypeOf<UpdateBuilder>();
	});

	it("delete returns DeleteBuilder", () => {
		expectTypeOf<TypedD1["delete"]>().returns.toMatchTypeOf<DeleteBuilder>();
	});

	it("raw is D1Database", () => {
		expectTypeOf<TypedD1["raw"]>().toEqualTypeOf<D1Database>();
	});
});

describe("TypedPreparedStatement type inference", () => {
	it("first returns Promise<T | null>", () => {
		type Stmt = TypedPreparedStatement<User>;
		expectTypeOf<Stmt["first"]>().returns.toEqualTypeOf<Promise<User | null>>();
	});

	it("all returns Promise<T[]>", () => {
		type Stmt = TypedPreparedStatement<User>;
		expectTypeOf<Stmt["all"]>().returns.toEqualTypeOf<Promise<User[]>>();
	});

	it("run returns Promise<D1RunResult>", () => {
		type Stmt = TypedPreparedStatement<User>;
		expectTypeOf<Stmt["run"]>().returns.toEqualTypeOf<Promise<D1RunResult>>();
	});

	it("bind returns BoundStatement", () => {
		type Stmt = TypedPreparedStatement<User>;
		expectTypeOf<Stmt["bind"]>().returns.toMatchTypeOf<BoundStatement>();
	});

	it("sql is readonly string", () => {
		type Stmt = TypedPreparedStatement<User>;
		expectTypeOf<Stmt["sql"]>().toBeString();
	});
});

describe("SelectBuilder type inference", () => {
	it("all returns Promise<T[]>", () => {
		type Sel = SelectBuilder<User>;
		expectTypeOf<Sel["all"]>().returns.toEqualTypeOf<Promise<User[]>>();
	});

	it("first returns Promise<T | null>", () => {
		type Sel = SelectBuilder<User>;
		expectTypeOf<Sel["first"]>().returns.toEqualTypeOf<Promise<User | null>>();
	});

	it("count returns Promise<number>", () => {
		type Sel = SelectBuilder<User>;
		expectTypeOf<Sel["count"]>().returns.toEqualTypeOf<Promise<number>>();
	});

	it("toSQL returns { sql: string; params: unknown[] }", () => {
		type Sel = SelectBuilder<User>;
		expectTypeOf<Sel["toSQL"]>().returns.toEqualTypeOf<{
			sql: string;
			params: unknown[];
		}>();
	});

	it("chaining methods return SelectBuilder<T>", () => {
		type Sel = SelectBuilder<User>;
		expectTypeOf<ReturnType<Sel["columns"]>>().toMatchTypeOf<SelectBuilder<User>>();
		expectTypeOf<ReturnType<Sel["orderBy"]>>().toMatchTypeOf<SelectBuilder<User>>();
		expectTypeOf<ReturnType<Sel["limit"]>>().toMatchTypeOf<SelectBuilder<User>>();
		expectTypeOf<ReturnType<Sel["offset"]>>().toMatchTypeOf<SelectBuilder<User>>();
		expectTypeOf<ReturnType<Sel["groupBy"]>>().toMatchTypeOf<SelectBuilder<User>>();
	});
});

describe("InsertBuilder type inference", () => {
	it("run returns Promise<D1RunResult>", () => {
		type Ins = InsertBuilder;
		expectTypeOf<Ins["run"]>().returns.toEqualTypeOf<Promise<D1RunResult>>();
	});

	it("toSQL returns sql and params", () => {
		type Ins = InsertBuilder;
		expectTypeOf<Ins["toSQL"]>().returns.toEqualTypeOf<{
			sql: string;
			params: unknown[];
		}>();
	});
});

describe("ReturningBuilder type inference", () => {
	it("all returns Promise<T[]>", () => {
		type Ret = ReturningBuilder<User>;
		expectTypeOf<Ret["all"]>().returns.toEqualTypeOf<Promise<User[]>>();
	});

	it("first returns Promise<T | null>", () => {
		type Ret = ReturningBuilder<User>;
		expectTypeOf<Ret["first"]>().returns.toEqualTypeOf<Promise<User | null>>();
	});

	it("toSQL returns sql and params", () => {
		type Ret = ReturningBuilder<User>;
		expectTypeOf<Ret["toSQL"]>().returns.toEqualTypeOf<{
			sql: string;
			params: unknown[];
		}>();
	});
});

describe("UpdateBuilder type inference", () => {
	it("run returns Promise<D1RunResult>", () => {
		type Upd = UpdateBuilder;
		expectTypeOf<Upd["run"]>().returns.toEqualTypeOf<Promise<D1RunResult>>();
	});

	it("toSQL returns sql and params", () => {
		type Upd = UpdateBuilder;
		expectTypeOf<Upd["toSQL"]>().returns.toEqualTypeOf<{
			sql: string;
			params: unknown[];
		}>();
	});
});

describe("DeleteBuilder type inference", () => {
	it("run returns Promise<D1RunResult>", () => {
		type Del = DeleteBuilder;
		expectTypeOf<Del["run"]>().returns.toEqualTypeOf<Promise<D1RunResult>>();
	});

	it("toSQL returns sql and params", () => {
		type Del = DeleteBuilder;
		expectTypeOf<Del["toSQL"]>().returns.toEqualTypeOf<{
			sql: string;
			params: unknown[];
		}>();
	});
});
