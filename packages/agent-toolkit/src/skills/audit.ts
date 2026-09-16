// Skill operation audit trail (in memory, most recent 500 entries).
//
// The original wrote to a `skill_audit_log` table. The audit trail is diagnostic only
// and never read by the agent, so the port keeps it in a bounded ring buffer and lets
// the host mirror it into its own log through `setAgentLogSink`.
import { logEvent } from "../runtime/log.ts";

export interface SkillAuditEntry {
  id: number;
  action: string;
  detail: string | null;
  createdAt: number;
}

const MAX_ENTRIES = 500;

let seq = 0;
const entries: SkillAuditEntry[] = [];

export function audit(action: string, detail?: string): void {
  try {
    seq += 1;
    entries.push({ id: seq, action, detail: detail ?? null, createdAt: Date.now() });
    if (entries.length > MAX_ENTRIES) entries.splice(0, entries.length - MAX_ENTRIES);
    logEvent({ source: "skills", event: `skill.${action}`, message: detail ?? action });
  } catch {
    // Auditing must never fail the operation it is recording.
  }
}

/** Most recent entries first. */
export function listAudit(limit = 20): SkillAuditEntry[] {
  return entries.slice(-limit).reverse();
}

export function clearAudit(): void {
  entries.length = 0;
}
