# SPEC_AOS_CLI — The `aos` Command

**Status:** v0.1 draft · 2026-07-22
**Sits on:** `AGENTICT_OS.md` (council spec) and `PLAN_AGENTIC_OS.md` (implementation plan). The CLI is a *frontend to the wire contract*: every command publishes CouncilEvents and reads traces. It adds no machinery to the machine and no state of its own beyond channel manifests — traces are the only state, `correlationId` the only job handle.
**Conventions:** follows the workspace agent-facing CLI template (`canillita-bot/CLI.md`): stdout is data, stderr is everything else; `--json` is a versioned parallel contract; distinct exit codes per failure class; no blocking prompts; `--dry-run` where money or fan-out is involved.

---

## 0. One paragraph

`aos` is how a human (or another agent) sits inside the council. Run bare, it opens **chat mode** on the default channel. A **channel** is a persistent 1:1 conversation with one node — any harness/model configuration: Claude Code on the Mac, an Ollama model on galpon, Kimi, Hermes, a bridge. A **room** is a set of channels deliberating under one `contextId`; a **group ask** fans a single direct question to every member and closes with a **vote** — implemented entirely as ordinary Events and caller-side tallying, so the council's §8 anti-goals (no in-protocol consensus) stay intact.

## 1. Nouns

| Noun | Is | Backed by |
| --- | --- | --- |
| **channel** | A named 1:1 chat with one node | Manifest `~/.aos/channels/<name>.md` + the node's NATS subjects |
| **room** | A named set of channels that deliberate together | Manifest `~/.aos/rooms/<name>.md`; conversation = one `contextId` |
| **exchange** | One call→reply | `correlationId`, greppable across traces |
| **thread** | A long-lived conversation (chat history of a channel or room) | `contextId`; N exchanges |

**Channel manifest** (`~/.aos/channels/<name>.md`, agent.md-shaped, sha256-stamped):

```yaml
---
name: galpon-qwen
node: galpon-qwen            # council node name → agentict.node.<node>.inbox
harness: ollama              # claude-code | kimi | hermes | ollama | bridge | ...
host: galpon
model: qwen3:8b
tier: executor               # thinker | executor
protocolVersion: "0.1"
---
Free prose: what this channel is for, cost notes, quirks.
```

`tier` encodes the thinking/execution split: rooms of `thinker` channels deliberate and vote; the winning option can be dispatched to a cheap `executor` channel. The CLI enforces nothing about tiers beyond filtering (`--tier`); policy is the caller's.

## 2. Command surface

Panel-agreed shape (vault: AgenticOS/Overview.md): **council verbs top-level, management strictly noun-verb.** Chat additions follow the same rule — `chat` and `ask` are verbs; `channel` and `room` are nouns.

```
aos                          # chat mode on the default channel
aos @<name>                  # chat mode on channel <name> (sugar for: aos channel attach <name>)

# council verbs (from the panel design; unchanged)
aos call <node> <type> [--part text=... | --json-payload ...]
aos trace <correlationId | contextId> [--all-nodes]
aos who-can <capability>
aos wanted [list | post <text>]
aos serve                    # run this host's node ingress (wraps scripts/node-ingress.sh)

# chat verbs (new)
aos ask "<question>" [--room <room> | --to <ch>,<ch>...] [--vote] [--deadline 120s] [--dry-run]
aos chat [<channel|room>]    # explicit form of the default

# nouns (management, noun-verb)
aos channel list|new|attach|edit|rm [<name>] [--harness --host --model --tier]
aos room    list|new|edit|rm [<name>] [<member>...]
aos node    list|announce|context <name>     # peers.jsonl view; stream a node's OKF bundle
aos inbox                    # pending.jsonl view: open exchanges, deadlines
```

`aos channels` / `aos rooms` (bare plural) are accepted aliases for `... list` — the listing is the command you run most.

### 2.1 Chat mode

