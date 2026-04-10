import { defineConfig } from 'tsup';

export default defineConfig([
  {
    entry: { index: 'src/index.ts' },
    format: ['cjs', 'esm'],
    dts: true,
    sourcemap: true,
    clean: true,
    outDir: 'dist',
    platform: 'browser',
    target: 'es2020',
    external: ['ws'],
  },
  {
    entry: { 'server/index': 'server/index.ts' },
    format: ['cjs', 'esm'],
    dts: true,
    sourcemap: true,
    outDir: 'dist',
    platform: 'node',
    target: 'node18',
  },
]);
