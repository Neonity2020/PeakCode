// FILE: AboutSettingsPanel.tsx
// Purpose: The "About" settings section — a single place for the app identity
// (icon, name, tagline, version), the desktop update flow (check / download /
// install plus the pending release's notes), the full changelog, and the
// outbound links. Modelled on Cherry Studio's About page: identity + primary
// update action up top, then detail rows below.
// Layer: Component

import { useState, type ReactNode } from "react";

import { APP_DISPLAY_NAME, APP_VERSION } from "../branding";
import { useDesktopUpdate } from "../hooks/useDesktopUpdate";
import { useMessages } from "../i18n";
import {
  BookIcon,
  ExternalLinkIcon,
  GitHubIcon,
  GlobeIcon,
  MessageCircleIcon,
  RefreshCwIcon,
} from "../lib/icons";
import { readNativeApi } from "../nativeApi";
import { persistAppStateNow } from "../store";
import { ChangelogAccordion } from "../whatsNew/ChangelogAccordion";
import { WHATS_NEW_ENTRIES } from "../whatsNew/entries";
import { sortEntriesByVersionDesc } from "../whatsNew/logic";
import {
  findReleaseEntry,
  resolveAboutUpdateActionLabel,
  resolveAboutUpdateHint,
  resolvePendingUpdateVersion,
  shouldShowPendingReleaseNotes,
} from "./aboutUpdate.logic";
import { SettingsCard, SettingsRow, SettingsSection } from "./settingsPrimitives";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogClose,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "./ui/dialog";

const REPOSITORY_URL = "https://github.com/PeakCode-AI/PeakCode";
const DOCUMENTATION_URL = `${REPOSITORY_URL}#readme`;
const FEEDBACK_URL = `${REPOSITORY_URL}/issues/new`;
const COMMUNITY_URL = "https://discord.gg/jn4EGJjrvv";

const CHANGELOG_ENTRIES = sortEntriesByVersionDesc(WHATS_NEW_ENTRIES);

function openExternal(url: string): void {
  const api = readNativeApi();
  if (!api) return;
  void api.shell.openExternal(url).catch(() => undefined);
}

