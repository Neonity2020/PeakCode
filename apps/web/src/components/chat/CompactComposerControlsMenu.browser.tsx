import { ModelSelection, ThreadId, type ProviderInteractionMode } from "@peakcode/contracts";
import "../../index.css";

import { page } from "vitest/browser";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import { I18nProvider } from "../../i18n";
import { CompactComposerControlsMenu } from "./CompactComposerControlsMenu";
import { TraitsMenuContent } from "./TraitsPicker";
import { useComposerDraftStore } from "../../composerDraftStore";

async function mountMenu(props?: {
  activePlan?: boolean;
  interactionMode?: ProviderInteractionMode;
  modelSelection?: ModelSelection;
  prompt?: string;
}) {
  const threadId = ThreadId.makeUnsafe("thread-compact-menu");
  const provider = props?.modelSelection?.provider ?? "pi";
  const draftsByThreadId = {} as ReturnType<
    typeof useComposerDraftStore.getState
  >["draftsByThreadId"];
  const model = props?.modelSelection?.model ?? "";

  draftsByThreadId[threadId] = {
    prompt: props?.prompt ?? "",
    images: [],
    nonPersistedImageIds: [],
    persistedAttachments: [],
    assistantSelections: [],
    terminalContexts: [],
    queuedTurns: [],
    modelSelectionByProvider: {
      [provider]: {
        provider,
        model,
        ...(props?.modelSelection?.options ? { options: props.modelSelection.options } : {}),
      },
    },
    activeProvider: provider,
    runtimeMode: null,
    interactionMode: null,
  };
  useComposerDraftStore.setState({
    draftsByThreadId,
    draftThreadsByThreadId: {},
    projectDraftThreadIdByProjectId: {},
  });
  const host = document.createElement("div");
  document.body.append(host);
  const onPromptChange = vi.fn();
  const providerOptions = props?.modelSelection?.options;
  const onSetInteractionMode = vi.fn();
  const screen = await render(
    <I18nProvider language="en">
      <CompactComposerControlsMenu
        activePlan={props?.activePlan ?? false}
        interactionMode={props?.interactionMode ?? "default"}
        planSidebarOpen={false}
        runtimeMode="approval-required"
        traitsMenuContent={
          <TraitsMenuContent
            provider={provider}
            threadId={threadId}
            model={model}
            prompt={props?.prompt ?? ""}
            modelOptions={providerOptions}
            onPromptChange={onPromptChange}
          />
        }
        onSetInteractionMode={onSetInteractionMode}
        onTogglePlanSidebar={vi.fn()}
        onToggleRuntimeMode={vi.fn()}
      />
    </I18nProvider>,
    { container: host },
  );

  const cleanup = async () => {
    await screen.unmount();
    host.remove();
  };

  return {
    [Symbol.asyncDispose]: cleanup,
    cleanup,
    onSetInteractionMode,
  };
}

describe("CompactComposerControlsMenu", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    useComposerDraftStore.setState({
      draftsByThreadId: {},
      draftThreadsByThreadId: {},
      projectDraftThreadIdByProjectId: {},
      stickyModelSelectionByProvider: {},
    });
  });

  it("shows agent, plan, and goal mode options", async () => {
    await using _ = await mountMenu();

    await page.getByLabelText("More composer controls").click();

    await vi.waitFor(() => {
      const text = document.body.textContent ?? "";
      expect(text).toContain("Agent");
      expect(text).toContain("Plan");
      expect(text).toContain("Goal");
    });
  });

  it("forwards the selected mode", async () => {
    await using menu = await mountMenu();

    await page.getByLabelText("More composer controls").click();
    await page.getByRole("menuitemradio", { name: "Goal" }).click();

    expect(menu.onSetInteractionMode).toHaveBeenCalledWith("goal");
  });

  it("shows the plan sidebar toggle when a plan is active", async () => {
    await using _ = await mountMenu({
      activePlan: true,
      interactionMode: "plan",
    });

    await page.getByLabelText("More composer controls").click();

    await vi.waitFor(() => {
      expect(document.body.textContent ?? "").toContain("Show plan sidebar");
    });
  });

  it("defaults the provider selection to pi", async () => {
    await using _ = await mountMenu({
      modelSelection: {
        provider: "pi",
        model: "anthropic/claude-sonnet-4-5",
      },
    });

    await page.getByLabelText("More composer controls").click();

    await vi.waitFor(() => {
      expect(document.body.textContent ?? "").toContain("Agent");
    });
  });
});
