# Event-Machine Agent Runtime

A minimal agent runtime. Events arrive, get validated, get routed through an
explicit registry to a worker, stream chunks, terminate, and produce one
`Transition` JSON record per cycle.

## Evaluation criterion

> A new contributor, given only the trace and the registry, can predict the
> next state and explain any failure without reading runtime code.

Everything in this repo exists to make that sentence true. If reading
`src/machine.ts` ever feels necessary to interpret a trace, that is a defect.

## Stack

**TypeScript + Zod + Bun.** Zod schemas are runtime values, so `Event`,
`Chunk`, and `Transition` are simultaneously the static types and the
validators at every boundary. Async generators are native, which means the
streaming contract is just `for await … yield` with no library to learn.
Bun runs `.ts` directly (no build step) and ships a test runner, so the
project has zero tooling beyond `bun install`. Lowest ceremony for a runtime
whose criterion is "no runtime code reading required."

## Boot contract: `agent.md`

The runtime refuses to start without an `agent.md` in the working directory.
That file is the agent's identity, role, and capability declaration —
machine-readable frontmatter on top, prose for humans below.

```yaml
---
name: ping-echo-agent
role: Trivial demo agent that responds to pings and echoes payloads
version: 0.1.0
capabilities: [ping, echo]
tools: []
---

# ping-echo-agent
...
```

At boot the runtime:
1. Reads `./agent.md` — fails fast (`exit 2`) if missing.
2. Validates frontmatter against `AgentManifest` (`src/agent-md.ts`).
3. Asserts every capability is a registered worker — mismatches fail boot.
4. Hashes the file (sha256) and stamps `{name, version, sha256}` into every
   Transition under `agent`. Two runs with different file contents have
   different shas, so traces self-identify their authoring agent.

Adding a new event type means: register the worker in `src/registry.ts`,
add the type to `capabilities` in `agent.md`, document it in the prose. The
two files must agree.

## Lifecycle

```
agent.md ──▶ boot validation ──▶ machine in `waiting`
                                     │
                ┌──────── ingress ────┴───┐
event in ──▶ validate ─▶ route ─▶ dedup ──▶ worker ──▶ chunks ──▶ Transition
                │           │         │                              │
                └─ drop ────┴── drop ─┴── drop ─────────────────────▶ Transition
                   (invalid / unknown-type / duplicate, all traced)
```

The machine idles in `waiting`. Each accepted event takes it to
`processing`; the first terminal chunk (`final` or `error`) returns it to
`waiting` and writes a `Transition` to disk. A worker that never terminates
or one that throws is still resolved by the machine — both surface as a
synthetic `error` chunk and an `error` outcome. The machine never throws
across its boundary.

## Registry

The registry is the single inspectable mapping from event type → worker.
Open `src/registry.ts`:

```ts
export const registry = {
  ping: pingWorker,   // src/workers/ping.ts → "ack" then "pong"
  echo: echoWorker,   // src/workers/echo.ts → streams words, finals the message
} as const satisfies Record<string, Worker>;
```

Adding a new event type means adding a key here. Nothing else.

## Worked example

Run `bun run src/index.ts ping --id demo-ping-001` and one line is appended
to `traces/run.jsonl`:

```json
{
  "cycleId": "8968e774-403e-4ce1-ac39-7f87a834dcf1",
  "agent": {
    "name": "ping-echo-agent",
    "version": "0.1.0",
    "sha256": "a913f15c57376ac76583beb7560c5439d010581594f644239f9fa374788838bf"
  },
  "event": {
    "id": "demo-ping-001",
    "type": "ping",
    "source": "cli",
    "ts": "2026-04-25T17:03:59.321Z",
    "payload": { "message": "" }
  },
  "fromState": "waiting",
  "toState": "waiting",
  "worker": "ping",
  "startedAt": "2026-04-25T17:03:59.322Z",
  "endedAt":   "2026-04-25T17:03:59.323Z",
  "chunks": [
    { "kind": "partial", "seq": 0, "data": "ack"  },
    { "kind": "final",   "seq": 1, "data": "pong" }
  ],
  "outcome": { "kind": "final", "data": "pong" },
  "metrics": { "latencyMs": 1, "chunkCount": 2 }
}
```

What a contributor can read off this record without opening `machine.ts`:

- **Next state.** `toState: "waiting"`. The machine is back to idle and ready
  for the next event.
- **What ran.** `worker: "ping"`. Cross-reference the registry: `ping`
  routes to `pingWorker` in `src/workers/ping.ts`. That's the entire
  call path.
- **What the cycle produced.** Two chunks, ending in `final` with `"pong"`.
  By the streaming contract, `final` is terminal — anything yielded after it
  would have been ignored.
