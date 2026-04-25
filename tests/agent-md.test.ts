import { test, expect } from "bun:test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  AgentBootError,
  assertCapabilitiesMatchRegistry,
  loadAgentMd,
  parseAgentMd,
} from "../src/agent-md.ts";

const VALID = `---
name: test
role: A test agent
version: 0.0.1
capabilities:
  - ping
tools: []
---

# test

body
`;

test("parseAgentMd accepts valid frontmatter", () => {
  const m = parseAgentMd(VALID);
  expect(m.name).toBe("test");
  expect(m.capabilities).toEqual(["ping"]);
  expect(m.tools).toEqual([]);
});

test("parseAgentMd rejects missing frontmatter", () => {
  expect(() => parseAgentMd("# no frontmatter\n")).toThrow(AgentBootError);
});

test("parseAgentMd rejects frontmatter that fails the schema", () => {
  const bad = `---
name: ""
role: x
version: 0.0.1
capabilities: []
---
`;
  expect(() => parseAgentMd(bad)).toThrow(AgentBootError);
});

test("loadAgentMd hashes the file and packs an AgentRef", async () => {
  const dir = await mkdtemp(join(tmpdir(), "agentmd-"));
  await writeFile(join(dir, "agent.md"), VALID, "utf8");
  const id = await loadAgentMd(dir);
  expect(id.manifest.name).toBe("test");
  expect(id.ref.sha256).toMatch(/^[0-9a-f]{64}$/);
  expect(id.ref.name).toBe("test");
  expect(id.ref.version).toBe("0.0.1");
  await rm(dir, { recursive: true, force: true });
});

test("loadAgentMd fails when agent.md is missing", async () => {
  const dir = await mkdtemp(join(tmpdir(), "agentmd-empty-"));
  await expect(loadAgentMd(dir)).rejects.toThrow(AgentBootError);
  await rm(dir, { recursive: true, force: true });
});

test("assertCapabilitiesMatchRegistry passes when subset", () => {
  expect(() =>
    assertCapabilitiesMatchRegistry(
      { name: "t", role: "r", version: "0", capabilities: ["ping"], tools: [] },
      ["ping", "echo"],
    ),
  ).not.toThrow();
});

test("assertCapabilitiesMatchRegistry fails on missing capability", () => {
  expect(() =>
    assertCapabilitiesMatchRegistry(
      { name: "t", role: "r", version: "0", capabilities: ["nope"], tools: [] },
      ["ping", "echo"],
    ),
  ).toThrow(AgentBootError);
});
