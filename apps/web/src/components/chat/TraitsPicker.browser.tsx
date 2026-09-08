import "../../index.css";

import {
  type ModelSelection,
  type PiModelOptions,
  type ProviderModelDescriptor,
  ThreadId,
} from "@peakcode/contracts";
import { page } from "vitest/browser";
import { useCallback } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import { TraitsPicker } from "./TraitsPicker";
import {
  COMPOSER_DRAFT_STORAGE_KEY,
  ComposerThreadDraftState,
  useComposerDraftStore,
  useComposerThreadDraft,
  useEffectiveComposerModelState,
} from "../../composerDraftStore";

// ── Pi TraitsPicker tests ─────────────────────────────────────────────

const PI_THREAD_ID = ThreadId.makeUnsafe("thread-pi-traits");

const PI_RUNTIME_MODEL_WITH_REASONING: ProviderModelDescriptor = {
  slug: "openai/gpt-5.5",
  name: "GPT-5.5",
  upstreamProviderId: "openai",
  upstreamProviderName: "OpenAI",
  supportedReasoningEfforts: [{ value: "off" }, { value: "medium" }, { value: "xhigh" }],
  defaultReasoningEffort: "medium",
};

function PiTraitsPickerHarness(props: {
  model: string;
  runtimeModel?: ProviderModelDescriptor;
  fallbackModelSelection: ModelSelection | null;
}) {
  const prompt = useComposerThreadDraft(PI_THREAD_ID).prompt;
  const setPrompt = useComposerDraftStore((store) => store.setPrompt);
  const { modelOptions, selectedModel } = useEffectiveComposerModelState({
    threadId: PI_THREAD_ID,
    selectedProvider: "pi",
    threadModelSelection: props.fallbackModelSelection,
    projectModelSelection: null,
    customModelsByProvider: {
      pi: [],
    },
  });
  const handlePromptChange = useCallback(
    (nextPrompt: string) => {
      setPrompt(PI_THREAD_ID, nextPrompt);
    },
    [setPrompt],
  );

  return (
    <TraitsPicker
      provider="pi"
      threadId={PI_THREAD_ID}
      model={selectedModel ?? props.model}
      runtimeModel={props.runtimeModel}
      prompt={prompt}
      modelOptions={modelOptions?.pi}
      onPromptChange={handlePromptChange}
    />
  );
}

async function mountPiPicker(props?: {
  model?: string;
  options?: PiModelOptions;
  runtimeModel?: ProviderModelDescriptor;
  fallbackModelOptions?: PiModelOptions | null;
}) {
  const model = props?.model ?? "openai/gpt-5.5";
  const draftsByThreadId: Record<ThreadId, ComposerThreadDraftState> = {
    [PI_THREAD_ID]: {
      prompt: "",
      images: [],
      nonPersistedImageIds: [],
      persistedAttachments: [],
      assistantSelections: [],
      terminalContexts: [],
      queuedTurns: [],
      modelSelectionByProvider: {
        pi: {
          provider: "pi",
          model,
          ...(props?.options ? { options: props.options } : {}),
        },
      },
      activeProvider: "pi",
      runtimeMode: null,
      interactionMode: null,
    },
  };

  useComposerDraftStore.setState({
    draftsByThreadId,
    draftThreadsByThreadId: {},
    projectDraftThreadIdByProjectId: {},
  });
  const host = document.createElement("div");
  document.body.append(host);
  const fallbackModelSelection: ModelSelection = {
    provider: "pi",
    model,
    ...(props?.fallbackModelOptions ? { options: props.fallbackModelOptions } : {}),
  };
  const screen = await render(
    <PiTraitsPickerHarness
      model={model}
      {...(props?.runtimeModel ? { runtimeModel: props.runtimeModel } : {})}
      fallbackModelSelection={fallbackModelSelection}
    />,
    { container: host },
  );

  const cleanup = async () => {
    await screen.unmount();
    host.remove();
  };

  return {
    host,
    [Symbol.asyncDispose]: cleanup,
    cleanup,
  };
}

describe("TraitsPicker (Pi)", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    localStorage.removeItem(COMPOSER_DRAFT_STORAGE_KEY);
    useComposerDraftStore.setState({
      draftsByThreadId: {},
      draftThreadsByThreadId: {},
      projectDraftThreadIdByProjectId: {},
      stickyModelSelectionByProvider: {},
    });
  });

  it("does not render an empty traits trigger when the model exposes no controls", async () => {
    await using mounted = await mountPiPicker({
      model: "openrouter/gpt-oss-120b:free",
    });

    await vi.waitFor(() => {
      expect(mounted.host.textContent ?? "").toBe("");
      expect(mounted.host.querySelector("button")).toBeNull();
    });
  });

  it("shows the runtime default thinking level in the trigger label", async () => {
    await using mounted = await mountPiPicker({
      model: "openai/gpt-5.5",
      runtimeModel: PI_RUNTIME_MODEL_WITH_REASONING,
    });

    await vi.waitFor(() => {
      const text = mounted.host.textContent ?? "";
      expect(text).toContain("Medium");
    });
  });

  it("shows the selected thinking level in the trigger label", async () => {
    await using mounted = await mountPiPicker({
      model: "openai/gpt-5.5",
      runtimeModel: PI_RUNTIME_MODEL_WITH_REASONING,
      options: { thinkingLevel: "xhigh" },
    });

    await vi.waitFor(() => {
      const text = mounted.host.textContent ?? "";
      expect(text).toContain("Extra High");
    });
  });

  it("exposes thinking level options in the traits menu", async () => {
    await using mounted = await mountPiPicker({
      model: "openai/gpt-5.5",
      runtimeModel: PI_RUNTIME_MODEL_WITH_REASONING,
    });

    await page.getByRole("button").click();

    await vi.waitFor(() => {
      const text = document.body.textContent ?? "";
      expect(text).toContain("Effort");
      expect(text).toContain("Off");
      expect(text).toContain("Extra High");
    });
  });

  it("persists sticky pi thinking levels when the thinking level changes", async () => {
    await using mounted = await mountPiPicker({
      model: "openai/gpt-5.5",
      runtimeModel: PI_RUNTIME_MODEL_WITH_REASONING,
    });

    await page.getByRole("button").click();

    await vi.waitFor(() => {
      const text = document.body.textContent ?? "";
      expect(text).toContain("Extra High");
    });

    await page.getByRole("menuitemradio", { name: /^Extra High$/u }).click();

    expect(useComposerDraftStore.getState().stickyModelSelectionByProvider.pi).toMatchObject({
      provider: "pi",
      options: {
        thinkingLevel: "xhigh",
      },
    });

    await vi.waitFor(() => {
      expect(mounted.host.textContent ?? "").toContain("Extra High");
    });
  });
});
