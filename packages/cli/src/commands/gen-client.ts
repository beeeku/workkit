import type { FileSystem } from '../utils'

export interface RouteDefinition {
  method: string
  path: string
  name: string
  requestType?: string
  responseType?: string
}

export interface GenClientOptions {
  sourceDir: string
  output: string
}

/**
 * Extract route definitions from source files.
 * Looks for patterns like:
 *   app.get('/path', handler)
 *   { method: 'GET', pattern: '/path', handler: fnName }
 *   router.post('/path', handler)
 */
export function extractRoutes(source: string, _fileName: string): RouteDefinition[] {
  const routes: RouteDefinition[] = []

  // Pattern 1: app.method('/path', handler) — Hono-style
  const honoRegex = /\.\s*(get|post|put|delete|patch)\s*\(\s*['"]([^'"]+)['"]/gi
  let match: RegExpExecArray | null
  while ((match = honoRegex.exec(source)) !== null) {
    const method = match[1]!.toUpperCase()
    const path = match[2]!
    const name = routeToFnName(method, path)
    routes.push({ method, path, name })
  }

  // Pattern 2: { method: 'GET', pattern: '/path' } — workkit router style
  const routerRegex = /method:\s*['"](\w+)['"],\s*pattern:\s*['"]([^'"]+)['"]/gi
  while ((match = routerRegex.exec(source)) !== null) {
    const method = match[1]!.toUpperCase()
    const path = match[2]!
    const name = routeToFnName(method, path)
    routes.push({ method, path, name })
  }

  return routes
}

/**
 * Convert method + path to a function name.
 * GET /users/:id -> getUser
 * POST /users -> createUser
 * GET /health -> getHealth
 */
export function routeToFnName(method: string, path: string): string {
  const segments = path
    .split('/')
    .filter((s) => s && !s.startsWith(':'))
    .map((s) => s.replace(/[^a-zA-Z0-9]/g, ''))

  const prefix = method.toLowerCase() === 'post'
    ? 'create'
    : method.toLowerCase() === 'put'
      ? 'update'
      : method.toLowerCase() === 'delete'
        ? 'remove'
        : method.toLowerCase()

  if (segments.length === 0) {
    return `${prefix}Root`
  }

  const parts = segments.map((s) => s.charAt(0).toUpperCase() + s.slice(1))

  return `${prefix}${parts.join('')}`
}

/**
 * Generate a typed API client from route definitions.
 */
export function generateClientCode(
  routes: RouteDefinition[],
  baseUrl: string = '',
): string {
  const lines: string[] = [
    '/**',
    ' * Auto-generated API client by workkit gen client.',
    ' * Do not edit manually.',
    ' */',
    '',
    'export interface ClientOptions {',
    '  baseUrl: string',
    '  headers?: Record<string, string>',
    '}',
    '',
    'async function request(options: ClientOptions, method: string, path: string, body?: unknown): Promise<Response> {',
    '  const url = `${options.baseUrl}${path}`',
    '  const headers: Record<string, string> = {',
    "    ...options.headers,",
    '  }',
    '  if (body !== undefined) {',
    "    headers['content-type'] = 'application/json'",
    '  }',
    '  return fetch(url, {',
    '    method,',
    '    headers,',
    '    body: body !== undefined ? JSON.stringify(body) : undefined,',
    '  })',
    '}',
    '',
    'export function createClient(options: ClientOptions) {',
    '  return {',
  ]

  for (const route of routes) {
    const hasBody = ['POST', 'PUT', 'PATCH'].includes(route.method)
    const params = hasBody
      ? 'body?: unknown'
      : ''

    lines.push(`    /** ${route.method} ${route.path} */`)
    lines.push(`    ${route.name}(${params}): Promise<Response> {`)
    if (hasBody) {
      lines.push(`      return request(options, '${route.method}', '${route.path}', body)`)
    } else {
      lines.push(`      return request(options, '${route.method}', '${route.path}')`)
    }
    lines.push('    },')
  }

  lines.push('  }')
  lines.push('}')
  lines.push('')

  return lines.join('\n')
}

/**
 * Execute the gen client command.
 */
export async function executeGenClient(
  options: GenClientOptions,
  fs: FileSystem,
): Promise<string> {
  if (!await fs.exists(options.sourceDir)) {
    throw new Error(`Source directory not found: ${options.sourceDir}`)
  }

  const entries = await fs.readDir(options.sourceDir)
  const tsFiles = entries.filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))

  const allRoutes: RouteDefinition[] = []

  for (const file of tsFiles) {
    const content = await fs.readFile(`${options.sourceDir}/${file}`)
    const routes = extractRoutes(content, file)
    allRoutes.push(...routes)
  }

  if (allRoutes.length === 0) {
    throw new Error('No route definitions found in source files')
  }

  const clientCode = generateClientCode(allRoutes)
  await fs.writeFile(options.output, clientCode)

  return clientCode
}
