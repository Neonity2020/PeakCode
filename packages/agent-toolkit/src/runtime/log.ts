export type AgentLogLevel = "debug" | "info" | "warn" | "error";

export interface AgentLogInput {
  level?: AgentLogLevel;
  source: string;
  event: string;
  message: string;
  detail?: unknown;
}

export type AgentLogSink = (input: AgentLogInput) => void;

const defaultSink: AgentLogSink = (input) => {
  const line = `[agent-toolkit] ${input.event}: ${input.message}`;
  switch (input.level ?? "info") {
    case "error":
      console.error(line, input.detail ?? "");
      break;
    case "warn":
      console.warn(line, input.detail ?? "");
      break;
    default:
      console.log(line, input.detail ?? "");
  }
};

let sink: AgentLogSink = defaultSink;

/**
 * Route toolkit diagnostics into the host's logger. The ported modules log through
 * `logEvent` at exactly the same call sites as the original; only the sink differs.
 */
export function setAgentLogSink(next: AgentLogSink | null): void {
  sink = next ?? defaultSink;
}

export function logEvent(input: AgentLogInput): void {
  try {
    sink(input);
  } catch {
    // Logging must never take the agent down.
  }
}
