import type { FileSystem } from '../utils'
import { joinPath, success, info, error as logError } from '../utils'
import { generateBasicTemplate } from '../templates/basic'
import { generateHonoTemplate } from '../templates/hono'
import { generateApiTemplate } from '../templates/api'

export type Template = 'basic' | 'hono' | 'api'
export type Feature = 'env' | 'd1' | 'kv' | 'r2' | 'cache' | 'queue' | 'cron' | 'auth' | 'ratelimit'

export const VALID_TEMPLATES: Template[] = ['basic', 'hono', 'api']
export const VALID_FEATURES: Feature[] = ['env', 'd1', 'kv', 'r2', 'cache', 'queue', 'cron', 'auth', 'ratelimit']

export interface InitOptions {
  name?: string
  template?: Template
  features?: Feature[]
  dir?: string
}

export interface GeneratedFile {
  path: string
  content: string
}

/**
 * Resolve project name from options or directory name.
 */
export function resolveProjectName(options: InitOptions, dir: string): string {
  if (options.name) return options.name
  const parts = dir.split('/').filter(Boolean)
  return parts[parts.length - 1] ?? 'my-worker'
}

/**
 * Build package.json content for the new project.
 */
export function buildPackageJson(name: string, features: Feature[]): string {
  const deps: Record<string, string> = {}
  const devDeps: Record<string, string> = {
    'wrangler': '^3.0.0',
    'typescript': '^5.7.0',
    'vitest': '^3.0.0',
    '@cloudflare/workers-types': '^4.20250310.0',
  }

  // Always include types and errors
  deps['@workkit/types'] = 'latest'
  deps['@workkit/errors'] = 'latest'

  for (const feature of features) {
    deps[`@workkit/${feature}`] = 'latest'
  }

  const pkg = {
    name,
    version: '0.0.0',
    private: true,
    type: 'module',
    scripts: {
      dev: 'wrangler dev',
      deploy: 'wrangler deploy',
      test: 'vitest run',
      typecheck: 'tsc --noEmit',
    },
    dependencies: deps,
    devDependencies: devDeps,
  }

  return JSON.stringify(pkg, null, 2) + '\n'
}

/**
 * Build wrangler.toml content.
 */
export function buildWranglerToml(name: string, features: Feature[]): string {
  const lines = [
    `name = "${name}"`,
    `main = "src/index.ts"`,
    `compatibility_date = "${new Date().toISOString().split('T')[0]}"`,
    '',
  ]

  if (features.includes('d1')) {
    lines.push(
      '[[d1_databases]]',
      `binding = "DB"`,
      `database_name = "${name}-db"`,
      `database_id = ""`,
      '',
    )
  }

  if (features.includes('kv')) {
    lines.push(
      '[[kv_namespaces]]',
      `binding = "KV"`,
      `id = ""`,
      '',
    )
  }

  if (features.includes('r2')) {
    lines.push(
      '[[r2_buckets]]',
      `binding = "BUCKET"`,
      `bucket_name = "${name}-bucket"`,
      '',
    )
  }

  if (features.includes('queue')) {
    lines.push(
      '[[queues.producers]]',
      `queue = "${name}-queue"`,
      `binding = "QUEUE"`,
      '',
    )
  }

  return lines.join('\n')
}

/**
 * Build tsconfig.json content.
 */
export function buildTsconfig(): string {
  const config = {
    compilerOptions: {
      target: 'ES2022',
      module: 'ESNext',
      moduleResolution: 'bundler',
      strict: true,
      esModuleInterop: true,
      skipLibCheck: true,
      forceConsistentCasingInFileNames: true,
      resolveJsonModule: true,
      isolatedModules: true,
      noUncheckedIndexedAccess: true,
      types: ['@cloudflare/workers-types'],
      lib: ['ES2022'],
    },
    include: ['src/**/*.ts'],
    exclude: ['node_modules', 'dist'],
  }
  return JSON.stringify(config, null, 2) + '\n'
}

/**
 * Build vitest.config.ts content.
 */
export function buildVitestConfig(): string {
  return `import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
  },
})
`
}

/**
 * Generate all project files based on template and features.
 */
export function generateProjectFiles(
  name: string,
  template: Template,
  features: Feature[],
): GeneratedFile[] {
  const files: GeneratedFile[] = [
    { path: 'package.json', content: buildPackageJson(name, features) },
    { path: 'wrangler.toml', content: buildWranglerToml(name, features) },
    { path: 'tsconfig.json', content: buildTsconfig() },
    { path: 'vitest.config.ts', content: buildVitestConfig() },
  ]

  // Generate template-specific source files
  let templateFiles: GeneratedFile[]
  switch (template) {
    case 'hono':
      templateFiles = generateHonoTemplate(name, features)
      break
    case 'api':
      templateFiles = generateApiTemplate(name, features)
      break
    case 'basic':
    default:
      templateFiles = generateBasicTemplate(name, features)
      break
  }

  files.push(...templateFiles)
  return files
}

/**
 * Parse features from a comma-separated string.
 */
export function parseFeatures(input: string): Feature[] {
  const raw = input.split(',').map((s) => s.trim().toLowerCase())
  const valid: Feature[] = []
  const invalid: string[] = []

  for (const f of raw) {
    if (VALID_FEATURES.includes(f as Feature)) {
      valid.push(f as Feature)
    } else if (f !== '') {
      invalid.push(f)
    }
  }

  if (invalid.length > 0) {
    logError(`Unknown features: ${invalid.join(', ')}. Valid: ${VALID_FEATURES.join(', ')}`)
  }

  return valid
}

/**
 * Execute the init command: write project files to disk.
 */
export async function executeInit(
  options: InitOptions,
  fs: FileSystem,
): Promise<GeneratedFile[]> {
  const dir = options.dir ?? process.cwd()
  const name = resolveProjectName(options, dir)
  const template = options.template ?? 'basic'
  const features = options.features ?? ['env']

  if (!VALID_TEMPLATES.includes(template)) {
    throw new Error(`Unknown template "${template}". Valid: ${VALID_TEMPLATES.join(', ')}`)
  }

  const files = generateProjectFiles(name, template, features)

  for (const file of files) {
    const fullPath = joinPath(dir, file.path)
    await fs.writeFile(fullPath, file.content)
    success(`Created ${file.path}`)
  }

  info(`Project "${name}" initialized with template "${template}"`)
  return files
}
