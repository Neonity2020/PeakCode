import { DatabaseSync } from "node:sqlite";

import { describe, expect, test } from "vitest";

import { agentStore, setAgentStore } from "../store/AgentStore.ts";
import { createSqliteAgentStore, type SyncSqlHandle } from "../store/sqlite.ts";

/**
 * SQLite 后端。
 *
 * 用 `node:sqlite` 的 `DatabaseSync` 直接驱动 —— 它在 Node 与 Bun 下都在，
 * 所以这个测试本身就在验证"驱动可由宿主决定"这件事，也顺带验证两张表在
 * `IF NOT EXISTS` 迁移下的幂等性。
 */
const openStore = (): { store: ReturnType<typeof createSqliteAgentStore>; db: DatabaseSync } => {
  const db = new DatabaseSync(":memory:");

  /** `node:sqlite` 的 StatementSync 与 toolkit 的 SyncSqlHandle 形状对齐。 */
  const handle: SyncSqlHandle = {
    exec: (sql) => {
      db.exec(sql);
    },
    run: (sql, params = []) => {
      db.prepare(sql).run(...params);
    },
    all: <T>(sql: string, params: readonly (string | number | null)[] = []) =>
      db.prepare(sql).all(...params) as T[],
    get: <T>(sql: string, params: readonly (string | number | null)[] = []) =>
      db.prepare(sql).get(...params) as T | undefined,
  };

  return { store: createSqliteAgentStore(handle), db };
};

