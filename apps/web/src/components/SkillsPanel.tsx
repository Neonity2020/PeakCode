// FILE: SkillsPanel.tsx
// Purpose: Skills browser body (search, local skills, provider skills). Shared by the
//          standalone skills screen and the settings skills section.
// Layer: Component
// Exports: SkillsPanel

import { useDeferredValue, useMemo, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { CheckIcon, CircleAlertIcon, ExternalLinkIcon, SearchIcon } from "~/lib/icons";
import { localSkillsQueryOptions } from "~/localSkillsReactQuery";
import { useMessages } from "~/i18n/I18nContext";
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from "./ui/input-group";
import { Skeleton } from "./ui/skeleton";
import { useProviderDiscoveryData } from "./useProviderDiscoveryData";

const SKILL_SH_HOMEPAGE = "https://skill.sh/";

const SOURCE_LABEL: Record<string, string> = {
  claude: "~/.claude/skills",
  codex: "~/.codex/skills",
  agents: "~/.agents/skills",
  openclaw: "~/.openclaw/skills",
  unknown: "Unknown",
};

export function SkillsPanel() {
  const messages = useMessages();
  const data = useProviderDiscoveryData("skills");
  const localSkillsQuery = useQuery(localSkillsQueryOptions());
  const deferredQuery = useDeferredValue(data.skillSearch);

  const localSkills = useMemo(() => localSkillsQuery.data?.skills ?? [], [localSkillsQuery.data]);
  const filteredLocalSkills = useMemo(() => {
    const q = deferredQuery.trim().toLowerCase();
    if (!q) return localSkills;
    return localSkills.filter((skill) => {
      const haystack = `${skill.name} ${skill.description ?? ""} ${skill.sourceDir}`.toLowerCase();
      return haystack.includes(q);
    });
  }, [deferredQuery, localSkills]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <InputGroup className="rounded-xl bg-background/70 shadow-xs">
          <InputGroupAddon>
            <InputGroupText>
              <SearchIcon className="size-4 text-muted-foreground/60" />
            </InputGroupText>
          </InputGroupAddon>
          <InputGroupInput
            value={data.skillSearch}
            onChange={(e) => data.setSkillSearch(e.target.value)}
            placeholder={messages.skills.searchPlaceholder}
            className="text-sm"
          />
        </InputGroup>
        <a
          href={SKILL_SH_HOMEPAGE}
          target="_blank"
          rel="noreferrer noopener"
          className="inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-md bg-foreground/90 px-3 text-[12px] font-medium text-background transition-colors hover:bg-foreground"
        >
          <ExternalLinkIcon className="size-3.5" />
          {messages.skills.browseSkillSh}
        </a>
      </div>

      {!data.discoveryCwd ? (
        <SkillsInlineWarning>{messages.skills.needsWorkspace}</SkillsInlineWarning>
      ) : null}

      <LocalSkillsSection
        isLoading={localSkillsQuery.isLoading}
        skills={filteredLocalSkills}
        search={deferredQuery}
      />

      <section className="space-y-3">
        <header className="px-0.5">
          <h2 className="text-[14px] leading-5 font-semibold text-foreground">
            {messages.skills.providerHeading}
          </h2>
          <p className="mt-1 text-[12.5px] leading-relaxed text-muted-foreground">
            {messages.skills.providerHint}
          </p>
        </header>
        {!data.canListSkills ? (
          <SkillsEmptyPanel
            title={messages.skills.unavailableTitle.replace("{provider}", data.providerLabel)}
            description={messages.skills.unavailableDescription}
          />
        ) : data.skillsQuery.isLoading && data.discoveredSkills.length === 0 ? (
          <div className="space-y-1">
            {["1", "2", "3", "4", "5", "6"].map((k) => (
              <Skeleton key={k} className="h-[68px] w-full rounded-xl" />
            ))}
          </div>
        ) : data.filteredSkills.length === 0 ? (
          <SkillsEmptyPanel
            title={deferredQuery ? messages.skills.emptySearchTitle : messages.skills.emptyTitle}
            description={
              deferredQuery
                ? messages.skills.emptySearchDescription
                : messages.skills.emptyDescription
            }
          />
        ) : (
          <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
            {data.filteredSkills.map((skill) => (
              <ProviderSkillCard key={skill.path} skill={skill} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

interface LocalSkill {
  readonly name: string;
  readonly description?: string | undefined;
  readonly version?: string | undefined;
  readonly homepage?: string | undefined;
  readonly path: string;
  readonly source: string;
  readonly sourceDir: string;
  readonly enabled: boolean;
}

function LocalSkillsSection({
  isLoading,
  skills,
  search,
}: {
  isLoading: boolean;
  skills: ReadonlyArray<LocalSkill>;
  search: string;
}) {
  const messages = useMessages();

  const heading = (
    <header className="flex items-baseline justify-between gap-2 px-0.5">
      <h2 className="text-[14px] leading-5 font-semibold text-foreground">
        {messages.skills.localHeading}
      </h2>
      {skills.length > 0 && !isLoading ? (
        <span className="text-[11px] text-muted-foreground/70">
          {messages.skills.localCount.replace("{count}", String(skills.length))}
        </span>
      ) : null}
    </header>
  );

  if (isLoading) {
    return (
      <section className="space-y-3">
        {heading}
        <div className="space-y-1">
          {["1", "2", "3"].map((k) => (
            <Skeleton key={k} className="h-[72px] w-full rounded-xl" />
          ))}
        </div>
      </section>
    );
  }

  if (skills.length === 0) {
    return (
      <section className="space-y-3">
        {heading}
        <SkillsEmptyPanel
          title={search ? messages.skills.localEmptySearchTitle : messages.skills.localEmptyTitle}
          description={
            search
              ? messages.skills.localEmptySearchDescription
              : messages.skills.localEmptyDescription
          }
        />
      </section>
    );
  }

  return (
    <section className="space-y-3">
      {heading}
      <div className="grid grid-cols-1 gap-2">
        {skills.map((skill) => (
          <LocalSkillCard key={`${skill.source}::${skill.name}`} skill={skill} />
        ))}
      </div>
    </section>
  );
}

function LocalSkillCard({ skill }: { skill: LocalSkill }) {
  const sourceLabel = SOURCE_LABEL[skill.source] ?? SOURCE_LABEL.unknown ?? "Unknown";
  return (
    <div className="group flex flex-col gap-2 rounded-xl border border-[color:var(--color-border-light)] bg-[var(--color-background-panel)] px-4 py-3 transition-colors hover:bg-[var(--sidebar-accent)]">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="truncate text-[13px] leading-snug font-semibold text-foreground">
              {skill.name}
            </p>
            {skill.version ? (
              <span className="shrink-0 rounded-full border border-border/60 px-1.5 py-0.5 text-[10px] text-muted-foreground/80">
                v{skill.version}
              </span>
            ) : null}
            {skill.enabled ? (
              <span
                className="inline-flex size-4 shrink-0 items-center justify-center rounded-full border border-border/40 text-muted-foreground/60"
                title="Enabled"
              >
                <CheckIcon className="size-2.5" />
              </span>
            ) : null}
          </div>
          {skill.description ? (
            <p className="mt-1 line-clamp-2 text-[12px] leading-relaxed text-muted-foreground/85">
              {skill.description}
            </p>
          ) : null}
        </div>
        {skill.homepage ? (
          <a
            href={skill.homepage}
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex h-7 shrink-0 items-center gap-1 rounded-md border border-border/60 px-2 text-[11px] text-foreground/80 transition-colors hover:bg-accent/40"
            title={skill.homepage}
          >
            <ExternalLinkIcon className="size-3" />
          </a>
        ) : null}
      </div>
      <div className="flex items-center gap-2 text-[10.5px] text-muted-foreground/70">
        <span className="rounded-full border border-border/40 bg-background/70 px-1.5 py-0.5 font-mono">
          {sourceLabel}
        </span>
        <span className="truncate font-mono" title={skill.path}>
          {skill.path}
        </span>
      </div>
    </div>
  );
}

function ProviderSkillCard({
  skill,
}: {
  skill: {
    name: string;
    description?: string | undefined;
    interface?:
      | {
          readonly displayName?: string | undefined;
          readonly shortDescription?: string | undefined;
        }
      | undefined;
    enabled: boolean;
    path: string;
  };
}) {
  const displayName = skill.interface?.displayName ?? skill.name;
  const description = skill.interface?.shortDescription ?? skill.description ?? "";
  return (
    <div className="flex items-center gap-3 rounded-xl px-3 py-3 transition-colors hover:bg-[var(--sidebar-accent)]">
      <div className="flex size-11 shrink-0 items-center justify-center rounded-[14px] bg-accent/30 text-[15px] font-semibold text-foreground">
        {skill.name.charAt(0).toUpperCase()}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[13px] leading-snug font-semibold text-foreground">{displayName}</p>
        {description ? (
          <p className="mt-0.5 truncate text-[12px] text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {skill.enabled ? (
        <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-lg border border-border/40 text-muted-foreground/60">
          <CheckIcon className="size-3.5" />
        </span>
      ) : null}
    </div>
  );
}

function SkillsEmptyPanel({ title, description }: { title: string; description: string }) {
  return (
    <div className="flex min-h-32 items-center justify-center rounded-xl border border-dashed border-border/60 bg-background/40 px-5 py-6 text-center">
      <div className="max-w-sm space-y-1">
        <p className="text-sm font-medium text-foreground">{title}</p>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
    </div>
  );
}

function SkillsInlineWarning({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-start gap-2 rounded-xl border border-amber-500/20 bg-amber-500/6 px-3 py-2.5 text-xs text-muted-foreground">
      <CircleAlertIcon className="mt-0.5 size-3.5 shrink-0 text-amber-500" />
      <div>{children}</div>
    </div>
  );
}
