# Technical Design: beads-viewer (read-only MVP)

> The plugin shipped as `paseo-beads` until 0.2.0. That id already belonged to another plugin on
> paseo.cafe, so the plugin id, npm package and attachment URL scheme are now `beads-viewer`.

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
panel.tsx        TanStack Query UI     beads.ts  Zod types         dashboard.ts  triage+plan+alerts
rows.tsx         priority-rail rows    rpc.ts    RPC contracts     search.ts     robot-search
board.ts         columns + filter                attachment source issue.ts      tracker show/list
board-view.tsx   read-only board                                  attachments.ts workspace fanout
markdown.ts      bounded md parser                                tracker.ts    br vs bd identity
markdown-view.tsx md renderer
styles.ts        theme tokens
format.ts        labels, tones, icons
focus.ts         slash-command → panel
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

A quiet dependency and workstream console shaped as a **workbench**, not a SaaS dashboard.

- **Layout responds to `layout.compact`** (the only layout signal in the panel contract; `width`
  is not available).
  - Non-compact: a fixed-height workbench. Header and a project pulse/provenance summary sit at
    the top; below them a master/detail pair fills the remaining panel height with two
    **independent scroll regions**. The left pane holds the view switcher, a persistent search
    input, and the scrollable list; the right pane is the issue inspector. Selecting any issue —
    including a search result — renders detail immediately in the inspector, never appended after
    the dashboard.
  - Compact: the dashboard is one scrolling screen; selecting an issue replaces it with a
    dedicated, independently scrollable detail screen with a Back action. No bottom sheet, no
    absolute positioning.
- **Views answer the reader's questions, not `bv`'s section names.** `Overview` (default) says how
  far along the project is and what to do next: done/total over work with a progress bar, counts
  per work state, `bv`'s closing pace, progress per top-level issue and per parent, then In
  progress, Held, Ready now (ranked by `bv`'s triage score within priority), Other status, the
  project's labels over open work, and the critical chain. `Board` lays every piece of work out by state. `Plan` is `bv`'s execution tracks with
  containers removed. `Risks` leads with what needs a decision. Tabs use `tablist`/`tab` roles and
  `accessibilityState.selected`; a view whose backing section is unavailable shows `—`.
- **Pane proportions follow the view.** List views give the master pane slightly more room than the
  inspector (5:4); `Board` is board-dominant (7:3) and keeps the inspector reachable. With nothing
  selected the inspector is absent and the master pane takes the width.
- **Search is always reachable** from the toolbar. Submitting a query temporarily replaces the
  list with search results and shows an explicit back control returning to the active view.
- **The whole project comes from `bv --robot-graph`**, the one `bv` read that returns every issue
  rather than an analysis-selected subset. Type and assignee come from one extra read, `<tracker>
  list --fields id,issue_type,assignee --format csv`, because the graph carries neither; the
  tracker's JSON form was rejected as the source since it embeds every description and measured
  2.5 MB against the 24 KB of that CSV. The CSV is read with a real RFC 4180 reader, not by
  splitting lines: `br` quoted 167 of 784 rows when asked for a free-text column. A truncated or
  malformed read reports no overlay at all rather than a partial one. Triage and plan stay
  enrichment — score, suggested action, track membership — and never decide which issues exist.
- **Decision (reverses the MVP boundary): the plugin derives work state and the critical chain.**
  The MVP kept every readiness and critical-path result inside `bv`. Measured on a real 28-issue
  project, the panel built that way said "0 blocked · 12 ready" and put "blocked by 1" on the two
  top triage picks, while the truth was 15 issues waiting on dependencies, 5 startable tasks, and
  those two picks ready. Three causes, all verified against `bv v0.25.0` output: `blocked_count`
  counts only the `blocked` *status*; `actionable_count` counts containers; and a `blocks` edge stays in
  the graph after its blocker closes. So the server keeps only open blockers per issue, and
  `client/project.ts` derives each issue's state (done, in progress, held, waiting on an open
  blocker, ready) from its status and those blockers. Work under an open container that has an open
  blocker waits too, which is what `bv` does (its plan omits such a child and counts it in
  `dependency_blocked`); a container's blocker inside its own subtree is not inherited, so an epic
  that waits on its own tasks does not freeze them. An issue is *work* when no issue names it as
  parent and a *container* otherwise, with children counted server-side before truncation; only
  work is counted, carded, and ranked. The same open edges, inherited ones included, give the
  longest remaining chain of dependencies between work items. A cycle among open work makes
  the chain's depths depend on traversal order, so the panel then claims no chain and reports the
  cycle instead. `bv --robot-insights` reports slack, but
  caps that list by value on large projects (50 of 894 entries) and drops exactly the zero-slack
  issues, so it cannot supply the chain. `bv` remains the authority for ranking, recommendations,
  execution tracks, alerts, cycle detection, and velocity; the derived headline counts were checked
  against `bv`'s own `dependency_blocked` on two real projects and agree. Reopen this if `bv` gains
  a status-independent waiting count and a work-only ready count.
