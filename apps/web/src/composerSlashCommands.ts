import type { GitBranch, ProviderInteractionMode, ProviderKind } from "@peakcode/contracts";

export const BUILT_IN_COMPOSER_SLASH_COMMANDS = [
  "clear",
  "compact",
  "model",
  "plan",
  "goal",
  "default",
  "review",
  "fork",
  "side",
  "status",
  "subagents",
  "fast",
  "compress",
  "prompt-review",
  "review-prs",
] as const;

export type ComposerSlashCommand = (typeof BUILT_IN_COMPOSER_SLASH_COMMANDS)[number];

export interface ComposerSlashCommandDefinition {
  command: ComposerSlashCommand;
  label: `/${ComposerSlashCommand}`;
  description: string;
  source: "app" | "shared";
}

export interface ComposerSlashInvocation {
  command: ComposerSlashCommand;
  args: string;
}

export type FastSlashCommandAction = "toggle" | "on" | "off" | "status" | "invalid";
export type ForkSlashCommandTarget = "local" | "worktree";

function normalizeSlashCommandName(value: string): string {
  return value.trim().replace(/^\/+/, "").toLowerCase();
}

function getProviderNativeSlashCommandAliases(
  _provider: ProviderKind,
  _command: string,
): readonly string[] {
  return [];
}

function expandProviderNativeSlashCommandNames(
  provider: ProviderKind,
  commandNames: ReadonlyArray<string>,
): string[] {
  const expandedNames = new Set<string>();
  for (const commandName of commandNames) {
    const normalizedCommandName = normalizeSlashCommandName(commandName);
    if (!normalizedCommandName) {
      continue;
    }
    expandedNames.add(normalizedCommandName);
    for (const alias of getProviderNativeSlashCommandAliases(provider, normalizedCommandName)) {
      expandedNames.add(alias);
    }
  }
  return [...expandedNames];
}

function shouldKeepBuiltInSlashCommandDespiteNativeCollision(
  _provider: ProviderKind,
  _command: ComposerSlashCommand,
): boolean {
  return false;
}

export function shouldHideProviderNativeCommandFromComposerMenu(
  _provider: ProviderKind,
  _command: string,
): boolean {
  return false;
}

export function getProviderNativeSlashCommandSearchTerms(
  provider: ProviderKind,
  command: string,
): readonly string[] {
  const normalizedCommand = normalizeSlashCommandName(command);
  return [normalizedCommand, ...getProviderNativeSlashCommandAliases(provider, normalizedCommand)];
}

const COMPOSER_SLASH_COMMAND_DEFINITIONS: Record<
  ComposerSlashCommand,
  ComposerSlashCommandDefinition
> = {
  clear: {
    command: "clear",
    label: "/clear",
    description: "Start a fresh thread and clear the current conversation context",
    source: "shared",
  },
  compact: {
    command: "compact",
    label: "/compact",
    description: "Compact the current thread context to free space",
    source: "app",
  },
  model: {
    command: "model",
    label: "/model",
    description: "Switch response model for this thread",
    source: "shared",
  },
  plan: {
    command: "plan",
    label: "/plan",
    description: "Switch this thread into plan mode",
    source: "app",
  },
  goal: {
    command: "goal",
    label: "/goal",
    description: "Switch this thread into goal mode — the agent keeps working across turns",
    source: "app",
  },
  default: {
    command: "default",
    label: "/default",
    description: "Switch this thread back to normal chat mode",
    source: "app",
  },
  review: {
    command: "review",
    label: "/review",
    description: "Start a code review for current changes",
    source: "app",
  },
  fork: {
    command: "fork",
    label: "/fork",
    description: "Fork this thread into local or a new worktree",
    source: "app",
  },
  side: {
    command: "side",
    label: "/side",
    description: "Open a guarded sidechat from this thread",
    source: "app",
  },
  status: {
    command: "status",
    label: "/status",
    description: "Show context usage and rate-limit status",
    source: "app",
  },
  subagents: {
    command: "subagents",
    label: "/subagents",
    description: "Insert a prompt that asks the assistant to delegate work",
    source: "app",
  },
  fast: {
    command: "fast",
    label: "/fast",
    description: "Turn fast mode on or off for this thread",
    source: "app",
  },
  compress: {
    command: "compress",
    label: "/compress",
    description:
      "Insert a prompt that compresses the given text with the semantic-compression skill",
    source: "app",
  },
  "prompt-review": {
    command: "prompt-review",
    label: "/prompt-review",
    description: "Insert a prompt that reviews a prompt against the system-prompts skill",
    source: "app",
  },
  "review-prs": {
    command: "review-prs",
    label: "/review-prs",
    description: "Insert a prompt that runs the repository's PR review gate",
    source: "app",
  },
};

