import type { NativeApi, PiPackagesSnapshot } from "@peakcode/contracts";
import { QueryClient } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import * as nativeApi from "../nativeApi";
import { providerDiscoveryQueryKeys } from "./providerDiscoveryReactQuery";
import {
  installPiPackageMutationOptions,
  piPackagesQueryKeys,
  piPackagesQueryOptions,
  removePiPackageMutationOptions,
} from "./piPackagesReactQuery";

afterEach(() => vi.restoreAllMocks());

const emptySnapshot: PiPackagesSnapshot = {
  agentDir: "/agent",
  settingsPath: "/agent/settings.json",
  packages: [],
};

it("lists packages from the requested directory with a separate cache", async () => {
  const listPiPackages = vi.fn().mockResolvedValue(emptySnapshot);
  vi.spyOn(nativeApi, "ensureNativeApi").mockReturnValue({
    server: { listPiPackages },
  } as unknown as NativeApi);
  const client = new QueryClient();
  await client.fetchQuery(piPackagesQueryOptions("/custom"));
  expect(listPiPackages).toHaveBeenCalledWith({ agentDir: "/custom" });
  expect(client.getQueryData(piPackagesQueryKeys.list())).toBeUndefined();
  client.clear();
});

it("stores the snapshot returned by install and invalidates package-derived discovery caches", async () => {
  const client = new QueryClient();
  const snapshot: PiPackagesSnapshot = {
    ...emptySnapshot,
    packages: [
      {
        source: "npm:@melihmucuk/pi-crew",
        kind: "npm",
        scope: "user",
        filtered: false,
        resources: { extensions: 1, skills: 1, prompts: 2, themes: 0 },
      },
    ],
  };
  const installPiPackage = vi.fn().mockResolvedValue(snapshot);
  vi.spyOn(nativeApi, "ensureNativeApi").mockReturnValue({
    server: { installPiPackage },
  } as unknown as NativeApi);
  const discoveryKey = providerDiscoveryQueryKeys.models("pi", null, null, null);
  client.setQueryData(discoveryKey, { models: [] });
  await installPiPackageMutationOptions(client).onSuccess(snapshot, {
    agentDir: "/agent",
    source: "npm:@melihmucuk/pi-crew",
  });
  expect(client.getQueryData(piPackagesQueryKeys.list("/agent"))).toEqual(snapshot);
  expect(client.getQueryState(discoveryKey)?.isInvalidated).toBe(true);
  client.clear();
});

it("replaces the cache with the post-remove listing", async () => {
  const client = new QueryClient();
  client.setQueryData(piPackagesQueryKeys.list("/agent"), {
    ...emptySnapshot,
    packages: [{ source: "git:host/repo", kind: "git", scope: "user", filtered: false }],
  } as unknown as PiPackagesSnapshot);
  const removePiPackage = vi.fn().mockResolvedValue(emptySnapshot);
  vi.spyOn(nativeApi, "ensureNativeApi").mockReturnValue({
    server: { removePiPackage },
  } as unknown as NativeApi);
  await removePiPackageMutationOptions(client).onSuccess(emptySnapshot, { agentDir: "/agent" });
  const cached = client.getQueryData<PiPackagesSnapshot>(piPackagesQueryKeys.list("/agent"));
  expect(cached?.packages).toEqual([]);
  client.clear();
});
