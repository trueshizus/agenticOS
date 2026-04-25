import { z } from "zod";

/**
 * Event: a validated message arriving from a Source.
 * `id` is the idempotency key — two events with the same id collapse to one cycle.
 * `type` is the routing key — it must match a key in the Registry.
 */
export const Event = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  source: z.string().min(1),
  ts: z.string().datetime(),
  payload: z.unknown(),
});
export type Event = z.infer<typeof Event>;

/**
 * Chunk: a single piece of a streaming response.
 * A worker yields zero-or-more `partial` chunks then exactly one terminal
 * chunk (`final` or `error`). The machine treats the first terminal chunk
 * as the cycle's outcome and ignores anything after it.
 */
export const PartialChunk = z.object({
  kind: z.literal("partial"),
  seq: z.number().int().nonnegative(),
  data: z.unknown(),
});

export const FinalChunk = z.object({
  kind: z.literal("final"),
  seq: z.number().int().nonnegative(),
  data: z.unknown(),
});

export const ErrorChunk = z.object({
  kind: z.literal("error"),
  seq: z.number().int().nonnegative(),
  message: z.string().min(1),
  cause: z.unknown().optional(),
});

export const Chunk = z.discriminatedUnion("kind", [
  PartialChunk,
  FinalChunk,
  ErrorChunk,
]);
export type Chunk = z.infer<typeof Chunk>;
export type PartialChunk = z.infer<typeof PartialChunk>;
export type FinalChunk = z.infer<typeof FinalChunk>;
export type ErrorChunk = z.infer<typeof ErrorChunk>;

/**
 * Metrics: mechanical observations recorded by the machine, not the worker.
 * Token / cost fields are optional — present only when a worker reports them.
 */
export const Metrics = z.object({
  latencyMs: z.number().nonnegative(),
  chunkCount: z.number().int().nonnegative(),
  tokens: z
    .object({
      in: z.number().int().nonnegative(),
      out: z.number().int().nonnegative(),
    })
    .optional(),
  costUsd: z.number().nonnegative().optional(),
});
export type Metrics = z.infer<typeof Metrics>;

/**
 * Outcome: the cycle's terminal classification, lifted from the terminal chunk
 * (or set to `dropped` when ingress refused to dispatch).
 */
export const Outcome = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("final"), data: z.unknown() }),
  z.object({ kind: z.literal("error"), message: z.string() }),
  z.object({ kind: z.literal("dropped"), reason: z.string() }),
]);
export type Outcome = z.infer<typeof Outcome>;

/**
 * AgentRef: minimal identity stamp for provenance.
 * `sha256` is the hash of the agent.md file that was loaded at boot —
 * two transitions with different shas were produced by different agents,
 * even if names match.
 */
export const AgentRef = z.object({
  name: z.string().min(1),
  version: z.string().min(1),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
});
export type AgentRef = z.infer<typeof AgentRef>;

/**
 * Transition: one full waiting → processing → waiting cycle.
 * This is the only durable artifact. If something happened that isn't here,
 * it's a defect.
 */
export const Transition = z.object({
  cycleId: z.string().min(1),
  agent: AgentRef,
  event: Event,
  fromState: z.literal("waiting"),
  toState: z.literal("waiting"),
  worker: z.string().min(1),
  startedAt: z.string().datetime(),
  endedAt: z.string().datetime(),
  chunks: z.array(Chunk),
  outcome: Outcome,
  metrics: Metrics,
});
export type Transition = z.infer<typeof Transition>;
