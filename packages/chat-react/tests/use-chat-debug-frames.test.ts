import React from "react";
import { type ReactTestRenderer, act, create } from "react-test-renderer";
import { describe, expect, it } from "vitest";
import { type ChatDebugSocket, type UseChatDebugFramesResult, useChatDebugFrames } from "../src";

class MockSocket implements ChatDebugSocket {
	readyState = 0;
	sent: unknown[] = [];
	private listeners = new Map<string, Set<(event: any) => void>>();

	send(data: Parameters<ChatDebugSocket["send"]>[0]): void {
		this.sent.push(data);
	}

	addEventListener(type: string, listener: (event: any) => void): void {
		const listeners = this.listeners.get(type) ?? new Set();
		listeners.add(listener);
		this.listeners.set(type, listeners);
	}

	removeEventListener(type: string, listener: (event: any) => void): void {
		this.listeners.get(type)?.delete(listener);
	}

	emit(type: string, event: any = {}): void {
		for (const listener of this.listeners.get(type) ?? []) {
			listener(event);
		}
	}
}

function mountHook(socket: MockSocket, options?: Parameters<typeof useChatDebugFrames>[1]) {
	let latest: UseChatDebugFramesResult | undefined;
	let renderer: ReactTestRenderer;

	function TestComponent() {
		latest = useChatDebugFrames(socket, options);
		return null;
	}

	act(() => {
		renderer = create(React.createElement(TestComponent));
	});

	return {
		get result() {
			if (!latest) throw new Error("hook did not render");
			return latest;
		},
		unmount: () => {
			act(() => {
				renderer.unmount();
			});
		},
	};
}

function mountTwoHooks(socket: MockSocket) {
	let first: UseChatDebugFramesResult | undefined;
	let second: UseChatDebugFramesResult | undefined;
	let showFirst = true;
	let showSecond = true;
	let renderer: ReactTestRenderer;

	function FirstHook() {
		first = useChatDebugFrames(socket);
		return null;
	}

	function SecondHook() {
		second = useChatDebugFrames(socket);
		return null;
	}

	function TestComponent() {
		return React.createElement(
			React.Fragment,
			null,
			showFirst ? React.createElement(FirstHook) : null,
			showSecond ? React.createElement(SecondHook) : null,
		);
	}

	act(() => {
		renderer = create(React.createElement(TestComponent));
	});

	return {
		get first() {
			if (!first) throw new Error("first hook did not render");
			return first;
		},
		get second() {
			if (!second) throw new Error("second hook did not render");
			return second;
		},
		unmountFirst: () => {
			act(() => {
				showFirst = false;
				renderer.update(React.createElement(TestComponent));
			});
		},
		unmountSecond: () => {
			act(() => {
				showSecond = false;
				renderer.update(React.createElement(TestComponent));
			});
		},
		unmount: () => {
			act(() => {
				renderer.unmount();
			});
		},
	};
}

