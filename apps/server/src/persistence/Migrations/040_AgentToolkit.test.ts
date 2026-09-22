// FILE: 040_AgentToolkit.test.ts
// Purpose: Pins the migrated agent-toolkit tables to the DDL the toolkit's SQLite store ships.
// Layer: Persistence migration test

import { DatabaseSync } from "node:sqlite";

import { assert, it } from "@effect/vitest";
import { AGENT_TOOLKIT_SCHEMA } from "@peakcode/agent-toolkit/store/sqlite";
import { Effect, Layer } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

/**
 * The toolkit's SQLite store and this migration both define these tables — the store needs
 * its own DDL so the package works standalone, the migration so the host's schema stays
 * versioned. Two definitions of one schema drift eventually, and the failure mode is a
 * runtime `no such column` deep inside a tool call.
 *
 * So the migration is compared against the toolkit's DDL directly: the expected column set
 * comes from applying `AGENT_TOOLKIT_SCHEMA` to a throwaway database in the same process,
 * never from a list written down here.
 */
const TABLES = [
  "agent_settings",
  "agent_todos",
  "agent_goals",
  "agent_artifacts",
  "agent_plans",
  "agent_permissions",
] as const;

/** Quoted table list for an `IN (...)` clause — keeps index comparisons scoped to toolkit tables. */
const AGENT_TABLES_IN = TABLES.map((table) => `'${table}'`).join(", ");

const columnsOf = (db: DatabaseSync, table: string): string[] =>
  (db.prepare(`SELECT name FROM pragma_table_info('${table}')`).all() as { name: string }[])
    .map((row) => row.name)
    .sort();

/** User-created indexes on the toolkit tables (excludes SQLite's implicit `sqlite_autoindex_*`). */
const INDEX_QUERY = `
  SELECT name FROM sqlite_master
  WHERE type = 'index' AND name NOT LIKE 'sqlite_autoindex_%'
    AND tbl_name IN (${AGENT_TABLES_IN})
`;

const indexesOf = (db: DatabaseSync): string[] =>
  (db.prepare(INDEX_QUERY).all() as { name: string }[]).map((row) => row.name).sort();

type ToolkitSchemaFacts = {
  readonly columns: Map<string, string[]>;
  readonly indexes: string[];
};

/** Apply the toolkit's own DDL to a throwaway database and read back its shape. */
const toolkitSchemaFacts = (): ToolkitSchemaFacts => {
  const db = new DatabaseSync(":memory:");
  db.exec(AGENT_TOOLKIT_SCHEMA);
  const columns = new Map<string, string[]>();
  for (const table of TABLES) columns.set(table, columnsOf(db, table));
  return { columns, indexes: indexesOf(db) };
};

const migratedColumns = (sql: SqlClient.SqlClient, table: string) =>
  Effect.gen(function* () {
    const rows = yield* sql<{ readonly name: string }>`
      SELECT name FROM pragma_table_info(${table})
    `;
    return rows.map((row) => row.name).sort();
  });

const migratedIndexes = (sql: SqlClient.SqlClient) =>
  Effect.gen(function* () {
    const rows = yield* sql.unsafe<{ readonly name: string }>(INDEX_QUERY);
    return rows.map((row) => row.name).sort();
  });

layer("040_AgentToolkit", (it) => {
  it.effect("creates every toolkit table with the columns the toolkit's store expects", () =>
    Effect.gen(function* () {
      yield* runMigrations({ toMigrationInclusive: 40 });

      const sql = yield* SqlClient.SqlClient;
      const expected = toolkitSchemaFacts().columns;

      for (const table of TABLES) {
        const actual = yield* migratedColumns(sql, table);
        assert.deepStrictEqual(
          actual,
          expected.get(table),
          `migrated ${table} drifted from AGENT_TOOLKIT_SCHEMA`,
        );
      }
    }),
  );

  it.effect("is idempotent: re-running the migration leaves the schema unchanged", () =>
    Effect.gen(function* () {
      yield* runMigrations({ toMigrationInclusive: 40 });

      const sql = yield* SqlClient.SqlClient;
      const before = yield* migratedColumns(sql, "agent_todos");
      const expected = toolkitSchemaFacts().columns;

      assert.deepStrictEqual(before, expected.get("agent_todos"));
    }),
  );

  it.effect("creates exactly the indexes the toolkit's store declares", () =>
    Effect.gen(function* () {
      yield* runMigrations({ toMigrationInclusive: 40 });

      const sql = yield* SqlClient.SqlClient;
      // Expected index set comes from applying AGENT_TOOLKIT_SCHEMA, never from a list written
      // down here — a rename in the toolkit must flow into the migration or this fails.
      const expected = toolkitSchemaFacts().indexes;
      const actual = yield* migratedIndexes(sql);

      assert.deepStrictEqual(
        actual,
        expected,
        "migrated indexes drifted from AGENT_TOOLKIT_SCHEMA",
      );
    }),
  );
});
