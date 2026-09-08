import { describe, expect, it } from "vitest";
import { Schema } from "effect";

import { ProviderSendTurnInput, ProviderSessionStartInput } from "./provider";

const decodeProviderSessionStartInput = Schema.decodeUnknownSync(ProviderSessionStartInput);
const decodeProviderSendTurnInput = Schema.decodeUnknownSync(ProviderSendTurnInput);

describe("ProviderSessionStartInput", () => {
  it("accepts pi-compatible payloads", () => {
    const parsed = decodeProviderSessionStartInput({
      threadId: "thread-1",
      provider: "pi",
      cwd: "/tmp/workspace",
      modelSelection: {
        provider: "pi",
        model: "openai/gpt-5.3",
        options: {
          thinkingLevel: "high",
        },
      },
      runtimeMode: "full-access",
      providerOptions: {
        pi: {
          binaryPath: "/usr/local/bin/pi",
          agentDir: "/tmp/.pi",
        },
      },
    });
    expect(parsed.runtimeMode).toBe("full-access");
    expect(parsed.modelSelection?.provider).toBe("pi");
    expect(parsed.modelSelection?.model).toBe("openai/gpt-5.3");
    if (parsed.modelSelection?.provider !== "pi") {
      throw new Error("Expected pi modelSelection");
    }
    expect(parsed.modelSelection.options?.thinkingLevel).toBe("high");
    expect(parsed.providerOptions?.pi?.binaryPath).toBe("/usr/local/bin/pi");
    expect(parsed.providerOptions?.pi?.agentDir).toBe("/tmp/.pi");
  });

  it("rejects payloads without runtime mode", () => {
    expect(() =>
      decodeProviderSessionStartInput({
        threadId: "thread-1",
        provider: "pi",
      }),
    ).toThrow();
  });
});

describe("ProviderSendTurnInput", () => {
  it("accepts pi modelSelection", () => {
    const parsed = decodeProviderSendTurnInput({
      threadId: "thread-1",
      modelSelection: {
        provider: "pi",
        model: "openai/gpt-5.3",
        options: {
          thinkingLevel: "xhigh",
        },
      },
    });

    expect(parsed.modelSelection?.provider).toBe("pi");
    expect(parsed.modelSelection?.model).toBe("openai/gpt-5.3");
    if (parsed.modelSelection?.provider !== "pi") {
      throw new Error("Expected pi modelSelection");
    }
    expect(parsed.modelSelection.options?.thinkingLevel).toBe("xhigh");
  });

  it("accepts pi modelSelection without provider options", () => {
    const parsed = decodeProviderSendTurnInput({
      threadId: "thread-1",
      modelSelection: {
        provider: "pi",
        model: "openai/gpt-5.3",
        options: {
          thinkingLevel: "minimal",
        },
      },
    });

    expect(parsed.modelSelection?.provider).toBe("pi");
    if (parsed.modelSelection?.provider !== "pi") {
      throw new Error("Expected pi modelSelection");
    }
    expect(parsed.modelSelection.options?.thinkingLevel).toBe("minimal");
  });
});
