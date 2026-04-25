import type { Chunk, Event } from "../schemas.ts";
import type { Ports } from "../ports.ts";

/**
 * ping → pong.
 * Yields one partial ("ack") then a final ("pong"). No I/O.
 */
export async function* pingWorker(
  _event: Event,
  _ports: Ports,
): AsyncGenerator<Chunk> {
  yield { kind: "partial", seq: 0, data: "ack" };
  yield { kind: "final", seq: 1, data: "pong" };
}