describe("createSqliteAgentStore", () => {
  test("重复打开不报错（IF NOT EXISTS 幂等）", () => {
    const { store, db } = openStore();
    expect(store.getSetting("SERVER_CTX_SIZE")).toBeUndefined();
    expect(() =>
      createSqliteAgentStore({
        exec: (sql) => db.exec(sql),
        run: (sql, params = []) => {
          db.prepare(sql).run(...params);
        },
        all: <T>(sql: string, params: readonly (string | number | null)[] = []) =>
          db.prepare(sql).all(...params) as T[],
        get: <T>(sql: string, params: readonly (string | number | null)[] = []) =>
          db.prepare(sql).get(...params) as T | undefined,
      }),
    ).not.toThrow();
  });

  test("设置项 upsert 而不是重复插入", () => {
    const { store } = openStore();
    store.setSettings({ AGENT_APPROVAL_MODE: "manual" });
    expect(store.getSetting("AGENT_APPROVAL_MODE")).toBe("manual");
    store.setSettings({ AGENT_APPROVAL_MODE: "auto" });
    expect(store.getSetting("AGENT_APPROVAL_MODE")).toBe("auto");
  });

  test("待办全量覆盖：写入两次只剩后一份，seq 按顺序", () => {
    const { store } = openStore();
    store.replaceTodos(7, [{ content: "第一条" }, { content: "第二条", status: "completed" }]);
    const first = store.listTodos(7);
    expect(first.map((row) => row.content)).toEqual(["第一条", "第二条"]);
    expect(first.map((row) => row.seq)).toEqual([0, 1]);

    store.replaceTodos(7, [{ content: "只有这条", priority: "high" }]);
    const second = store.listTodos(7);
    expect(second.map((row) => row.content)).toEqual(["只有这条"]);
    expect(second[0]?.priority).toBe("high");

    store.clearTodos(7);
    expect(store.listTodos(7)).toEqual([]);
  });

  test("会话之间互不串数据", () => {
    const { store } = openStore();
    store.replaceTodos(1, [{ content: "A" }]);
    store.replaceTodos(2, [{ content: "B" }]);
    expect(store.listTodos(1).map((row) => row.content)).toEqual(["A"]);
    expect(store.listTodos(2).map((row) => row.content)).toEqual(["B"]);
  });

  test("目标：一个会话一条，upsert 覆盖并保留统计", () => {
    const { store } = openStore();
    const base = {
      conversationId: 3,
      objective: "跑通 CI",
      acceptance: "CI 全绿",
      status: "active" as const,
      tokenBudget: 1000,
      tokensUsed: 0,
      secondsUsed: 0,
      continuations: 0,
      outcome: null,
      createdAt: 1,
      updatedAt: 1,
    };
    store.upsertGoal(base);
    store.upsertGoal({ ...base, tokensUsed: 250, continuations: 2, updatedAt: 9 });

    const goal = store.getGoal(3);
    expect(goal?.objective).toBe("跑通 CI");
    expect(goal?.tokensUsed).toBe(250);
    expect(goal?.continuations).toBe(2);
    expect(goal?.createdAt).toBe(1);

    store.clearGoal(3);
    expect(store.getGoal(3)).toBeNull();
  });

  test("产出物：按绝对路径去重查到最新一条，按时间倒序列出", () => {
    const { store } = openStore();
    store.insertArtifact({
      conversationId: 4,
      path: "a.ts",
      absPath: "/ws/a.ts",
      title: "a.ts",
      kind: "code",
      size: 10,
      tool: "write_file",
    });
    const second = store.insertArtifact({
      conversationId: 4,
      path: "a.ts",
      absPath: "/ws/a.ts",
      title: "a.ts",
      kind: "code",
      size: 20,
      tool: "edit_file",
    });

    const found = store.findArtifactByPath(4, "/ws/a.ts");
    expect(found?.id).toBe(second.id);
    expect(store.getArtifact(second.id)?.size).toBe(20);

    store.updateArtifact(second.id, { size: 33, createdAt: 123 });
    expect(store.getArtifact(second.id)?.size).toBe(33);

    // 另一个会话看不到
    expect(store.findArtifactByPath(5, "/ws/a.ts")).toBeNull();

    store.deleteArtifact(second.id);
    expect(store.getArtifact(second.id)).toBeNull();
  });

  test("方案：落盘路径与批准时间可往返", () => {
    const { store } = openStore();
    store.upsertPlan({
      conversationId: 6,
      content: "# 方案",
      messageId: 11,
      filePath: "/data/plans/6.md",
      approvedAt: null,
      createdAt: 1,
      updatedAt: 1,
    });
    store.upsertPlan({
      conversationId: 6,
      content: "# 方案（改过）",
      messageId: 12,
      filePath: "/data/plans/6.md",
      approvedAt: null,
      createdAt: 1,
      updatedAt: 2,
    });
    expect(store.getPlan(6)?.content).toBe("# 方案（改过）");

    const stored = store.getPlan(6);
    if (stored) store.upsertPlan({ ...stored, approvedAt: 99, updatedAt: 3 });
    expect(store.getPlan(6)?.approvedAt).toBe(99);

    store.clearPlan(6);
    expect(store.getPlan(6)).toBeNull();
  });

  test("权限规则：按 scope 过滤，能删单条也能清一组", () => {
    const { store } = openStore();
    const session = store.insertPermission({
      scope: "session",
      scopeRef: "42",
      permission: "bash",
      pattern: "npm test",
      action: "allow",
    });
    store.insertPermission({
      scope: "workspace",
      scopeRef: "/ws",
      permission: "edit",
      pattern: "src/*",
      action: "allow",
    });

    expect(store.listPermissions("session", "42")).toHaveLength(1);
    expect(store.listPermissions("workspace", "/ws")).toHaveLength(1);
    expect(store.listAllPermissions()).toHaveLength(2);

    store.deletePermission(session.id);
    expect(store.listPermissions("session", "42")).toEqual([]);

    store.clearPermissions("workspace", "/ws");
    expect(store.listAllPermissions()).toEqual([]);
  });

  test("接上 store 之后，工具箱模块真的读到了 SQLite 里的设置", () => {
    const { store } = openStore();
    const previous = setAgentStore(store);
    try {
      store.setSettings({ SERVER_CTX_SIZE: "32768" });
      expect(agentStore().getSetting("SERVER_CTX_SIZE")).toBe("32768");
    } finally {
      setAgentStore(previous);
    }
  });
});