export function isBuiltInComposerSlashCommand(value: string): value is ComposerSlashCommand {
  const normalizedValue = normalizeSlashCommandName(value);
  return BUILT_IN_COMPOSER_SLASH_COMMANDS.some((command) => command === normalizedValue);
}

export function parseComposerSlashInvocation(text: string): ComposerSlashInvocation | null {
  return parseComposerSlashInvocationForCommands(text, BUILT_IN_COMPOSER_SLASH_COMMANDS);
}

export function parseComposerSlashInvocationForCommands(
  text: string,
  commands: ReadonlyArray<ComposerSlashCommand>,
): ComposerSlashInvocation | null {
  const match = /^\/([a-z-]+)(?:\s+(.*))?$/i.exec(text.trim());
  if (!match) {
    return null;
  }
  const command = normalizeSlashCommandName(match[1] ?? "");
  if (!command || !commands.includes(command as ComposerSlashCommand)) {
    return null;
  }
  return {
    command: command as ComposerSlashCommand,
    args: (match[2] ?? "").trim(),
  };
}

export function getComposerSlashCommandDefinition(
  command: ComposerSlashCommand,
): ComposerSlashCommandDefinition {
  return COMPOSER_SLASH_COMMAND_DEFINITIONS[command];
}

export function filterComposerSlashCommands(
  query: string,
  commands: ReadonlyArray<ComposerSlashCommand> = BUILT_IN_COMPOSER_SLASH_COMMANDS,
): ComposerSlashCommandDefinition[] {
  const normalizedQuery = query.trim().toLowerCase();
  const matches = commands.filter((command) => {
    if (!normalizedQuery) {
      return true;
    }
    const definition = COMPOSER_SLASH_COMMAND_DEFINITIONS[command];
    return (
      command.includes(normalizedQuery) ||
      definition.label.slice(1).includes(normalizedQuery) ||
      definition.description.toLowerCase().includes(normalizedQuery)
    );
  });

  return matches.map((command) => COMPOSER_SLASH_COMMAND_DEFINITIONS[command]);
}

function hasMeaningfulComposerText(prompt: string): boolean {
  return prompt.trim().length > 0;
}

export function canOfferForkSlashCommand(input: {
  prompt: string;
  imageCount: number;
  terminalContextCount: number;
  selectedSkillCount: number;
  selectedMentionCount: number;
  interactionMode: ProviderInteractionMode;
}): boolean {
  return (
    !hasMeaningfulComposerText(input.prompt) &&
    input.imageCount === 0 &&
    input.terminalContextCount === 0 &&
    input.selectedSkillCount === 0 &&
    input.selectedMentionCount === 0 &&
    input.interactionMode === "default"
  );
}

export function canOfferSideSlashCommand(input: {
  prompt: string;
  imageCount: number;
  terminalContextCount: number;
  selectedSkillCount: number;
  selectedMentionCount: number;
  interactionMode: ProviderInteractionMode;
  isSidechat: boolean;
}): boolean {
  return (
    !hasMeaningfulComposerText(input.prompt) &&
    input.imageCount === 0 &&
    input.terminalContextCount === 0 &&
    input.selectedSkillCount === 0 &&
    input.selectedMentionCount === 0 &&
    input.interactionMode === "default" &&
    !input.isSidechat
  );
}

