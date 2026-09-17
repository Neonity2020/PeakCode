/**
 * Skills → 单项开关的浏览器测试。
 *
 * 这一层要证明的是"点一下真的发了请求，且带的是目录名 id"：开关按 id 生效，
 * 而卡片上显示的是 frontmatter 的 name，传错一个就会静默什么也不做。
 * provider 那一侧的数据与开关无关，这里整体 mock 掉，只留本地技能列表。
 */
import "../index.css";
import type { ListLocalUserSkillsResult } from "@peakcode/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";
import { I18nProvider } from "../i18n";
import { SkillsPanel } from "./SkillsPanel";

const api = vi.hoisted(() => ({ listLocal: vi.fn(), setEnabled: vi.fn() }));
vi.mock("../nativeApi", () => ({ ensureNativeApi: () => ({ skills: api }) }));

vi.mock("./useProviderDiscoveryData", () => ({
  useProviderDiscoveryData: () => ({
    skillSearch: "",
    setSkillSearch: () => {},
    discoveryCwd: "/tmp/workspace",
    providerLabel: "Pi",
    canListSkills: true,
    skillsQuery: { isLoading: false },
    discoveredSkills: [],
    filteredSkills: [],
  }),
}));

afterEach(() => vi.resetAllMocks());

const skillList: ListLocalUserSkillsResult = {
  searchedDirs: ["/home/.agents/skills"],
  skills: [
    {
      id: "dir-name-is-the-id",
      name: "A Nicer Display Name",
      description: "Compresses text",
      path: "/home/.agents/skills/dir-name-is-the-id/SKILL.md",
      source: "agents",
      sourceDir: "/home/.agents/skills/dir-name-is-the-id",
      enabled: true,
    },
  ],
};

/**
 * The mock has to remember what was switched off: the panel invalidates the listing after a
 * write, so a mock that always answers "enabled" would flip the switch back and hide a real
 * bug behind a test that looks like it is exercising the optimistic update.
 */
async function mountPanel(skills: ListLocalUserSkillsResult = skillList) {
  const disabled = new Set(
    skills.skills.filter((skill) => !skill.enabled).map((skill) => skill.id),
  );
  api.listLocal.mockImplementation(async () => ({
    ...skills,
    skills: skills.skills.map((skill) => ({ ...skill, enabled: !disabled.has(skill.id) })),
  }));
  api.setEnabled.mockImplementation(async (input: { id: string; enabled: boolean }) => {
    if (input.enabled) disabled.delete(input.id);
    else disabled.add(input.id);
    return { ...input, disabled: [...disabled].toSorted() };
  });
  await page.viewport(1164, 900);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await render(
    <QueryClientProvider client={client}>
      <I18nProvider language="en">
        <SkillsPanel />
      </I18nProvider>
    </QueryClientProvider>,
  );
}

it("lists the local skill under its display name", async () => {
  await mountPanel();
  await expect.element(page.getByText("A Nicer Display Name")).toBeVisible();
});

it("sends the directory id — not the display name — when switched off", async () => {
  await mountPanel();
  const toggle = page.getByRole("switch", {
    name: "Enable or disable the A Nicer Display Name skill",
  });
  await expect.element(toggle).toBeChecked();

  await toggle.click();

  await vi.waitFor(() =>
    expect(api.setEnabled).toHaveBeenCalledWith({ id: "dir-name-is-the-id", enabled: false }),
  );
  await expect.element(toggle).not.toBeChecked();
});

it("switches a disabled skill back on", async () => {
  await mountPanel({
    ...skillList,
    skills: [{ ...skillList.skills[0]!, enabled: false }],
  });
  const toggle = page.getByRole("switch", {
    name: "Enable or disable the A Nicer Display Name skill",
  });
  await expect.element(toggle).not.toBeChecked();
  // The consequence of "off" has to be visible, not implied by the switch alone.
  await expect
    .element(page.getByText("Hidden from the agent and refused by read_skill"))
    .toBeVisible();

  await toggle.click();

  await vi.waitFor(() =>
    expect(api.setEnabled).toHaveBeenCalledWith({ id: "dir-name-is-the-id", enabled: true }),
  );
});
