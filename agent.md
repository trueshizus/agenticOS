---
name: ping-echo-agent
role: Trivial demo agent that responds to pings and echoes payloads
version: 0.1.0
capabilities:
  - ping
  - echo
tools: []
---

# ping-echo-agent

A v0 demo agent for the event-machine runtime. No LLM, no external tools —
just two deterministic event handlers.

## Identity

This file is the boot contract. The runtime refuses to start without it.
The frontmatter above is validated against `AgentManifest`
(`src/agent-md.ts`); the prose below is for humans.

## Capabilities

- **`ping`** — returns `"pong"`. Yields one `partial` chunk (`"ack"`) before
  the `final`.
- **`echo`** — splits `payload.message` into words and streams them as
  `partial` chunks; `final` is the full joined string. Validates payload
  shape; yields an `error` chunk on bad input.

Each capability MUST exist as a key in `src/registry.ts`. Mismatches fail
boot fast.

## Tools

None in v0. When workers need to call out (HTTP, fs, LLM, MCP, ...), tools
get listed here and a matching `Port` is added to `src/ports.ts`.

## Provenance

The full text of this file is hashed (sha256) at boot. The hash plus
`name` and `version` are stamped into every `Transition` under `agent`.
Two runs with different `agent.md` content produce different shas, even
if the name and version are the same.
