export interface TemplateOption {
	value: string;
	label: string;
	hint: string;
}

export const TEMPLATE_OPTIONS: TemplateOption[] = [
	{ value: "basic", label: "Basic", hint: "Minimal fetch handler — start from scratch" },
	{ value: "hono", label: "Hono", hint: "Hono framework with typed routes (recommended)" },
	{ value: "api", label: "API", hint: "Structured API with router, handlers, and OpenAPI" },
];
