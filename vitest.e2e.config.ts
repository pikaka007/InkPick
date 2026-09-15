import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/e2e/**/*.test.ts'],
    environment: 'node',
    // 真实启动 Electron，慢且串行
    testTimeout: 60_000,
    hookTimeout: 60_000,
    fileParallelism: false
  }
})
