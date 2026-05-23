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

describe("useChatDebugFrames", () => {
	it("captures inbound and outbound chat frames newest-last", () => {
		const socket = new MockSocket();
		socket.readyState = 1;
		const hook = mountHook(socket);

		act(() => {
			socket.emit("message", {
				data: JSON.stringify({ id: "in-1", type: "message", role: "assistant", content: "hi" }),
			});
			socket.send(JSON.stringify({ id: "out-1", type: "typing", role: "user", content: "..." }));
		});

		expect(hook.result.connectionState).toBe("open");
		expect(hook.result.frames).toHaveLength(2);
		expect(hook.result.frames[0]?.direction).toBe("in");
		expect(hook.result.frames[0]?.message?.id).toBe("in-1");
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
