import { describe, expect, it } from "vitest";
import { aiProbe, d1Probe, doProbe, kvProbe, queueProbe, r2Probe } from "../src/probes";
import { createHealthCheck } from "../src/health";

// --- Lightweight inline mocks (avoid importing @workkit/testing at test-time) ---

function createMockKV(): KVNamespace {
	return {
		get: async () => null,
		getWithMetadata: async () => ({ value: null, metadata: null, cacheStatus: null }),
		put: async () => {},
		delete: async () => {},
		list: async () => ({ keys: [], list_complete: true, cursor: undefined, cacheStatus: null }),
	} as any;
}

function createFailingKV(): KVNamespace {
	return {
		get: async () => {
			throw new Error("KV unavailable");
		},
		getWithMetadata: async () => {
			throw new Error("KV unavailable");
		},
		put: async () => {
			throw new Error("KV unavailable");
		},
		delete: async () => {
			throw new Error("KV unavailable");
		},
		list: async () => {
			throw new Error("KV unavailable");
		},
	} as any;
}

function createMockD1(): D1Database {
	return {
		prepare: (_sql: string) => ({
			bind: () => ({ first: async () => ({ ok: 1 }) }),
			first: async () => ({ ok: 1 }),
			all: async () => ({ results: [{ ok: 1 }], success: true, meta: {} }),
			run: async () => ({ success: true, meta: {} }),
			raw: async () => [[1]],
		}),
		batch: async () => [],
		exec: async () => ({ count: 0, duration: 0 }),
		dump: async () => new ArrayBuffer(0),
	} as any;
}

function createFailingD1(): D1Database {
	return {
		prepare: (_sql: string) => ({
			bind: () => ({
				first: async () => {
					throw new Error("D1 unavailable");
				},
			}),
			first: async () => {
				throw new Error("D1 unavailable");
			},
			all: async () => {
				throw new Error("D1 unavailable");
			},
			run: async () => {
				throw new Error("D1 unavailable");
			},
			raw: async () => {
				throw new Error("D1 unavailable");
			},
		}),
		batch: async () => {
			throw new Error("D1 unavailable");
		},
		exec: async () => {
			throw new Error("D1 unavailable");
		},
		dump: async () => {
			throw new Error("D1 unavailable");
		},
	} as any;
}

function createMockR2(): R2Bucket {
	return {
		head: async () => null,
		get: async () => null,
		put: async () => ({}) as any,
		delete: async () => {},
		list: async () => ({ objects: [], truncated: false, delimitedPrefixes: [] }),
		createMultipartUpload: async () => ({}) as any,
		resumeMultipartUpload: () => ({}) as any,
	} as any;
}

function createFailingR2(): R2Bucket {
	return {
		head: async () => {
			throw new Error("R2 unavailable");
		},
		get: async () => {
			throw new Error("R2 unavailable");
		},
		put: async () => {
			throw new Error("R2 unavailable");
		},
		delete: async () => {
			throw new Error("R2 unavailable");
		},
		list: async () => {
			throw new Error("R2 unavailable");
		},
		createMultipartUpload: async () => {
			throw new Error("R2 unavailable");
		},
		resumeMultipartUpload: () => {
			throw new Error("R2 unavailable");
		},
	} as any;
}

function createMockAi(): Ai {
	return {
		run: async () => ({}) as any,
	} as any;
}

function createMockDONamespace(): DurableObjectNamespace {
	return {
		idFromName: (_name: string) => ({ toString: () => "mock-id" }) as any,
		idFromString: (_id: string) => ({ toString: () => _id }) as any,
		newUniqueId: () => ({ toString: () => "unique-id" }) as any,
		get: (_id: any) => ({}) as any,
		jurisdiction: () => ({}) as any,
	} as any;
}

function createFailingDONamespace(): DurableObjectNamespace {
	return {
		idFromName: () => {
			throw new Error("DO unavailable");
		},
		idFromString: () => {
			throw new Error("DO unavailable");
		},
		newUniqueId: () => {
			throw new Error("DO unavailable");
		},
		get: () => {
			throw new Error("DO unavailable");
		},
		jurisdiction: () => {
			throw new Error("DO unavailable");
		},
	} as any;
}

function createMockQueue(): Queue {
	return {
		send: async () => {},
		sendBatch: async () => {},
	} as any;
}

