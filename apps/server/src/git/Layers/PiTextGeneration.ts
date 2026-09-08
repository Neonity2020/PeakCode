/**
 * PiTextGeneration - Pi-based implementation of git/thread text generation.
 *
 * Drives a Pi coding-agent session scoped to the target cwd, sends a prompt
 * that instructs the agent to reply with only a JSON object matching the
 * expected schema, waits for the final assistant text message, then parses
 * and sanitizes it into the same result shapes used by the Git services.
 *
 * @module PiTextGeneration
 */
import nodePath from "node:path";
import { readFile } from "node:fs/promises";

import {
  AuthStorage,
  ModelRegistry,
  SessionManager,
  createAgentSessionFromServices,
  createAgentSessionRuntime,
  createAgentSessionServices,
  getAgentDir,
  type AgentSession as PiAgentSession,
  type CreateAgentSessionRuntimeFactory,
} from "@earendil-works/pi-coding-agent";
import type { Api, ImageContent, Model, TextContent } from "@earendil-works/pi-ai";
import { DEFAULT_GIT_TEXT_GENERATION_MODEL, type ProviderStartOptions } from "@peakcode/contracts";
import { sanitizeGeneratedThreadTitle } from "@peakcode/shared/chatThreads";
import { sanitizeBranchFragment, sanitizeFeatureBranchName } from "@peakcode/shared/git";
import { Duration, Effect, Layer, Option, Schema } from "effect";

import { resolveAttachmentPath } from "../../attachmentStore.ts";
import { ServerConfig } from "../../config.ts";
import { TextGenerationError } from "../Errors.ts";
import {
  type BranchNameGenerationInput,
  type BranchNameGenerationResult,
  type CommitMessageGenerationResult,
  type DiffSummaryGenerationResult,
  type PrContentGenerationResult,
  type ThreadTitleGenerationResult,
  type TextGenerationShape,
  PiTextGeneration,
  TextGeneration,
} from "../Services/TextGeneration.ts";
import {
  buildBranchNamePrompt,
  buildCommitMessagePrompt,
  buildDiffSummaryPrompt,
  buildPrContentPrompt,
  buildThreadTitlePrompt,
  extractJsonObject,
  sanitizeCommitSubject,
  sanitizeDiffSummary,
  sanitizePrTitle,
  toJsonSchemaObject,
} from "../textGenerationShared.ts";

const PI_TIMEOUT = Duration.minutes(3);

type GenerationOperation =
  | "generateCommitMessage"
  | "generatePrContent"
  | "generateDiffSummary"
  | "generateBranchName"
  | "generateThreadTitle";

type AgentContentBlock = TextContent | ImageContent;
interface SlackAssistantMessage {
  role?: string;
  content?: string | ReadonlyArray<AgentContentBlock>;
}

function trimToUndefined(value: string | null | undefined): string | undefined {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed.length > 0 ? trimmed : undefined;
}

function parseModelReference(
  modelId: string | null | undefined,
): { readonly provider?: string; readonly id: string } | undefined {
  const trimmed = trimToUndefined(modelId);
  if (!trimmed) {
    return undefined;
  }
  if (trimmed.includes("/")) {
    const [provider, ...rest] = trimmed.split("/");
    const id = rest.join("/");
    if (provider && id) {
      return { provider, id };
    }
  }
  if (trimmed.includes(":")) {
    const [provider, ...rest] = trimmed.split(":");
    const id = rest.join(":");
    if (provider && id) {
      return { provider, id };
    }
  }
  return { id: trimmed };
}

function findPiModel(
  registry: ModelRegistry,
  modelId: string | null | undefined,
): Model<Api> | undefined {
  const parsed = parseModelReference(modelId);
  if (parsed?.provider) {
    return registry.find(parsed.provider, parsed.id);
  }
  if (parsed) {
    return (
      registry
        .getAll()
        .find((model) => model.id === parsed.id || `${model.provider}/${model.id}` === parsed.id) ??
      registry.getAll()[0]
    );
  }
  return registry.getAll()[0];
}

