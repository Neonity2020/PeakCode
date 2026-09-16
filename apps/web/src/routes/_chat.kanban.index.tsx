// FILE: _chat.kanban.index.tsx
// Purpose: Registers the kanban board view under the shared chat shell.
// Layer: Route
// Exports: Route

import { createFileRoute } from "@tanstack/react-router";
import { KanbanView } from "~/components/KanbanView";

export const Route = createFileRoute("/_chat/kanban/")({
  component: KanbanView,
});