describe("kvProbe", () => {
	it("returns healthy for a working KV", async () => {
		const probe = kvProbe(createMockKV());
		const hc = createHealthCheck([probe]);
		const result = await hc.check();

		expect(result.status).toBe("healthy");
		expect(result.checks[0]!.name).toBe("kv");
	});

	it("returns unhealthy when KV throws", async () => {
		const probe = kvProbe(createFailingKV());
		const hc = createHealthCheck([probe]);
		const result = await hc.check();

		expect(result.status).toBe("unhealthy");
		expect(result.checks[0]!.message).toContain("KV unavailable");
	});

	it("respects critical option", () => {
		const probe = kvProbe(createMockKV(), { critical: false });
		expect(probe.critical).toBe(false);
	});

	it("respects timeout option", () => {
		const probe = kvProbe(createMockKV(), { timeout: 2000 });
		expect(probe.timeout).toBe(2000);
	});
});

describe("d1Probe", () => {
	it("returns healthy for a working D1", async () => {
		const probe = d1Probe(createMockD1());
		const hc = createHealthCheck([probe]);
		const result = await hc.check();

		expect(result.status).toBe("healthy");
		expect(result.checks[0]!.name).toBe("d1");
	});

	it("returns unhealthy when D1 throws", async () => {
		const probe = d1Probe(createFailingD1());
		const hc = createHealthCheck([probe]);
		const result = await hc.check();

		expect(result.status).toBe("unhealthy");
		expect(result.checks[0]!.message).toContain("D1 unavailable");
	});
});

describe("r2Probe", () => {
	it("returns healthy for a working R2", async () => {
		const probe = r2Probe(createMockR2());
		const hc = createHealthCheck([probe]);
		const result = await hc.check();

		expect(result.status).toBe("healthy");
		expect(result.checks[0]!.name).toBe("r2");
	});

	it("returns unhealthy when R2 throws", async () => {
		const probe = r2Probe(createFailingR2());
		const hc = createHealthCheck([probe]);
		const result = await hc.check();

		expect(result.status).toBe("unhealthy");
		expect(result.checks[0]!.message).toContain("R2 unavailable");
	});
});

describe("aiProbe", () => {
	it("returns healthy for a valid AI binding", async () => {
		const probe = aiProbe(createMockAi());
		const hc = createHealthCheck([probe]);
		const result = await hc.check();

		expect(result.status).toBe("healthy");
		expect(result.checks[0]!.name).toBe("ai");
	});

	it("returns unhealthy for an invalid AI binding", async () => {
		const probe = aiProbe({} as any);
		const hc = createHealthCheck([probe]);
		const result = await hc.check();

		expect(result.status).toBe("unhealthy");
		expect(result.checks[0]!.message).toContain("run is not a function");
	});
});

describe("doProbe", () => {
	it("returns healthy for a valid DO namespace", async () => {
		const probe = doProbe(createMockDONamespace());
		const hc = createHealthCheck([probe]);
		const result = await hc.check();

		expect(result.status).toBe("healthy");
		expect(result.checks[0]!.name).toBe("do");
	});

	it("returns unhealthy when DO namespace throws", async () => {
		const probe = doProbe(createFailingDONamespace());
		const hc = createHealthCheck([probe]);
		const result = await hc.check();

		expect(result.status).toBe("unhealthy");
		expect(result.checks[0]!.message).toContain("DO unavailable");
	});
});

describe("queueProbe", () => {
	it("returns healthy for a valid Queue binding", async () => {
		const probe = queueProbe(createMockQueue());
		const hc = createHealthCheck([probe]);
		const result = await hc.check();

		expect(result.status).toBe("healthy");
		expect(result.checks[0]!.name).toBe("queue");
	});

	it("returns unhealthy for an invalid Queue binding", async () => {
		const probe = queueProbe({} as any);
		const hc = createHealthCheck([probe]);
		const result = await hc.check();

		expect(result.status).toBe("unhealthy");
		expect(result.checks[0]!.message).toContain("send is not a function");
	});
});

describe("mixed probes integration", () => {
	it("returns degraded when only non-critical probe fails", async () => {
		const probes = [
			kvProbe(createMockKV()),
			d1Probe(createMockD1()),
			r2Probe(createFailingR2(), { critical: false }),
		];
		const hc = createHealthCheck(probes);
		const result = await hc.check();

		expect(result.status).toBe("degraded");
		expect(result.checks[0]!.status).toBe("healthy");
		expect(result.checks[1]!.status).toBe("healthy");
		expect(result.checks[2]!.status).toBe("unhealthy");
	});

	it("returns unhealthy when a critical probe fails among healthy ones", async () => {
		const probes = [
			kvProbe(createMockKV()),
			d1Probe(createFailingD1()),
			r2Probe(createMockR2()),
		];
		const hc = createHealthCheck(probes);
		const result = await hc.check();

		expect(result.status).toBe("unhealthy");
	});
});
