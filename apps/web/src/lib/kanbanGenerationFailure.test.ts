// FILE: kanbanGenerationFailure.test.ts
// Purpose: A failed requirement generation has to read as advice ("that key may
//          not use this model"), not as the provider's raw error text.
// Layer: Web logic tests

import { describe, expect, it } from "vitest";

import { MESSAGES } from "../i18n";
import {
  classifyGenerationFailure,
  describeGenerationFailure,
  generationFailureReasonText,
} from "./kanbanGenerationFailure";

/** The failure a key-restricted relay returns for a model it will not serve. */
const KEY_MODEL_ACCESS_DENIED =
  "Failed to generate a requirement for '初始化分析当前项目': Text generation failed in " +
  "generateTaskRequirement: Error code: 403 - {'error': {'message': 'key not allowed to access " +
  "model. This key can only access models=['deepseek-v4-flash']. Tried to access deepseek-v4.1', " +
  "'type': 'key_model_access_denied', 'param': 'model', 'code': '403'}}";

describe("classifyGenerationFailure", () => {
  it("recognizes a key that may not call the requested model", () => {
    expect(classifyGenerationFailure(KEY_MODEL_ACCESS_DENIED)).toBe("model-access-denied");
  });

  it("recognizes credentials, missing models and timeouts", () => {
    expect(classifyGenerationFailure("401 Unauthorized: invalid api key provided")).toBe("auth");
    expect(classifyGenerationFailure("404 model_not_found: unknown model 'x'")).toBe(
      "model-not-found",
    );
    expect(classifyGenerationFailure("Request timed out after 180s")).toBe("timeout");
  });

  it("falls back to a provider error for anything it cannot place", () => {
    expect(classifyGenerationFailure("Upstream connection reset")).toBe("provider-error");
  });

  it("does not mistake a model-permission failure for a missing key", () => {
    // The blob mentions a key; what it actually reports is the model permission.
    expect(classifyGenerationFailure(KEY_MODEL_ACCESS_DENIED)).not.toBe("auth");
  });
});

describe("failure wording", () => {
  it("tells the user what to change, in their language", () => {
    const zh = generationFailureReasonText(MESSAGES.zh, KEY_MODEL_ACCESS_DENIED);
    expect(zh).toContain("没有访问权限");

    const en = generationFailureReasonText(MESSAGES.en, KEY_MODEL_ACCESS_DENIED);
    expect(en).toContain("not allowed for the configured key");
  });

  it("names the model that failed in the toast description", () => {
    const toast = describeGenerationFailure(
      MESSAGES.zh,
      KEY_MODEL_ACCESS_DENIED,
      "omni/deepseek-v4.1",
    );
    expect(toast.title).toBe("需求生成失败");
    expect(toast.description).toContain("omni/deepseek-v4.1");
    expect(toast.description).toContain("没有访问权限");
    // The raw provider text belongs in the copy action, not in the message.
    expect(toast.description).not.toContain("key_model_access_denied");
  });

  it("leaves the model out when the caller does not know it", () => {
    const toast = describeGenerationFailure(MESSAGES.en, "Upstream connection reset", "");
    expect(toast.description).toBe(MESSAGES.en.kanban.failure.providerError);
  });
});
