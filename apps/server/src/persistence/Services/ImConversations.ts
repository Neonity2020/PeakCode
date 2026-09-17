import type { Effect, Option } from "effect";
import { ServiceMap } from "effect";

import type { ImChannelId, ImConversation, ProjectId, ThreadId } from "@peakcode/contracts";

import type { ProjectionRepositoryError } from "../Errors.ts";

/** A row to write: the conversation's identity plus the thread it continues in. */
export interface ImConversationWrite {
  readonly conversationKey: string;
  readonly channel: ImChannelId;
  readonly peerId: string;
  readonly peerLabel: string;
  readonly threadId: ThreadId;
  readonly projectId: ProjectId;
  readonly createdAt: string;
  readonly lastMessageAt: string;
}

/**
 * ImConversationRepositoryShape - the chat → thread index the IM bridge keeps.
 *
 * Lookups are by `conversationKey` (channel plus peer) because that is what an inbound
 * message carries; the thread is what the bridge needs in order to continue the same
 * conversation, so a restart does not make the agent forget who it was talking to.
 */
export interface ImConversationRepositoryShape {
  readonly findByKey: (
    conversationKey: string,
  ) => Effect.Effect<Option.Option<ImConversation>, ProjectionRepositoryError>;

  /** Every wired chat, newest activity first — the bot-management list. */
  readonly list: () => Effect.Effect<ReadonlyArray<ImConversation>, ProjectionRepositoryError>;

  readonly upsert: (write: ImConversationWrite) => Effect.Effect<void, ProjectionRepositoryError>;

  /** Record activity without touching the thread the chat is bound to. */
  readonly touch: (input: {
    readonly conversationKey: string;
    readonly lastMessageAt: string;
  }) => Effect.Effect<void, ProjectionRepositoryError>;

  /** Forget a chat; the next message from it opens a fresh thread. */
  readonly deleteByKey: (conversationKey: string) => Effect.Effect<void, ProjectionRepositoryError>;
}

/**
 * ImConversationRepository - Service tag for IM conversation persistence.
 */
export class ImConversationRepository extends ServiceMap.Service<
  ImConversationRepository,
  ImConversationRepositoryShape
>()("t3/persistence/Services/ImConversations/ImConversationRepository") {}
