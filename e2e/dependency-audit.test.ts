import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import path from 'path'

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
    it('@workkit/cache has no @workkit/types in dependencies', () => {
      const pkg = readPkg('packages/cache')
      expect(pkg.dependencies ?? {}).not.toHaveProperty('@workkit/types')
    })

    it('@workkit/cache has no @workkit/errors in dependencies', () => {
      const pkg = readPkg('packages/cache')
      expect(pkg.dependencies ?? {}).not.toHaveProperty('@workkit/errors')
    })

    it('@workkit/crypto has no @workkit/types in dependencies', () => {
      const pkg = readPkg('packages/crypto')
      expect(pkg.dependencies ?? {}).not.toHaveProperty('@workkit/types')
    })

    it('@workkit/crypto has no @workkit/errors in dependencies', () => {
      const pkg = readPkg('packages/crypto')
      expect(pkg.dependencies ?? {}).not.toHaveProperty('@workkit/errors')
    })
  })

  describe('CLI template deps are in devDependencies, not dependencies', () => {
    const templateDeps = ['@workkit/types', '@workkit/errors', '@workkit/env', '@workkit/d1']

    for (const dep of templateDeps) {
      it(`workkit CLI has ${dep} in devDependencies, not dependencies`, () => {
        const pkg = readPkg('packages/cli')
        expect(pkg.dependencies ?? {}).not.toHaveProperty(dep)
        expect(pkg.devDependencies).toHaveProperty(dep)
      })
    }
  })

  describe('@standard-schema/spec is a peerDep in remix, not a dep', () => {
    it('@workkit/remix has @standard-schema/spec in peerDependencies', () => {
      const pkg = readPkg('integrations/remix')
      expect(pkg.peerDependencies).toHaveProperty('@standard-schema/spec')
    })

    it('@workkit/remix does not have @standard-schema/spec in dependencies', () => {
      const pkg = readPkg('integrations/remix')
      expect(pkg.dependencies ?? {}).not.toHaveProperty('@standard-schema/spec')
    })
  })
})
