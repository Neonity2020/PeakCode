// FILE: Sidebar.sortMenus.tsx
// Purpose: Sort menus, segmented pickers and the sortable project/workspace row wrappers.
// Layer: Component

import { IoFilter } from "react-icons/io5";

import { useSortable } from "@dnd-kit/sortable";

import { CSS } from "@dnd-kit/utilities";
import { ProjectId } from "@peakcode/contracts";

import type { SidebarProjectSortOrder, SidebarThreadSortOrder } from "../appSettings";

import { Menu, MenuGroup, MenuPopup, MenuRadioGroup, MenuRadioItem, MenuTrigger } from "./ui/menu";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";

import { cn } from "~/lib/utils";

import { useMessages } from "../i18n";

export function useProjectSortLabels(): Record<SidebarProjectSortOrder, string> {
  const messages = useMessages();
  return {
    updated_at: messages.sidebar.sortRecentlyActive,
    created_at: messages.sidebar.sortCreatedAt,
    manual: messages.sidebar.sortManual,
  };
}

export function useThreadSortLabels(): Record<SidebarThreadSortOrder, string> {
  const messages = useMessages();
  return {
    updated_at: messages.sidebar.sortRecentlyActive,
    created_at: messages.sidebar.sortCreatedAt,
  };
}
export const SIDEBAR_LIST_ANIMATION_OPTIONS = {
  duration: 180,
  easing: "ease-out",
} as const;

export function PeakCodeWordmark() {
  return (
    <span aria-label="Peak Code" className="shrink-0 text-[14px] font-semibold text-foreground">
      Peak
    </span>
  );
}

export type SortableProjectHandleProps = Pick<
  ReturnType<typeof useSortable>,
  "attributes" | "listeners" | "setActivatorNodeRef"
>;

export function ProjectSortMenu({
  projectSortOrder,
  threadSortOrder,
  onProjectSortOrderChange,
  onThreadSortOrderChange,
}: {
  projectSortOrder: SidebarProjectSortOrder;
  threadSortOrder: SidebarThreadSortOrder;
  onProjectSortOrderChange: (sortOrder: SidebarProjectSortOrder) => void;
  onThreadSortOrderChange: (sortOrder: SidebarThreadSortOrder) => void;
}) {
  const messages = useMessages();
  const projectSortLabels = useProjectSortLabels();
  return (
    <Menu>
      <Tooltip>
        <TooltipTrigger
          render={<MenuTrigger className="sidebar-icon-button inline-flex size-5 cursor-pointer" />}
        >
          <IoFilter className="size-3.5" />
        </TooltipTrigger>
        <TooltipPopup side="right">{messages.sidebar.sortProjects}</TooltipPopup>
      </Tooltip>
      <MenuPopup
        align="end"
        side="bottom"
        className="min-w-44 rounded-lg border-[color:var(--color-border)] bg-[var(--color-background-elevated-primary-opaque)] shadow-lg"
      >
        <MenuGroup>
          <div className="px-2 py-1 sm:text-xs font-medium text-muted-foreground">
            {messages.sidebar.projectSortMenuHeader}
          </div>
          <MenuRadioGroup
            value={projectSortOrder}
            onValueChange={(value) => {
              onProjectSortOrderChange(value as SidebarProjectSortOrder);
            }}
          >
            {(Object.entries(projectSortLabels) as Array<[SidebarProjectSortOrder, string]>).map(
              ([value, label]) => (
                <MenuRadioItem key={value} value={value} className="min-h-7 py-1 sm:text-xs">
                  {label}
                </MenuRadioItem>
              ),
            )}
          </MenuRadioGroup>
        </MenuGroup>
        <MenuGroup>
          <div className="px-2 pt-2 pb-1 sm:text-xs font-medium text-muted-foreground">
            {messages.sidebar.threadSortMenuHeader}
          </div>
          <ThreadSortMenuItems
            threadSortOrder={threadSortOrder}
            onThreadSortOrderChange={onThreadSortOrderChange}
          />
        </MenuGroup>
      </MenuPopup>
    </Menu>
  );
}

