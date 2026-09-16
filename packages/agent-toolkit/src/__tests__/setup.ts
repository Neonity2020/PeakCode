import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeEach } from "vitest";

import { setAgentLogSink } from "../runtime/log.ts";
import { setAgentDataDir } from "../runtime/paths.ts";
import { createInMemoryAgentStore, setAgentStore } from "../store/AgentStore.ts";

/**
 * Shared test setup (registered as a vitest `setupFile`).
 *
 * Every test starts from a clean in-memory store and its own scratch data directory, so
 * snapshot repos, spilled tool output and plan files can never land in the real
 * application data directory — or leak from one test into the next.
 */
const scratchRoot = mkdtempSync(join(tmpdir(), "peakcode-agent-toolkit-"));

beforeEach(() => {
  setAgentStore(createInMemoryAgentStore());
  setAgentDataDir(mkdtempSync(join(scratchRoot, "case-")));
  setAgentLogSink(null);
});

afterAll(() => {
  rmSync(scratchRoot, { recursive: true, force: true });
});
