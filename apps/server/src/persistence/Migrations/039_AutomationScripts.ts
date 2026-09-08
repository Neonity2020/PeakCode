import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

const addColumnIfMissing = (sql: SqlClient.SqlClient, columnName: string, definition: string) =>
  Effect.gen(function* () {
    const columns = yield* sql<{ name: string }>`
      SELECT name
      FROM pragma_table_info('automations')
      WHERE name = ${columnName}
    `;
    if (columns.length > 0) {
      return;
    }
    yield* sql.unsafe(`ALTER TABLE automations ADD COLUMN ${definition}`);
  });

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* addColumnIfMissing(sql, "script_id", "script_id TEXT");
  yield* addColumnIfMissing(sql, "script_name", "script_name TEXT");
  yield* addColumnIfMissing(sql, "script_command", "script_command TEXT");
});