export function ThreadSortMenuItems({
  threadSortOrder,
  onThreadSortOrderChange,
}: {
  threadSortOrder: SidebarThreadSortOrder;
  onThreadSortOrderChange: (sortOrder: SidebarThreadSortOrder) => void;
}) {
  const threadSortLabels = useThreadSortLabels();
  return (
    <MenuRadioGroup
      value={threadSortOrder}
      onValueChange={(value) => {
        onThreadSortOrderChange(value as SidebarThreadSortOrder);
      }}
    >
      {(Object.entries(threadSortLabels) as Array<[SidebarThreadSortOrder, string]>).map(
        ([value, label]) => (
          <MenuRadioItem key={value} value={value} className="min-h-7 py-1 sm:text-xs">
            {label}
          </MenuRadioItem>
        ),
      )}
    </MenuRadioGroup>
  );
}

export function SortableProjectItem({
  projectId,
  disabled = false,
  children,
}: {
  projectId: ProjectId;
  disabled?: boolean;
  children: (handleProps: SortableProjectHandleProps) => React.ReactNode;
}) {
  const {
    attributes,
    listeners,
    setActivatorNodeRef,
    setNodeRef,
    transform,
    transition,
    isDragging,
    isOver,
  } = useSortable({ id: projectId, disabled });
  return (
    <li
      ref={setNodeRef}
      style={{
        transform: CSS.Translate.toString(transform),
        transition,
      }}
      className={`group/menu-item relative rounded-md ${
        isDragging ? "z-20 opacity-80" : ""
      } ${isOver && !isDragging ? "ring-1 ring-primary/40" : ""}`}
      data-sidebar="menu-item"
      data-slot="sidebar-menu-item"
    >
      {children({ attributes, listeners, setActivatorNodeRef })}
    </li>
  );
}

export function SidebarSegmentedPicker({
  activeView,
  onSelectView,
}: {
  activeView: "threads" | "workspace";
  onSelectView: (view: "threads" | "workspace") => void;
}) {
  return (
    <div className="px-3 pb-2.5">
      <div className="inline-flex w-full rounded-md bg-[var(--color-background-elevated-secondary)] p-0.5">
        {(["threads", "workspace"] as const).map((view) => {
          const active = activeView === view;
          return (
            <button
              key={view}
              type="button"
              className={cn(
                "flex-1 rounded-sm px-2.5 py-1 text-[11.5px] font-medium transition-colors",
                active
                  ? "bg-[var(--composer-surface)] text-[var(--color-text-foreground)] shadow-xs"
                  : "text-[var(--color-text-foreground-secondary)] hover:bg-[var(--color-background-button-secondary-hover)] hover:text-[var(--color-text-foreground)]",
              )}
              onClick={() => onSelectView(view)}
            >
              {view === "threads" ? "Work" : "Code"}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function SortableWorkspaceItem({
  workspaceId,
  children,
}: {
  workspaceId: string;
  children: (handleProps: SortableProjectHandleProps) => React.ReactNode;
}) {
  const {
    attributes,
    listeners,
    setActivatorNodeRef,
    setNodeRef,
    transform,
    transition,
    isDragging,
    isOver,
  } = useSortable({ id: workspaceId });

  return (
    <li
      ref={setNodeRef}
      style={{
        transform: CSS.Translate.toString(transform),
        transition,
      }}
      className={`group/menu-item relative rounded-md ${
        isDragging ? "z-20 opacity-80" : ""
      } ${isOver && !isDragging ? "ring-1 ring-primary/40" : ""}`}
      data-sidebar="menu-item"
      data-slot="sidebar-menu-item"
    >
      {children({ attributes, listeners, setActivatorNodeRef })}
    </li>
  );
}
