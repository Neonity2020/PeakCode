// FILE: automationReactQuery.ts
// Purpose: React Query hooks for the automations view (scheduled tasks and their runs).
// Layer: Web data fetching helpers

import type {
  Automation,
  AutomationId,
  AutomationRun,
  CreateAutomationInput,
  UpdateAutomationInput,
} from "@peakcode/contracts";
import { queryOptions, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ensureNativeApi } from "../nativeApi";
import { toastManager } from "../components/ui/toast";
import { useMessages } from "../i18n";

/**
 * Runs happen on the server's clock — scheduled ones start with nobody at the keyboard — so
 * an open list refreshes on its own instead of waiting for the user to come back.
 */
const AUTOMATION_POLL_INTERVAL_MS = 10_000;
const RUN_POLL_INTERVAL_MS = 5_000;

export const automationQueryKeys = {
  all: ["automations"] as const,
  list: () => [...automationQueryKeys.all, "list"] as const,
  runs: (automationId: AutomationId | null) =>
    [...automationQueryKeys.all, "runs", automationId] as const,
};

export const automationsQueryOptions = () =>
  queryOptions({
    queryKey: automationQueryKeys.list(),
    queryFn: async () => ensureNativeApi().automation.list({}),
    refetchInterval: AUTOMATION_POLL_INTERVAL_MS,
    refetchIntervalInBackground: false,
  });

export function useAutomationsQuery() {
  return useQuery(automationsQueryOptions());
}

export const automationRunsQueryOptions = (automationId: AutomationId | null) =>
  queryOptions({
    queryKey: automationQueryKeys.runs(automationId),
    queryFn: async () => {
      if (!automationId) throw new Error("No automation selected");
      return ensureNativeApi().automation.listRuns({ automationId, limit: 10 });
    },
    enabled: automationId !== null,
    refetchInterval: RUN_POLL_INTERVAL_MS,
    refetchIntervalInBackground: false,
  });

export function useAutomationRunsQuery(automationId: AutomationId | null) {
  return useQuery(automationRunsQueryOptions(automationId));
}

const useAutomationListMutation = <Input, Result>(
  run: (input: Input) => Promise<Result>,
  options?: { readonly successMessage?: () => string },
) => {
  const queryClient = useQueryClient();
  return useMutation<Result, Error, Input>({
    mutationFn: run,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: automationQueryKeys.all });
      const successMessage = options?.successMessage?.();
      if (successMessage) toastManager.add({ type: "success", title: successMessage });
    },
    onError: (error) => {
      toastManager.add({ type: "error", title: error.message });
    },
  });
};

export function useAutomationCreateMutation() {
  const messages = useMessages();
  return useAutomationListMutation<CreateAutomationInput, Automation>(
    (input) => ensureNativeApi().automation.create(input),
    { successMessage: () => messages.automations.createdToast },
  );
}

export function useAutomationUpdateMutation(options?: { readonly successMessage?: () => string }) {
  return useAutomationListMutation<UpdateAutomationInput, Automation>(
    (input) => ensureNativeApi().automation.update(input),
    options,
  );
}

export function useAutomationDeleteMutation() {
  const messages = useMessages();
  return useAutomationListMutation<{ automationId: AutomationId }, void>(
    (input) => ensureNativeApi().automation.delete(input),
    { successMessage: () => messages.automations.deletedToast },
  );
}

/**
 * "Run now" only starts the run; how it went shows up in the run history once the
 * conversation reports back.
 */
export function useAutomationRunMutation() {
  const messages = useMessages();
  return useAutomationListMutation<{ automationId: AutomationId }, AutomationRun>(
    (input) => ensureNativeApi().automation.run(input),
    { successMessage: () => messages.automations.runStartedToast },
  );
}
