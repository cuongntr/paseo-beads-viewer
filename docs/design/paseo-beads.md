# Technical Design: paseo-beads (read-only MVP)

## Routing Decision

- **Greenfield.** The repository contained only the `paseo plugin init` greeting scaffold, so
  there is no existing behaviour to preserve.
- **Risk surface.** Two elements raise this above trivial: a **public cross-runtime RPC
  contract** between the Paseo app and the daemon subprocess, and a **trusted subprocess
  boundary** where daemon-side code executes external binaries. Both need to be pinned before
  implementation.
- **Artifact: Technical Design (design-ready).** No PRD. The product intent was fully settled
  in intake: a read-only Beads console, external required `bv` binary, plugin id
  `paseo-beads`, build and typecheck only. There is no open product question for a PRD to
  resolve, but the contract and safety boundary need writing down — which is what this document
  is.
- **Direct implementation, no Beads task graph.** This is one locked, read-only vertical slice
  with a single owner and no parallelisable independent tracks. Splitting a slice this size into
  beads would add coordination overhead without reducing risk.

## Architecture

Three runtimes, enforced by the Paseo plugin import rules.

```
client/ (Paseo app, React Native)      shared/ (both)              server/ (daemon subprocess)
─────────────────────────────────      ──────────────────          ───────────────────────────
panel.tsx   TanStack Query UI          beads.ts  Zod types         dashboard.ts  triage+plan+alerts
rows.tsx    status-rail rows           rpc.ts    RPC contracts     search.ts     robot-search
styles.ts   theme tokens                         attachment source issue.ts      tracker show
format.ts   labels and tones                                       attachments.ts workspace fanout
focus.ts    slash-command → panel                                  tracker.ts    br vs bd identity
                                                                   workspace.ts  cwd resolution
                                                                   normalize.ts  payload reshaping
                                                                   command.ts    secure runner
                                                                   cache.ts      expiring cache
```

`server/` is the only place that may touch Node, `process`, the filesystem, or subprocesses.
`shared/` holds Zod contracts and plain values only. `client/` imports no Node module and uses
React Native primitives exclusively.

### Data flow

1. The panel calls `beads.dashboard` with its `workspaceId`.
2. `workspace.ts` resolves the workspace through `paseo.workspaces.ref(id).refresh()` and uses
   its directory as the fixed subprocess cwd, after verifying it is an existing absolute path.
3. `bv --version` probes availability. On failure the dashboard returns immediately with
   `tool.available: false` and no analysis is attempted.
4. `bv --robot-triage`, `bv --robot-plan`, and `bv --robot-alerts` are requested together but
   serialized per workspace because `bv` can refresh `bd`'s compatibility export. A failure in one
   still degrades only its section.
5. `normalize.ts` reshapes each payload into the forward-compatible contract types.
6. `tracker.ts` reads the project's tracker from `triage.*.actions.tracker`, then falls back to
   `.beads/metadata.json` and installed CLI capabilities when triage is inconclusive. For detail
   reads it additionally binds that identity to an existing database route derived from `bv`'s
   selected source and metadata; unresolved routes fail closed.

`bv` is the single analysis authority. The plugin computes no graph, readiness, or cycle
information of its own, and never parses `.beads/*.jsonl` or the Beads database.

## Contracts

Four RPCs, all defined in `shared/rpc.ts` with Zod input and output schemas validated on both
sides.

| RPC | Input | Output shape |
| --- | --- | --- |
| `beads.dashboard` | `workspaceId` | tool state, tracker state, `projectState`, source snapshot, counts, recommendations, blockers, tracks, plan summary, alerts, alert summary, per-section state, `fetchedAt`, `cached` |
| `beads.search` | `workspaceId`, bounded `query`, optional bounded `limit` | echoed query and limit, normalized results, nullable error |
| `beads.issue` | `workspaceId`, pattern-checked `issueId` | tracker state, nullable normalized detail, nullable error |
| `beads.attachments.search` | `query` | at most 8 attachment items |

Design rules that make these forward-compatible:

- **No raw `bv` payloads cross the boundary.** Every field is explicitly read and renamed.
  Unknown fields are dropped rather than passed through.
- **Unknown enums stay opaque strings.** Beads statuses, authority states, readiness values,
  and alert severities are `z.string()`. A newer `bv` renders instead of failing validation.
- **`projectState` distinguishes three states**: `ready` (bv analysed a project, possibly
  empty), `missing` (no `.beads` source here), `error` (the read failed). An empty project is
  never conflated with a broken one.
- **Per-section degradation.** `sections.triage`, `sections.plan`, and `sections.alerts` each
  carry their own `ok`/`unavailable` state and error, so a missing plan or alerts read never
  blanks the dashboard.
- **Errors are a closed code set**: `unavailable`, `timeout`, `exit`, `output_limit`,
  `invalid_json`, `cwd_invalid`, `workspace_unresolved`, `tracker_unknown`, `internal`. The UI
  maps each to a distinct message.

## Safety

The subprocess boundary is the security-relevant surface. `server/command.ts` owns all of it.

