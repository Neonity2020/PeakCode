import { it } from "@effect/vitest";
import { describe, expect } from "vitest";
import { Deferred, Effect } from "effect";

import { makeDrainableWorker } from "./DrainableWorker";

describe("makeDrainableWorker", () => {
  it.live("waits for work enqueued during active processing before draining", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const processed: string[] = [];
        const firstStarted = yield* Deferred.make<void>();
        const releaseFirst = yield* Deferred.make<void>();
        const secondStarted = yield* Deferred.make<void>();
        const releaseSecond = yield* Deferred.make<void>();

        const worker = yield* makeDrainableWorker((item: string) =>
          Effect.gen(function* () {
            if (item === "first") {
              yield* Deferred.succeed(firstStarted, undefined).pipe(Effect.orDie);
              yield* Deferred.await(releaseFirst);
            }

            if (item === "second") {
              yield* Deferred.succeed(secondStarted, undefined).pipe(Effect.orDie);
              yield* Deferred.await(releaseSecond);
            }

            processed.push(item);
          }),
        );

        yield* worker.enqueue("first");
        yield* Deferred.await(firstStarted);

        const drained = yield* Deferred.make<void>();
        yield* Effect.forkChild(
          worker.drain.pipe(
            Effect.tap(() => Deferred.succeed(drained, undefined).pipe(Effect.orDie)),
          ),
        );

        yield* worker.enqueue("second");
        yield* Deferred.succeed(releaseFirst, undefined);
        yield* Deferred.await(secondStarted);

        expect(yield* Deferred.isDone(drained)).toBe(false);

        yield* Deferred.succeed(releaseSecond, undefined);
        yield* Deferred.await(drained);

        expect(processed).toEqual(["first", "second"]);
      }),
    ),
  );

  it.live("keeps same-key items serial and in order while distinct keys run concurrently", () =>
    Effect.scoped(
      Effect.gen(function* () {
        let active = 0;
        let maxActive = 0;
        const order: string[] = [];

        const worker = yield* makeDrainableWorker(
          (item: { readonly key: string; readonly id: number }) =>
            Effect.gen(function* () {
              active += 1;
              maxActive = Math.max(maxActive, active);
              yield* Effect.sleep("5 millis");
              order.push(`${item.key}:${item.id}`);
              active -= 1;
            }),
          { key: (item) => item.key, concurrency: 4 },
        );

        // Same key: strictly serial and in enqueue order.
        yield* worker.enqueue({ key: "same", id: 1 });
        yield* worker.enqueue({ key: "same", id: 2 });
        yield* worker.enqueue({ key: "same", id: 3 });
        yield* worker.drain;
        expect(order).toEqual(["same:1", "same:2", "same:3"]);
        expect(maxActive).toBe(1);

        // Distinct keys land on distinct shards ("a" -> shard 0, "b" -> shard 1 for
        // concurrency 4), so their work overlaps instead of queueing behind one another.
        order.length = 0;
        maxActive = 0;
        yield* worker.enqueue({ key: "a", id: 1 });
        yield* worker.enqueue({ key: "b", id: 1 });
        yield* worker.drain;
        expect(maxActive).toBe(2);
      }),
    ),
  );
});
