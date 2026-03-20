import { describe, it, expect } from 'vitest'
import {
  detectInstalledPackages,
  buildCatalog,
  formatCatalog,
  executeCatalog,
  WORKKIT_PACKAGES,
} from '../src/commands/catalog'
import { createMockFs } from './helpers'

describe('catalog command', () => {
  describe('WORKKIT_PACKAGES', () => {
    it('includes core packages', () => {
      expect(WORKKIT_PACKAGES['@workkit/types']).toBeDefined()
      expect(WORKKIT_PACKAGES['@workkit/errors']).toBeDefined()
      expect(WORKKIT_PACKAGES['@workkit/env']).toBeDefined()
      expect(WORKKIT_PACKAGES['@workkit/d1']).toBeDefined()
    })

    it('includes all expected packages', () => {
      const count = Object.keys(WORKKIT_PACKAGES).length
      expect(count).toBeGreaterThanOrEqual(10)
    })
  })

  describe('detectInstalledPackages', () => {
    it('detects packages from dependencies', () => {
      const installed = detectInstalledPackages({
        dependencies: { '@workkit/env': '0.0.1', 'hono': '4.0.0' },
      })
      expect(installed.size).toBe(1)
      expect(installed.get('@workkit/env')).toBe('0.0.1')
    })

    it('detects packages from devDependencies', () => {
      const installed = detectInstalledPackages({
        devDependencies: { '@workkit/testing': '0.0.1' },
      })
      expect(installed.has('@workkit/testing')).toBe(true)
    })

    it('merges dependencies and devDependencies', () => {
      const installed = detectInstalledPackages({
        dependencies: { '@workkit/env': '0.0.1' },
        devDependencies: { '@workkit/testing': '0.0.1' },
      })
      expect(installed.size).toBe(2)
    })

    it('ignores non-workkit packages', () => {
      const installed = detectInstalledPackages({
        dependencies: { 'hono': '4.0.0', 'zod': '3.0.0' },
      })
      expect(installed.size).toBe(0)
    })

    it('handles missing dependencies', () => {
      const installed = detectInstalledPackages({})
      expect(installed.size).toBe(0)
    })
  })

  describe('buildCatalog', () => {
    it('marks installed packages', () => {
      const installed = new Map([['@workkit/env', '0.0.1']])
      const catalog = buildCatalog(installed)
      const envPkg = catalog.find((p) => p.name === '@workkit/env')
      expect(envPkg?.installed).toBe(true)
      expect(envPkg?.version).toBe('0.0.1')
    })

    it('marks uninstalled packages', () => {
      const catalog = buildCatalog(new Map())
      const allUninstalled = catalog.every((p) => !p.installed)
      expect(allUninstalled).toBe(true)
    })

    it('includes all workkit packages', () => {
      const catalog = buildCatalog(new Map())
      expect(catalog.length).toBe(Object.keys(WORKKIT_PACKAGES).length)
    })
  })

  describe('formatCatalog', () => {
    it('shows installed count', () => {
      const packages = [
        { name: '@workkit/env', version: '0.0.1', description: 'Env', installed: true },
        { name: '@workkit/d1', version: '', description: 'D1', installed: false },
      ]
      const output = formatCatalog(packages)
      expect(output).toContain('1/2 packages installed')
    })

    it('shows package names and descriptions', () => {
      const packages = [
        { name: '@workkit/env', version: '0.0.1', description: 'Environment bindings', installed: true },
      ]
      const output = formatCatalog(packages)
      expect(output).toContain('@workkit/env')
      expect(output).toContain('Environment bindings')
    })

    it('shows version for installed packages', () => {
      const packages = [
        { name: '@workkit/env', version: '0.0.1', description: 'Env', installed: true },
      ]
      const output = formatCatalog(packages)
      expect(output).toContain('[0.0.1]')
    })

    it('shows not installed for missing packages', () => {
      const packages = [
        { name: '@workkit/d1', version: '', description: 'D1', installed: false },
      ]
      const output = formatCatalog(packages)
      expect(output).toContain('[not installed]')
    })
  })

  describe('executeCatalog', () => {
    it('reads package.json and builds catalog', async () => {
      const fs = createMockFs({
        '/app/package.json': JSON.stringify({
          dependencies: { '@workkit/env': '0.0.1', '@workkit/d1': '0.0.1' },
        }),
      })
      const catalog = await executeCatalog('/app', fs)
      const envPkg = catalog.find((p) => p.name === '@workkit/env')
      expect(envPkg?.installed).toBe(true)
    })

    it('handles missing package.json', async () => {
      const fs = createMockFs()
      const catalog = await executeCatalog('/empty', fs)
      const allUninstalled = catalog.every((p) => !p.installed)
      expect(allUninstalled).toBe(true)
    })
  })
})