| Concern | Control |
| --- | --- |
| Shell injection | `spawn` with `shell: false` and a literal argv array. No command string is ever assembled. |
| Executable hijacking | Absolute path resolved by scanning `PATH`; executable names must start with an alphanumeric character and then contain only alphanumerics, dots, underscores, or hyphens. |
| Arbitrary command execution | Explicit allowlist in `server/bv.ts`. Only `--version`, `--robot-triage`, `--robot-plan`, `--robot-alerts`, `--robot-search`, and `<tracker> --db <validated-route> show --json -- <id>` exist. `br` also receives `--no-auto-import --no-auto-flush`; bare `bv` is never invoked. |
| Untrusted cwd | Always Paseo's own workspace directory, verified absolute and existing. Never client-supplied. |
| Argument smuggling | Search query passed as one argv value after sanitisation; issue ids pattern-checked and placed after `--`. |
| Ambient tracker routing | `bv` runs with inherited `BEADS_DIR`, `BEADS_DB`, `BEADS_JSONL`, and `BD_DB` removed. Tracker detail gets only the exact validated route. |
| Runaway process | Per-process timeout (20 s) and stdout cap (4 MiB); the process is `SIGKILL`ed on either. |
| Leaked processes | Live children tracked in a module set and killed by plugin cleanup. |
| Unbounded fanout | Attachment search scans ≤12 workspaces, searches ≤4, with concurrency 2, and performs ≤8 detail reads with concurrency 3. |
| Stale analysis served as current | Only normalized results cached, expiry-only invalidation (15 s dashboard, 2 min tracker identity and route). The cache key includes workspace id and directory. No derived graph cached. Source freshness and `data_hash` shown in the UI. |
| Mutation | No mutation API exists. The tracker is invoked only with `show`; `bv` calls are serialized because `bv` may refresh `bd`'s compatibility export. |

Error mapping is deliberately non-lossy: a timeout, a non-zero exit, an oversized output, and
unparseable JSON produce different codes, because each implies a different user action.

## UI direction

A quiet dependency and workstream console, not a SaaS dashboard.

- A single **left status rail** carries all state colour. Every list row is a 3 px coloured rail
  plus dense flat text on one surface.
- A **compact project pulse** row of bare numbers (open / ready / blocked / active / tracked).
  No cards, no shadows, no gradients, no coloured panels.
- Authority, readiness, freshness, source kind, and short `data_hash` are shown as a single
  provenance line, because trustworthiness of the analysis is the first thing a reader needs.
- All state is representable: loading, error, empty project, missing project, per-section
  degraded, and unavailable `bv`.
- Every pressable carries `accessibilityRole` and a descriptive `accessibilityLabel`; the pulse
  cells and status text are labelled too.
- Colours come only from `theme.colors`, and padding and font sizes respond to `layout.compact`.

## MVP scope

**In scope**

- Workspace panel at `workspace` and `explorer` locations, with refresh.
- Overview counts, authority/freshness state, triage picks, execution tracks, blockers, alerts.
- Bounded issue search and selectable issue detail.
- Composer attachment source for Beads issues across recent workspaces.
- Command Center items and `/beads`, `/bead` slash commands.
- Loading, error, empty, missing-project, and degraded states with accessibility labels.

**Out of scope**

- Any mutation: claim, close, update, create, dependency edits.
- Direct issue JSONL or database reading (only `.beads/metadata.json` is read for tracker detection and exact route binding).
- Plugin-side graph, readiness, or cycle computation.
- Cross-workspace aggregate dashboards; the panel is per-workspace.
- Sprint, forecast, capacity, burndown, history, and hotspot analyses that `bv` also offers.
- Settings screens, themes, timeline transformers, lifecycle hooks.
- Persistent storage of any kind.

## Test strategy

All tests run without a Beads repository. `bv` and the tracker CLIs are never required.

| Area | Approach |
| --- | --- |
| Normalization (`tests/normalize.test.ts`) | Fixtures shaped after real `bv v0.25` and `br 0.5` output. Asserts provenance folding, count reading, top_picks preference, unknown-status passthrough, single-element-array and bare-object detail shapes, snapshot text, and URL stability. Every normalized value is re-validated against its Zod schema. |
| Project classification | `classifyProject` asserted across ready, empty-but-ready, missing-via-JSON-envelope, missing-via-exit-message, and genuine-failure inputs. |
| Command safety (`tests/command.test.ts`) | Argv allowlist assertions; shell metacharacters proven to stay inside one argv value; query/limit bound clamping; issue-id and flag-shaped-id rejection before spawn; executable-name rejection. |
| Command error mapping | Real `node -e` child processes prove literal-argv handling, cwd honouring, timeout kill, output-cap kill, and non-zero exit capture; `interpretJsonOutcome` asserted for every error code. |
| Dashboard assembly (`tests/dashboard.test.ts`) | `bv` mocked at the command boundary with a fake Paseo API. Asserts healthy assembly, per-section degradation, provenance from a partial read, missing project, unavailable `bv` short-circuit, unresolved workspace short-circuit, and cache hit/no-cache-on-degraded behaviour. |
| Handlers (`tests/handlers.test.ts`) | Search sanitisation and error passthrough; tracker detection and refusal to guess; attachment `.beads` filtering, URL/resourceType/snapshot content, per-workspace failure isolation, result bounding and deduplication, and blank-query and list-failure short-circuits. |
| Client presentation (`tests/format.test.ts`) | Authority tone and label across complete/partial/failed/not-claim-safe sources; status and severity tone mapping including unknown values; relative age; distinct message per error code. |

Verification gate before install: `npm run typecheck`, `npm test`, and the `client/` mobile
audit with no hits.
