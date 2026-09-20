# paseo-beads

A read-only Beads console for Paseo workspaces. It surfaces project pulse, triage picks,
execution tracks, blockers, and alerts for the workspace you are in, plus a read-only
whole-project board, issue search, Markdown-rendered issue detail, and a composer attachment
source for Beads issues.

The plugin never invokes a mutating `br` or `bd` command. There is no claim, close,
update, or create path in the code. `bv` may refresh its own compatibility export while
loading a `bd`/Dolt workspace, so `bv` calls are serialized per workspace.

## Requirements

- Paseo `>=0.8.0` (daemon and app).
- The [`bv`](https://github.com/Dicklesworthstone/beads_viewer) analysis CLI on the daemon machine's `PATH`.
  Verified against `bv v0.25.0`.
- A project that uses Beads through `br` or `bd`. The tracker CLI matching the project must
  also be on the daemon `PATH` for issue detail; the dashboard works without it.

Everything else degrades gracefully: a missing `bv`, a workspace without a `.beads` source,
and an empty-but-healthy project are three distinct, clearly labelled states.

## Development

```bash
npm install
npm run typecheck
npm test
```

Mobile audit — a hit here is a bug:

```bash
rg -n "document\.|window\.|localStorage|navigator\.|<[a-z]+[ >]|className=|onClick=" client/
```

## Install

```bash
npm run typecheck && npm test
paseo plugin install /absolute/path/to/paseo-beads
paseo plugin ls        # expect paseo-beads running
paseo plugin logs paseo-beads
```

After editing source, run `paseo plugin reload paseo-beads`.

## What it contributes

| Contribution | Where |
| --- | --- |
| Workspace panel `beads` ("Beads") | Workspace tab bar and the Explorer |
| Command Center: **Open Beads** | Workspace context |
| Command Center: **Refresh Beads triage** | Workspace context; re-reads `bv` then opens the panel |
| Slash command `/beads` | Opens the panel for the current workspace |
| Slash command `/bead <issue-id>` | Opens the panel with that issue selected |
| Attachment source **Beads issue** | Composer attachment picker |

## Security and read-only behaviour

- Only the daemon-side `server/` code touches Node, the process table, or the filesystem.
  Client code imports no Node module.
- Subprocesses are spawned with `spawn` using a **literal argv** and an absolute executable
  path resolved by scanning `PATH` directly. `shell` is never enabled, so no input can be
  interpreted as a shell operator.
- The working directory always comes from Paseo's own workspace record
  (`paseo.workspaces.ref(id).refresh()`), never from client input, and must be an existing
  absolute directory.
- Only an explicit allowlist of read-only commands can run: `bv --version`,
  `bv --robot-triage`, `bv --robot-plan`, `bv --robot-alerts`, `bv --robot-graph`,
  `bv --robot-search`, and
  `<tracker> --db <validated-route> show --json -- <id>`. `br` detail reads also pass
  `--no-auto-import --no-auto-flush`. Bare `bv` is never invoked.
- The search query is whitespace-collapsed, control-character-stripped, length-bounded, and
  passed as a single argv value. Issue ids are pattern-checked and passed after `--` so an id
  can never be read as a flag.
- `bv` calls clear inherited `BEADS_DIR`, `BEADS_DB`, `BEADS_JSONL`, and `BD_DB` values so
  daemon-level environment configuration cannot redirect a workspace read. Tracker detail calls set those
  variables only to the validated route.
- Every subprocess has a timeout and an output size cap, and is killed when either is
  exceeded. Unavailable binary, timeout, non-zero exit, oversized output, and malformed JSON
  are reported as distinct error codes. Plugin cleanup kills any process still running.
- Plugin code never parses or writes `.beads/*.jsonl` or a Beads SQLite/Dolt database. It reads
  only `.beads/metadata.json` to bind tracker identity to `bv`'s selected source; issue data comes
  from CLI output. `bv` itself may refresh a `bd` compatibility export, so its calls are serialized.
- No graph, readiness, or cycle analysis is computed in the plugin. `bv --robot-*` is the sole
  analysis authority, and its `source_authority`, freshness, and `data_hash` are shown as
  reported.
- Only short-lived normalized command results are cached (15 s for the dashboard, 2 min for
  tracker identity and its validated route), invalidated purely by expiry. No derived graph is
  ever cached.

## Limitations

- Read-only by design. Claiming, closing, and editing issues stay in `br`/`bd`.
- Issue detail requires an exact tracker and database route. The plugin checks `bv`, then the
  selected source's `.beads/metadata.json`; if identity or routing remains inconclusive, detail
  reads are disabled rather than guessed.
- Attachment search has no workspace context, so it scans a bounded set of recently active
  Paseo workspaces, searches at most 4 Beads-enabled ones, and returns at most 8 items. An
  issue in a workspace outside that window will not appear.
- Search relevance, ranking, and analysis semantics are entirely `bv`'s; the plugin only
  reshapes them.
- Statuses, readiness values, and alert severities are treated as opaque strings, so a newer
  `bv` renders without a plugin update but without bespoke styling for new values.
- The **Board** view shows every issue `bv --robot-graph` reports, grouped by that issue's own
  status. Closed lanes start collapsed, each lane renders at most 60 cards with the rest reported
  as `+N more`, and a project past 2000 issues drops closed issues from the payload first and says
  so. Assignee and type come from triage, so they appear only on issues triage also surfaced. If
  the graph read fails the board falls back to the capped triage+plan working set and relabels
  itself. It is read-only: no drag, no drop, no status change.
- Issue prose renders through a bounded in-repo Markdown subset (headings h1–h3, lists, task
  items, quotes, rules, code, bold, italic, links). HTML, images, and tables are not rendered,
  and link targets are shown as text — the panel never opens a URL.
