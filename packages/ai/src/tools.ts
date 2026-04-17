/** Definition of a tool that a model can call */
export interface ToolDefinition {
	/** Unique name for the tool */
	name: string;
	/** Human-readable description of what the tool does */
	description: string;
	/** JSON Schema describing the tool's parameters */
	parameters: Record<string, unknown>;
}

/** A tool call returned by the model */
export interface ToolCall {
	/** Unique identifier for this tool call */
	id: string;
	/** Name of the tool to invoke */
	name: string;
	/** Parsed arguments for the tool */
	arguments: Record<string, unknown>;
}

/** Result from executing a tool call */
export interface ToolResult {
	/** The id of the tool call this result corresponds to */
	toolCallId: string;
	/** The string content returned by the tool */
	content: string;
}

/** Options for tool use with an AI model */
export interface ToolUseOptions {
	/** Tool definitions to make available to the model */
	tools: ToolDefinition[];
	/** How the model should choose tools */
	toolChoice?: "auto" | "none" | "required" | { name: string };
	/** Maximum number of tool call rounds before stopping (default: 5) */
	maxTurns?: number;
}

/** Result from a tool use session */
export interface ToolUseResult<T = string> {
	/** The final content from the model */
	content: T;
	/** All tool calls made during the session */
	toolCalls: ToolCall[];
	/** The model that produced the output */
	model: string;
	/** Number of turns (model calls) made */
	turns: number;
}
