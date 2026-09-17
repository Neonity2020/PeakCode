import { describe, expect, it } from "vitest";

import { declaredModelIdsFromModelsJson } from "./modelProviders";

describe("declaredModelIdsFromModelsJson", () => {
  it("reads the model ids a provider lists, keyed by provider", () => {
    expect(
      declaredModelIdsFromModelsJson(
        JSON.stringify({
          providers: {
            deepseek: {
              baseUrl: "https://api.example.com/v1",
              apiKey: "sk-x",
              models: [{ id: "deepseek-v4.1" }, { id: "  spaced  " }, { name: "no id" }],
            },
            Step: { baseUrl: "https://api.stepfun.com", models: [{ id: "water18-0910" }] },
          },
        }),
      ),
    ).toEqual({
      deepseek: new Set(["deepseek-v4.1", "spaced"]),
      Step: new Set(["water18-0910"]),
    });
  });

  it("marks a provider with no model list as 'use its defaults'", () => {
    expect(
      declaredModelIdsFromModelsJson(
        JSON.stringify({ providers: { anthropic: { apiKey: "sk" } } }),
      ),
    ).toEqual({ anthropic: null });
  });

  it("declares nothing for files it cannot read, so nothing is hidden by mistake", () => {
    expect(declaredModelIdsFromModelsJson("not json")).toEqual({});
    expect(declaredModelIdsFromModelsJson(JSON.stringify({}))).toEqual({});
    expect(declaredModelIdsFromModelsJson(JSON.stringify({ providers: [] }))).toEqual({});
  });
});