- **What would change if the worker threw.** Per the contract, throwing is a
  bug, but the machine catches it. The trace would instead show an
  appended `error` chunk like
  `{ "kind": "error", "seq": N, "message": "worker threw: <text>" }` and
  `outcome: { "kind": "error", "message": "worker threw: <text>" }`.
  `toState` would still be `"waiting"`.
- **What would change on a duplicate id.** The same event id submitted again
  in the same process is dropped at ingress. The trace would record a
  separate Transition with `worker: "<none>"`, `chunks: []`, and
  `outcome: { "kind": "dropped", "reason": "duplicate: demo-ping-001" }`.

That is the full causal story of one cycle. The Transition is the source of
truth — if a behavior isn't visible here, it didn't happen, or there's a bug.

## Idempotency

Dedup is by `event.id`. v0 uses an **in-memory** `Set<string>` (see
`src/dedup.ts`); restarting the process forgets every seen id. This is the
documented persistence model — fine for a single-process runtime, and the
seam (`DedupStore`) is where you'd plug in JSONL/SQLite later. The
idempotency test (`tests/idempotency.test.ts`) exercises dedup within a
single process: same id twice ⇒ one `final` and one `dropped`, both
recorded.

## Errors are values

`Chunk` carries an `error` variant, and `Outcome` carries `error` and
`dropped` variants. Workers don't throw; the machine doesn't propagate
throws. Three drop reasons are enumerated in `src/ingress.ts` —
`invalid`, `unknown-type`, `duplicate` — and each produces a Transition
with that reason in `outcome`.

## Run (local)

```sh
bun install
bun run src/index.ts ping
bun run src/index.ts echo "hello world"
bun run src/index.ts --help            # prints identity + registry
bun test                               # 12 tests across 3 files
bun run typecheck                      # strict tsc
```

## Run (container)

```sh
docker build -t event-machine .
# one-shot dispatch
docker run --rm -v "$PWD/traces:/app/traces" event-machine ping
# stdin mode (default CMD)
echo '{"id":"e1","type":"ping","source":"docker","ts":"2026-04-25T00:00:00Z","payload":{}}' \
  | docker run --rm -i -v "$PWD/traces:/app/traces" event-machine
```

The image bakes `agent.md` in at `/app/agent.md`. To swap identity at run
time, mount over it:

```sh
docker run --rm -i \
  -v "$PWD/agent.md:/app/agent.md:ro" \
  -v "$PWD/traces:/app/traces" \
  event-machine ping
```

Trace output is appended to `traces/run.jsonl` (gitignored). One JSON
object per line, schema-validated before write.

## Wiring to NATS (or any other source)

The runtime stays NATS-agnostic. `--stdin` reads newline-delimited JSON
Events and feeds each to the dispatcher — exactly the same path as the CLI
source, just with many events per process. NATS lives entirely in the
operator's shell:

```sh
# consumer
nats sub agent.events --raw | bun run src/index.ts --stdin

# producer (any client, any language)
nats pub agent.events '{"id":"e1","type":"ping","source":"nats","ts":"2026-04-25T00:00:00Z","payload":{}}'
```

For durable cross-process dedup, publish with the `Nats-Msg-Id` header set
to `event.id` and let JetStream deduplicate inside its window — no client
code needed. The in-memory `DedupStore` then becomes belt-and-suspenders or
can be swapped for a no-op. Malformed JSON on stdin surfaces as a
`dropped: invalid` Transition; nothing throws.

## Layout

```
agent.md             # boot contract: identity, role, capabilities, tools
Dockerfile           # oven/bun:1-alpine, ENTRYPOINT bun src/index.ts
src/
  schemas.ts         # Event, Chunk, Metrics, Outcome, AgentRef, Transition
  registry.ts        # type → worker, the ONLY routing artifact
  agent-md.ts        # AgentManifest loader + capability check
  ports.ts           # injectable side effects (now, cycleId)
  dedup.ts           # DedupStore interface + in-memory impl
  ingress.ts         # validate + route + dedup → IngressDecision
  machine.ts         # runCycle + buildDispatcher (emits Transitions)
  trace-sink.ts      # JSONL appender (re-validates on write)
  sources/cli.ts     # argv → Event
  workers/ping.ts    # ping → pong
  workers/echo.ts    # echo → streams words, finals the joined message
  index.ts           # CLI entry: loads agent.md, builds dispatcher
tests/
  e2e.test.ts        # happy paths + unknown-type drop
  idempotency.test.ts # duplicate id + invalid input drops
  agent-md.test.ts   # frontmatter parse + capability assertions
traces/              # JSONL output, gitignored
```

## Anti-goals

No session pooling, no actor supervisors, no inotify, no in-runtime metric
aggregation, no LLM calls in v0. A real model worker is added only after
the criterion holds for the trivial cases.
