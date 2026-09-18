import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createInMemoryAgentStore, setAgentStore } from "@peakcode/agent-toolkit/store/AgentStore";
import { beforeEach, describe, expect, test } from "vitest";

import {
  canonicalRequestTypeFor,
  decideToolCall,
  isApproved,
  makeToolkitApprovalExtension,
  type ApprovalPrompt,
} from "./agentToolkitApprovals";

/**
 * 审批闸门。
 *
 * 三件事必须被钉住：
 * 1. **哪些工具根本不弹窗** —— 名单写错的后果是"每次调用都弹"，而不是报错；
 * 2. **pi 的内置工具名与工具箱工具名走同一套规则** —— 否则会话可以换一套工具绕开闸门；
 * 3. **弹窗回答的四种落点** —— 本次放行 / 本会话记住 / 拒绝 / 超时，任何一种都不能变成静默放行。
 */
const CWD = "/tmp/peakcode-approvals-ws";

const call = (toolName: string, args: Record<string, unknown>, conversationId = 42) =>
  decideToolCall({ toolName, args, cwd: CWD, conversationId });

beforeEach(() => {
  setAgentStore(createInMemoryAgentStore());
});

describe("decideToolCall：不需要授权的调用", () => {
  test("只读且无副作用的工具直接放行（不打扰用户）", () => {
    for (const tool of [
      "todo_write",
      "read_skill",
      "think",
      "get_context_remaining",
      "web_search",
      "knowledge_search",
      // Writes only the card the thread was dispatched from, and the model cannot point it
      // anywhere else — gating each progress line would defeat per-step board comments.
      "kanban_comment",
      // Reading that card back is the same argument with nothing to undo: the point is to
      // consult it before starting, so it must not cost an approval prompt each time.
      "kanban_task",
    ]) {
      expect(call(tool, {})).toBeNull();
    }
  });

  test("工作区内的读取放行，工作区外的读取要问", () => {
    expect(call("read_file", { path: "src/a.ts" })).toBeNull();
    expect(call("read", { path: "src/a.ts" })).toBeNull();

    const outside = call("read_file", { path: "/etc/hosts" });
    expect(outside?.action).toBe("ask");
    expect(outside?.permission).toBe("external_directory");
    expect(outside?.requestType).toBe("file_read_approval");
  });
});

describe("decideToolCall：默认（smart）策略", () => {
  test("普通命令与工作区内写文件放行", () => {
    const command = call("bash", { command: "npm test" });
    expect(command?.action).toBe("allow");
    expect(command?.requestType).toBe("command_execution_approval");

    const write = call("write_file", { path: "src/a.ts", content: "x" });
    expect(write?.action).toBe("allow");
    expect(write?.requestType).toBe("file_change_approval");
  });

  test("破坏性命令升级成询问，并带上人能看懂的命令原文", () => {
    const dangerous = call("bash", { command: "rm -rf /tmp/whatever" });
    expect(dangerous?.action).toBe("ask");
    expect(dangerous?.requestType).toBe("command_execution_approval");
    expect(dangerous?.detailText).toContain("rm -rf");
  });

  test("工作区外的写入要问，且是「修改」而不是「读取」", () => {
    const outside = call("write_file", { path: "/tmp/elsewhere/a.ts", content: "x" });
    expect(outside?.action).toBe("ask");
    expect(outside?.permission).toBe("external_directory");
    expect(outside?.requestType).toBe("file_change_approval");
  });

  test("strict 模式下 bash 直接拒绝（不弹窗，模型自己换做法）", () => {
    setAgentStore(createInMemoryAgentStore());
    const store = createInMemoryAgentStore();
    store.setSettings({ AGENT_APPROVAL_MODE: "strict" });
    setAgentStore(store);

    expect(call("bash", { command: "npm test" })?.action).toBe("deny");
  });

  test("auto 模式下连工作区外访问都放行", () => {
    const store = createInMemoryAgentStore();
    store.setSettings({ AGENT_APPROVAL_MODE: "auto" });
    setAgentStore(store);

    expect(call("read_file", { path: "/etc/hosts" })?.action).toBe("allow");
    expect(call("bash", { command: "rm -rf /" })?.action).toBe("allow");
  });
});

describe("pi 内置工具名与工具箱工具名同规则", () => {
  test("write / edit 走「修改文件」，不会被当成外部工具", () => {
    const write = call("write", { path: "src/a.ts", content: "x" });
    expect(write?.permission).toBe("edit");
    expect(write?.requestType).toBe("file_change_approval");

    const edit = call("edit", { path: "src/a.ts" });
    expect(edit?.permission).toBe("edit");
  });

  test("ls / find / grep 走「读取文件」的外部路径判定", () => {
    const ls = call("ls", { path: "/etc" });
    expect(ls?.permission).toBe("external_directory");
    expect(ls?.requestType).toBe("file_read_approval");

    // 工作区内的 find 不弹窗
    expect(call("find", { pattern: "*.ts", path: "src" })).toBeNull();
  });

  test("未映射的工具名归到 mcp 权限，沿用 mcp 的默认策略（smart 下放行）", () => {
    const unknown = call("some_mcp_tool", { arg: 1 });
    expect(unknown?.permission).toBe("mcp");
    // smart 默认放行 mcp：MCP 服务器动辄几十个工具，每个都弹窗会把审批变成噪声。
    // 想收紧就在设置里写 `mcp * → ask`，或整体切到 manual。
    expect(unknown?.action).toBe("allow");
  });

  test("manual 模式下未映射的工具也要问", () => {
    const store = createInMemoryAgentStore();
    store.setSettings({ AGENT_APPROVAL_MODE: "manual" });
    setAgentStore(store);

    const unknown = call("some_mcp_tool", { arg: 1 });
    expect(unknown?.action).toBe("ask");
  });
});