Attaching a channel opens a line-based REPL: your line becomes a call Event (`type` from the channel's default, normally a `chat` capability; `parts: [TextPart]`), the reply streams to stdout as it arrives. Slash commands inside chat, IRC-style:

```
/who            members + liveness (room) or node manifest (channel)
/ask <q>        run a group ask + vote from inside a room
/trace          print the current thread's contextId and exchange list
/tier <t>       filter which members an /ask fans to
/quit
```

Chat history *is* the trace: `aos trace <contextId>` replays any conversation; the CLI stores nothing else.

### 2.2 The ask/vote protocol (caller-side, anti-goal-safe)

`aos ask` is the group-chat-with-voting flow. It is **pure caller policy** layered on §5 call/reply — no new Event semantics, no in-protocol consensus:

1. **Fan-out.** Mint one `contextId` (or reuse the room's), one `correlationId` per member. Publish the same single direct question (`payload.question`, schema-enforced ≤ 280 chars — Zod does the discipline, not prose) to each member's inbox.
2. **Collect.** Wait for reply Events until `--deadline` (default 120s) or all members answer, whichever first. Absent members' silence is traced by the caller's deadline sweeper (`pending.jsonl` → `error` Transition), per §5.1 — one dead channel never blocks the ask.
3. **Vote round** (when `--vote`, default on for rooms). Re-publish the collected answers to every member **anonymized and shuffled** (options labeled A, B, C… with authorship stripped — no halo votes for big models), as a `vote` call whose reply schema is a ranking. A member may not see its own option removed; it simply may not rank first any option it authored (the convener enforces this at tally, since it knows the mapping).
4. **Tally.** The convener (the `aos` process — whichever node originated, per the spec's dissolving-orchestrator rule) tallies in its own trace and prints the result. The tally Transition carries the full mapping (option → author → votes) so `aos trace <contextId>` reconstructs the whole deliberation, per §10.
5. **Dispatch (optional).** `--then-execute <channel>` sends the winning option as a call to an executor-tier channel.

`--dry-run` prints the fan-out plan (members, estimated calls = N answers + N votes) without publishing — cost preview before an N-model spend.

## 3. Agent-facing contract

Per `canillita-bot/CLI.md`, non-negotiable:

- `--json` on every command: NDJSON events on stdout (`{"v":1,"kind":"answer"|"vote"|"tally"|"error",...}`); schema versioned with `v`.
- Exit codes: `0` ok · `2` usage · `3` channel/room not found · `4` transport (NATS unreachable) · `5` deadline expired with zero replies · `6` partial (some replied, some timed out — data on stdout, detail on stderr).
- Errors are structured with fix-hints (`"channel 'kimi' not found — aos channel list; aos channel new kimi --harness kimi"`).
- Never prompts. Chat mode is the sole interactive surface, and it is never entered when stdout is not a TTY or `--json` is set.
- `aos doctor` preflights: NATS reachable, streams exist, default channel's node answering, manifests valid.

## 4. Implementation notes

- Runtime: Bun + citty (framework recommendation from `canillita-bot/investigations/cli/frameworks/RECOMMENDATION.md`), sharing `src/schemas.ts` for CouncilEvent/Part/Artifact validation at the boundary.
- Transport: shells out to `nats` exactly like the bridge workers (`scripts/publish.sh`); zero NATS client imports, same greppable guarantee as the runtime.
- The CLI's own actions are traced: `aos` runs as (or fronts) a node named for the human's seat (`fable-mac`), so every ask, vote, and tally is a Transition in that node's `traces/run.jsonl`.

## 5. Anti-goals (v0.1)

- No server, daemon, or database — manifests + traces + JetStream are the state.
- No in-protocol voting: `vote` is an ordinary call type members opt into; a member that drops it as `unknown-type` simply abstains (traced, legible).
- No scheduler or fleet supervisor verbs — `serve` runs one local ingress; starting/stopping remote nodes stays a deployment concern (Dokploy, systemd).
- No streaming-token protocol in v0.1: replies arrive as whole Events. Revisit with chunked Parts only if chat feels unusable.

## 6. Open questions

1. Should room votes support weights (e.g. thinker tier ×2)? Deferred — tally is caller policy, so this needs no protocol change whenever decided.
2. `aos` as the seat-node vs. a thin client to an already-running seat node (`aos serve` in another terminal) — v0.1 assumes the latter for chat, spawn-on-demand later.
3. Whether the answer round should let members see each other's answers before voting (deliberation) or stay blind (independent votes). v0.1: blind; a `/discuss` follow-up round can reuse the same `contextId`.

## 7. Criterion

The spec's §10 sentence, applied here: *given only the involved nodes' traces, a stranger can replay any chat, reconstruct any vote — who asked, who answered what, how each member ranked, why the winner won — without reading the CLI's code.*
