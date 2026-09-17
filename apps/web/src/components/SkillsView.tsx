// FILE: SkillsView.tsx
// Purpose: Standalone skills screen (route /plugins?tab=skills); renders the shared
//          SkillsPanel inside the full-screen shell.
// Layer: Route-level screen
// Exports: SkillsView

import { BookIcon } from "~/lib/icons";
import { useMessages } from "~/i18n/I18nContext";
import { SidebarInset } from "./ui/sidebar";
import { SidebarHeaderNavigationControls } from "./SidebarHeaderNavigationControls";
import { SkillsPanel } from "./SkillsPanel";

export function SkillsView() {
  const messages = useMessages();

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden isolate">
      <div className="flex h-full min-h-0 flex-col bg-background">
        <div className="flex shrink-0 items-center gap-3 border-b border-border px-4 sm:px-6">
          <SidebarHeaderNavigationControls />
          <div className="flex-1" />
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-2xl px-6 pt-8 pb-6">
            <h1 className="flex items-center gap-2 text-[22px] font-semibold text-foreground">
              <BookIcon className="size-5" />
              {messages.skills.title}
            </h1>
            <p className="mt-1 text-[13px] text-muted-foreground/85">{messages.skills.subtitle}</p>
          </div>
          <div className="mx-auto w-full max-w-2xl px-6 pb-10">
            <SkillsPanel />
          </div>
        </div>
      </div>
    </SidebarInset>
  );
}
