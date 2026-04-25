import { test, expect, beforeEach } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Transition, type AgentRef, type Event } from "../src/schemas.ts";
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

const AGENT: AgentRef = {
  name: "test-agent",
  version: "0.0.1",
  sha256: "0".repeat(64),
};

let dir: string;
let tracePath: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "evm-dedup-"));
  tracePath = join(dir, "run.jsonl");
});

test("same event id dispatched twice → first runs, second is dropped as duplicate", async () => {
  const ports = fixedPorts();
  const dedup = createInMemoryDedupStore();
  const sink = await createJsonlTraceSink(tracePath);
  const dispatch = buildDispatcher({ agent: AGENT, dedup, sink, ports });

  const event: Event = {
    id: "same-id",
    type: "ping",
    source: "test",
    ts: "2026-04-25T00:00:00.000Z",
    payload: null,
  };

  const first = await dispatch(event);
  const second = await dispatch(event);

  expect(first.outcome).toEqual({ kind: "final", data: "pong" });
  expect(second.outcome.kind).toBe("dropped");
  if (second.outcome.kind === "dropped") {
    expect(second.outcome.reason).toBe("duplicate: same-id");
  }

  // Both events were observed → both are in the trace.
  const raw = await readFile(tracePath, "utf8");
  const lines = raw.split("\n").filter((l) => l.length > 0);
  expect(lines).toHaveLength(2);
  for (const l of lines) {
    expect(() => Transition.parse(JSON.parse(l))).not.toThrow();
  }

  await rm(dir, { recursive: true, force: true });
});

test("malformed input produces a dropped Transition with reason=invalid", async () => {
  const ports = fixedPorts();
  const dedup = createInMemoryDedupStore();
  const sink = await createJsonlTraceSink(tracePath);
  const dispatch = buildDispatcher({ agent: AGENT, dedup, sink, ports });

  const t = await dispatch({ not: "an event" });

  expect(t.outcome.kind).toBe("dropped");
  if (t.outcome.kind === "dropped") {
    expect(t.outcome.reason.startsWith("invalid:")).toBe(true);
  }
  expect(t.worker).toBe("<none>");

  await rm(dir, { recursive: true, force: true });
});
