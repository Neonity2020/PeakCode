// FILE: modelCategories.ts
// Purpose: Categorize remote model ids so the "fetch model list" picker can
// group thousands of ids into filterable buckets, and split them by the vendor
// prefix in the id (`deepseek-ai/DeepSeek-V3` → `deepseek-ai`).
// Layer: Web UI support
//
// The classifier is a name heuristic ported from OmniStudio
// (`apps/studio/src/shared/modelscope.ts`): /models endpoints only return ids,
// so the id itself is the only signal available. `other` means "not
// recognized" rather than "misc", so a filter selection can always keep it.

export type ModelCategory =
  | "chat"
  | "embedding"
  | "rerank"
  | "tts"
  | "asr"
  | "image"
  | "video"
  | "music"
  | "other";

/** Render order of the category chips. */
export const MODEL_CATEGORIES: readonly ModelCategory[] = [
  "chat",
  "embedding",
  "rerank",
  "tts",
  "asr",
  "image",
  "video",
  "music",
  "other",
];

/**
 * Categorize a model by name. Only explicit naming traits are recognized; the
 * check order runs from the most specific family to the broadest, first hit
 * wins, so that e.g. `bge-reranker-v2-m3` lands in `rerank` and not in
 * `embedding` (it contains `bge`).
 */
export function classifyModelName(rawName: string): ModelCategory {
  const name = rawName.toLowerCase();
  const tokens = new Set(name.split(/[^a-z0-9]+/).filter(Boolean));
  const has = (...keys: string[]) => keys.some((key) => tokens.has(key));
  const hasWord = (...keys: string[]) => keys.some((key) => name.includes(key));

  // Rerank has to be decided before embeddings.
  if (
    hasWord("rerank", "reranker", "cross-encoder", "crossencoder", "reranking") ||
    has("ranker")
  ) {
    return "rerank";
  }

  // Embeddings: OpenAI text-embedding plus the usual open families.
  if (
    hasWord(
      "embedding",
      "embed-",
      "-embed",
      "_embed",
      "sentence-transformers",
      "text2vec",
      "minilm",
    ) ||
    has("embed", "embeddings", "bge", "gte", "m3e", "e5", "voyage", "bce", "acge", "piccolo") ||
    /(^|\/)(intfloat|dunzhang)\//.test(name)
  ) {
    return "embedding";
  }

  // Speech synthesis.
  if (
    hasWord(
      "tts",
      "text-to-speech",
      "cosyvoice",
      "sovits",
      "fish-speech",
      "fishaudio",
      "indextts",
      "index-tts",
      "mega-tts",
      "vocoder",
      "voice-clone",
      "voiceclone",
      "chatterbox",
      "speecht5",
      "outetts",
      "zonos",
      "xtts",
      "kokoro",
      "sambert",
      "higgs-audio",
      "f5-tts",
      "dia-tts",
    ) ||
    has("tts") ||
    // `speech-01` / `speech-2.5` are TTS, so the family needs a version digit.
    /(^|[/_-])speech[-_]?\d/.test(name)
  ) {
    return "tts";
  }

  // Speech recognition / transcription.
  if (
    hasWord(
      "whisper",
      "sensevoice",
      "paraformer",
      "funasr",
      "transcribe",
      "transcription",
      "speech-to-text",
      "speech-recognition",
      "vosk",
      "wav2vec",
      "moonshine",
      "whisperx",
      "scribe",
      "seaco",
      "dolphin",
    ) ||
    has("asr")
  ) {
    return "asr";
  }

  // Music generation. Hyphenated family names must use substring matching:
  // `ace-step` tokenizes to `ace` + `step`. A bare `audio` cannot be included
  // here because speech models like `qwen-audio` would be misfiled as music.
  if (
    hasWord("music") ||
    has("musicgen", "suno", "udio", "mureka", "acestep", "diffrhythm", "audioldm") ||
    hasWord("ace-step", "stable-audio", "text-to-music", "text2music")
  ) {
    return "music";
  }

  // Text-to-video.
  if (
    hasWord(
      "t2v",
      "i2v",
      "v2v",
      "text-to-video",
      "image-to-video",
      "seedance",
      "hailuo",
      "minimax-h3",
      "kling",
      "veo",
      "sora",
      "cogvideo",
      "hunyuanvideo",
      "ltx-video",
      "mochi",
      "pika",
      "runway",
      "luma",
    ) ||
    has("video", "videos")
  ) {
    return "video";
  }

  // Text-to-image.
  if (
    hasWord(
      "stable-diffusion",
      "sdxl",
      "sd3",
      "sd-turbo",
      "sd15",
      "flux",
      "kolors",
      "dall-e",
      "dall·e",
      "dalle",
      "imagen",
      "gpt-image",
      "seedream",
      "seededit",
      "wanx",
      "qwen-image",
      "hunyuan-image",
      "cogview",
      "midjourney",
      "ideogram",
      "recraft",
      "playground",
      "schnell",
      "text-to-image",
      "image-generation",
      "imagegen",
    ) ||
    has("image", "images")
  ) {
    return "image";
  }

  // Text chat / VLM, decided last as the "looks like a chat model" fallback.
  if (
    hasWord(
      "chat",
      "instruct",
      "text-generation",
      "conversational",
      "gpt",
      "claude",
      "gemini",
      "qwen",
      "llama",
      "mistral",
      "mixtral",
      "deepseek",
      "chatglm",
      "glm",
      "moonshot",
      "kimi",
      "doubao",
      "ernie",
      "hunyuan",
      "baichuan",
      "command-r",
      "gemma",
      "phi-",
      "olmo",
      "falcon",
      "vicuna",
      "hermes",
      "sonnet",
      "opus",
      "haiku",
      "grok",
      "reasoner",
      "omni",
      "mimo",
      "vision",
      "cogvlm",
    ) ||
    has("llm", "vl", "chat", "instruct")
  ) {
    return "chat";
  }

  return "other";
}

export interface ModelNamespaceGroup {
  /** Vendor prefix before the first `/`; `""` is the ungrouped bucket. */
  readonly namespace: string;
  readonly models: readonly string[];
}

/**
 * Split ids into vendor groups. Aggregators return hundreds of
 * `owner/model` ids, and the prefix is the only grouping key /models gives us.
 * Named groups come first (alphabetically); ids without a prefix go last so
 * they don't push the interesting groups off screen.
 */
export function groupModelsByNamespace(ids: readonly string[]): ModelNamespaceGroup[] {
  const groups = new Map<string, string[]>();
  for (const id of ids) {
    const slash = id.indexOf("/");
    const namespace = slash > 0 ? id.slice(0, slash) : "";
    const bucket = groups.get(namespace);
    if (bucket) {
      bucket.push(id);
    } else {
      groups.set(namespace, [id]);
    }
  }
  return [...groups.entries()]
    .toSorted(([a], [b]) => {
      if (a === b) return 0;
      if (a === "") return 1;
      if (b === "") return -1;
      return a.localeCompare(b);
    })
    .map(([namespace, models]) => ({ namespace, models }));
}

/** Count of ids per category, for the chip labels. */
export function countByCategory(ids: readonly string[]): Record<ModelCategory, number> {
  const counts = Object.fromEntries(MODEL_CATEGORIES.map((value) => [value, 0])) as Record<
    ModelCategory,
    number
  >;
  for (const id of ids) {
    counts[classifyModelName(id)] += 1;
  }
  return counts;
}
