export interface MockOperation {
	type: "read" | "write" | "delete" | "list";
	key?: string;
	timestamp: number;
}

export interface MockOperations {
	operations: MockOperation[];
	reads(): MockOperation[];
	writes(): MockOperation[];
	deletes(): MockOperation[];
	reset(): void;
}

export function createOperationTracker(): MockOperations & {
	_record: (type: MockOperation["type"], key?: string) => void;
} {
	const ops: MockOperation[] = [];
	return {
		get operations() {
			return [...ops];
		},
		reads() {
			return ops.filter((o) => o.type === "read");
		},
		writes() {
			return ops.filter((o) => o.type === "write");
		},
		deletes() {
			return ops.filter((o) => o.type === "delete");
		},
		reset() {
			ops.length = 0;
		},
		_record(type: MockOperation["type"], key?: string) {
			ops.push({ type, timestamp: Date.now(), key });
		},
	};
}
