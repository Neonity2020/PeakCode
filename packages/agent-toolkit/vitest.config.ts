import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    // 沙箱 / 影子 git 快照这些用例要真的起进程、真的写盘，默认 5s 不够。
    testTimeout: 45_000,
    hookTimeout: 45_000,
    setupFiles: ["./src/__tests__/setup.ts"],
  },
});
