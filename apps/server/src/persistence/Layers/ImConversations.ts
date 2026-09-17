import { Effect, Layer, Schema } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";

import { ImChannelId, ImConversation } from "@peakcode/contracts";

import { toPersistenceSqlError } from "../Errors.ts";
import {
  ImConversationRepository,
  type ImConversationRepositoryShape,
  type ImConversationWrite,
} from "../Services/ImConversations.ts";

const conversationColumns = (sql: SqlClient.SqlClient) => sql`
  conversation_key AS "conversationKey",
  channel,
  peer_id AS "peerId",
  peer_label AS "peerLabel",
  thread_id AS "threadId",
  project_id AS "projectId",
  created_at AS "createdAt",
  last_message_at AS "lastMessageAt"
`;

const makeImConversationRepository = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const findByKeyOption = SqlSchema.findOneOption({
    Request: Schema.Struct({ conversationKey: Schema.String }),
    Result: ImConversation,
    execute: ({ conversationKey }) => sql`
      SELECT ${conversationColumns(sql)}
      FROM im_conversations
      WHERE conversation_key = ${conversationKey}
    `,
  });

  const listRows = SqlSchema.findAll({
    Request: Schema.Struct({}),
    Result: ImConversation,
    execute: () => sql`
      SELECT ${conversationColumns(sql)}
      FROM im_conversations
      ORDER BY last_message_at DESC, conversation_key ASC
    `,
  });

  const upsertRow = SqlSchema.void({
    Request: Schema.Struct({
      conversationKey: Schema.String,
      channel: ImChannelId,
      peerId: Schema.String,
      peerLabel: Schema.String,
      threadId: Schema.String,
      projectId: Schema.String,
      createdAt: Schema.String,
      lastMessageAt: Schema.String,
    }),
    execute: (row) => sql`
      INSERT INTO im_conversations (
        conversation_key,
        channel,
        peer_id,
        peer_label,
        thread_id,
        project_id,
        created_at,
        last_message_at
      )
      VALUES (
        ${row.conversationKey},
        ${row.channel},
        ${row.peerId},
        ${row.peerLabel},
        ${row.threadId},
        ${row.projectId},
        ${row.createdAt},
        ${row.lastMessageAt}
      )
      ON CONFLICT (conversation_key) DO UPDATE SET
        peer_label = ${row.peerLabel},
        thread_id = ${row.threadId},
        project_id = ${row.projectId},
        last_message_at = ${row.lastMessageAt}
    `,
  });

  const findByKey: ImConversationRepositoryShape["findByKey"] = (conversationKey) =>
    findByKeyOption({ conversationKey }).pipe(
      Effect.mapError(toPersistenceSqlError("ImConversationRepository.findByKey:query")),
    );

  const list: ImConversationRepositoryShape["list"] = () =>
    listRows({}).pipe(
      Effect.mapError(toPersistenceSqlError("ImConversationRepository.list:query")),
    );

  const upsert: ImConversationRepositoryShape["upsert"] = (write: ImConversationWrite) =>
    upsertRow(write).pipe(
      Effect.mapError(toPersistenceSqlError("ImConversationRepository.upsert:query")),
    );

  const touch: ImConversationRepositoryShape["touch"] = (input) =>
    sql`
      UPDATE im_conversations
      SET last_message_at = ${input.lastMessageAt}
      WHERE conversation_key = ${input.conversationKey}
    `.pipe(Effect.mapError(toPersistenceSqlError("ImConversationRepository.touch:query")));

  const deleteByKey: ImConversationRepositoryShape["deleteByKey"] = (conversationKey) =>
    sql`
      DELETE FROM im_conversations
      WHERE conversation_key = ${conversationKey}
    `.pipe(Effect.mapError(toPersistenceSqlError("ImConversationRepository.deleteByKey:query")));

  return ImConversationRepository.of({
    findByKey,
    list,
    upsert,
    touch,
    deleteByKey,
  } satisfies ImConversationRepositoryShape);
});

export const ImConversationRepositoryLive = Layer.effect(
  ImConversationRepository,
  makeImConversationRepository,
);
