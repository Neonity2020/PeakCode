// FILE: kanbanPresentation.test.ts
// Purpose: Pins the short codes and lookups kanban surfaces render: work-item
//          codes, project initials, model names, and column colours.
// Layer: Web presentation helper tests

import { describe, expect, it } from "vitest";

import { MESSAGES } from "../i18n/messages";
import {
  KANBAN_STATUS_ACCENT,
  kanbanColumnAccent,
  kanbanProjectCode,
  kanbanRunStatusLabel,
  kanbanStampLabel,
  kanbanStatusLabel,
  kanbanTaskCode,
  shortModelName,
  shortWorkspacePath,
} from "./kanbanPresentation";

describe("kanbanTaskCode", () => {
  it("derives a work-item code from the task id and project initials", () => {
    expect(kanbanTaskCode("t_29b8116000", "PC")).toBe("PC-29B8");
    expect(kanbanTaskCode("t_29b8116000", "")).toBe("29B8");
  });

  it("drops the id prefix and punctuation before shortening", () => {
    expect(kanbanTaskCode("task_ab-cd-ef", "PC")).toBe("PC-ABCD");
    expect(kanbanTaskCode("kanban_1234", "PC")).toBe("PC-1234");
  });

  it("falls back to the project code when the id carries nothing usable", () => {
    expect(kanbanTaskCode("___", "PC")).toBe("PC");
  });
});

describe("kanbanProjectCode", () => {
  it("takes the initials of a camel-cased or multi-word title", () => {
    expect(kanbanProjectCode("PeakCode")).toBe("PC");
    expect(kanbanProjectCode("auto campaigns launch")).toBe("ACL");
  });

  it("keeps the first characters of a CJK title", () => {
    expect(kanbanProjectCode("看板项目")).toBe("看板");
  });

  it("never returns an empty code", () => {
    expect(kanbanProjectCode("   ")).toBe("?");
  });
});

describe("shortModelName", () => {
  it("keeps only the model, not its provider prefix", () => {
    expect(shortModelName("anthropic/claude-sonnet-4")).toBe("claude-sonnet-4");
    expect(shortModelName("gpt-5")).toBe("gpt-5");
    expect(shortModelName("")).toBe("");
  });
});

describe("shortWorkspacePath", () => {
  it("shortens home paths and leaves other paths alone", () => {
    expect(shortWorkspacePath("/Users/ada/projects/peak")).toBe("~/projects/peak");
    expect(shortWorkspacePath("/srv/peak")).toBe("/srv/peak");
  });
});

describe("kanbanColumnAccent", () => {
  it("prefers the board's dot and falls back to the status palette", () => {
    expect(kanbanColumnAccent("todo", "#123456")).toBe("#123456");
    expect(kanbanColumnAccent("todo", "  ")).toBe(KANBAN_STATUS_ACCENT.todo);
    expect(kanbanColumnAccent("in_progress")).toBe(KANBAN_STATUS_ACCENT.in_progress);
  });
});

describe("labels", () => {
  it("reads the status and run-state labels from the message catalogue", () => {
    expect(kanbanStatusLabel(MESSAGES.en, "in_progress")).toBe("In progress");
    expect(kanbanStatusLabel(MESSAGES.zh, "blocked")).toBe("已阻塞");
    expect(kanbanRunStatusLabel(MESSAGES.en, "running")).toBe("Running");
    expect(kanbanRunStatusLabel(MESSAGES.zh, null)).toBe(MESSAGES.zh.kanban.agentRunUnknown);
  });
});

/** An ISO stamp `daysAgo` before now, at the same time of day. */
function stampDaysAgo(daysAgo: number): string {
  const date = new Date();
  date.setDate(date.getDate() - daysAgo);
  return date.toISOString();
}

describe("kanbanStampLabel", () => {
  it("names the days a card is most likely to carry", () => {
    expect(kanbanStampLabel(stampDaysAgo(0), "en")).toMatch(/today/i);
    expect(kanbanStampLabel(stampDaysAgo(1), "en")).toMatch(/yesterday/i);
    expect(kanbanStampLabel(stampDaysAgo(0), "zh")).toBe("今天");
    expect(kanbanStampLabel(stampDaysAgo(1), "zh")).toBe("昨天");
  });

  it("drops to a short day once the card is older than that", () => {
    const older = kanbanStampLabel(stampDaysAgo(30), "en");
    expect(older).not.toMatch(/today|yesterday/i);
    expect(older.length).toBeGreaterThan(0);
  });

  it("renders nothing for a stamp it cannot read", () => {
    expect(kanbanStampLabel("not a date", "en")).toBe("");
  });
});
