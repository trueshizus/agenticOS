import { createInterface } from "node:readline";
import { realPorts } from "./ports.ts";
import { createInMemoryDedupStore } from "./dedup.ts";
import { createJsonlTraceSink } from "./trace-sink.ts";
import { buildDispatcher } from "./machine.ts";
import { eventFromArgv } from "./sources/cli.ts";
import { describeRegistry, registry } from "./registry.ts";
import {
  AgentBootError,
  assertCapabilitiesMatchRegistry,
  loadAgentMd,
} from "./agent-md.ts";

async function main(argv: string[]): Promise<void> {
  // Boot: agent.md is the entry point. Without it, nothing runs.
  let agent;
  try {
    agent = await loadAgentMd(process.cwd());
    assertCapabilitiesMatchRegistry(agent.manifest, Object.keys(registry));
  } catch (err) {
    if (err instanceof AgentBootError) {
      process.stderr.write(`boot error: ${err.message}\n`);
      process.exit(2);
    }
    throw err;
  }

  if (argv.length === 0 || argv[0] === "--help" || argv[0] === "-h") {
    const reg = describeRegistry()
      .map((r) => `  ${r.type}\t→ ${r.worker}`)
      .join("\n");
    process.stdout.write(
      [
        `agent: ${agent.manifest.name} v${agent.manifest.version} (${agent.sha256.slice(0, 12)})`,
        `role:  ${agent.manifest.role}`,
        `caps:  ${agent.manifest.capabilities.join(", ")}`,
        `tools: ${agent.manifest.tools.length > 0 ? agent.manifest.tools.join(", ") : "<none>"}`,
        "",
        "usage: bun run src/index.ts <type> [arg ...] [--id <uuid>]",
        "       bun run src/index.ts --stdin   # read JSON Events, one per line",
        "",
        "registry:",
        reg,
        "",
      ].join("\n"),
    );
    return;
  }

  const ports = realPorts;
  const dedup = createInMemoryDedupStore();
  const sink = await createJsonlTraceSink("traces/run.jsonl");
  const dispatch = buildDispatcher({ agent: agent.ref, dedup, sink, ports });

  if (argv[0] === "--stdin") {
    const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
    for await (const line of rl) {
      const trimmed = line.trim();
      if (trimmed.length === 0) continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(trimmed);
      } catch {
        // Hand the raw string to dispatch — ingress will drop it as `invalid`,
        // which is exactly what we want recorded in the trace.
        parsed = trimmed;
      }
      const t = await dispatch(parsed);
      process.stdout.write(JSON.stringify(t) + "\n");
    }
    return;
  }

  const event = eventFromArgv(argv, ports);
  const transition = await dispatch(event);
  process.stdout.write(JSON.stringify(transition, null, 2) + "\n");
}

main(process.argv.slice(2)).catch((err) => {
  // The machine never throws — anything here is a bug in main itself.
  process.stderr.write(`fatal: ${err instanceof Error ? err.message : err}\n`);
  process.exit(1);
});
