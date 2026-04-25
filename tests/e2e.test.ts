import { test, expect, beforeEach } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Transition, type Event } from "../src/schemas.ts";
import { createInMemoryDedupStore } from "../src/dedup.ts";
import { createJsonlTraceSink } from "../src/trace-sink.ts";
import { buildDispatcher } from "../src/machine.ts";
import type { Ports } from "../src/ports.ts";

function fixedPorts(): Ports {
  let n = 0;
  return {
    now: () => new Date("2026-04-25T00:00:00.000Z"),
    cycleId: () => `cycle-${++n}`,
  };
}

let dir: string;
let tracePath: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "evm-e2e-"));
  tracePath = join(dir, "run.jsonl");
});

async function readTransitions(path: string): Promise<unknown[]> {
  const raw = await readFile(path, "utf8");
  return raw
    .split("\n")
    .filter((l) => l.length > 0)
    .map((l) => JSON.parse(l));
}

test("ping event produces one valid Transition with outcome=final/pong", async () => {
  const ports = fixedPorts();
  const dedup = createInMemoryDedupStore();
  const sink = await createJsonlTraceSink(tracePath);
  const dispatch = buildDispatcher({ dedup, sink, ports });

  const event: Event = {
    id: "evt-1",
    type: "ping",
    source: "test",
    ts: "2026-04-25T00:00:00.000Z",
    payload: null,
  };

  const t = await dispatch(event);

  expect(t.outcome).toEqual({ kind: "final", data: "pong" });
  expect(t.chunks).toHaveLength(2);
  expect(t.chunks[0]).toMatchObject({ kind: "partial", data: "ack" });
  expect(t.chunks[1]).toMatchObject({ kind: "final", data: "pong" });
  expect(t.fromState).toBe("waiting");
  expect(t.toState).toBe("waiting");
  expect(t.worker).toBe("ping");
  expect(t.metrics.chunkCount).toBe(2);

  const lines = await readTransitions(tracePath);
  expect(lines).toHaveLength(1);
  // Re-validate from disk: the trace alone must be schema-valid.
  expect(() => Transition.parse(lines[0])).not.toThrow();

  await rm(dir, { recursive: true, force: true });
});

test("echo streams words then a final equal to the joined message", async () => {
  const ports = fixedPorts();
  const dedup = createInMemoryDedupStore();
  const sink = await createJsonlTraceSink(tracePath);
  const dispatch = buildDispatcher({ dedup, sink, ports });

  const event: Event = {
    id: "evt-2",
    type: "echo",
    source: "test",
    ts: "2026-04-25T00:00:00.000Z",
    payload: { message: "hello world" },
  };

  const t = await dispatch(event);

  expect(t.outcome).toEqual({ kind: "final", data: "hello world" });
  expect(t.chunks.map((c) => c.kind)).toEqual(["partial", "partial", "final"]);
  expect((t.chunks[0] as { data: unknown }).data).toBe("hello");
  expect((t.chunks[1] as { data: unknown }).data).toBe("world");

  await rm(dir, { recursive: true, force: true });
});

test("unknown event type produces a dropped Transition", async () => {
  const ports = fixedPorts();
  const dedup = createInMemoryDedupStore();
  const sink = await createJsonlTraceSink(tracePath);
  const dispatch = buildDispatcher({ dedup, sink, ports });

  const event: Event = {
    id: "evt-3",
    type: "nope",
    source: "test",
    ts: "2026-04-25T00:00:00.000Z",
    payload: null,
  };

  const t = await dispatch(event);

  expect(t.outcome.kind).toBe("dropped");
  if (t.outcome.kind === "dropped") {
    expect(t.outcome.reason).toBe("unknown-type: nope");
  }
  expect(t.worker).toBe("<none>");
  expect(t.chunks).toHaveLength(0);

  const lines = await readTransitions(tracePath);
  expect(lines).toHaveLength(1);
  expect(() => Transition.parse(lines[0])).not.toThrow();

  await rm(dir, { recursive: true, force: true });
});
