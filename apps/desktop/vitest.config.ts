import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

/** The aliases, mirrored from `electron.vite.config.ts`. */
const alias = {
  '~': r('src/renderer'),
  '@shared-types': r('../../packages/shared-types/src/index.ts'),
  '@shared-ipc': r('../../packages/shared-ipc/src/index.ts'),
  '@adapter-contract': r('../../packages/adapter-contract/src/index.ts'),
  '@market-sdk': r('../../packages/market-sdk/src/index.ts'),
};

/** `electron-log` требует `electron`, а тот падает без распакованного бинарника — в CI его нет. */
const stubs = {
  'electron-log/main': r('src/main/testing/electron-log.stub.ts'),
  'electron-log/renderer': r('src/main/testing/electron-log.stub.ts'),
};

/** Two projects, split by file extension. */
export default defineConfig({
  test: {
    projects: [
      {
        resolve: { alias: { ...alias, ...stubs } },
        test: {
          name: { label: 'node', color: 'green' },
          include: ['src/**/__tests__/**/*.test.ts'],
          environment: 'node',
        },
      },
      {
        // The React plugin, so JSX and Fast Refresh's `@vitejs/plugin-react` transform behave exactly as they do.
        plugins: [react()],
        resolve: { alias: { ...alias, ...stubs } },
        test: {
          name: { label: 'dom', color: 'magenta' },
          include: ['src/renderer/**/__tests__/**/*.test.tsx'],
          environment: 'jsdom',
          setupFiles: [r('src/renderer/testing/setup.ts')],
          // The renderer's styles are SCSS Modules; under jsdom the class names are the only part that matters.
          css: false,
        },
      },
    ],
  },
});
