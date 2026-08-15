/**
 * dsh-shift-router — client bundle build (tsdown)
 *
 * Mirrors the DSH repo's `packages/client/tsdown.client.ts` protocol: bundle
 * the tsc-compiled browser half (`dist/client/index.js`) into one CJS
 * closure-factory served as `/plugins/dsh-shift-router/client.js`, with
 * platform modules left as `require(...)` calls the browser module loader
 * answers. See `src/client/index.tsx` for the browser entry.
 */

import { defineConfig } from 'tsdown'

export default defineConfig({
  name: 'dsh-shift-router/client',
  entry: { client: 'dist/client/index.js' },
  outDir: 'dist',
  format: 'cjs',
  platform: 'browser',
  dts: false,
  sourcemap: true,
  clean: false,
  // Platform seed words + the one graph entry this bundle value-imports.
  deps: {
    neverBundle: [
      'react',
      'react/jsx-runtime',
      '@deepseek-ai/dsh-client-runtime/client',
    ],
  },
  define: {
    'process.env.NODE_ENV': JSON.stringify('production'),
  },
  outputOptions: {
    entryFileNames: 'client.js',
    banner: 'window.__ModuleLoader__.load({ id: "dsh-shift-router", factory: (require) => {',
    footer: 'return module.exports; } });',
    intro: 'var module = { exports: {} }; var exports = module.exports;',
  },
})
