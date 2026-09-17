import * as path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: [
      {
        find: /^@peakcode\/contracts$/,
        replacement: path.resolve(import.meta.dirname, "./packages/contracts/src/index.ts"),
      },
      // Web sources import through the `~/*` -> `apps/web/src/*` path alias (see
      // apps/web/tsconfig.json). Runs started from the repo root — like the PR review
      // script's affected-test pass — need it too.
      {
        find: /^~\//,
        replacement: `${path.resolve(import.meta.dirname, "./apps/web/src")}/`,
      },
    ],
  },
});
