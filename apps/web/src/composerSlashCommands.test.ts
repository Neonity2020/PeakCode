import { describe, expect, it } from "vitest";

import {
  buildCompressPrompt,
  buildPromptReviewPrompt,
  buildReviewPrsPrompt,
  buildReviewPrompt,
  buildSubagentsPrompt,
  canOfferForkSlashCommand,
  canOfferReviewSlashCommand,
  canOfferSideSlashCommand,
  COMPOSER_PROMPT_INJECTION_BUILDERS,
  filterComposerSlashCommands,
  getAvailableComposerSlashCommands,
  hasProviderNativeSlashCommand,
  isBuiltInComposerSlashCommand,
  parseComposerSlashInvocation,
  parseComposerSlashInvocationForCommands,
  parseFastSlashCommandAction,
  parseForkSlashCommandArgs,
  shouldHideProviderNativeCommandFromComposerMenu,
} from "./composerSlashCommands";

describe("composerSlashCommands", () => {
  it("recognizes built-in slash commands", () => {
    expect(isBuiltInComposerSlashCommand("review")).toBe(true);
    expect(isBuiltInComposerSlashCommand("fast")).toBe(true);
    expect(isBuiltInComposerSlashCommand("unknown")).toBe(false);
  });

  it("filters slash commands by query", () => {
    expect(filterComposerSlashCommands("rev").map((entry) => entry.command)).toEqual([
      "review",
      "prompt-review",
      "review-prs",
    ]);
    expect(filterComposerSlashCommands("fast").map((entry) => entry.command)).toEqual(["fast"]);
  });

  it("parses slash invocations with optional arguments", () => {
    expect(parseComposerSlashInvocation("/review current diff")).toEqual({
      command: "review",
      args: "current diff",
    });
    expect(parseComposerSlashInvocation("/fast")).toEqual({
      command: "fast",
      args: "",
    });
    expect(parseComposerSlashInvocation("/side is this safe?")).toEqual({
      command: "side",
      args: "is this safe?",
    });
    expect(parseComposerSlashInvocation("review")).toBeNull();
  });

  it("does not parse app slash commands that are shadowed by provider-native commands", () => {
    expect(parseComposerSlashInvocationForCommands("/fast", ["clear", "model"])).toBeNull();
    expect(parseComposerSlashInvocationForCommands("/clear", ["clear", "model"])).toEqual({
      command: "clear",
      args: "",
    });
  });

  it("parses /fast actions", () => {
    expect(parseFastSlashCommandAction("/fast")).toBe("toggle");
    expect(parseFastSlashCommandAction("/fast on")).toBe("on");
    expect(parseFastSlashCommandAction("/fast off")).toBe("off");
    expect(parseFastSlashCommandAction("/fast status")).toBe("status");
    expect(parseFastSlashCommandAction("/fast maybe")).toBe("invalid");
    expect(parseFastSlashCommandAction("/review")).toBeNull();
  });

  it("parses /fork target shorthand only", () => {
    expect(parseForkSlashCommandArgs("")).toEqual({
      target: null,
      invalid: false,
    });
    expect(parseForkSlashCommandArgs("local")).toEqual({
      target: "local",
      invalid: false,
    });
    expect(parseForkSlashCommandArgs("  worktree  ")).toEqual({
      target: "worktree",
      invalid: false,
    });
    expect(parseForkSlashCommandArgs("follow up on the bug")).toEqual({
      target: null,
      invalid: true,
    });
    expect(parseForkSlashCommandArgs("local continue here")).toEqual({
      target: null,
      invalid: true,
    });
  });

  it("only offers /fork for an otherwise empty default composer", () => {
    expect(
      canOfferForkSlashCommand({
        prompt: "",
        imageCount: 0,
        terminalContextCount: 0,
        selectedSkillCount: 0,
        selectedMentionCount: 0,
        interactionMode: "default",
      }),
    ).toBe(true);

    expect(
      canOfferForkSlashCommand({
        prompt: "hello",
        imageCount: 0,
        terminalContextCount: 0,
        selectedSkillCount: 0,
        selectedMentionCount: 0,
        interactionMode: "default",
      }),
    ).toBe(false);

    expect(
      canOfferForkSlashCommand({
        prompt: "",
        imageCount: 0,
        terminalContextCount: 0,
        selectedSkillCount: 0,
        selectedMentionCount: 0,
        interactionMode: "plan",
      }),
    ).toBe(false);
  });

  it("only offers /side for a main-thread empty default composer", () => {
    expect(
      canOfferSideSlashCommand({
        prompt: "",
        imageCount: 0,
        terminalContextCount: 0,
        selectedSkillCount: 0,
        selectedMentionCount: 0,
        interactionMode: "default",
        isSidechat: false,
      }),
    ).toBe(true);

    expect(
      canOfferSideSlashCommand({
        prompt: "",
        imageCount: 0,
        terminalContextCount: 0,
        selectedSkillCount: 0,
        selectedMentionCount: 0,
        interactionMode: "default",
        isSidechat: true,
      }),
    ).toBe(false);
  });

  it("only offers /review for an otherwise empty composer", () => {
    expect(
      canOfferReviewSlashCommand({
        prompt: "",
        imageCount: 0,
        terminalContextCount: 0,
        selectedSkillCount: 0,
        selectedMentionCount: 0,
      }),
    ).toBe(true);

    expect(
      canOfferReviewSlashCommand({
        prompt: "",
        imageCount: 1,
        terminalContextCount: 0,
        selectedSkillCount: 0,
        selectedMentionCount: 0,
      }),
    ).toBe(false);
  });

  it("builds slash-command canned prompts", () => {
    expect(buildSubagentsPrompt("")).toContain("Run subagents");
    expect(buildSubagentsPrompt("Already there")).toContain("Already there\n\nRun subagents");
    expect(buildReviewPrompt({ target: "changes" })).toContain("uncommitted changes");
    expect(buildReviewPrompt({ target: "base-branch" })).toContain("base branch");
  });

  it("points the ported-skill commands at the skill they drive", () => {
    // These two exist to make the ported skills invocable, so the skill id is the contract:
    // a rename would silently turn them into "read a skill that isn't installed".
    expect(buildCompressPrompt("")).toContain("`semantic-compression`");
    expect(buildCompressPrompt("src/prompt.md")).toContain("Target: src/prompt.md");
    expect(buildCompressPrompt("")).toContain("ask me which text");
    expect(buildPromptReviewPrompt("")).toContain("`system-prompts`");
    expect(buildPromptReviewPrompt("the tool docs")).toContain("Target: the tool docs");
  });

  it("adapts the PR-review command to this repo's own gate", () => {
    expect(buildReviewPrsPrompt("")).toContain("bash scripts/pr-review.sh");
    expect(buildReviewPrsPrompt("")).not.toContain("pr-review.sh ");
    expect(buildReviewPrsPrompt("123")).toContain("bash scripts/pr-review.sh 123");
    expect(buildReviewPrsPrompt("--all")).toContain("bash scripts/pr-review.sh --all");
    // The oh-my-pi original leaned on its own GitHub/IRC tooling; this repo has neither.
    expect(buildReviewPrsPrompt("")).toContain("do not reach for GitHub MCP tools");
  });

  it("registers every injectable command in the shared builder table", () => {
    // Both dispatch sites read this table, so a command missing here would appear in the
    // menu and then do nothing when picked.
    expect(Object.keys(COMPOSER_PROMPT_INJECTION_BUILDERS).toSorted()).toEqual([
      "compress",
      "prompt-review",
      "review-prs",
      "subagents",
    ]);
    for (const command of ["compress", "prompt-review", "review-prs"] as const) {
      expect(isBuiltInComposerSlashCommand(command)).toBe(true);
      const built = COMPOSER_PROMPT_INJECTION_BUILDERS[command]!("");
      expect(built.length, command).toBeGreaterThan(0);
      expect(built, command).not.toContain("/" + command);
    }
  });

  it("filters app slash commands when a provider exposes the same command natively", () => {
    const availableCommands = getAvailableComposerSlashCommands({
      provider: "pi",
      supportsFastSlashCommand: true,
      canOfferCompactCommand: true,
      canOfferReviewCommand: true,
      canOfferForkCommand: true,
      canOfferSideCommand: true,
      providerNativeCommandNames: ["fast", "/model", "status"],
    });

    expect(availableCommands).not.toContain("fast");
    expect(availableCommands).not.toContain("model");
    expect(availableCommands).not.toContain("status");
    expect(hasProviderNativeSlashCommand("pi", ["/fast", "model"], "fast")).toBe(true);
    expect(hasProviderNativeSlashCommand("pi", ["/fast", "model"], "/model")).toBe(true);
  });

  it("hides app /review when the provider exposes review natively", () => {
    const availableCommands = getAvailableComposerSlashCommands({
      provider: "pi",
      supportsFastSlashCommand: true,
      canOfferCompactCommand: true,
      canOfferReviewCommand: true,
      canOfferForkCommand: true,
      canOfferSideCommand: true,
      providerNativeCommandNames: ["review"],
    });

    expect(availableCommands).not.toContain("review");
    expect(shouldHideProviderNativeCommandFromComposerMenu("pi", "review")).toBe(false);
    expect(shouldHideProviderNativeCommandFromComposerMenu("pi", "status")).toBe(false);
  });

  it("exposes the full app-level slash command set for pi", () => {
    expect(
      getAvailableComposerSlashCommands({
        provider: "pi",
        supportsFastSlashCommand: true,
        canOfferCompactCommand: true,
        canOfferReviewCommand: true,
        canOfferForkCommand: true,
        canOfferSideCommand: true,
      }),
    ).toEqual([
      "clear",
      "compact",
      "model",
      "fast",
      "plan",
      "default",
      "review",
      "fork",
      "side",
      "status",
      "subagents",
      "compress",
      "prompt-review",
      "review-prs",
    ]);
  });

  it("only offers /compact when compaction is available", () => {
    expect(
      getAvailableComposerSlashCommands({
        provider: "pi",
        supportsFastSlashCommand: true,
        canOfferCompactCommand: true,
        canOfferReviewCommand: true,
        canOfferForkCommand: true,
        canOfferSideCommand: true,
      }),
    ).toContain("compact");

    expect(
      getAvailableComposerSlashCommands({
        provider: "pi",
        supportsFastSlashCommand: true,
        canOfferCompactCommand: false,
        canOfferReviewCommand: true,
        canOfferForkCommand: true,
        canOfferSideCommand: true,
      }),
    ).not.toContain("compact");
  });

  it("exposes shared app slash commands for pi", () => {
    expect(
      getAvailableComposerSlashCommands({
        provider: "pi",
        supportsFastSlashCommand: false,
        canOfferCompactCommand: false,
        canOfferReviewCommand: true,
        canOfferForkCommand: true,
        canOfferSideCommand: true,
      }),
    ).toEqual([
      "clear",
      "model",
      "plan",
      "default",
      "review",
      "fork",
      "side",
      "status",
      "subagents",
      "compress",
      "prompt-review",
      "review-prs",
    ]);
  });

  it("does not map provider-native aliases in pi mode", () => {
    expect(hasProviderNativeSlashCommand("pi", ["branch", "model"], "fork")).toBe(false);
    expect(hasProviderNativeSlashCommand("pi", ["clear"], "reset")).toBe(false);
  });
});