function textFromContent(content: string | ReadonlyArray<AgentContentBlock>): string {
  if (typeof content === "string") {
    return content;
  }
  return (content as readonly AgentContentBlock[])
    .filter((block): block is TextContent => block.type === "text")
    .map((block) => block.text)
    .join("\n\n");
}

function makeAgentDir(agentDir: string | undefined): string {
  return trimToUndefined(agentDir) ?? getAgentDir();
}

function lastAssistantText(session: PiAgentSession): string | undefined {
  const messages = session.messages as ReadonlyArray<SlackAssistantMessage>;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role === "assistant" && message.content !== undefined) {
      const text = textFromContent(message.content);
      if (text.trim().length > 0) {
        return text;
      }
    }
  }
  return undefined;
}

/**
 * Create a throwaway Pi agent session scoped to `cwd`, run a single prompt, and
 * return the assistant's final text message. Plain async — throws on failure so
 * the caller can wrap it in Effect.tryPromise.
 */
async function runPiPrompt(options: {
  readonly cwd: string;
  readonly agentDir: string;
  readonly modelId?: string;
  readonly prompt: string;
  readonly images?: ReadonlyArray<ImageContent>;
}): Promise<string> {
  const sessionManager = SessionManager.create(options.cwd);
  const authStorage = AuthStorage.create(nodePath.join(options.agentDir, "auth.json"));
  const registry = ModelRegistry.create(
    authStorage,
    nodePath.join(options.agentDir, "models.json"),
  );
  const model = findPiModel(registry, options.modelId);

  const createRuntime: CreateAgentSessionRuntimeFactory = async ({
    cwd,
    agentDir,
    sessionManager: sm,
    sessionStartEvent,
  }) => {
    const services = await createAgentSessionServices({
      cwd,
      agentDir,
      modelRegistry: registry,
    });
    return {
      ...(await createAgentSessionFromServices({
        services,
        sessionManager: sm,
        ...(sessionStartEvent ? { sessionStartEvent } : {}),
        ...(model ? { model } : {}),
        noTools: "all",
      })),
      services,
      diagnostics: services.diagnostics,
    };
  };

  const runtime = await createAgentSessionRuntime(createRuntime, {
    cwd: options.cwd,
    agentDir: options.agentDir,
    sessionManager,
  });

  try {
    await runtime.session.prompt(
      options.prompt,
      options.images && options.images.length > 0
        ? { images: [...options.images], expandPromptTemplates: false }
        : { expandPromptTemplates: false },
    );

    const text = lastAssistantText(runtime.session);
    if (!text) {
      throw new Error("Pi did not return an assistant message.");
    }
    return text;
  } finally {
    await runtime.dispose().catch(() => undefined);
  }
}

