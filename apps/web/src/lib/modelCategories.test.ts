import { describe, expect, it } from "vitest";
import { classifyModelName, countByCategory, groupModelsByNamespace } from "./modelCategories";

describe("classifyModelName", () => {
  it("decides rerank before embedding so bge rerankers do not land in embeddings", () => {
    expect(classifyModelName("BAAI/bge-reranker-v2-m3")).toBe("rerank");
    expect(classifyModelName("BAAI/bge-large-zh-v1.5")).toBe("embedding");
    expect(classifyModelName("text-embedding-3-large")).toBe("embedding");
  });

  it("keeps non-chat families out of chat", () => {
    expect(classifyModelName("speech-2.5-hd-preview")).toBe("tts");
    expect(classifyModelName("whisper-large-v3")).toBe("asr");
    expect(classifyModelName("stable-diffusion-xl")).toBe("image");
    expect(classifyModelName("kling-v1")).toBe("video");
  });

  it("recognizes hyphenated families and does not misfile speech as music", () => {
    expect(classifyModelName("ACE-Step-v1")).toBe("music");
    expect(classifyModelName("qwen-audio")).toBe("chat");
  });

  it("treats chat families as chat and unknown ids as other", () => {
    expect(classifyModelName("deepseek-v4-pro")).toBe("chat");
    expect(classifyModelName("mimo-v2-5-pro")).toBe("chat");
    expect(classifyModelName("claude-opus-5")).toBe("chat");
    expect(classifyModelName("x7-internal-thing")).toBe("other");
  });
});

describe("groupModelsByNamespace", () => {
  it("groups by vendor prefix and keeps ungrouped ids last", () => {
    expect(
      groupModelsByNamespace(["zzz-model", "Qwen/Qwen3", "deepseek-ai/DeepSeek-V3", "aaa"]),
    ).toEqual([
      { namespace: "deepseek-ai", models: ["deepseek-ai/DeepSeek-V3"] },
      { namespace: "Qwen", models: ["Qwen/Qwen3"] },
      { namespace: "", models: ["zzz-model", "aaa"] },
    ]);
  });
});

describe("countByCategory", () => {
  it("counts every category, including the empty ones", () => {
    const counts = countByCategory(["deepseek-v4-pro", "whisper-large-v3"]);
    expect(counts.chat).toBe(1);
    expect(counts.asr).toBe(1);
    expect(counts.music).toBe(0);
  });
});
