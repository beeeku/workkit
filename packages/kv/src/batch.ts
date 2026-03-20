const DEFAULT_BATCH_CONCURRENCY = 6

export async function batchGet<T>(
  binding: KVNamespace,
  keys: string[],
  kvType: string,
  concurrency: number = DEFAULT_BATCH_CONCURRENCY,
): Promise<Map<string, T>> {
  const results = new Map<string, T>()

  await pMap(
    keys,
    async (key) => {
      const value = await binding.get(key, kvType as any)
      if (value !== null) {
        results.set(key, value as T)
      }
    },
    concurrency,
  )

  return results
}

export async function batchPut(
  binding: KVNamespace,
  entries: Array<{
    key: string
    value: string | ArrayBuffer | ReadableStream
    options?: KVNamespacePutOptions
  }>,
  concurrency: number = DEFAULT_BATCH_CONCURRENCY,
): Promise<void> {
  await pMap(
    entries,
    async ({ key, value, options }) => {
      await binding.put(key, value as any, options)
    },
    concurrency,
  )
}

export async function batchDelete(
  binding: KVNamespace,
  keys: string[],
  concurrency: number = DEFAULT_BATCH_CONCURRENCY,
): Promise<void> {
  await pMap(
    keys,
    async (key) => {
      await binding.delete(key)
    },
    concurrency,
  )
}

async function pMap<T, R>(
  items: T[],
  fn: (item: T) => Promise<R>,
  concurrency: number,
): Promise<R[]> {
  const results: R[] = []
  let index = 0

  async function worker(): Promise<void> {
    while (index < items.length) {
      const i = index++
      results[i] = await fn(items[i])
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () =>
    worker(),
  )
  await Promise.all(workers)
  return results
}