export function canOfferReviewSlashCommand(input: {
  prompt: string;
  imageCount: number;
  terminalContextCount: number;
  selectedSkillCount: number;
  selectedMentionCount: number;
}): boolean {
  return (
    !hasMeaningfulComposerText(input.prompt) &&
    input.imageCount === 0 &&
    input.terminalContextCount === 0 &&
    input.selectedSkillCount === 0 &&
    input.selectedMentionCount === 0
  );
}

export function buildSubagentsPrompt(existingPrompt: string): string {
  const cannedPrompt =
    "Run subagents for different tasks. Delegate distinct work in parallel when helpful and then synthesize the results.";
  const trimmedPrompt = existingPrompt.trim();
  return trimmedPrompt.length > 0 ? `${trimmedPrompt}\n\n${cannedPrompt}` : cannedPrompt;
}

// The three builders below back the ported-skill entry points and the adapted PR-review gate.
// Like /subagents they only *insert* text, so the user reads the instruction before sending it.

/** `/compress` — drives the ported `semantic-compression` skill. */
export function buildCompressPrompt(args: string): string {
  const target = args.trim();
  return [
    "Use the `semantic-compression` skill: call `read_skill` for it first, then follow its procedure exactly.",
    target.length > 0
      ? `Target: ${target}`
      : "Target: the text named in this thread; if none is named, ask me which text to compress before starting.",
    "Report the compressed text together with every declared loss.",
  ].join("\n");
}

/** `/prompt-review` — drives the ported `system-prompts` skill. */
export function buildPromptReviewPrompt(args: string): string {
  const target = args.trim();
  return [
    "Use the `system-prompts` skill: call `read_skill` for it first, then review the target prompt against its house style.",
    target.length > 0
      ? `Target: ${target}`
      : "Target: the prompt named in this thread; if none is named, ask me which prompt to review before starting.",
    "Findings first — what breaks the house style and why — then the rewritten prompt.",
  ].join("\n");
}

/** `/review-prs` — the one oh-my-pi command worth adapting: it lands on this repo's own gate. */
export function buildReviewPrsPrompt(args: string): string {
  const invocation = args.trim();
  return [
    "Review pull request(s) with this repository's own gate. Use the repository script — do not reach for GitHub MCP tools, an IRC tool, or any issue tracker.",
    `Run: \`bash scripts/pr-review.sh${invocation.length > 0 ? ` ${invocation}` : ""}\``,
    "Pass a PR number, `--all` for every open PR, or nothing to auto-detect the PR for the current branch; the script's header documents both and its exit codes (0 approved, 1 changes requested, 2 rejected).",
    "Report the verdict, then the errors that must be fixed before merging, quoting the script's own output rather than restating it from memory.",
  ].join("\n");
}

/**
 * Commands that work purely by putting instruction text into the composer.
 *
 * Both dispatch sites (submit and menu selection) read this one table, so a command only has
 * to be added here once to work in both — and `buildXPrompt` stays the single place that
 * decides what the model is told.
 */
export const COMPOSER_PROMPT_INJECTION_BUILDERS: Partial<
  Record<ComposerSlashCommand, (args: string) => string>
> = {
  subagents: buildSubagentsPrompt,
  compress: buildCompressPrompt,
  "prompt-review": buildPromptReviewPrompt,
  "review-prs": buildReviewPrsPrompt,
};

export function buildReviewPrompt(input: { target: "changes" | "base-branch" }): string {
  const baseInstruction =
    "Review the local code changes for bugs, risks, behavioural regressions, and missing tests. Findings first, ordered by severity.";
  if (input.target === "base-branch") {
    return `${baseInstruction}\nFocus on the current branch diff against its base branch.`;
  }
  return `${baseInstruction}\nFocus on the current uncommitted changes.`;
}

export function parseFastSlashCommandAction(text: string): FastSlashCommandAction | null {
  const invocation = parseComposerSlashInvocation(text);
  if (!invocation || invocation.command !== "fast") {
    return null;
  }
  const arg = invocation.args.toLowerCase();
  if (!arg) {
    return "toggle";
  }
  if (arg === "on") {
    return "on";
  }
  if (arg === "off") {
    return "off";
  }
  if (arg === "status") {
    return "status";
  }
  return "invalid";
}

