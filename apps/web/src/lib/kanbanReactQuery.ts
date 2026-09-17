// FILE: kanbanReactQuery.ts
// Purpose: React Query hooks for the per-project kanban board view.
// Layer: Web data fetching helpers

import type {
  KanbanAddTaskCommentInput,
  KanbanBoard,
  KanbanCreateTaskInput,
  KanbanDeleteTaskInput,
  KanbanGenerateRequirementDraftInput,
  KanbanGenerateRequirementDraftResult,
  KanbanMoveTaskInput,
  KanbanTaskDetail,
  KanbanTaskId,
  KanbanUpdateTaskInput,
  ProjectId,
} from "@peakcode/contracts";
import { queryOptions, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ensureNativeApi } from "../nativeApi";
import { toastManager } from "../components/ui/toast";
import { useMessages } from "../i18n";
import { describeGenerationFailure } from "./kanbanGenerationFailure";

/**
 * Agents and the standalone 看板 plugin write the same `.kanban/board.json`
 * file on disk, so an open board polls to pick those edits up.
 */
const BOARD_POLL_INTERVAL_MS = 5_000;

export const kanbanQueryKeys = {
  all: ["kanban"] as const,
  projects: () => [...kanbanQueryKeys.all, "projects"] as const,
  board: (projectId: ProjectId | null) => [...kanbanQueryKeys.all, "board", projectId] as const,
  /** Prefix of every open task detail in one project. */
  tasks: (projectId: ProjectId | null) => [...kanbanQueryKeys.all, "task", projectId] as const,
  task: (projectId: ProjectId | null, taskId: KanbanTaskId | null) =>
    [...kanbanQueryKeys.tasks(projectId), taskId] as const,
};

export const kanbanProjectsQueryOptions = () =>
  queryOptions({
    queryKey: kanbanQueryKeys.projects(),
    queryFn: async () => ensureNativeApi().kanban.listProjects({}),
    staleTime: 10_000,
  });

export function useKanbanProjectsQuery() {
  return useQuery(kanbanProjectsQueryOptions());
}

export const kanbanBoardQueryOptions = (projectId: ProjectId | null) =>
  queryOptions({
    queryKey: kanbanQueryKeys.board(projectId),
    queryFn: async () => {
      if (!projectId) throw new Error("No project selected");
      return ensureNativeApi().kanban.getBoard({ projectId });
    },
    enabled: projectId !== null,
    refetchInterval: BOARD_POLL_INTERVAL_MS,
    refetchIntervalInBackground: false,
  });

export function useKanbanBoardQuery(projectId: ProjectId | null) {
  return useQuery(kanbanBoardQueryOptions(projectId));
}

/**
 * Task detail polls like the board does, so comments the agent writes while it
 * works show up without a manual refresh.
 */
export const kanbanTaskDetailQueryOptions = (
  projectId: ProjectId | null,
  taskId: KanbanTaskId | null,
) =>
  queryOptions({
    queryKey: kanbanQueryKeys.task(projectId, taskId),
    queryFn: async () => {
      if (!projectId || !taskId) throw new Error("No task selected");
      return ensureNativeApi().kanban.getTaskDetail({ projectId, taskId });
    },
    enabled: projectId !== null && taskId !== null,
    refetchInterval: BOARD_POLL_INTERVAL_MS,
    refetchIntervalInBackground: false,
  });

export function useKanbanTaskDetailQuery(projectId: ProjectId | null, taskId: KanbanTaskId | null) {
  return useQuery(kanbanTaskDetailQueryOptions(projectId, taskId));
}

/**
 * Requirement generation runs on the server, which stores the brief on the task
 * and returns the refreshed detail.
 */
export function useKanbanGenerateTaskRequirementMutation() {
  const queryClient = useQueryClient();
  const messages = useMessages();
  return useMutation<
    KanbanTaskDetail,
    Error,
    { readonly projectId: ProjectId; readonly taskId: KanbanTaskId }
  >({
    mutationFn: (input) => ensureNativeApi().kanban.generateTaskRequirement(input),
    onSuccess: (detail) => {
      queryClient.setQueryData(kanbanQueryKeys.task(detail.projectId, detail.task.taskId), detail);
      void queryClient.invalidateQueries({ queryKey: kanbanQueryKeys.board(detail.projectId) });
    },
    onError: (error, variables) => {
      const detail = queryClient.getQueryData<KanbanTaskDetail>(
        kanbanQueryKeys.task(variables.projectId, variables.taskId),
      );
      toastManager.add({
        type: "error",
        ...describeGenerationFailure(messages, error.message, detail?.task.agentModel),
        data: { copyText: error.message },
      });
    },
  });
}

/**
 * Requirement generation for a task that is still being written (the create
 * dialog, or the detail page's requirement editor). Nothing is stored: the
 * caller drops the brief into the field it is editing.
 */
export function useKanbanGenerateRequirementDraftMutation() {
  const messages = useMessages();
  return useMutation<
    KanbanGenerateRequirementDraftResult,
    Error,
    KanbanGenerateRequirementDraftInput
  >({
    mutationFn: (input) => ensureNativeApi().kanban.generateRequirementDraft(input),
    onError: (error, variables) => {
      toastManager.add({
        type: "error",
        ...describeGenerationFailure(messages, error.message, variables.agentModel),
        data: { copyText: error.message },
      });
    },
  });
}

export function useKanbanAddTaskCommentMutation() {
  const queryClient = useQueryClient();
  return useMutation<KanbanTaskDetail, Error, KanbanAddTaskCommentInput>({
    mutationFn: (input) => ensureNativeApi().kanban.addTaskComment(input),
    onSuccess: (detail) => {
      queryClient.setQueryData(kanbanQueryKeys.task(detail.projectId, detail.task.taskId), detail);
      void queryClient.invalidateQueries({
        queryKey: kanbanQueryKeys.board(detail.projectId),
      });
    },
    onError: (error) => {
      toastManager.add({ type: "error", title: error.message });
    },
  });
}

function useKanbanBoardMutation<Input>(run: (input: Input) => Promise<KanbanBoard>) {
  const queryClient = useQueryClient();
  return useMutation<KanbanBoard, Error, Input>({
    mutationFn: run,
    onSuccess: (board) => {
      queryClient.setQueryData(kanbanQueryKeys.board(board.projectId), board);
      // An open task detail shows the same fields the board just changed (its
      // requirement, status, run state), so refresh it instead of leaving it on
      // the polling interval.
      void queryClient.invalidateQueries({ queryKey: kanbanQueryKeys.tasks(board.projectId) });
      void queryClient.invalidateQueries({ queryKey: kanbanQueryKeys.projects() });
    },
    onError: (error) => {
      toastManager.add({ type: "error", title: error.message });
    },
  });
}

export function useKanbanCreateTaskMutation() {
  return useKanbanBoardMutation<KanbanCreateTaskInput>((input) =>
    ensureNativeApi().kanban.createTask(input),
  );
}

export function useKanbanUpdateTaskMutation() {
  return useKanbanBoardMutation<KanbanUpdateTaskInput>((input) =>
    ensureNativeApi().kanban.updateTask(input),
  );
}

export function useKanbanMoveTaskMutation() {
  return useKanbanBoardMutation<KanbanMoveTaskInput>((input) =>
    ensureNativeApi().kanban.moveTask(input),
  );
}

export function useKanbanDeleteTaskMutation() {
  return useKanbanBoardMutation<KanbanDeleteTaskInput>((input) =>
    ensureNativeApi().kanban.deleteTask(input),
  );
}
