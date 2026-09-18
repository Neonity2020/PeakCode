import { describe, expect, it } from "vitest";
import {
  buildSettingsNavGroups,
  buildSettingsNavItems,
  normalizeSettingsSection,
} from "./settingsNavigation";
import { MESSAGES } from "./i18n";

describe("settingsNavigation", () => {
  it("normalizes unknown section ids back to general", () => {
    expect(normalizeSettingsSection(undefined)).toBe("general");
    expect(normalizeSettingsSection("advanced")).toBe("advanced");
    expect(normalizeSettingsSection("not-a-section")).toBe("general");
    // Sections that no longer exist fall back rather than breaking a stale deep link.
    expect(normalizeSettingsSection("providers")).toBe("general");
    expect(normalizeSettingsSection("models")).toBe("general");
  });

  it("exposes the same nav ids for every language", () => {
    const enIds = buildSettingsNavItems(MESSAGES.en).map((item) => item.id);
    const zhIds = buildSettingsNavItems(MESSAGES.zh).map((item) => item.id);
    expect(enIds).toEqual(zhIds);
  });

  it("localizes nav labels per language", () => {
    expect(buildSettingsNavItems(MESSAGES.en).find((item) => item.id === "general")?.label).toBe(
      "General",
    );
    expect(buildSettingsNavItems(MESSAGES.zh).find((item) => item.id === "general")?.label).toBe(
      "通用",
    );
  });

  it("localizes nav descriptions per language", () => {
    const en = buildSettingsNavItems(MESSAGES.en).find((item) => item.id === "modelProviders");
    const zh = buildSettingsNavItems(MESSAGES.zh).find((item) => item.id === "modelProviders");
    expect(en?.description).toBe("Add and edit AI providers and models written to models.json.");
    expect(zh?.description).toBe("添加并编辑写入 models.json 的模型提供商与模型。");
  });

  it("exposes localized group labels", () => {
    expect(buildSettingsNavGroups(MESSAGES.en).map((g) => g.label)).toEqual([
      "Basics",
      "Agent",
      "Data & stats",
    ]);
    expect(buildSettingsNavGroups(MESSAGES.zh).map((g) => g.label)).toEqual([
      "基础设置",
      "Agent 能力",
      "数据与统计",
    ]);
  });

  it("keeps every section assigned to a known group", () => {
    const groupIds = buildSettingsNavGroups(MESSAGES.en).map((group) => group.id);
    for (const item of buildSettingsNavItems(MESSAGES.en)) {
      expect(groupIds).toContain(item.group);
    }
  });

  it("lists the skills section under the agent group", () => {
    const skills = buildSettingsNavItems(MESSAGES.zh).find((item) => item.id === "skills");
    expect(skills?.label).toBe("技能");
    expect(skills?.group).toBe("agent");
  });

  it("lists the model providers section under the basics group", () => {
    const modelProviders = buildSettingsNavItems(MESSAGES.zh).find(
      (item) => item.id === "modelProviders",
    );
    expect(modelProviders?.label).toBe("模型提供商");
    expect(modelProviders?.group).toBe("basics");
  });

  it("lists the usage statistics section under the data group", () => {
    const usage = buildSettingsNavItems(MESSAGES.zh).find((item) => item.id === "usage");

    expect(usage?.label).toBe("使用统计");
    expect(usage?.group).toBe("data");
    expect(buildSettingsNavItems(MESSAGES.en).find((item) => item.id === "usage")?.label).toBe(
      "Usage",
    );
    expect(normalizeSettingsSection("usage")).toBe("usage");
  });
});
