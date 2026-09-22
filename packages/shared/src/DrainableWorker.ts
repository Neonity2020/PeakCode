/**
 * DrainableWorker - A queue-based worker that exposes a `drain()` effect.
 *
 * Wraps the common `Queue.unbounded` + `Effect.forever` pattern and adds
 * a signal that resolves when the queue is empty **and** the current item
 * has finished processing. This lets tests replace timing-sensitive
 * `Effect.sleep` calls with deterministic `drain()`.
 *
 * @module DrainableWorker
 */
import { Deferred, Effect, Queue, Ref } from "effect";
import type { Scope } from "effect";

export interface DrainableWorker<A> {
  /**
   * Enqueue a work item and track it for `drain()`.
   *
   * This wraps `Queue.offer` so drain state is updated atomically with the
   * enqueue path instead of inferring it from queue internals.
   */
  readonly enqueue: (item: A) => Effect.Effect<void>;

  /**
   * Resolves when the queue is empty and the worker is idle (not processing).
   */
  readonly drain: Effect.Effect<void>;
}

export interface DrainableWorkerOptions<A> {
  /**
   * Optional partition key.
   *
   * When provided, items sharing a key are processed strictly in enqueue order,
   * while items with different keys may be processed concurrently (bounded by
   * `concurrency`). Without a key the worker keeps its original single-fiber,
   * fully serial behavior.
   */
  readonly key?: (item: A) => string;

  /**
   * Number of worker fibers distinct keys are spread across. Ignored when `key`
   * is absent. Defaults to 1.
   */
  readonly concurrency?: number;

  /**
   * Maximum queue depth per worker before `enqueue` applies backpressure.
   * Defaults to unbounded.
   */
  readonly capacity?: number;
}

/**
 * FNV-1a hash used to map a partition key to a worker shard deterministically.
 */
const stableHash = (value: string): number => {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
};

/**
 * Create a drainable worker that processes items from one or more queues.
 *
 * The worker(s) are forked into the current scope and will be interrupted when
 * the scope closes. A finalizer shuts down the queues.
 *
 * With no `key`, a single queue and fiber preserve the original fully serial
 * semantics. With a `key`, items are sharded by key across `concurrency`
 * queues, so a slow item only blocks other items in the same shard while every
 * shard still processes its keys in order.
 *
 * @param process - The effect to run for each queued item.
 * @param options - Optional keying/concurrency/backpressure configuration.
 * @returns A `DrainableWorker` with `enqueue` and `drain`.
 */
export const makeDrainableWorker = <A, E, R>(
  process: (item: A) => Effect.Effect<void, E, R>,
  options?: DrainableWorkerOptions<A>,
): Effect.Effect<DrainableWorker<A>, never, Scope.Scope | R> =>
  Effect.gen(function* () {
    const keyOf = options?.key;
    const shardCount = keyOf ? Math.max(1, options?.concurrency ?? 1) : 1;
    const capacity = options?.capacity;

    const queues = yield* Effect.forEach(
      Array.from({ length: shardCount }),
      () => (capacity !== undefined ? Queue.bounded<A>(capacity) : Queue.unbounded<A>()),
      { concurrency: 1 },
    );
    const initialIdle = yield* Deferred.make<void>();
    yield* Deferred.succeed(initialIdle, undefined).pipe(Effect.orDie);
    const state = yield* Ref.make({
      outstanding: 0,
      idle: initialIdle,
    });

    yield* Effect.addFinalizer(() =>
      Effect.forEach(queues, (queue) => Queue.shutdown(queue), { concurrency: 1 }).pipe(
        Effect.asVoid,
      ),
    );

    const finishOne = Ref.modify(state, (current) => {
      const remaining = Math.max(0, current.outstanding - 1);
      return [
        remaining === 0 ? current.idle : null,
        {
          outstanding: remaining,
          idle: current.idle,
        },
      ] as const;
    }).pipe(
      Effect.flatMap((idle) =>
        idle === null ? Effect.void : Deferred.succeed(idle, undefined).pipe(Effect.orDie),
      ),
    );

    yield* Effect.forEach(
      queues,
      (queue) =>
        Effect.forkScoped(
          Effect.forever(
            Queue.take(queue).pipe(
              Effect.flatMap((item) => process(item).pipe(Effect.ensuring(finishOne))),
            ),
          ),
        ),
      { concurrency: 1 },
    );

    const shardFor = (item: A): number => {
      if (!keyOf || shardCount === 1) {
        return 0;
      }
      return stableHash(keyOf(item)) % shardCount;
    };

    const enqueue: DrainableWorker<A>["enqueue"] = (item) =>
      Effect.gen(function* () {
        const nextIdle = yield* Deferred.make<void>();
        yield* Ref.update(state, (current) =>
          current.outstanding === 0
            ? {
                outstanding: 1,
                idle: nextIdle,
              }
            : {
                outstanding: current.outstanding + 1,
                idle: current.idle,
              },
        );

        const accepted = yield* Queue.offer(queues[shardFor(item)]!, item);
        if (!accepted) {
          yield* finishOne;
        }
      });

    const drain: DrainableWorker<A>["drain"] = Ref.get(state).pipe(
      Effect.flatMap(({ idle }) => Deferred.await(idle)),
    );

    return { enqueue, drain } satisfies DrainableWorker<A>;
  });
