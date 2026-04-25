import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { Transition } from "./schemas.ts";

/**
 * TraceSink: append-only sink for Transition records.
 * The sink validates every record before writing — a corrupt trace is a bug,
 * not an accepted input.
 */
export interface TraceSink {
  write(transition: Transition): Promise<void>;
  path(): string;
}

export async function createJsonlTraceSink(path: string): Promise<TraceSink> {
  await mkdir(dirname(path), { recursive: true });
  return {
    async write(transition) {
      const validated = Transition.parse(transition);
      await appendFile(path, JSON.stringify(validated) + "\n", "utf8");
    },
    path() {
      return path;
    },
  };
}
