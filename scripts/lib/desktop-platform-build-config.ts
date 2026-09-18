// FILE: desktop-platform-build-config.ts
// Purpose: Builds platform-specific electron-builder config fragments for desktop artifacts.
// Layer: Release/build helper
// Depends on: Desktop packaging policy, the shared computer-use contract, and electron-builder's
//             config shape.

import { COMPUTER_USE_BUNDLED_HELPER_DIR_NAME } from "@peakcode/shared/computerUse";

export const MICROPHONE_USAGE_DESCRIPTION =
  "Peak Code needs microphone access so you can record voice notes and transcribe them into the chat composer.";
export const MAC_ENTITLEMENTS_PATH = "apps/desktop/resources/entitlements.mac.plist";
export const MAC_INHERITED_ENTITLEMENTS_PATH =
  "apps/desktop/resources/entitlements.mac.inherit.plist";
/**
 * Where the built computer-use helper is staged before packaging.
 *
 * It sits under the build-resources directory because electron-builder keeps that out of the
 * asar, and the helper has to stay a real bundle on disk: macOS files the Accessibility and
 * Screen Recording grants against the bundle itself, so it cannot be packed.
 */
export const MAC_COMPUTER_USE_HELPER_STAGE_DIR = `apps/desktop/resources/${COMPUTER_USE_BUNDLED_HELPER_DIR_NAME}`;
const MAC_AFTER_PACK_HOOK_PATH = "./electron-builder-after-pack.cjs";
const MAC_DMG_ICON_PATH = "icon.icns";

export interface DesktopPlatformBuildConfig {
  readonly afterPack?: string;
  readonly dmg?: {
    readonly icon: string;
  };
  /** Files copied into the app's Resources rather than into the asar. */
  readonly extraResources?: readonly { readonly from: string; readonly to: string }[];
  readonly linux?: Record<string, unknown>;
  readonly mac?: Record<string, unknown>;
  readonly win?: Record<string, unknown>;
}

export interface CreateDesktopPlatformBuildConfigInput {
  readonly hasMacIconComposer: boolean;
  readonly platform: "linux" | "mac" | "win";
  readonly target: string;
  readonly windowsAzureSignOptions?: Record<string, string>;
}

export function createDesktopPlatformBuildConfig(
  input: CreateDesktopPlatformBuildConfigInput,
): DesktopPlatformBuildConfig {
  if (input.platform === "mac") {
    const mac = {
      target: input.target === "dmg" ? [input.target, "zip"] : [input.target],
      icon: input.hasMacIconComposer ? "icon.icon" : MAC_DMG_ICON_PATH,
      category: "public.app-category.developer-tools",
      hardenedRuntime: true,
      entitlements: MAC_ENTITLEMENTS_PATH,
      entitlementsInherit: MAC_INHERITED_ENTITLEMENTS_PATH,
      // The computer-use helper ships beside the app rather than inside the asar. Its
      // Accessibility grant is filed against the bundle, so it has to be a real bundle on disk,
      // and the app copies it into a stable location on first launch.
      extraResources: [
        {
          from: MAC_COMPUTER_USE_HELPER_STAGE_DIR,
          to: COMPUTER_USE_BUNDLED_HELPER_DIR_NAME,
        },
      ],
      extendInfo: {
        NSMicrophoneUsageDescription: MICROPHONE_USAGE_DESCRIPTION,
        ...(input.hasMacIconComposer ? { CFBundleIconFile: MAC_DMG_ICON_PATH } : {}),
      },
    } satisfies Record<string, unknown>;

    // The hook is always wired, not only for Icon Composer builds: besides the legacy icon it
    // applies the ad-hoc signature an unsigned release needs — electron-builder's own `sign`
    // hook cannot do that, because it is never reached without an identity to sign with.
    return {
      mac,
      afterPack: MAC_AFTER_PACK_HOOK_PATH,
      ...(input.hasMacIconComposer
        ? {
            dmg: {
              icon: MAC_DMG_ICON_PATH,
            },
          }
        : {}),
    };
  }

  if (input.platform === "linux") {
    return {
      linux: {
        target: [input.target],
        executableName: "peakcode",
        icon: "icon.png",
        category: "Development",
        desktop: {
          entry: {
            StartupWMClass: "peakcode",
          },
        },
      },
    };
  }

  return {
    win: {
      target: [input.target],
      icon: "icon.ico",
      ...(input.windowsAzureSignOptions ? { azureSignOptions: input.windowsAzureSignOptions } : {}),
    },
  };
}
