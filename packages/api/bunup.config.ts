import { defineConfig } from 'bunup'

export default defineConfig({
  entry: ['src/index.ts', 'src/client.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: 'linked',
  clean: true,
  external: [
    '@workkit/types',
    '@workkit/errors',
  ],
})
