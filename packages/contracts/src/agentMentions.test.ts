import { describe, expect, it } from "vitest";

import {
  AGENT_MENTION_ALIASES,
  getAgentAliasNames,
  getAgentMentionAliases,
  getAgentMentionAutocompleteAliases,
  isValidAgentAlias,
  resolveAgentAlias,
} from "./agentMentions";

describe("agentMentions", () => {
  it("shows no agent aliases in autocomplete for pi", () => {
    expect(getAgentMentionAutocompleteAliases("pi")).toEqual([]);
  });

  it("returns no agent aliases for pi", () => {
    expect(getAgentMentionAliases("pi")).toEqual([]);
    expect(getAgentAliasNames("pi")).toEqual([]);
  });

  it("returns no aliases when resolving any alias for pi", () => {
    expect(resolveAgentAlias("spark", "pi")).toBeNull();
    expect(resolveAgentAlias("review", "pi")).toBeNull();
    expect(isValidAgentAlias("anything", "pi")).toBe(false);
  });

  it("exposes an empty global alias table for the pi-only provider set", () => {
    expect(Object.keys(AGENT_MENTION_ALIASES)).toEqual([]);
    expect(getAgentMentionAliases()).toEqual([]);
  });
});
