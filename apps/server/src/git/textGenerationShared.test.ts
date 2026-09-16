// FILE: textGenerationShared.test.ts
// Purpose: Locks the shape of the requirement brief prompt behind the board's
//          "generate requirement" action, and its output sanitizing.
// Layer: Server unit test

import { describe, expect, it } from "vitest";

import { buildTaskRequirementPrompt, sanitizeTaskRequirement } from "./textGenerationShared";

describe("buildTaskRequirementPrompt", () => {
  it("asks for a short agile brief with acceptance criteria in the title's language", () => {
    const { prompt, outputSchemaJson } = buildTaskRequirementPrompt({ title: "看板支持归档" });

    expect(prompt).toContain("actionable requirement brief");
    expect(prompt).toContain("acceptance criteria section: 3-4 checkbox bullets");
    expect(prompt).toContain("under 160 words");
    expect(prompt).toContain("Write in the same language as the task title.");
    expect(prompt).toContain("看板支持归档");
    expect(outputSchemaJson).toBeDefined();
  });

  it("passes existing notes as context and omits the section when there are none", () => {
    expect(buildTaskRequirementPrompt({ title: "T", notes: "  先不动数据库  " }).prompt).toContain(
      "先不动数据库",
    );
    expect(buildTaskRequirementPrompt({ title: "T" }).prompt).not.toContain("already wrote");
    expect(buildTaskRequirementPrompt({ title: "T", notes: "   " }).prompt).not.toContain(
      "already wrote",
    );
  });
});

describe("sanitizeTaskRequirement", () => {
  it("keeps markdown and strips accidental code fences", () => {
    expect(sanitizeTaskRequirement("```markdown\n## 目标\n- 干活\n```")).toBe("## 目标\n- 干活");
    expect(sanitizeTaskRequirement("## Goal\n- [ ] works")).toBe("## Goal\n- [ ] works");
  });

  it("falls back to a usable skeleton for empty output", () => {
    const fallback = sanitizeTaskRequirement("   \n");

    expect(fallback).toContain("## Goal");
    expect(fallback).toContain("- [ ]");
  });
});
