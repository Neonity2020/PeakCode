import { CommandId, ProjectId, type ClientOrchestrationCommand } from "@peakcode/contracts";
import { Effect, Path, FileSystem } from "effect";
import { describe, expect, it, vi } from "vitest";

import { makeDispatchCommandNormalizer } from "./dispatchCommandNormalization.ts";

const CANONICAL_ROOT = "/canonical/root";

function makeNormalizer() {
  const canonicalizeProjectWorkspaceRoot = vi.fn(
    (_workspaceRoot: string, _options?: { readonly createIfMissing?: boolean }) =>
      Effect.succeed(CANONICAL_ROOT),
  );
  const normalize = makeDispatchCommandNormalizer({
    attachmentsDir: "/tmp/attachments",
    fileSystem: {} as FileSystem.FileSystem,
    path: {} as Path.Path,
    canonicalizeProjectWorkspaceRoot,
  });
  return { canonicalizeProjectWorkspaceRoot, normalize };
}

function projectMetaUpdateCommand(
  overrides: Partial<Extract<ClientOrchestrationCommand, { type: "project.meta.update" }>> = {},
): ClientOrchestrationCommand {
  return {
    type: "project.meta.update",
    commandId: CommandId.makeUnsafe("cmd-project-meta"),
    projectId: ProjectId.makeUnsafe("project-1"),
    workspaceRoot: "/Users/tester/.peakcode/workspace",
    ...overrides,
  } as ClientOrchestrationCommand;
}

describe("dispatchCommandNormalization", () => {
  it("does not create the workspace root when repointing a project by default", async () => {
    const { canonicalizeProjectWorkspaceRoot, normalize } = makeNormalizer();

    const normalized = await Effect.runPromise(normalize({ command: projectMetaUpdateCommand() }));

    expect(canonicalizeProjectWorkspaceRoot).toHaveBeenCalledWith(expect.any(String), {
      createIfMissing: false,
    });
    expect(normalized).toMatchObject({ workspaceRoot: CANONICAL_ROOT });
  });

  it("creates the workspace root when the command asks for it", async () => {
    const { canonicalizeProjectWorkspaceRoot, normalize } = makeNormalizer();

    await Effect.runPromise(
      normalize({ command: projectMetaUpdateCommand({ createWorkspaceRootIfMissing: true }) }),
    );

    expect(canonicalizeProjectWorkspaceRoot).toHaveBeenCalledWith(expect.any(String), {
      createIfMissing: true,
    });
  });
});
