// FILE: useDesktopTopBarGutter.ts
// Purpose: Decide when desktop top bars must clear the macOS traffic light buttons.
// Layer: Shared web shell chrome
// Depends on: appSettings sidebar side, sidebar context, electron env detection.

import type { SidebarSide } from "~/appSettings";
import { useAppSettings } from "~/appSettings";
import { isElectron } from "~/env";
import { useSidebar } from "~/components/ui/sidebar";
import { isMacPlatform } from "~/lib/utils";

/**
 * Tailwind padding that clears the macOS traffic light cluster
 * (positioned at x=16, y=18 in the Electron BrowserWindow).
 *
 * Both the base and `sm:` variants are emitted so this gutter wins over any
 * responsive horizontal-padding class (e.g. `sm:px-5`) on the surrounding top
 * bar — `twMerge` only resolves conflicts within the same breakpoint.
 *
 * Kept as a module-level constant so every top bar uses the same gutter width.
 */
export const DESKTOP_TOP_BAR_TRAFFIC_LIGHT_GUTTER_CLASS = "pl-[90px] sm:pl-[90px]";

/**
 * Pure helper: should a top bar at the left edge of the desktop window reserve
 * space for the macOS traffic light buttons?
 *
 * The traffic lights live in the renderer area (titleBarStyle = "hiddenInset"),
 * so any chrome surface that sits flush against the window's left edge needs a
 * gutter, or its leading controls will collide with the close/minimize/zoom
 * buttons. The sidebar provides that gutter when it is on the left AND visible;
 * otherwise the next surface to the right has to provide it instead.
 */
export function shouldReserveDesktopTopBarTrafficLightGutter(input: {
  isElectron: boolean;
  isMacDesktop: boolean;
  sidebarSide: SidebarSide;
  sidebarOpen: boolean;
  isMobile: boolean;
}): boolean {
  if (!input.isElectron) return false;
  if (!input.isMacDesktop) return false;
  if (input.sidebarSide === "right") return true;
  // Mobile drawers float above content rather than reserving a column,
  // so the chat header always owns the left edge in that mode.
  if (input.isMobile) return true;
  return !input.sidebarOpen;
}

/**
 * Pure helper: should a leading navigation column that *replaces* the
 * workspace sidebar reserve space for the macOS traffic light buttons?
 *
 * The settings surface is the case this exists for: the workspace sidebar
 * steps aside, so the settings navigation column owns the window's left edge
 * and always has to clear the traffic lights (unlike a top bar, which only
 * needs the gutter while the sidebar is not providing it).
 */
export function shouldReserveLeadingColumnTrafficLightGutter(input: {
  isElectron: boolean;
  isMacDesktop: boolean;
}): boolean {
  return input.isElectron && input.isMacDesktop;
}

/**
 * React hook variant of {@link shouldReserveLeadingColumnTrafficLightGutter}
 * returning the gutter className (or `null` when no gutter is needed).
 */
export function useLeadingColumnTrafficLightGutterClassName(): string | null {
  const isMacDesktop = typeof navigator !== "undefined" ? isMacPlatform(navigator.platform) : false;
  return shouldReserveLeadingColumnTrafficLightGutter({ isElectron, isMacDesktop })
    ? DESKTOP_TOP_BAR_TRAFFIC_LIGHT_GUTTER_CLASS
    : null;
}

/**
 * React hook variant of {@link shouldReserveDesktopTopBarTrafficLightGutter}
 * that returns the gutter className (or `null` when no gutter is needed).
 *
 * Use this for any chrome surface whose top bar can sit flush against the
 * window's left edge: chat header, workspace header, etc. Surfaces that
 * replace the sidebar outright want
 * {@link useLeadingColumnTrafficLightGutterClassName} instead.
 */
export function useDesktopTopBarTrafficLightGutterClassName(): string | null {
  const { settings } = useAppSettings();
  const { isMobile, open } = useSidebar();
  const isMacDesktop = typeof navigator !== "undefined" ? isMacPlatform(navigator.platform) : false;
  return shouldReserveDesktopTopBarTrafficLightGutter({
    isElectron,
    isMacDesktop,
    sidebarSide: settings.sidebarSide,
    sidebarOpen: open,
    isMobile,
  })
    ? DESKTOP_TOP_BAR_TRAFFIC_LIGHT_GUTTER_CLASS
    : null;
}
