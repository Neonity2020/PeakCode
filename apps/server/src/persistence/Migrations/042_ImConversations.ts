import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

/**
 * The IM bridge's conversation index: one row per chat that has ever talked to the
 * agent, pointing at the thread the conversation continues in.
 *
 * `thread_id` deliberately has no foreign key to `projection_threads`: the mapping is
 * written the moment a turn is dispatched, while the thread row only appears once the
 * projection pipeline has processed that command. A cascade here would reject the
 * insert instead of letting the bridge keep its context.
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE IF NOT EXISTS im_conversations (
      conversation_key TEXT PRIMARY KEY,
      channel TEXT NOT NULL,
      peer_id TEXT NOT NULL,
      peer_label TEXT NOT NULL DEFAULT '',
      thread_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      last_message_at TEXT NOT NULL
    )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_im_conversations_thread_id
    ON im_conversations(thread_id)
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_im_conversations_last_message_at
    ON im_conversations(last_message_at DESC)
  `;
});