describe("canonicalRequestTypeFor", () => {
  test("权限名 → 面板认识的请求类型", () => {
    expect(canonicalRequestTypeFor("bash", "bash")).toBe("command_execution_approval");
    expect(canonicalRequestTypeFor("edit", "write_file")).toBe("file_change_approval");
    expect(canonicalRequestTypeFor("edit", "apply_patch")).toBe("apply_patch_approval");
    expect(canonicalRequestTypeFor("read", "read_file")).toBe("file_read_approval");
    expect(canonicalRequestTypeFor("mcp", "some_tool")).toBe("dynamic_tool_call");
  });

  test("isApproved 只认 accept / acceptForSession", () => {
    expect(isApproved("accept")).toBe(true);
    expect(isApproved("acceptForSession")).toBe(true);
    expect(isApproved("decline")).toBe(false);
    expect(isApproved("cancel")).toBe(false);
  });
});

/** 把扩展注册到假的 pi 上，取回它的 tool_call 处理器。 */
const handlerFor = async (prompt: ApprovalPrompt) => {
  let handler: ((event: unknown) => unknown) | undefined;
  const fakePi = {
    on: (event: string, h: (e: unknown) => unknown) => {
      if (event === "tool_call") handler = h;
    },
  } as unknown as ExtensionAPI;

  await makeToolkitApprovalExtension({ cwd: CWD, conversationId: 42, prompt })(fakePi);
  if (!handler) throw new Error("extension did not register a tool_call handler");
  return handler as (event: {
    type: "tool_call";
    toolCallId: string;
    toolName: string;
    input: Record<string, unknown>;
  }) => Promise<{ block?: boolean; reason?: string } | undefined>;
};

describe("扩展处理器", () => {
  const promptReturning = (reply: string): { prompt: ApprovalPrompt; calls: () => number } => {
    let calls = 0;
    return {
      prompt: async () => {
        calls += 1;
        return reply as never;
      },
      calls: () => calls,
    };
  };

  test("放行的调用不返回任何东西（工具照常执行）", async () => {
    const handler = await handlerFor(promptReturning("deny").prompt);
    const result = await handler({
      type: "tool_call",
      toolCallId: "c1",
      toolName: "bash",
      input: { command: "npm test" },
    });
    expect(result).toBeUndefined();
  });

  test("需要询问时把问题交给面板，回答 deny 就拦下并给出原因", async () => {
    const { prompt, calls } = promptReturning("deny");
    const handler = await handlerFor(prompt);
    const result = await handler({
      type: "tool_call",
      toolCallId: "c2",
      toolName: "bash",
      input: { command: "rm -rf /tmp/x" },
    });
    expect(result?.block).toBe(true);
    expect(result?.reason).toContain("拒绝");
    expect(calls()).toBe(1);
  });

  test("回答 once 就放行这一次，且不写规则", async () => {
    const { prompt, calls } = promptReturning("once");
    const handler = await handlerFor(prompt);
    const event = {
      type: "tool_call" as const,
      toolCallId: "c3",
      toolName: "bash",
      input: { command: "rm -rf /tmp/y" },
    };

    expect(await handler(event)).toBeUndefined();
    expect(calls()).toBe(1);
    // 没写规则：下一次同样形状的命令还得再问一遍。
    const again = await handler({ ...event, toolCallId: "c4" });
    expect(again).toBeUndefined();
    expect(calls()).toBe(2);
  });

  test("回答 session 就记住规则，下一次不再弹窗", async () => {
    const { prompt, calls } = promptReturning("session");
    const handler = await handlerFor(prompt);
    const event = {
      type: "tool_call" as const,
      toolCallId: "c5",
      toolName: "bash",
      input: { command: "rm -rf /tmp/z" },
    };

    expect(await handler(event)).toBeUndefined();
    expect(calls()).toBe(1);

    // 会话规则生效：同样形状的调用第二次直接放行，不再打扰用户。
    expect(await handler({ ...event, toolCallId: "c6" })).toBeUndefined();
    expect(calls()).toBe(1);
  });

  test("规则拒绝（deny）时不弹窗，直接把模型挡回去", async () => {
    const store = createInMemoryAgentStore();
    store.setSettings({ AGENT_APPROVAL_MODE: "strict" });
    setAgentStore(store);

    const { prompt, calls } = promptReturning("once");
    const handler = await handlerFor(prompt);
    const result = await handler({
      type: "tool_call",
      toolCallId: "c7",
      toolName: "bash",
      input: { command: "npm test" },
    });

    expect(result?.block).toBe(true);
    expect(calls()).toBe(0);
  });
});
