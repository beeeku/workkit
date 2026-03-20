import type { Feature } from "../commands/init";
import type { GeneratedFile } from "../commands/init";

/**
 * Generate source files for the "api" template.
 * A structured API Worker with route handlers.
 */
export function generateApiTemplate(name: string, features: Feature[]): GeneratedFile[] {
	const imports: string[] = [];
	const envFields: string[] = [];

	if (features.includes("env")) {
		imports.push(`import { createEnv } from '@workkit/env'`);
	}
	if (features.includes("d1")) {
		envFields.push("  DB: D1Database");
	}
	if (features.includes("kv")) {
		envFields.push("  KV: KVNamespace");
	}
	if (features.includes("r2")) {
		envFields.push("  BUCKET: R2Bucket");
	}

	const envType =
		envFields.length > 0
			? `\nexport interface Env {\n${envFields.join("\n")}\n}\n`
			: "\nexport interface Env {}\n";

	const routerTs = `${envType}
export interface Route {
  method: string
  pattern: string
  handler: (request: Request, env: Env) => Promise<Response>
}

export function createRouter(routes: Route[]) {
  return async (request: Request, env: Env): Promise<Response> => {
    const url = new URL(request.url)
    const method = request.method

    for (const route of routes) {
      if (route.method === method && url.pathname === route.pattern) {
        return route.handler(request, env)
      }
    }

    return Response.json({ error: 'Not Found' }, { status: 404 })
  }
}
`;

	const handlersTs = `import type { Env } from './router'

export async function healthHandler(_request: Request, _env: Env): Promise<Response> {
  return Response.json({ status: 'ok', name: '${name}' })
}

export async function rootHandler(_request: Request, _env: Env): Promise<Response> {
  return Response.json({ message: 'Hello from ${name}!' })
}
`;

	const envSetup = features.includes("env") ? "    const env = createEnv<Env>(rawEnv)\n" : "";
	const envParam = features.includes("env") ? "rawEnv" : "env";

	const indexTs = `${imports.join("\n")}${imports.length > 0 ? "\n" : ""}import { createRouter } from './router'
import { healthHandler, rootHandler } from './handlers'
import type { Env } from './router'

const router = createRouter([
  { method: 'GET', pattern: '/health', handler: healthHandler },
  { method: 'GET', pattern: '/', handler: rootHandler },
])

export default {
  async fetch(request: Request, ${envParam}: Env): Promise<Response> {
${envSetup}    return router(request, env)
  },
} satisfies ExportedHandler<Env>
`;

	const testTs = `import { describe, it, expect } from 'vitest'
import { createRouter } from '../src/router'
import type { Route, Env } from '../src/router'

describe('API Router', () => {
  const mockEnv = {} as Env

  it('routes to matching handler', async () => {
    const routes: Route[] = [
      {
        method: 'GET',
        pattern: '/test',
        handler: async () => Response.json({ ok: true }),
      },
    ]
    const router = createRouter(routes)
    const req = new Request('http://localhost/test')
    const res = await router(req, mockEnv)
    expect(res.status).toBe(200)
  })

  it('returns 404 for unmatched routes', async () => {
    const router = createRouter([])
    const req = new Request('http://localhost/missing')
    const res = await router(req, mockEnv)
    expect(res.status).toBe(404)
  })
})
`;

	return [
		{ path: "src/router.ts", content: routerTs },
		{ path: "src/handlers.ts", content: handlersTs },
		{ path: "src/index.ts", content: indexTs },
		{ path: "tests/api.test.ts", content: testTs },
	];
}
