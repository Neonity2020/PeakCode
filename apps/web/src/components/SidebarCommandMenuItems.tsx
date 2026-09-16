// FILE: SidebarCommandMenuItems.tsx
// Purpose: Skill / plugin / automation navigation rows for the sidebar's top menu.
// Layer: Component
// Exports: SidebarCommandMenuItems

import { useCallback } from "react";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { ClockIcon, PlugIcon } from "../lib/icons";
import { useMessages } from "../i18n/I18nContext";
import { SidebarNavRow } from "./SidebarNavRow";

export function SidebarCommandMenuItems({ pathname }: { readonly pathname: string }) {
  const messages = useMessages();
  const navigate = useNavigate();
  const routeSearch = useSearch({ strict: false }) as Record<string, unknown>;

  const isOnPlugins = pathname.startsWith("/plugins");
  const isOnAutomations = pathname.startsWith("/automations");
  const activeTab = isOnPlugins && routeSearch.tab === "skills" ? "skills" : "plugins";

  const onSelectPlugins = useCallback(() => {
    void navigate({ to: "/plugins", search: { tab: "plugins" } });
  }, [navigate]);

  const onSelectAutomations = useCallback(() => {
    void navigate({ to: "/automations" });
  }, [navigate]);

  return (
    <>
      <SidebarNavRow
        icon={PlugIcon}
        label={messages.sidebar.pluginsLabel}
        active={isOnPlugins && activeTab === "plugins"}
        onClick={onSelectPlugins}
        testId="sidebar-command-plugins"
      />
      <SidebarNavRow
        icon={ClockIcon}
        label={messages.sidebar.automationsLabel}
        active={isOnAutomations}
        onClick={onSelectAutomations}
        testId="sidebar-command-automations"
      />
    </>
  );
}