export function AboutSettingsPanel() {
  const messages = useMessages();
  const about = messages.settings.about;
  const update = useDesktopUpdate();
  const [changelogOpen, setChangelogOpen] = useState(false);

  const state = update.state;
  const status = state?.status ?? "idle";
  const currentVersion = state?.currentVersion ?? APP_VERSION;

  const pendingVersion = resolvePendingUpdateVersion(state);
  const showPendingNotes = shouldShowPendingReleaseNotes(status, pendingVersion);
  const pendingEntry = findReleaseEntry(WHATS_NEW_ENTRIES, pendingVersion);

  const actionLabel = resolveAboutUpdateActionLabel({
    installing: update.installing,
    status,
    action: update.action,
    labels: about.update,
  });

  const hint =
    update.available && status !== "disabled"
      ? resolveAboutUpdateHint({
          status,
          currentVersion,
          percent: state?.downloadPercent ?? null,
          labels: about.update,
        })
      : about.update.unavailableHint;

  return (
    <div className="space-y-6">
      <SettingsSection title={about.update.section}>
        <SettingsCard>
          <div className="border-b border-[color:var(--color-border-light)] px-5 py-5">
            <div className="flex items-start gap-4">
              <img
                src="/favicon-32x32.png"
                alt=""
                aria-hidden="true"
                className="size-12 shrink-0 rounded-xl"
                loading="eager"
                decoding="async"
              />
              <div className="min-w-0 flex-1 space-y-1.5">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-base font-semibold text-foreground">{APP_DISPLAY_NAME}</h3>
                  <Badge variant="secondary">v{currentVersion}</Badge>
                </div>
                <p className="text-xs text-muted-foreground">{about.tagline}</p>
                {hint ? (
                  <p
                    className={
                      status === "error"
                        ? "pt-0.5 text-[11px] text-destructive"
                        : "pt-0.5 text-[11px] text-muted-foreground"
                    }
                  >
                    {hint}
                  </p>
                ) : null}
              </div>
              <Button
                size="sm"
                variant={status === "downloaded" ? "default" : "outline"}
                disabled={!update.available || update.disabled || update.action === "none"}
                onClick={() => update.requestAction({ beforeInstall: persistAppStateNow })}
              >
                {actionLabel}
              </Button>
            </div>
          </div>

          <SettingsRow
            title={about.version.title}
            description={about.version.description}
            control={
              <code className="text-xs font-medium text-muted-foreground">v{currentVersion}</code>
            }
          />

          <SettingsRow
            title={about.changelog.section}
            description={about.changelog.description}
            control={
              <Button size="xs" variant="outline" onClick={() => setChangelogOpen(true)}>
                {about.changelog.button}
              </Button>
            }
          />
        </SettingsCard>
      </SettingsSection>

      {showPendingNotes ? (
        <SettingsSection
          title={about.update.releaseNotesTitle}
          description={about.update.availableTitle(pendingVersion ?? "")}
        >
          <SettingsCard>
            <div className="space-y-4 px-5 py-4">
              {pendingEntry ? (
                pendingEntry.features.map((feature) => (
                  <div key={feature.id} className="space-y-1">
                    <h4 className="text-sm font-medium text-foreground">{feature.title}</h4>
                    <p className="text-xs leading-relaxed text-muted-foreground">
                      {feature.description}
                    </p>
                  </div>
                ))
              ) : (
                <p className="text-xs text-muted-foreground">{about.update.noReleaseNotes}</p>
              )}
            </div>
          </SettingsCard>
        </SettingsSection>
      ) : null}

      <SettingsSection title={about.links.section}>
        <SettingsCard>
          <AboutLinkRow
            icon={<BookIcon className="size-4" />}
            title={about.links.documentation.title}
            description={about.links.documentation.description}
            url={DOCUMENTATION_URL}
            openLabel={about.links.openButton}
          />
          <AboutLinkRow
            icon={<MessageCircleIcon className="size-4" />}
            title={about.links.feedback.title}
            description={about.links.feedback.description}
            url={FEEDBACK_URL}
            openLabel={about.links.openButton}
          />
          <AboutLinkRow
            icon={<GlobeIcon className="size-4" />}
            title={about.links.community.title}
            description={about.links.community.description}
            url={COMMUNITY_URL}
            openLabel={about.links.openButton}
          />
          <AboutLinkRow
            icon={<GitHubIcon className="size-4" />}
            title={about.links.source.title}
            description={about.links.source.description}
            url={REPOSITORY_URL}
            openLabel={about.links.openButton}
          />
        </SettingsCard>
      </SettingsSection>

      <Dialog open={changelogOpen} onOpenChange={setChangelogOpen}>
        <DialogPopup className="max-w-lg gap-0 p-0">
          <DialogHeader className="gap-1 p-4 pr-12">
            <div className="flex items-center gap-3">
              <RefreshCwIcon className="size-5 shrink-0 text-muted-foreground" />
              <div className="flex min-w-0 flex-col">
                <DialogTitle className="text-base">{about.changelog.dialogTitle}</DialogTitle>
                <DialogDescription className="text-xs">
                  {about.changelog.dialogDescription}
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>
          <DialogPanel className="max-h-[min(62vh,520px)] px-4 py-3">
            <ChangelogAccordion
              entries={CHANGELOG_ENTRIES}
              defaultExpandedVersion={currentVersion}
            />
          </DialogPanel>
          <DialogFooter className="px-4 py-3 sm:justify-end">
            <DialogClose render={<Button size="sm">{about.changelog.closeButton}</Button>} />
          </DialogFooter>
        </DialogPopup>
      </Dialog>
    </div>
  );
}

function AboutLinkRow({
  icon,
  title,
  description,
  url,
  openLabel,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  url: string;
  openLabel: string;
}) {
  return (
    <SettingsRow
      title={title}
      description={description}
      onClick={() => openExternal(url)}
      control={
        <span className="flex items-center gap-2">
          <span className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground">
            {icon}
          </span>
          <Button
            size="xs"
            variant="outline"
            onClick={(event) => {
              // The whole row is clickable; keep the button from firing twice.
              event.stopPropagation();
              openExternal(url);
            }}
          >
            <ExternalLinkIcon className="size-3.5" />
            {openLabel}
          </Button>
        </span>
      }
    />
  );
}

export default AboutSettingsPanel;
