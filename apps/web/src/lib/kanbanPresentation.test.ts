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
