import type { FileSystem } from '../src/utils'

/**
 * In-memory mock file system for testing.
 */
export interface MockFileSystem extends FileSystem {
  files: Map<string, string>
}

export function createMockFs(initialFiles?: Record<string, string>): MockFileSystem {
  const files = new Map<string, string>(
    initialFiles ? Object.entries(initialFiles) : [],
  )

  return {
    files,
    async readFile(path: string): Promise<string> {
      const content = files.get(path)
      if (content === undefined) {
        throw new Error(`ENOENT: no such file: ${path}`)
      }
      return content
    },
    async writeFile(path: string, content: string): Promise<void> {
      files.set(path, content)
    },
    async mkdir(_path: string): Promise<void> {
      // noop for mock
    },
    async exists(path: string): Promise<boolean> {
      // Check exact file match
      if (files.has(path)) return true
      // Check if any file starts with this path (directory check)
      for (const key of files.keys()) {
        if (key.startsWith(path + '/')) return true
      }
      return false
    },
    async readDir(path: string): Promise<string[]> {
      const prefix = path.endsWith('/') ? path : path + '/'
      const entries = new Set<string>()
      for (const key of files.keys()) {
        if (key.startsWith(prefix)) {
          const rest = key.slice(prefix.length)
          const firstSegment = rest.split('/')[0]
          if (firstSegment) entries.add(firstSegment)
        }
      }
      return [...entries].sort()
    },
    async readJson<T = unknown>(path: string): Promise<T> {
      const content = files.get(path)
      if (content === undefined) {
        throw new Error(`ENOENT: no such file: ${path}`)
      }
      return JSON.parse(content) as T
    },
  }
}
