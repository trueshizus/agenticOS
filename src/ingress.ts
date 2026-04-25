import { Event } from "./schemas.ts";
import { registry, type Worker } from "./registry.ts";
import type { DedupStore } from "./dedup.ts";

/**
 * IngressDecision: the result of validating + deduplicating + routing one
 * incoming event. Every branch is enumerated so a reader can predict which
 * decision the machine will make from the event alone.
 */
export type IngressDecision =
  | { kind: "dispatch"; event: Event; worker: Worker; workerName: string }
  | { kind: "drop"; reason: "invalid"; detail: unknown }
  | { kind: "drop"; reason: "unknown-type"; type: string }
  | { kind: "drop"; reason: "duplicate"; id: string };

export function ingress(input: unknown, dedup: DedupStore): IngressDecision {
  const parsed = Event.safeParse(input);
  if (!parsed.success) {
    return { kind: "drop", reason: "invalid", detail: parsed.error.flatten() };
  }
  const event = parsed.data;

  const worker = (registry as Record<string, Worker | undefined>)[event.type];
  if (!worker) {
    return { kind: "drop", reason: "unknown-type", type: event.type };
  }

  if (!dedup.recordIfAbsent(event.id)) {
    return { kind: "drop", reason: "duplicate", id: event.id };
  }

  return { kind: "dispatch", event, worker, workerName: event.type };
}
