import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { parse as parseYaml } from "yaml";
import { z } from "zod";

/**
 * agent.md: the agent's identity and contract.
 *
 * Format: YAML frontmatter (between two `---` lines) followed by freeform
 * markdown prose. The frontmatter is the machine-readable boot contract;
 * the prose below is documentation for humans (and, eventually, an LLM).
 *
 *   ---
 *   name: my-agent
 *   role: One-line description of what this agent does
 *   version: 0.1.0
 *   capabilities: [ping, echo]
 *   tools: []
 *   ---
 *
 *   # my-agent
 *   ...
 *
 * Boot rules (enforced before the first event is dispatched):
 *   1. agent.md MUST exist (no agent.md, no boot).
 *   2. Frontmatter MUST validate against AgentManifest.
 *   3. Every capability MUST exist as a key in the registry.
 *      The registry MAY contain extra workers (the agent simply doesn't
 *      claim them). A capability without a registry entry is a hard fail.
 *
 * The full file is hashed (sha256). Identity (name + version + sha256) is
 * stamped into every Transition so traces carry their own provenance.
 */
export const AgentManifest = z.object({
  name: z.string().min(1),
  role: z.string().min(1),
  version: z.string().min(1),
  capabilities: z.array(z.string().min(1)).min(1),
  tools: z.array(z.string()).default([]),
});
export type AgentManifest = z.infer<typeof AgentManifest>;

export const AgentRef = z.object({
  name: z.string().min(1),
  version: z.string().min(1),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
});
export type AgentRef = z.infer<typeof AgentRef>;

export interface AgentIdentity {
  manifest: AgentManifest;
  sha256: string;
  path: string;
  ref: AgentRef;
}

export class AgentBootError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AgentBootError";
  }
}

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

export function parseAgentMd(raw: string): AgentManifest {
  const match = FRONTMATTER.exec(raw);
  if (!match) {
    throw new AgentBootError(
      "agent.md must begin with YAML frontmatter delimited by `---`",
    );
  }
  const yamlBody = match[1];
  if (yamlBody === undefined) {
    throw new AgentBootError("agent.md frontmatter is empty");
  }
  let data: unknown;
  try {
    data = parseYaml(yamlBody);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new AgentBootError(`agent.md frontmatter is not valid YAML: ${msg}`);
  }
  const parsed = AgentManifest.safeParse(data);
  if (!parsed.success) {
    throw new AgentBootError(
      `agent.md frontmatter does not match AgentManifest: ${JSON.stringify(parsed.error.flatten())}`,
    );
  }
  return parsed.data;
}

export async function loadAgentMd(cwd: string): Promise<AgentIdentity> {
  const path = resolve(cwd, "agent.md");
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch {
    throw new AgentBootError(`agent.md not found at ${path}`);
  }
  const manifest = parseAgentMd(raw);
  const sha256 = createHash("sha256").update(raw).digest("hex");
  return {
    manifest,
    sha256,
    path,
    ref: { name: manifest.name, version: manifest.version, sha256 },
  };
}

/**
 * Verify that every capability the agent claims is actually wired in the
 * registry. Extra registry entries are fine — the agent simply doesn't
 * claim them. Missing entries are a hard fail.
 */
export function assertCapabilitiesMatchRegistry(
  manifest: AgentManifest,
  registryKeys: readonly string[],
): void {
  const keys = new Set(registryKeys);
  const missing = manifest.capabilities.filter((c) => !keys.has(c));
  if (missing.length > 0) {
    throw new AgentBootError(
      `agent.md declares capabilities not present in registry: ${missing.join(", ")}. ` +
        `Registered: ${registryKeys.join(", ")}`,
    );
  }
}
