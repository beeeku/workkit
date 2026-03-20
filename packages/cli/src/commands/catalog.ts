import type { FileSystem } from '../utils'

export interface PackageInfo {
  name: string
  version: string
  description: string
  installed: boolean
}

/**
 * All workkit packages with descriptions.
 */
export const WORKKIT_PACKAGES: Record<string, string> = {
  '@workkit/types': 'Shared TypeScript types — Result, branded IDs, typed bindings',
  '@workkit/errors': 'Structured error types with retry classification',
  '@workkit/env': 'Typed environment bindings with Standard Schema validation',
  '@workkit/d1': 'Type-safe D1 query helpers with query builder and migrations',
  '@workkit/kv': 'Typed KV namespace wrapper with serialization',
  '@workkit/r2': 'R2 bucket helpers with streaming and metadata',
  '@workkit/cache': 'Cache API wrapper with typed keys and TTL',
  '@workkit/queue': 'Queue producer/consumer with typed messages',
  '@workkit/cron': 'Cron trigger handler with typed scheduling',
  '@workkit/auth': 'Authentication and authorization helpers',
  '@workkit/ratelimit': 'Rate limiting with sliding window and token bucket',
  '@workkit/do': 'Durable Objects helpers with typed state',
  '@workkit/api': 'API route builder with typed request/response',
  '@workkit/testing': 'Test utilities and mocks for Cloudflare bindings',
  '@workkit/crypto': 'Web Crypto API helpers for Workers',
  '@workkit/ai': 'Workers AI integration helpers',
  '@workkit/ai-gateway': 'AI Gateway integration helpers',
}

/**
 * Detect installed workkit packages from package.json.
 */
export function detectInstalledPackages(
  packageJson: { dependencies?: Record<string, string>; devDependencies?: Record<string, string> },
): Map<string, string> {
  const installed = new Map<string, string>()
  const allDeps = {
    ...packageJson.dependencies,
    ...packageJson.devDependencies,
  }

  for (const [name, version] of Object.entries(allDeps)) {
    if (name.startsWith('@workkit/')) {
      installed.set(name, version)
    }
  }

  return installed
}

/**
 * Build the full catalog with installation status.
 */
export function buildCatalog(
  installed: Map<string, string>,
): PackageInfo[] {
  return Object.entries(WORKKIT_PACKAGES).map(([name, description]) => ({
    name,
    version: installed.get(name) ?? '',
    description,
    installed: installed.has(name),
  }))
}

/**
 * Format catalog for display.
 */
export function formatCatalog(packages: PackageInfo[]): string {
  const lines: string[] = ['workkit packages:\n']

  const maxName = Math.max(...packages.map((p) => p.name.length))

  for (const pkg of packages) {
    const status = pkg.installed ? `[${pkg.version}]` : '[not installed]'
    const name = pkg.name.padEnd(maxName + 2)
    lines.push(`  ${name}${status.padEnd(20)} ${pkg.description}`)
  }

  const installedCount = packages.filter((p) => p.installed).length
  lines.push(`\n${installedCount}/${packages.length} packages installed`)

  return lines.join('\n')
}

/**
 * Execute the catalog command.
 */
export async function executeCatalog(
  dir: string,
  fs: FileSystem,
): Promise<PackageInfo[]> {
  const pkgPath = `${dir}/package.json`

  let packageJson: { dependencies?: Record<string, string>; devDependencies?: Record<string, string> } = {}
  if (await fs.exists(pkgPath)) {
    packageJson = await fs.readJson(pkgPath)
  }

  const installed = detectInstalledPackages(packageJson)
  return buildCatalog(installed)
}
