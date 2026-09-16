# Runtime modes

Peak Code has a global runtime mode switch in the chat toolbar:

- **Full access** (default): starts sessions with `approvalPolicy: never` and `sandboxMode: danger-full-access`.
- **Supervised**: starts sessions with `approvalPolicy: on-request` and `sandboxMode: workspace-write`, then prompts in-app for command/file approvals.

## Interaction modes

Independently of the runtime mode, the composer carries an interaction mode (`ProviderInteractionMode` in `packages/contracts/src/orchestration.ts`) that travels with the turn and is kept in thread state:

- **Agent** (`default`): the full tool set; the agent works directly on the workspace.
- **Plan** (`plan`): read-only exploration plus `write_plan`. The workspace stays untouched and the result comes back as a proposed plan for the user to accept.
- **Goal** (`goal`): the full tool set plus the `goal` tool. The objective and acceptance criteria live in the agent toolkit store (`agent_goals`, one row per thread) and the goal continuation reactor keeps adding turns — bounded by the goal's token budget and `AGENT_GOAL_MAX_CONTINUATIONS` — until the goal is completed, dropped, or out of budget (`budget-limited`).

The composer's goal panel reads that state and offers the one write it allows: pause, resume, complete or drop the goal.
