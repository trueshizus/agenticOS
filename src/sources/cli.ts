import { Event } from "../schemas.ts";
import type { Ports } from "../ports.ts";

/**
 * CLI source: turn argv into an Event.
 *
 *   bun run src/index.ts <type> [arg ...]
 *
 * The first positional becomes `event.type`. Remaining positionals are joined
 * into `payload.message` — this is the convention for `echo`, and `ping`
 * simply ignores it. An optional `--id <uuid>` lets callers force a specific
 * event id (used to demonstrate idempotency from the shell).
 *
 * The returned object is validated through `Event` before being handed off,
 * so any malformed argv surfaces as an ingress drop, not a thrown error.
 */
export function eventFromArgv(argv: string[], ports: Ports): Event {
  let id: string | null = null;
  const positional: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--id" && i + 1 < argv.length) {
      id = argv[++i] ?? null;
    } else if (a !== undefined) {
      positional.push(a);
    }
  }

  const type = positional[0] ?? "";
  const rest = positional.slice(1);
  const payload =
    rest.length > 0 ? { message: rest.join(" ") } : { message: "" };

  return Event.parse({
    id: id ?? ports.cycleId(),
    type,
    source: "cli",
    ts: ports.now().toISOString(),
    payload,
  });
}
