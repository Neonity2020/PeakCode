/**
 * Sub-agent registry, exposed to the Settings panel.
 *
 * The registry itself lives in the agent toolkit (see
 * `@peakcode/agent-toolkit/agent-subagents`) because that is where the orchestrator and the
 * `task` tool read it from. This module is the thin server-side face: it maps the toolkit's
 * types onto the WebSocket contracts so the panel can list, add, edit, and remove workers.
 *
 * The one job worth stating: `model` is nullable end to end. `null` is not "unset yet" — it
 * is the deliberate choice to let a worker inherit the orchestrator's model, and the panel
 * renders it as 继承默认. Coercing it to a string here would turn "inherit" into "pinned to
 * whatever the default happened to be when the row was saved".
 */
import {
  deleteSubAgent as deleteSubAgentInRegistry,
  listSubAgents,
  saveSubAgent as saveSubAgentInRegistry,
} from "@peakcode/agent-toolkit/agent-subagents";
import type {
  SubAgentDefinition,
  SubAgentsDeleteInput,
  SubAgentsSaveInput,
  SubAgentsSavedInput,
} from "@peakcode/contracts";

function toContract(agent: {
  id: string;
  name: string;
  description: string;
  systemPrompt: string;
  tools: readonly string[];
  model: string | null;
  enabled: boolean;
}): SubAgentDefinition {
  return {
    id: agent.id,
    name: agent.name,
    description: agent.description,
    systemPrompt: agent.systemPrompt,
    tools: [...agent.tools],
    model: agent.model,
    enabled: agent.enabled,
  };
}

function snapshot(): SubAgentsSavedInput {
  return { subAgents: listSubAgents().map(toContract) };
}

export function listSubAgentsSnapshot(): SubAgentsSavedInput {
  return snapshot();
}

export function saveSubAgentSnapshot(input: SubAgentsSaveInput): SubAgentsSavedInput {
  saveSubAgentInRegistry({
    id: input.subAgent.id,
    name: input.subAgent.name,
    description: input.subAgent.description,
    systemPrompt: input.subAgent.systemPrompt,
    tools: input.subAgent.tools,
    model: input.subAgent.model,
    enabled: input.subAgent.enabled,
  });
  return snapshot();
}

export function deleteSubAgentSnapshot(input: SubAgentsDeleteInput): SubAgentsSavedInput {
  deleteSubAgentInRegistry(input.id);
  return snapshot();
}