export function resolveComposerSlashRootBranch(input: {
  branches: ReadonlyArray<GitBranch> | null | undefined;
  activeProjectCwd: string | null | undefined;
  activeThreadBranch: string | null | undefined;
}): string | null {
  return (
    input.branches?.find(
      (branch) =>
        branch.current === true &&
        (branch.worktreePath === null ||
          branch.worktreePath === undefined ||
          branch.worktreePath === input.activeProjectCwd),
    )?.name ??
    input.branches?.find((branch) => branch.current === true)?.name ??
    input.activeThreadBranch ??
    null
  );
}

export function getAvailableComposerSlashCommands(input: {
  provider: ProviderKind;
  supportsFastSlashCommand: boolean;
  canOfferCompactCommand: boolean;
  canOfferReviewCommand: boolean;
  canOfferForkCommand: boolean;
  canOfferSideCommand: boolean;
  providerNativeCommandNames?: ReadonlyArray<string>;
}): ComposerSlashCommand[] {
  const collidingNativeCommandNames = new Set<ComposerSlashCommand>(
    expandProviderNativeSlashCommandNames(
      input.provider,
      input.providerNativeCommandNames ?? [],
    ).filter(
      (name): name is ComposerSlashCommand =>
        isBuiltInComposerSlashCommand(name) &&
        !shouldKeepBuiltInSlashCommandDespiteNativeCollision(input.provider, name),
    ),
  );

  const availableCommands: ComposerSlashCommand[] = [
    "clear",
    ...(input.canOfferCompactCommand ? (["compact"] as const) : []),
    "model",
    ...(input.supportsFastSlashCommand ? (["fast"] as const) : []),
    "plan",
    "default",
    ...(input.canOfferReviewCommand ? (["review"] as const) : []),
    ...(input.canOfferForkCommand ? (["fork"] as const) : []),
    ...(input.canOfferSideCommand ? (["side"] as const) : []),
    "status",
    "subagents",
    // Always offered: they only shape the prompt text, so no composer state gates them.
    "compress",
    "prompt-review",
    "review-prs",
  ];
  return availableCommands.filter((command) => !collidingNativeCommandNames.has(command));
}

export function hasProviderNativeSlashCommand(
  provider: ProviderKind,
  commandNames: ReadonlyArray<string>,
  command: string,
): boolean {
  const normalizedCommand = normalizeSlashCommandName(command);
  return expandProviderNativeSlashCommandNames(provider, commandNames).includes(normalizedCommand);
}

export function buildSlashReviewComposerPrompt(args: string): string {
  const trimmedArgs = args.trim();
  const normalizedArgs = trimmedArgs.toLowerCase();
  const reviewTarget =
    normalizedArgs === "base" || normalizedArgs.startsWith("base ") ? "base-branch" : "changes";
  const basePrompt = buildReviewPrompt({ target: reviewTarget });
  if (!trimmedArgs) {
    return basePrompt;
  }
  if (reviewTarget === "base-branch") {
    const baseBranchHint = trimmedArgs.replace(/^base\b/i, "").trim();
    return baseBranchHint.length > 0
      ? `${basePrompt}\nUse ${baseBranchHint} as the base branch if needed.`
      : basePrompt;
  }
  return `${basePrompt}\nFocus especially on: ${trimmedArgs}`;
}

// `/fork` optionally accepts only an explicit target shorthand like `/fork local`.
export function parseForkSlashCommandArgs(args: string): {
  target: ForkSlashCommandTarget | null;
  invalid: boolean;
} {
  const trimmedArgs = args.trim();
  if (!trimmedArgs) {
    return { target: null, invalid: false };
  }

  const match = /^(local|worktree)$/i.exec(trimmedArgs);
  if (!match) {
    return { target: null, invalid: true };
  }

  return {
    target: match[1]!.toLowerCase() as ForkSlashCommandTarget,
    invalid: false,
  };
}
