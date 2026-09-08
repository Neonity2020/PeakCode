import { MessageId, type ThreadHandoffImportedMessage, type ThreadId } from "@peakcode/contracts";

function readTranscriptTextParts(value: unknown): ReadonlyArray<string> {
  if (!Array.isArray(value)) return [];

  return value.flatMap((part) => {
    if (!part || typeof part !== "object") return [];
    const candidate = part as {
      readonly type?: unknown;
      readonly text?: unknown;
    };
    return candidate.type === "text" && typeof candidate.text === "string" ? [candidate.text] : [];
  });
}

function readSnapshotMessageText(value: unknown): string {
  if (!value || typeof value !== "object") return "";

  const candidate = value as {
    readonly text?: unknown;
    readonly content?: unknown;
  };
  if (typeof candidate.text === "string") return candidate.text;

  return readTranscriptTextParts(candidate.content).join("");
}

/**
 * Maps provider snapshot turns (the `ProviderThreadSnapshot.turns` shape
 * returned by an adapter's `readThread`) into orchestration import messages.
 * Works for the Pi provider, whose JSONL snapshot uses the same turn/item
 * structure.
 */
export function mapSnapshotMessages(input: {
  readonly importedAt: string;
  readonly threadId: ThreadId;
  readonly turns: ReadonlyArray<{
    readonly items: ReadonlyArray<unknown>;
  }>;
}): ReadonlyArray<ThreadHandoffImportedMessage> {
  return input.turns.flatMap((turn, turnIndex) =>
    turn.items.flatMap((item, itemIndex) => {
      if (!item || typeof item !== "object") return [];

      const candidate = item as {
        readonly type?: unknown;
        readonly content?: unknown;
      };
      const role =
        candidate.type === "userMessage"
          ? "user"
          : candidate.type === "agentMessage"
            ? "assistant"
            : null;
      if (role === null) return [];

      const text = readSnapshotMessageText(candidate);
      if (text.length === 0) return [];

      return [
        {
          messageId: MessageId.makeUnsafe(
            `import:${String(input.threadId)}:${turnIndex}:${itemIndex}`,
          ),
          role,
          text,
          createdAt: input.importedAt,
          updatedAt: input.importedAt,
        },
      ];
    }),
  );
}