const makePiTextGeneration = Effect.gen(function* () {
  const serverConfig = yield* ServerConfig;

  const buildImageContents = (
    attachments: BranchNameGenerationInput["attachments"],
  ): Effect.Effect<ReadonlyArray<ImageContent>, TextGenerationError> =>
    Effect.gen(function* () {
      if (!attachments || attachments.length === 0) {
        return [];
      }
      const images: ImageContent[] = [];
      for (const attachment of attachments) {
        if (attachment.type !== "image" || !attachment.mimeType) {
          continue;
        }
        const attachmentPath = resolveAttachmentPath({
          attachmentsDir: serverConfig.attachmentsDir,
          attachment,
        });
        if (!attachmentPath) {
          continue;
        }
        const bytes = yield* Effect.tryPromise({
          try: () => readFile(attachmentPath),
          catch: (cause) =>
            new TextGenerationError({
              operation: "pi:readImage",
              detail: `Failed to read image attachment: ${cause instanceof Error ? cause.message : String(cause)}.`,
              cause,
            }),
        });
        if (bytes.length === 0) {
          continue;
        }
        images.push({
          type: "image",
          data: Buffer.from(bytes).toString("base64"),
          mimeType: attachment.mimeType,
        });
      }
      return images;
    });

  const resolveModelId = (
    model: string | undefined,
    modelSelection: BranchNameGenerationInput["modelSelection"] | undefined,
  ): string | undefined =>
    modelSelection?.provider === "pi"
      ? modelSelection.model
      : (trimToUndefined(model) ?? DEFAULT_GIT_TEXT_GENERATION_MODEL);

  const resolveAgentDir = (providerOptions: ProviderStartOptions | undefined): string | undefined =>
    providerOptions?.pi?.agentDir;

  const runPiJson = <S extends Schema.Top>({
    operation,
    cwd,
    prompt,
    outputSchemaJson,
    images = [],
    model,
    modelSelection,
    providerOptions,
  }: {
    operation: GenerationOperation;
    cwd: string;
    prompt: string;
    outputSchemaJson: S;
    images?: ReadonlyArray<ImageContent>;
    model?: string;
    modelSelection?: BranchNameGenerationInput["modelSelection"];
    providerOptions?: ProviderStartOptions;
  }): Effect.Effect<S["Type"], TextGenerationError, S["DecodingServices"]> =>
    Effect.gen(function* () {
      const instruction = [
        prompt,
        "",
        "Respond with ONLY a single JSON object matching this schema and no other text:",
        JSON.stringify(toJsonSchemaObject(outputSchemaJson)),
      ].join("\n");
      const textMaybe = yield* Effect.tryPromise({
        try: () =>
          runPiPrompt({
            cwd,
            agentDir: makeAgentDir(resolveAgentDir(providerOptions)),
            ...(resolveModelId(model, modelSelection)
              ? { modelId: resolveModelId(model, modelSelection)! }
              : {}),
            prompt: instruction,
            images,
          }),
        catch: (cause) =>
          cause instanceof TextGenerationError
            ? cause
            : new TextGenerationError({
                operation,
                detail: cause instanceof Error ? cause.message : String(cause),
                cause,
              }),
      }).pipe(Effect.timeoutOption(PI_TIMEOUT));
      const text = yield* Option.match(textMaybe, {
        onNone: () =>
          Effect.fail(
            new TextGenerationError({
              operation,
              detail: `Pi text generation timed out after ${Duration.toMillis(PI_TIMEOUT)}ms.`,
            }),
          ),
        onSome: (value) => Effect.succeed(value),
      });
      const jsonText = extractJsonObject(text);
      return yield* Schema.decodeEffect(Schema.fromJsonString(outputSchemaJson))(jsonText).pipe(
        Effect.mapError(
          (cause) =>
            new TextGenerationError({
              operation,
              detail: "Pi returned invalid structured output.",
              cause,
            }),
        ),
      );
    });

  const generateCommitMessage: TextGenerationShape["generateCommitMessage"] = (input) => {
    const wantsBranch = input.includeBranch === true;
    const { prompt, outputSchemaJson } = buildCommitMessagePrompt({
      branch: input.branch,
      stagedSummary: input.stagedSummary,
      stagedPatch: input.stagedPatch,
      includeBranch: wantsBranch,
    });

    return runPiJson({
      operation: "generateCommitMessage",
      cwd: input.cwd,
      prompt,
      outputSchemaJson,
      ...(input.model ? { model: input.model } : {}),
      ...(input.modelSelection ? { modelSelection: input.modelSelection } : {}),
      ...(input.providerOptions ? { providerOptions: input.providerOptions } : {}),
    }).pipe(
      Effect.map(
        (generated) =>
          ({
            subject: sanitizeCommitSubject(generated.subject),
            body: generated.body.trim(),
            ...("branch" in generated && typeof generated.branch === "string"
              ? { branch: sanitizeFeatureBranchName(generated.branch) }
              : {}),
          }) satisfies CommitMessageGenerationResult,
      ),
    );
  };

  const generatePrContent: TextGenerationShape["generatePrContent"] = (input) => {
    const { prompt, outputSchemaJson } = buildPrContentPrompt({
      baseBranch: input.baseBranch,
      headBranch: input.headBranch,
      commitSummary: input.commitSummary,
      diffSummary: input.diffSummary,
      diffPatch: input.diffPatch,
    });

    return runPiJson({
      operation: "generatePrContent",
      cwd: input.cwd,
      prompt,
      outputSchemaJson,
      ...(input.model ? { model: input.model } : {}),
      ...(input.modelSelection ? { modelSelection: input.modelSelection } : {}),
      ...(input.providerOptions ? { providerOptions: input.providerOptions } : {}),
    }).pipe(
      Effect.map(
        (generated) =>
          ({
            title: sanitizePrTitle(generated.title),
            body: generated.body.trim(),
          }) satisfies PrContentGenerationResult,
      ),
    );
  };

  const generateDiffSummary: TextGenerationShape["generateDiffSummary"] = (input) => {
    const { prompt, outputSchemaJson } = buildDiffSummaryPrompt({
      patch: input.patch,
    });

    return runPiJson({
      operation: "generateDiffSummary",
      cwd: input.cwd,
      prompt,
      outputSchemaJson,
      ...(input.model ? { model: input.model } : {}),
      ...(input.modelSelection ? { modelSelection: input.modelSelection } : {}),
      ...(input.providerOptions ? { providerOptions: input.providerOptions } : {}),
    }).pipe(
      Effect.map(
        (generated) =>
          ({
            summary: sanitizeDiffSummary(generated.summary),
          }) satisfies DiffSummaryGenerationResult,
      ),
    );
  };

  const generateBranchName: TextGenerationShape["generateBranchName"] = (input) => {
    return Effect.gen(function* () {
      const images = yield* buildImageContents(input.attachments);
      const { prompt, outputSchemaJson } = buildBranchNamePrompt({
        message: input.message,
        ...(input.attachments ? { attachments: input.attachments } : {}),
      });

      const generated = yield* runPiJson({
        operation: "generateBranchName",
        cwd: input.cwd,
        prompt,
        outputSchemaJson,
        images,
        ...(input.model ? { model: input.model } : {}),
        ...(input.modelSelection ? { modelSelection: input.modelSelection } : {}),
        ...(input.providerOptions ? { providerOptions: input.providerOptions } : {}),
      });

      return {
        branch: sanitizeBranchFragment(generated.branch),
      } satisfies BranchNameGenerationResult;
    });
  };

  const generateThreadTitle: TextGenerationShape["generateThreadTitle"] = (input) => {
    return Effect.gen(function* () {
      const images = yield* buildImageContents(input.attachments);
      const { prompt, outputSchemaJson } = buildThreadTitlePrompt({
        message: input.message,
        ...(input.attachments ? { attachments: input.attachments } : {}),
      });

      const generated = yield* runPiJson({
        operation: "generateThreadTitle",
        cwd: input.cwd,
        prompt,
        outputSchemaJson,
        images,
        ...(input.model ? { model: input.model } : {}),
        ...(input.modelSelection ? { modelSelection: input.modelSelection } : {}),
        ...(input.providerOptions ? { providerOptions: input.providerOptions } : {}),
      });

      return {
        title: sanitizeGeneratedThreadTitle(generated.title),
      } satisfies ThreadTitleGenerationResult;
    });
  };

  return {
    generateCommitMessage,
    generatePrContent,
    generateDiffSummary,
    generateBranchName,
    generateThreadTitle,
  } satisfies TextGenerationShape;
});

export const PiTextGenerationServiceLive = Layer.effect(PiTextGeneration, makePiTextGeneration);

export const PiTextGenerationLive = Layer.effect(TextGeneration, makePiTextGeneration);