describe("useChatDebugFrames", () => {
	it("captures inbound and outbound chat frames newest-last", () => {
		const socket = new MockSocket();
		socket.readyState = 1;
		const hook = mountHook(socket);
		const messageTimestamp = 1_774_111_200_000;

		act(() => {
			socket.emit("message", {
				data: JSON.stringify({
					id: "in-1",
					type: "message",
					role: "assistant",
					content: "hi",
					timestamp: messageTimestamp,
				}),
			});
			socket.send(JSON.stringify({ id: "out-1", type: "typing", role: "user", content: "..." }));
		});

		expect(hook.result.connectionState).toBe("open");
		expect(hook.result.frames).toHaveLength(2);
		expect(hook.result.frames[0]?.direction).toBe("in");
		expect(hook.result.frames[0]?.message?.id).toBe("in-1");
		expect(hook.result.frames[0]?.message?.timestamp).toBe(messageTimestamp);
		expect(hook.result.frames[1]?.direction).toBe("out");
		expect(hook.result.frames[1]?.type).toBe("typing");
		expect(socket.sent).toHaveLength(1);

		hook.unmount();
	});

	it("applies include filters and buffer caps", () => {
		const socket = new MockSocket();
		const hook = mountHook(socket, { bufferSize: 2, include: ["message"] });

		act(() => {
			socket.emit("message", {
				data: JSON.stringify({ id: "m1", type: "message", role: "assistant", content: "one" }),
			});
			socket.emit("message", {
				data: JSON.stringify({ id: "t1", type: "typing", role: "assistant", content: "typing" }),
			});
			socket.emit("message", {
				data: JSON.stringify({ id: "m2", type: "message", role: "assistant", content: "two" }),
			});
			socket.emit("message", {
				data: JSON.stringify({ id: "m3", type: "message", role: "assistant", content: "three" }),
			});
		});

		expect(hook.result.frames.map((frame) => frame.message?.id)).toEqual(["m2", "m3"]);

		hook.unmount();
	});

	it("falls back to the default buffer size when bufferSize is NaN", () => {
		const socket = new MockSocket();
		const hook = mountHook(socket, { bufferSize: Number.NaN });

		act(() => {
			for (let index = 0; index < 101; index += 1) {
				socket.emit("message", {
					data: JSON.stringify({
						id: `m${index}`,
						type: "message",
						role: "assistant",
						content: String(index),
					}),
				});
			}
		});

		expect(hook.result.frames).toHaveLength(100);
		expect(hook.result.frames[0]?.message?.id).toBe("m1");

		hook.unmount();
	});

	it("uses hook-local frame ids", () => {
		const firstSocket = new MockSocket();
		const firstHook = mountHook(firstSocket);

		act(() => {
			firstSocket.emit("message", {
				data: JSON.stringify({ id: "first", type: "message", role: "assistant", content: "one" }),
			});
		});

		expect(firstHook.result.frames[0]?.id).toBe("frame-1");
		firstHook.unmount();

		const secondSocket = new MockSocket();
		const secondHook = mountHook(secondSocket);

		act(() => {
			secondSocket.emit("message", {
				data: JSON.stringify({ id: "second", type: "message", role: "assistant", content: "two" }),
			});
		});

		expect(secondHook.result.frames[0]?.id).toBe("frame-1");
		secondHook.unmount();
	});

	it("keeps same-socket send capture isolated across multiple hook instances", () => {
		const socket = new MockSocket();
		const originalSend = socket.send;
		const hooks = mountTwoHooks(socket);

		act(() => {
			socket.send(JSON.stringify({ id: "out-1", type: "message", role: "user", content: "one" }));
		});

		expect(hooks.first.frames.map((frame) => frame.message?.id)).toEqual(["out-1"]);
		expect(hooks.second.frames.map((frame) => frame.message?.id)).toEqual(["out-1"]);

		hooks.unmountFirst();

		act(() => {
			socket.send(JSON.stringify({ id: "out-2", type: "message", role: "user", content: "two" }));
		});

		expect(hooks.second.frames.map((frame) => frame.message?.id)).toEqual(["out-1", "out-2"]);
		expect(socket.send).not.toBe(originalSend);

		hooks.unmountSecond();

		expect(socket.send).toBe(originalSend);
		hooks.unmount();
	});

	it("falls back to user when a wire message has an invalid role", () => {
		const socket = new MockSocket();
		const hook = mountHook(socket);

		act(() => {
			socket.emit("message", {
				data: JSON.stringify({ id: "bad-role", type: "message", role: "admin", content: "one" }),
			});
		});

		expect(hook.result.frames[0]?.message?.role).toBe("user");
		expect(hook.result.frames[0]?.error).toBeUndefined();

		hook.unmount();
	});

	it("tracks connection state and clears the buffer", () => {
		const socket = new MockSocket();
		const hook = mountHook(socket);

		act(() => {
			socket.readyState = 1;
			socket.emit("open");
			socket.emit("message", {
				data: JSON.stringify({ id: "m1", type: "message", role: "assistant", content: "one" }),
			});
		});
		expect(hook.result.connectionState).toBe("open");
		expect(hook.result.frames).toHaveLength(1);

		act(() => {
			hook.result.clear();
			socket.readyState = 3;
			socket.emit("close");
		});

		expect(hook.result.frames).toHaveLength(0);
		expect(hook.result.connectionState).toBe("closed");

		hook.unmount();
	});
});
