import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Node environment — fans.ts is pure Electron-main code, no DOM.
    environment: 'node',
    include: ['test/**/*.test.ts'],
    // fans.ts holds module-level singletons (the in-memory fan map, reminder
    // events, gift buffer). Give each TEST FILE its own forked process so those
    // singletons — and the fake-timer state used by the reminder suite — can't
    // leak across files. Within a file we still reset via clearAll() +
    // wipeDataDir() in beforeEach. `isolate` keeps the module registry fresh.
    pool: 'forks',
    isolate: true,
    fileParallelism: false,
    clearMocks: true,
  },
});
