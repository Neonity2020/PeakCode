import { QueryClient, QueryObserver } from "@tanstack/react-query";
import type { NativeApi } from "@peakcode/contracts";
import { afterEach, expect, it, vi } from "vitest";
import * as nativeApi from "../nativeApi";
import { modelProvidersQueryKeys, modelProvidersQueryOptions, saveModelProvidersMutationOptions } from "./modelProvidersReactQuery";
import { providerDiscoveryQueryKeys } from "./providerDiscoveryReactQuery";

afterEach(() => vi.restoreAllMocks());

it("reads configuration from the requested directory with a separate cache", async () => {
  const listModelProviders = vi.fn().mockResolvedValue({ path: "/custom/models.json", providers: {} });
  vi.spyOn(nativeApi, "ensureNativeApi").mockReturnValue({ server: { listModelProviders } } as unknown as NativeApi);
  const client = new QueryClient();
  await client.fetchQuery(modelProvidersQueryOptions("/custom"));
  expect(listModelProviders).toHaveBeenCalledWith({ agentDir: "/custom" });
  expect(client.getQueryData(modelProvidersQueryKeys.file())).toBeUndefined();
  client.clear();
});

it("refreshes active model pickers, invalidates inactive pickers, and keeps directory caches isolated", async () => {
  const client = new QueryClient();
  const activeKey = providerDiscoveryQueryKeys.models("pi", null, null, "/custom");
  const inactiveKey = providerDiscoveryQueryKeys.models("pi", null, null, null);
  client.setQueryData(activeKey, { models: [] });
  client.setQueryData(inactiveKey, { models: [] });
  const queryFn = vi.fn().mockResolvedValue({ models: [{ slug: "custom/new" }] });
  const observer = new QueryObserver(client, { queryKey: activeKey, queryFn, staleTime: Infinity });
  const unsubscribe = observer.subscribe(() => {});
  const saved = { path: "/custom/models.json", providers: { custom: { name: "Custom" } } };
  await saveModelProvidersMutationOptions(client).onSuccess(saved, { agentDir: "/custom", providers: saved.providers });
  expect(queryFn).toHaveBeenCalledTimes(1);
  expect(client.getQueryData(activeKey)).toEqual({ models: [{ slug: "custom/new" }] });
  expect(client.getQueryState(inactiveKey)?.isInvalidated).toBe(true);
  expect(client.getQueryData(modelProvidersQueryKeys.file("/custom"))).toEqual(saved);
  expect(client.getQueryData(modelProvidersQueryKeys.file())).toBeUndefined();
  unsubscribe();
  client.clear();
});
