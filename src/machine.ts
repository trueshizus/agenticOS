import {
  Chunk,
  type Event,
  type Outcome,
  type Transition,
} from "./schemas.ts";
import type { Worker } from "./registry.ts";
import type { Ports } from "./ports.ts";
import { ingress, type IngressDecision } from "./ingress.ts";
import type { DedupStore } from "./dedup.ts";
import type { TraceSink } from "./trace-sink.ts";

/**
 * The machine is conceptually:
 *
 *     waiting --(event)--> processing --(terminal chunk)--> waiting
 *
 * It is implemented per-cycle: `runCycle` is called once per accepted event
 * and returns the Transition for that cycle. Concurrent calls run independent
 * cycles — concurrency comes from routing, not from sharing machine state.
 *
 * Invariants:
 *   - The cycle starts in `waiting` and ends in `waiting`.
 *   - Exactly one terminal chunk (`final` | `error`) is recorded per cycle.
 *     Workers yielding additional chunks after a terminal are ignored.
 *     Workers yielding NO terminal raise a synthetic `error` chunk.
 *   - The machine never throws. Anything thrown by a worker is caught and
 *     converted to an `error` chunk — throwing is a bug.
 */

export interface RunCycleArgs {
  worker: Worker;
  workerName: string;
  event: Event;
  ports: Ports;
}

export async function runCycle(args: RunCycleArgs): Promise<Transition> {
  const { worker, workerName, event, ports } = args;
  const cycleId = ports.cycleId();
  const startedAt = ports.now();

  const chunks: Chunk[] = [];
  let outcome: Outcome | null = null;

  try {
    for await (const raw of worker(event, ports)) {
      const chunk = Chunk.parse(raw);
      chunks.push(chunk);
      if (chunk.kind === "final") {
        outcome = { kind: "final", data: chunk.data };
        break;
      }
      if (chunk.kind === "error") {
        outcome = { kind: "error", message: chunk.message };
        break;
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const synthetic: Chunk = {
      kind: "error",
      seq: chunks.length,
      message: `worker threw: ${message}`,
    };
    chunks.push(synthetic);
    outcome = { kind: "error", message: synthetic.message };
  }

  if (outcome === null) {
    const synthetic: Chunk = {
      kind: "error",
      seq: chunks.length,
      message: "worker exhausted without terminal chunk",
    };
    chunks.push(synthetic);
    outcome = { kind: "error", message: synthetic.message };
  }

  const endedAt = ports.now();

  return {
    cycleId,
    event,
    fromState: "waiting",
    toState: "waiting",
    worker: workerName,
    startedAt: startedAt.toISOString(),
    endedAt: endedAt.toISOString(),
    chunks,
    outcome,
    metrics: {
      latencyMs: endedAt.getTime() - startedAt.getTime(),
      chunkCount: chunks.length,
    },
  };
}

/**
 * Build a one-shot `dispatch` function: validate + dedup + route + run + persist.
 * Returns the Transition (or `null` when ingress dropped the event — those are
 * recorded too, with a `dropped` outcome, for full causal coverage).
 */
export function buildDispatcher(args: {
  dedup: DedupStore;
  sink: TraceSink;
  ports: Ports;
}) {
  const { dedup, sink, ports } = args;

  return async function dispatch(input: unknown): Promise<Transition> {
    const decision: IngressDecision = ingress(input, dedup);

    if (decision.kind === "dispatch") {
      const transition = await runCycle({
        worker: decision.worker,
        workerName: decision.workerName,
        event: decision.event,
        ports,
      });
      await sink.write(transition);
      return transition;
    }

    // Drop path: still emit a Transition so the trace covers every input.
    const ts = ports.now().toISOString();
    const droppedEvent: Event = isEventLike(input)
      ? input
      : {
          id: `invalid-${ports.cycleId()}`,
          type: "<invalid>",
          source: "<unknown>",
          ts,
          payload: input,
        };

    const reason = describeDrop(decision);
    const transition: Transition = {
      cycleId: ports.cycleId(),
      event: droppedEvent,
      fromState: "waiting",
      toState: "waiting",
      worker: "<none>",
      startedAt: ts,
      endedAt: ts,
      chunks: [],
      outcome: { kind: "dropped", reason },
      metrics: { latencyMs: 0, chunkCount: 0 },
    };
    await sink.write(transition);
    return transition;
  };
}

function describeDrop(d: Extract<IngressDecision, { kind: "drop" }>): string {
  switch (d.reason) {
    case "invalid":
      return `invalid: ${JSON.stringify(d.detail)}`;
    case "unknown-type":
      return `unknown-type: ${d.type}`;
    case "duplicate":
      return `duplicate: ${d.id}`;
  }
}

function isEventLike(x: unknown): x is Event {
  // Best-effort: only used to surface a recognizable event in dropped traces.
  if (typeof x !== "object" || x === null) return false;
  const o = x as Record<string, unknown>;
  return (
    typeof o["id"] === "string" &&
    typeof o["type"] === "string" &&
    typeof o["source"] === "string" &&
    typeof o["ts"] === "string"
  );
}
