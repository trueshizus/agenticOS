import { z } from "zod";
import type { Chunk, Event } from "../schemas.ts";
import type { Ports } from "../ports.ts";

const EchoPayload = z.object({ message: z.string() });

/**
 * echo → emits the payload's `message` back.
 * Streams the message word-by-word as `partial` chunks, then a `final` with
 * the joined string. Yields an `error` chunk if the payload fails validation —
 * never throws across the machine boundary.
 */
export async function* echoWorker(
  event: Event,
  _ports: Ports,
): AsyncGenerator<Chunk> {
  const parsed = EchoPayload.safeParse(event.payload);
  if (!parsed.success) {
    yield {
      kind: "error",
      seq: 0,
      message: "echo payload must be { message: string }",
      cause: parsed.error.flatten(),
    };
    return;
  }

  const words = parsed.data.message.split(/\s+/).filter((w) => w.length > 0);
  let seq = 0;
  for (const word of words) {
    yield { kind: "partial", seq: seq++, data: word };
  }
  yield { kind: "final", seq: seq, data: parsed.data.message };
}
