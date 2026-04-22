export interface RingBufferEntry<T> {
	id: number;
	event: T;
}

export interface RingBuffer<T> {
	push(event: T): number;
	since(id: number): ReadonlyArray<RingBufferEntry<T>>;
	readonly lastId: number;
	readonly size: number;
}

export function createRingBuffer<T>(capacity: number): RingBuffer<T> {
	const entries: RingBufferEntry<T>[] = [];
	let counter = 0;

	return {
		push(event) {
			counter += 1;
			if (capacity > 0) {
				entries.push({ id: counter, event });
				if (entries.length > capacity) entries.shift();
			}
			return counter;
		},
		since(id) {
			if (entries.length === 0 || id >= counter) return [];
			return entries.filter((e) => e.id > id);
		},
		get lastId() {
			return counter;
		},
		get size() {
			return entries.length;
		},
	};
}
