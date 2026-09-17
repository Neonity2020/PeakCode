import { ProviderInteractionMode, RuntimeMode } from "@peakcode/contracts";
import { memo, type ReactNode } from "react";
import { useMessages } from "~/i18n";
import { EllipsisIcon, ListTodoIcon } from "~/lib/icons";
import { Button } from "../ui/button";
import {
  Menu,
  MenuItem,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator as MenuDivider,
  MenuTrigger,
} from "../ui/menu";

export const CompactComposerControlsMenu = memo(function CompactComposerControlsMenu(props: {
  activePlan: boolean;
  interactionMode: ProviderInteractionMode;
  planSidebarOpen: boolean;
  runtimeMode: RuntimeMode;
  traitsMenuContent?: ReactNode;
  onSetInteractionMode: (mode: ProviderInteractionMode) => void;
  onTogglePlanSidebar: () => void;
  onToggleRuntimeMode: () => void;
}) {
  const messages = useMessages();
  return (
    <Menu>
      <MenuTrigger
        render={
          <Button
            size="sm"
            variant="chrome"
            className="shrink-0 px-2"
            aria-label={messages.composer.moreAria}
          />
        }
      >
        <EllipsisIcon aria-hidden="true" className="size-4" />
      </MenuTrigger>
      <MenuPopup align="start">
        {props.traitsMenuContent ? (
          <>
            {props.traitsMenuContent}
            <MenuDivider />
          </>
        ) : null}
        <div className="px-2 py-1.5 font-medium text-muted-foreground text-xs">
          {messages.composer.modeLabel}
        </div>
        <MenuRadioGroup
          value={props.interactionMode}
          onValueChange={(value) => {
            if (!value || value === props.interactionMode) return;
            props.onSetInteractionMode(value as ProviderInteractionMode);
          }}
        >
          <MenuRadioItem value="default">Agent</MenuRadioItem>
          <MenuRadioItem value="plan">Plan</MenuRadioItem>
          <MenuRadioItem value="goal">Goal</MenuRadioItem>
        </MenuRadioGroup>
        {props.activePlan ? (
          <>
            <MenuDivider />
            <MenuItem onClick={props.onTogglePlanSidebar}>
              <ListTodoIcon className="size-4 shrink-0" />
              {props.planSidebarOpen
                ? messages.composer.interactionMode.hidePlanSidebar
                : messages.composer.interactionMode.showPlanSidebar}
            </MenuItem>
          </>
        ) : null}
      </MenuPopup>
    </Menu>
  );
});
