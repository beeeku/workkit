// src/registry.ts
import type {
  RegisteredTool,
  RegisteredResource,
  RegisteredPrompt,
  ToolConfig,
  ResourceConfig,
  PromptConfig,
  StandardSchemaV1,
} from "./types";

// ─── Tool Registry ────────────────────────────────────────────

export interface ToolRegistry<TEnv = unknown> {
  register<TInput extends StandardSchemaV1>(
    name: string,
    config: ToolConfig<TInput, any, TEnv>,
  ): void;
  get(name: string): RegisteredTool<TEnv> | undefined;
  all(): RegisteredTool<TEnv>[];
  freeze(): void;
  readonly size: number;
}

export function createToolRegistry<TEnv = unknown>(): ToolRegistry<TEnv> {
  const store = new Map<string, RegisteredTool<TEnv>>();
  let frozen = false;

  return {
    register(name, config) {
      if (frozen) throw new Error("Registry is frozen");
      if (store.has(name)) throw new Error(`Tool "${name}" already registered`);

      const registered: RegisteredTool<TEnv> = {
        name,
        description: config.description,
        input: config.input,
        output: config.output,
        handler: config.handler as any,
        tags: config.tags ?? [],
        annotations: config.annotations ?? {},
        middleware: config.middleware ?? [],
        timeout: config.timeout ?? 25000,
        progress: config.progress ?? false,
        cancellable: config.cancellable ?? false,
      };

      store.set(name, registered);
    },

    get(name) {
      return store.get(name);
    },

    all() {
      return Array.from(store.values());
    },

    freeze() {
      frozen = true;
    },

    get size() {
      return store.size;
    },
  };
}

// ─── Resource Registry ────────────────────────────────────────

function isURITemplate(uri: string): boolean {
  return /\{[^}]+\}/.test(uri);
}

function buildTemplateMatcher(
  template: string,
): ((uri: string) => Record<string, string> | null) {
  const paramNames: string[] = [];
  // Split on {param} placeholders; the regex captures the param names as odd elements
  const parts = template.split(/\{([^}]+)\}/g);
  // parts alternates: [literal, paramName, literal, paramName, ...]
  let regexSource = "";
  for (let i = 0; i < parts.length; i++) {
    if (i % 2 === 0) {
      // literal segment — escape regex special chars
      regexSource += parts[i].replace(/[.+?^$|[\]\\()]/g, "\\$&");
    } else {
      // param name
      paramNames.push(parts[i]);
      regexSource += "([^/]+)";
    }
  }

  const regex = new RegExp(`^${regexSource}$`);

  return (uri: string) => {
    const match = regex.exec(uri);
    if (!match) return null;
    const params: Record<string, string> = {};
    paramNames.forEach((name, i) => {
      params[name] = match[i + 1];
    });
    return params;
  };
}

export interface ResourceMatchResult<TEnv = unknown> {
  resource: RegisteredResource<TEnv>;
  params: Record<string, string>;
}

export interface ResourceRegistry<TEnv = unknown> {
  register(uri: string, config: ResourceConfig<TEnv>): void;
  get(uri: string): RegisteredResource<TEnv> | undefined;
  all(): RegisteredResource<TEnv>[];
  templates(): RegisteredResource<TEnv>[];
  match(uri: string): ResourceMatchResult<TEnv> | undefined;
  freeze(): void;
  readonly size: number;
}

export function createResourceRegistry<TEnv = unknown>(): ResourceRegistry<TEnv> {
  const store = new Map<string, RegisteredResource<TEnv>>();
  const matchers = new Map<string, (uri: string) => Record<string, string> | null>();
  let frozen = false;

  return {
    register(uri, config) {
      if (frozen) throw new Error("Registry is frozen");
      if (store.has(uri)) throw new Error(`Resource "${uri}" already registered`);

      const template = isURITemplate(uri);

      const registered: RegisteredResource<TEnv> = {
        uri,
        description: config.description,
        mimeType: config.mimeType,
        handler: config.handler as any,
        subscribe: config.subscribe ?? false,
        isTemplate: template,
      };

      store.set(uri, registered);

      if (template) {
        matchers.set(uri, buildTemplateMatcher(uri));
      }
    },

    get(uri) {
      return store.get(uri);
    },

    all() {
      return Array.from(store.values());
    },

    templates() {
      return Array.from(store.values()).filter((r) => r.isTemplate);
    },

    match(uri) {
      // Exact match wins
      const exact = store.get(uri);
      if (exact) return { resource: exact, params: {} };

      // Try templates
      for (const [templateUri, matcher] of matchers) {
        const params = matcher(uri);
        if (params !== null) {
          return { resource: store.get(templateUri)!, params };
        }
      }

      return undefined;
    },

    freeze() {
      frozen = true;
    },

    get size() {
      return store.size;
    },
  };
}

// ─── Prompt Registry ──────────────────────────────────────────

export interface PromptRegistry<TEnv = unknown> {
  register<TArgs extends StandardSchemaV1 | undefined>(
    name: string,
    config: PromptConfig<TArgs, TEnv>,
  ): void;
  get(name: string): RegisteredPrompt<TEnv> | undefined;
  all(): RegisteredPrompt<TEnv>[];
  freeze(): void;
  readonly size: number;
}

export function createPromptRegistry<TEnv = unknown>(): PromptRegistry<TEnv> {
  const store = new Map<string, RegisteredPrompt<TEnv>>();
  let frozen = false;

  return {
    register(name, config) {
      if (frozen) throw new Error("Registry is frozen");
      if (store.has(name)) throw new Error(`Prompt "${name}" already registered`);

      const registered: RegisteredPrompt<TEnv> = {
        name,
        description: config.description,
        args: config.args,
        handler: config.handler as any,
      };

      store.set(name, registered);
    },

    get(name) {
      return store.get(name);
    },

    all() {
      return Array.from(store.values());
    },

    freeze() {
      frozen = true;
    },

    get size() {
      return store.size;
    },
  };
}
