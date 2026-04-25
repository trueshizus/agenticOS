import { realPorts } from "./ports.ts";
import { createInMemoryDedupStore } from "./dedup.ts";
import { createJsonlTraceSink } from "./trace-sink.ts";
import { buildDispatcher } from "./machine.ts";
import { eventFromArgv } from "./sources/cli.ts";
import { describeRegistry } from "./registry.ts";

async function main(argv: string[]): Promise<void> {
  if (argv.length === 0 || argv[0] === "--help" || argv[0] === "-h") {
    const reg = describeRegistry()
      .map((r) => `  ${r.type}\t→ ${r.worker}`)
      .join("\n");
    process.stdout.write(
      [
        "usage: bun run src/index.ts <type> [arg ...] [--id <uuid>]",
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
  const dispatch = buildDispatcher({ dedup, sink, ports });

  const event = eventFromArgv(argv, ports);
  const transition = await dispatch(event);

  process.stdout.write(JSON.stringify(transition, null, 2) + "\n");
}

main(process.argv.slice(2)).catch((err) => {
  // The machine never throws — anything here is a bug in main itself.
  process.stderr.write(`fatal: ${err instanceof Error ? err.message : err}\n`);
  process.exit(1);
});
