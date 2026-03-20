import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import path from 'path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

function readPkg(relPath: string) {
  const full = path.resolve(__dirname, '..', relPath, 'package.json')
  return JSON.parse(readFileSync(full, 'utf-8'))
}

describe('P0 dependency audit', () => {
  describe('unlisted dependencies are declared', () => {
    it('@workkit/astro has @standard-schema/spec in devDependencies', () => {
      const pkg = readPkg('integrations/astro')
      expect(pkg.devDependencies).toHaveProperty('@standard-schema/spec')
    })

    it('@workkit/hono has zod in devDependencies', () => {
      const pkg = readPkg('integrations/hono')
      expect(pkg.devDependencies).toHaveProperty('zod')
    })
  })

  describe('unused runtime dependencies are removed', () => {
    it('@workkit/cache has no @workkit/types or @workkit/errors in dependencies', () => {
      const pkg = readPkg('packages/cache')
      expect(pkg.dependencies ?? {}).not.toHaveProperty('@workkit/types')
      expect(pkg.dependencies ?? {}).not.toHaveProperty('@workkit/errors')
    })

    it('@workkit/crypto has no @workkit/types or @workkit/errors in dependencies', () => {
      const pkg = readPkg('packages/crypto')
      expect(pkg.dependencies ?? {}).not.toHaveProperty('@workkit/types')
      expect(pkg.dependencies ?? {}).not.toHaveProperty('@workkit/errors')
    })
  })

  describe('CLI external deps are in dependencies for runtime resolution', () => {
    const externalDeps = ['@workkit/types', '@workkit/errors', '@workkit/env', '@workkit/d1']

    for (const dep of externalDeps) {
      it(`workkit CLI has ${dep} in dependencies`, () => {
        const pkg = readPkg('packages/cli')
        expect(pkg.dependencies).toHaveProperty(dep)
      })
    }
  })

  describe('@standard-schema/spec in remix', () => {
    const pkg = readPkg('integrations/remix')

    it('is in peerDependencies', () => {
      expect(pkg.peerDependencies).toHaveProperty('@standard-schema/spec')
    })

    it('is not in runtime dependencies', () => {
      expect(pkg.dependencies ?? {}).not.toHaveProperty('@standard-schema/spec')
    })
  })
})
