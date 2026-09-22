import { AGENT_TOOLKIT_SCHEMA_STATEMENTS } from "@peakcode/agent-toolkit/store/sqlite";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

/**
 * Agent toolkit state: settings, todos, goals, artifacts, plans, permission rules.
 *
 * The toolkit reads this state synchronously from inside tool execution, so it talks to
 * SQLite through its own `node:sqlite` connection rather than through Effect SQL. To keep
 * the two definitions from drifting, this migration replays `AGENT_TOOLKIT_SCHEMA_STATEMENTS`
 * from the toolkit verbatim — that array is the single source of truth for the `agent_*`
 * tables and their indexes, and the toolkit's own standalone store installs from it too.
 *
 * Each statement is issued on its own: `node:sqlite`'s `prepare` (what this Effect SQL
 * client is built on) silently runs only the first statement of a multi-statement string.
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  for (const statement of AGENT_TOOLKIT_SCHEMA_STATEMENTS) {
    yield* sql.unsafe(statement);
  }
});
