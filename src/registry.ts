import type { Chunk, Event } from "./schemas.ts";
import type { Ports } from "./ports.ts";
import { pingWorker } from "./workers/ping.ts";
import { echoWorker } from "./workers/echo.ts";

/**
 * Worker: an async generator from an Event to a stream of Chunks.
 * Contract:
 *   - yields zero-or-more `partial` chunks
 *   - yields exactly one terminal chunk (`final` or `error`) and returns
 *   - never throws; errors are values
 */
export type Worker = (event: Event, ports: Ports) => AsyncGenerator<Chunk>;

/**
 * Registry: the single inspectable mapping from event type → worker.
 * Read-only after construction. Adding a new event type means adding a key
 * here — there is no other place to register a worker.
 */
export const registry = {
  ping: pingWorker,
  echo: echoWorker,
} as const satisfies Record<string, Worker>;

export type EventType = keyof typeof registry;

export function describeRegistry(): Array<{ type: string; worker: string }> {
  return Object.entries(registry).map(([type, fn]) => ({
    type,
    worker: fn.name || "<anonymous>",
  }));
}
