import { assert, it } from "@effect/vitest";
import { Effect, Schema } from "effect";

import { ORCHESTRATION_WS_CHANNELS } from "./orchestration";
import { WsPush, WsWelcomePayload, WS_CHANNELS } from "./ws";

const decode = <S extends Schema.Top>(
  schema: S,
  input: unknown,
): Effect.Effect<Schema.Schema.Type<S>, Schema.SchemaError, never> =>
  Schema.decodeUnknownEffect(schema as never)(input) as Effect.Effect<
    Schema.Schema.Type<S>,
    Schema.SchemaError,
    never
  >;

it.effect("accepts typed websocket push envelopes with sequence", () =>
  Effect.gen(function* () {
    const parsed = yield* decode(WsPush, {
      type: "push",
      sequence: 1,
      channel: WS_CHANNELS.serverWelcome,
      data: {
        cwd: "/tmp/workspace",
        projectName: "workspace",
      },
    });

    assert.strictEqual(parsed.type, "push");
    assert.strictEqual(parsed.sequence, 1);
    assert.strictEqual(parsed.channel, WS_CHANNELS.serverWelcome);
  }),
);

it.effect("accepts git.actionProgress push envelopes", () =>
  Effect.gen(function* () {
    const parsed = yield* decode(WsPush, {
      type: "push",
      sequence: 3,
      channel: WS_CHANNELS.gitActionProgress,
      data: {
        actionId: "action-1",
        cwd: "/repo",
        action: "commit",
        kind: "phase_started",
        phase: "commit",
        label: "Committing...",
      },
    });

    assert.strictEqual(parsed.channel, WS_CHANNELS.gitActionProgress);
  }),
);

it.effect("rejects push envelopes when channel payload does not match the channel schema", () =>
  Effect.gen(function* () {
    const result = yield* Effect.exit(
      decode(WsPush, {
        type: "push",
        sequence: 2,
        channel: ORCHESTRATION_WS_CHANNELS.domainEvent,
        data: {
          cwd: "/tmp/workspace",
          projectName: "workspace",
        },
      }),
    );

    assert.strictEqual(result._tag, "Failure");
  }),
);

it.effect("trims server welcome payload fields", () =>
  Effect.gen(function* () {
    const parsed = yield* decode(WsWelcomePayload, {
      cwd: " /tmp/workspace ",
      projectName: " workspace ",
    });

    assert.strictEqual(parsed.cwd, "/tmp/workspace");
    assert.strictEqual(parsed.projectName, "workspace");
  }),
);
