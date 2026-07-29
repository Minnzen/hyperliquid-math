import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: [
      'test/unit/**/*.test.ts',
      'test/property/**/*.test.ts',
      'test/metamorphic/**/*.test.ts',
      'test/differential/**/*.test.ts',
      'test/replay/**/*.test.ts',
      'test/oracle/**/*.test.ts',
      'test/contract/**/*.test.ts',
      'test/spot/**/*.test.ts',
      'test/hip1/**/*.test.ts',
      'test/hip3/**/*.test.ts',
      'test/hip4/**/*.test.ts',
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: [
        'src/index.ts',
        'src/hip1/index.ts',
        'src/hip3/index.ts',
        'src/identifiers/index.ts',
        'src/model/**/*.ts',
        'src/orderbook/index.ts',
        'src/positions/index.ts',
        'src/precision/index.ts',
        'src/spot/index.ts',
      ],
      thresholds: {
        branches: 100,
        functions: 100,
        lines: 100,
        statements: 100,
      },
    },
  },
})
