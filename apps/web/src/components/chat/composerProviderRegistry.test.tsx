import { type ProviderModelDescriptor, ThreadId } from "@peakcode/contracts";
import { describe, expect, it, vi } from "vitest";
import {
  getComposerProviderState,
  renderProviderTraitsMenuContent,
  renderProviderTraitsPicker,
} from "./composerProviderRegistry";
import { getComposerTraitSelection } from "./composerTraits";

const PI_RUNTIME_MODEL_WITH_REASONING: ProviderModelDescriptor = {
  slug: "openai/gpt-5.5",
  name: "GPT-5.5",
  upstreamProviderId: "openai",
  upstreamProviderName: "OpenAI",
  supportedReasoningEfforts: [
    { value: "off", label: "Off" },
    { value: "medium", label: "Medium" },
    { value: "xhigh", label: "Extra High" },
  ],
  defaultReasoningEffort: "medium",
};

describe("getComposerProviderState", () => {
  it("uses the runtime default thinking level for pi trigger state", () => {
    const state = getComposerProviderState({
      provider: "pi",
      model: "openai/gpt-5.5",
      runtimeModel: PI_RUNTIME_MODEL_WITH_REASONING,
      prompt: "",
      modelOptions: undefined,
    });

    expect(state).toEqual({
      provider: "pi",
      promptEffort: "medium",
      modelOptionsForDispatch: undefined,
    });
  });

  it("keeps pi thinking selections on the thinkingLevel field", () => {
    const state = getComposerProviderState({
      provider: "pi",
      model: "openai/gpt-5.5",
      runtimeModel: PI_RUNTIME_MODEL_WITH_REASONING,
      prompt: "",
      modelOptions: {
        pi: {
          thinkingLevel: "xhigh",
        },
      },
    });

    expect(state).toEqual({
      provider: "pi",
      promptEffort: "xhigh",
      modelOptionsForDispatch: {
        thinkingLevel: "xhigh",
      },
    });
  });

  it("falls back to the runtime default when the selected thinking level is unsupported", () => {
    const state = getComposerProviderState({
      provider: "pi",
      model: "openai/gpt-5.5",
      runtimeModel: PI_RUNTIME_MODEL_WITH_REASONING,
      prompt: "",
      modelOptions: {
        pi: {
          thinkingLevel: "low",
        },
      },
    });

    expect(state).toEqual({
      provider: "pi",
      promptEffort: "medium",
      modelOptionsForDispatch: {
        thinkingLevel: "low",
      },
    });
  });

  it("keeps pi runtime thinking selections on the thinkingLevel field", () => {
    const selection = getComposerTraitSelection(
      "pi",
      "openai/gpt-5.5",
      "",
      { thinkingLevel: "xhigh" },
      PI_RUNTIME_MODEL_WITH_REASONING,
    );
    const state = getComposerProviderState({
      provider: "pi",
      model: "openai/gpt-5.5",
      runtimeModel: PI_RUNTIME_MODEL_WITH_REASONING,
      prompt: "",
      modelOptions: {
        pi: {
          thinkingLevel: "xhigh",
        },
      },
    });

    expect(selection.primarySelectDescriptor?.id).toBe("thinkingLevel");
    expect(selection.effort).toBe("xhigh");
    expect(state).toEqual({
      provider: "pi",
      promptEffort: "xhigh",
      modelOptionsForDispatch: {
        thinkingLevel: "xhigh",
      },
    });
  });

  it("renders a traits picker for pi models that expose thinking controls", () => {
    const threadId = ThreadId.makeUnsafe("thread-pi-traits");
    const picker = renderProviderTraitsPicker({
      provider: "pi",
      threadId,
      model: "openai/gpt-5.5",
      runtimeModel: PI_RUNTIME_MODEL_WITH_REASONING,
      modelOptions: undefined,
      prompt: "",
      includeFastMode: false,
      onPromptChange: vi.fn(),
    });

    const menuContent = renderProviderTraitsMenuContent({
      provider: "pi",
      threadId,
      model: "openai/gpt-5.5",
      runtimeModel: PI_RUNTIME_MODEL_WITH_REASONING,
      modelOptions: undefined,
      prompt: "",
      onPromptChange: vi.fn(),
    });

    expect(picker).not.toBeNull();
    expect(menuContent).not.toBeNull();
  });
});
