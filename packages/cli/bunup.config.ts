import { defineConfig } from 'bunup'

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: 'linked',
  external: [
    '@workkit/types',
    '@workkit/errors',
    '@workkit/env',
    '@workkit/d1',
  ],
  clean: true,
  banner: {
    js: '#!/usr/bin/env node',
  },
})
