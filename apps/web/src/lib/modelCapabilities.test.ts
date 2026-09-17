import { describe, expect, it } from "vitest";

import type { CustomModelConfig } from "@peakcode/contracts";

import { modelInputTypes, withModelInputTypes } from "./modelCapabilities";

describe("modelInputTypes", () => {
  it("defaults to text for models without any capability field", () => {
    expect(modelInputTypes({ id: "m" })).toEqual(["text"]);
  });

  it("reads pi's input array for models configured before the picker existed", () => {
    expect(modelInputTypes({ id: "m", input: ["text", "image"] })).toEqual(["text", "image"]);
  });

  it("prefers the extension key so video/pdf selections round-trip", () => {
    expect(
      modelInputTypes({ id: "m", input: ["text", "image"], inputTypes: ["text", "pdf"] }),
    ).toEqual(["text", "pdf"]);
  });

  it("always includes text and keeps picker order", () => {
    expect(modelInputTypes({ id: "m", inputTypes: ["pdf", "video"] })).toEqual([
      "text",
      "video",
      "pdf",
    ]);
  });
});

describe("withModelInputTypes", () => {
  it("writes image into pi's input without adding the extension key", () => {
    const model = withModelInputTypes({ id: "m" }, ["text", "image"]);
    expect(model).toEqual({ id: "m", input: ["text", "image"] });
    expect("inputTypes" in model).toBe(false);
  });

  it("keeps kinds pi rejects out of input and records them in inputTypes", () => {
    const model = withModelInputTypes({ id: "m" }, ["text", "image", "video", "pdf"]);
    expect(model.input).toEqual(["text", "image"]);
    expect(model.inputTypes).toEqual(["text", "image", "video", "pdf"]);
  });

  it("drops the extension key again when only pi-supported kinds remain", () => {
    const model = withModelInputTypes({ id: "m", input: ["text"], inputTypes: ["text", "pdf"] }, [
      "text",
    ]);
    expect(model).toEqual({ id: "m", input: ["text"] });
  });

  it("round-trips through modelInputTypes", () => {
    const kinds = ["text", "video"] as const;
    expect(modelInputTypes(withModelInputTypes({ id: "m" }, kinds))).toEqual([...kinds]);
  });

  it("leaves untouched keys in place so drafts compare equal", () => {
    const original: CustomModelConfig = {
      id: "m",
      name: "M",
      contextWindow: 1000,
      input: ["text", "image"],
    };
    expect(withModelInputTypes(original, ["text", "image"])).toEqual(original);
    expect(JSON.stringify(withModelInputTypes(original, ["text", "image"]))).toBe(
      JSON.stringify(original),
    );
  });
});
