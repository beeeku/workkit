import type { TokenUsage } from "@workkit/ai-gateway";
import type { AgentEvent } from "./events";
import { assertNoToolCollisions } from "./handoff";
import { type InternalAgentDef, runLoop } from "./loop";
import type { Agent, DefineAgentOptions, RunArgs, RunResult, Tool } from "./types";

const ZERO_USAGE: TokenUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };

interface AgentRegistry {
	get(name: string): InternalAgentDef | undefined;
	register(def: InternalAgentDef): void;
}

function createRegistry(): AgentRegistry {
	const map = new Map<string, InternalAgentDef>();
	return {
		get: (n) => map.get(n),
		register: (d) => {
			map.set(d.name, d);
		},
	};
}

const sharedRegistry = createRegistry();

export function defineAgent(options: DefineAgentOptions): Agent {
	if (!options.name) throw new Error("agent name is required");
	const tools: Tool[] = options.tools ?? [];
	assertNoToolCollisions(tools);

	const stopWhen = {
		maxSteps: options.stopWhen?.maxSteps ?? 10,
		maxTokens: options.stopWhen?.maxTokens ?? 0,
	};
	if (stopWhen.maxSteps <= 0) {
		throw new Error("stopWhen.maxSteps must be > 0");
	}

	const internal: InternalAgentDef = {
		name: options.name,
		model: options.model,
		provider: options.provider,
		instructions: options.instructions,
		tools,
		stopWhen,
		hooks: options.hooks ?? {},
		strictTools: options.strictTools ?? false,
		maxAfterModelRetries: options.maxAfterModelRetries ?? 2,
		forceTextAfterTool: options.forceTextAfterTool ?? false,
	};

	sharedRegistry.register(internal);

	const agent: Agent = {
		name: options.name,
		model: options.model,
		tools,
		async run(args: RunArgs): Promise<RunResult> {
			const events: AgentEvent[] = [];
			const result = await runLoop({
				agent: internal,
				messages: [...args.messages],
				context: {
					user: args.context?.user,
					signal: args.context?.signal,
					agentPath: [],
					usage: { ...ZERO_USAGE },
				},
				resolveAgent: (name) => sharedRegistry.get(name),
				emit: (e) => events.push(e),
			});
			return {
				text: result.finalText,
				messages: result.messages,
				usage: result.usage,
				stopReason: result.stopReason,
			};
		},
		stream(args: RunArgs): AsyncIterable<AgentEvent> {
			return streamRun(internal, args);
		},
	};

	return agent;
}

async function* streamRun(internal: InternalAgentDef, args: RunArgs): AsyncGenerator<AgentEvent> {
	const queue: AgentEvent[] = [];
	let resolveNext: (() => void) | undefined;
	let done = false;
	let error: unknown = null;

	const emit = (e: AgentEvent) => {
		queue.push(e);
		resolveNext?.();
	};

	const promise = runLoop({
		agent: internal,
		messages: [...args.messages],
		context: {
			user: args.context?.user,
			signal: args.context?.signal,
			agentPath: [],
			usage: { ...ZERO_USAGE },
		},
		resolveAgent: (name) => sharedRegistry.get(name),
		emit,
	}).then(
		() => {
			done = true;
			resolveNext?.();
		},
		(err) => {
			error = err;
			done = true;
			resolveNext?.();
		},
	);

	while (true) {
		while (queue.length > 0) {
			const event = queue.shift();
			if (event) yield event;
		}
		if (done) break;
		await new Promise<void>((resolve) => {
			resolveNext = resolve;
		});
		resolveNext = undefined;
	}

	await promise;
	if (error) throw error;
}