- **Decision: the panel interprets only what Beads and `bv` define, or what the data's structure
  says; it serves every project, not one.** An earlier cut of this redesign read "needs a human"
  from a fixed list of label spellings (`human-approval`, `needs-human`, …), grouped features by a
  `feature:` prefix, and mapped status spellings such as `done` or `review` onto meanings. Each was
  one project's convention: verified against `br 0.5.12`, Beads has no human-attention field, its
  built-in statuses are `open, in_progress, blocked, deferred, draft, closed, tombstone, pinned`
  (plus `bd`'s `hooked`), and anything else is custom, declared in `.beads/policy.yaml`. So:
  built-in statuses map to work states and a custom status lands in `Other status`, shown
  verbatim; groups come only from parent links; labels are shown and counted as written, a label
  on every open item is set aside because it distinguishes nothing, and the board's filter
  offers only the parents and labels the project's data has. A project that
  wants to keep agents off some work already has `bv`'s own `BV_ROBOT_NOT_READY_LABELS`.
- **Groups follow parent links.** Work is grouped by its direct parent under its top-level
  ancestor, whatever a project calls those levels. Grouping straight to the top level, as the MVP
  did, put a real 28-issue project in one group. Groups sort by id with numbers compared
  numerically, so `x.2` precedes `x.10`; parentless work sinks to a catch-all. Walks up the
  parent chain stop on a cycle or an absent parent.
- **The board is a plain board: columns by state, grouping by filter.** One column per derived
  state in the order work moves — Ready, Waiting (both not started), In progress, Held, Other
  status, Done — each one list with its own scroll; `Held` and `Other status` appear only when non-empty
  and `Done` only when the reader asks. Each column prints its definition under its title:
  Ready and Waiting were checked issue for issue against `br ready` and `br blocked` on a real
  project and match, containers aside. A first cut laid lanes (parent, label, …) across those
  columns. In use that matrix left most cells empty, repeated a card in every label lane it
  carried, and made the reader scan two ways at once — and it is not what boards do: GitHub
  Projects, Linear and Jira all default to plain columns, with swimlanes an opt-in. So grouping
  became a filter that narrows every column at once (a parent's whole subtree, or one of the
  project's labels, with options discovered from the data), and every card names its direct
  parent instead of sitting under it. Compact turns the columns into a state picker over one
  list. There is no drag, drop, or mutation control.
- **Edge direction is data, not intuition.** `bv --robot-graph` emits `blocks` as `from` → `to`
  meaning from-is-blocked-by-to, but `parent-child` as child → parent. Both were established by
  cross-checking `br show --json` on real repositories, after reading them the same way produced a
  tree that disagreed with the repository's own dotted-id convention on 620 of 620 edges.
  `discovered-from` and `related` are ignored: neither implies containment or ordering.
- **The board bounds itself out loud.** `BOARD_ISSUE_LIMIT` (2000, ~553 KB at a measured 283 B per
  issue with the type/assignee overlay) drops closed issues first so open work is never the part
  that goes missing, then keeps closed ancestors of open work so grouping survives, and the
  status line and Overview say closed issues were left out; `BOARD_COLUMN_CARD_LIMIT`
  (60) caps cards per column and reports the remainder as `+N more`.
- **Work state owns the colour channel.** Every work row and card is a 3 px rail coloured by state
  (in progress accent, ready success, held danger, waiting and done neutral, all from
  `theme.colors`). The MVP gave the channel to priority; on a project where every issue is P1 that
  painted every card the same colour. Priority is shown only when live work actually differs in
  it. Rows with no work state keep their own semantics: alerts use severity, keystones use
  actionability, search results use accent.
- **Facets name the exceptions.** The identifier anchors the row; after it come only facts that
  tell work apart — a raw status the state does not already say, assignee, "critical chain", the
  type and priority only when open work differs in them, up to three of the project's labels as
  written (leaving out any label every open item carries), the open blockers by id ("waits on
  x, y +2"), and how many open issues it unblocks. Accessibility labels keep every fact.
- **The status line reports the project, then freshness.** `done/total · ready · waiting · in
  progress · held · read Ns ago`. Source provenance (`complete · proven · fresh`) is a diagnostic,
  so it appears only when the source is not healthy; the header rail colour carries it otherwise.
- **Risks count only what needs a decision.** Stuck work (held by a `blocked`-like status, not
  deliberately `deferred`), a dependency cycle, and critical or warning alerts. The badge is `—`
  and the all-clear sentence is withheld unless alerts, `bv`'s cycle check, and the whole graph
  were all read. Informational alerts are folded behind a toggle and keystones (`bv`'s blockers to
  clear) are listed without counting, because a heuristic "potential duplicate" alert on ten
  issues sharing boilerplate once made the badge read 15 on a project with nothing at risk.

## MVP scope

**In scope**

- Workspace panel at `workspace` and `explorer` locations, with refresh.
- An Overview of progress per top-level issue and parent, work by derived state, the project's
  labels over open work, and the critical chain; execution tracks; held work, cycles, alerts, and keystones.
- A read-only whole-project `Board` with one column per derived work state and a filter by parent
  or label, sourced from `bv --robot-graph` plus the tracker's type/assignee CSV, with a bounded
  payload.
- Bounded issue search and selectable issue detail, with issue prose and comments rendered through
  the bounded Markdown subset.
- Composer attachment source for Beads issues across recent workspaces.
- Command Center items and `/beads`, `/bead` slash commands.
- Loading, error, empty, missing-project, and degraded states with accessibility labels.

**Out of scope**

- Any mutation: claim, close, update, create, dependency edits — including drag-and-drop status
  changes on the `Board` view.
- Full CommonMark: HTML, images, tables, reference links, footnotes, and setext headings are out,
  and no Markdown package is added as a runtime dependency.
- Opening links. Rendered link targets are shown as text; `Linking` is never invoked.
- Direct issue JSONL or database reading (only `.beads/metadata.json` is read for tracker detection and exact route binding).
- Plugin-side ranking, cycle detection, or any analysis beyond work state and the critical chain
  (see the decision above).
- Cross-workspace aggregate dashboards; the panel is per-workspace.
- Sprint, forecast, capacity, burndown, history, and hotspot analyses that `bv` also offers.
- Settings screens, themes, timeline transformers, lifecycle hooks.
- Persistent storage of any kind.

## Test strategy

All tests run without a Beads repository. `bv` and the tracker CLIs are never required.

| Area | Approach |
| --- | --- |
| Normalization (`tests/normalize.test.ts`) | Fixtures shaped after real `bv v0.25` and `br 0.5` output. Asserts provenance folding, count reading including `dependency_blocked` and velocity, closed blockers dropped from graph edges, top_picks preference, unknown-status passthrough, single-element-array and bare-object detail shapes, snapshot text, and URL stability. Every normalized value is re-validated against its Zod schema. |
| Project classification | `classifyProject` asserted across ready, empty-but-ready, missing-via-JSON-envelope, missing-via-exit-message, and genuine-failure inputs. |
| Command safety (`tests/command.test.ts`) | Argv allowlist assertions; shell metacharacters proven to stay inside one argv value; query/limit bound clamping; issue-id and flag-shaped-id rejection before spawn; executable-name rejection. |
| Command error mapping | Real `node -e` child processes prove literal-argv handling, cwd honouring, timeout kill, output-cap kill, and non-zero exit capture; `interpretJsonOutcome` asserted for every error code. |
| Dashboard assembly (`tests/dashboard.test.ts`) | `bv` mocked at the command boundary with a fake Paseo API. Asserts healthy assembly, per-section degradation, provenance from a partial read, missing project, unavailable `bv` short-circuit, unresolved workspace short-circuit, and cache hit/no-cache-on-degraded behaviour. |
| Handlers (`tests/handlers.test.ts`) | Search sanitisation and error passthrough; tracker detection and refusal to guess; attachment `.beads` filtering, URL/resourceType/snapshot content, per-workspace failure isolation, result bounding and deduplication, and blank-query and list-failure short-circuits. |
| Client presentation (`tests/format.test.ts`) | Authority tone and label across complete/partial/failed/not-claim-safe sources; priority tone mapping; Lucide status icon and status label mapping including unknown values; status and severity tone mapping; relative age; distinct message per error code. |
| Markdown subset (`tests/markdown.test.ts`) | Block and inline parsing for every supported construct; malformed and unclosed emphasis, code, links, and fences degrading to plain text; adversarial marker soup proven not to throw; character, line, block, code-line, inline-segment, and nesting bounds asserted against the exported constants. |
| Project model (`tests/project.test.ts`) | Work state from status and open blockers, built-in statuses only, custom statuses kept apart, tombstones dropped; containers excluded from work and counts; labels counted as written with common labels set aside; parent and top-level grouping with numeric id order and a sinking catch-all; settled groups; cyclic parent chains; critical chain order, tie-break stability, cycles, and a 5000-step chain without stack overflow; ranking order; triage and plan enrichment; working-set fallback. |
| Board layout (`tests/board.test.ts`) | Columns by derived state with conditional held, other and done; every work item in exactly one column and containers never carded; project order within a column; per-column caps; filter options discovered from parents and labels; subtree, parent and label filtering; fallback when a filter no longer matches; each card's parent context. |

Verification gate before install: `npm run typecheck`, `npm test`, and the `client/` mobile
audit with no hits.
