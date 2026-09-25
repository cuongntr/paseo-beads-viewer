import { describe, expect, it } from "vitest";
import {
  alertHeadline,
  authorityLabel,
  authorityTone,
  errorLabel,
  priorityLabel,
  priorityTone,
  relativeAge,
  severityTone,
  shortHash,
  statusIconName,
  statusLabel,
  activityLabel,
  stateDescription,
  stateTone,
  toneColor,
} from "../client/format";
import type { PluginTheme } from "@getpaseo/plugin";
import type { CommandErrorCode, SourceAuthority } from "../shared/beads";
import { normalizeSource } from "../server/normalize";
import { planPayload, triagePayload } from "./fixtures";

const theme: PluginTheme = {
  colors: {
    surface0: "#000",
    surface1: "#111",
    surface2: "#222",
    border: "#333",
    foreground: "#fff",
    foregroundMuted: "#aaa",
    accent: "#0af",
    accentForeground: "#000",
    statusSuccess: "#0a0",
    statusWarning: "#fa0",
    statusDanger: "#f00",
  },
};

function authority(overrides: Partial<SourceAuthority>): SourceAuthority {
  return {
    state: "complete",
    readiness: "proven",
    claimSafe: true,
    stale: false,
    loaded: 1,
    failed: 0,
    valid: 1,
    visible: 1,
    tombstones: 0,
    warnings: [],
    ...overrides,
  };
}

describe("authority presentation", () => {
  it("marks a complete, proven, fresh, claim-safe source as success", () => {
    expect(authorityTone(normalizeSource(planPayload)?.authority ?? null)).toBe("success");
    expect(authorityLabel(normalizeSource(planPayload)?.authority ?? null)).toBe("complete · proven · fresh");
  });

  it("marks a partial, provisional, stale source as a warning", () => {
    const parsed = normalizeSource(triagePayload)?.authority ?? null;
    expect(authorityTone(parsed)).toBe("warning");
    expect(authorityLabel(parsed)).toBe("partial · provisional · stale");
  });

  it("marks a failed or unknown source as danger", () => {
    expect(authorityTone(authority({ failed: 1 }))).toBe("danger");
    expect(authorityTone(authority({ state: "unknown", readiness: "provisional", claimSafe: false }))).toBe("danger");
  });

  it("warns when a source is proven but not claim-safe", () => {
    expect(authorityTone(authority({ claimSafe: false }))).toBe("warning");
  });

  it("stays neutral and honest when there is no authority at all", () => {
    expect(authorityTone(null)).toBe("neutral");
    expect(authorityLabel(null)).toBe("authority unknown");
  });
});

describe("status and severity tones", () => {
  it("shows a bare age: the update time, or the close time once done", () => {
    const now = Date.parse("2026-09-24T10:09:00Z");
    const base = { updatedAt: "2026-09-24T10:00:00Z", closedAt: null };
    expect(activityLabel({ ...base, state: "active" }, now)).toBe("9m ago");
    expect(activityLabel({ state: "done", updatedAt: "2026-09-20T00:00:00Z", closedAt: "2026-09-24T08:09:00Z" }, now)).toBe("2h ago");
    expect(activityLabel({ state: "ready", updatedAt: null, closedAt: null }, now)).toBeNull();
  });

  it("defines every work state in Beads' own terms", () => {
    expect(stateDescription("ready")).toContain("br ready");
    expect(stateDescription("waiting")).toContain("br blocked");
    expect(stateDescription("held")).toContain("blocked, deferred, draft or pinned");
  });

  it("colours derived work state, marking a custom status as an exception", () => {
    expect(stateTone("active")).toBe("accent");
    expect(stateTone("ready")).toBe("success");
    expect(stateTone("held")).toBe("danger");
    expect(stateTone("other")).toBe("warning");
    expect(stateTone("waiting")).toBe("neutral");
    expect(stateTone("done")).toBe("neutral");
  });

  it("encodes priority as the primary tone with lower priorities neutral", () => {
    expect(priorityTone(0)).toBe("danger");
    expect(priorityTone(1)).toBe("warning");
    expect(priorityTone(2)).toBe("accent");
    expect(priorityTone(3)).toBe("neutral");
    expect(priorityTone(9)).toBe("neutral");
    expect(priorityTone(null)).toBe("neutral");
  });

  it("gives Beads' built-in statuses an icon and every custom status the neutral one", () => {
    expect(statusIconName("in_progress")).toBe("Play");
    expect(statusIconName("hooked")).toBe("Play");
    expect(statusIconName("blocked")).toBe("CircleSlash");
    expect(statusIconName("deferred")).toBe("CircleSlash");
    expect(statusIconName("open")).toBe("Circle");
    expect(statusIconName("closed")).toBe("CircleCheck");
    // Spellings Beads does not define get no borrowed meaning.
    expect(statusIconName("In Progress")).toBe("CircleDashed");
    expect(statusIconName("done")).toBe("CircleDashed");
    expect(statusIconName("awaiting_review")).toBe("CircleDashed");
  });

  it("labels opaque statuses readably", () => {
    expect(statusLabel("in_progress")).toBe("in progress");
    expect(statusLabel("needs-review")).toBe("needs review");
    expect(statusLabel("  ")).toBe("unknown");
  });

  it("maps known severities and leaves unknown ones neutral", () => {
    expect(severityTone("critical")).toBe("danger");
    expect(severityTone("WARNING")).toBe("warning");
    expect(severityTone("info")).toBe("neutral");
    expect(severityTone("notice")).toBe("neutral");
  });

  it("resolves every tone to a theme token", () => {
    for (const tone of ["neutral", "accent", "success", "warning", "danger"] as const) {
      expect(Object.values(theme.colors)).toContain(toneColor(theme, tone));
    }
  });
});

describe("compact labels", () => {
  it("formats priority and hashes", () => {
    expect(priorityLabel(0)).toBe("P0");
    expect(priorityLabel(null)).toBeNull();
    expect(shortHash("abcdef0123456789")).toBe("abcdef01");
    expect(shortHash(null)).toBeNull();
    expect(shortHash("")).toBeNull();
  });

  it("formats freshness relative to now", () => {
    const now = Date.parse("2026-09-18T00:00:00Z");
    expect(relativeAge("2026-09-18T00:00:00Z", now)).toBe("0s ago");
    expect(relativeAge("2026-09-17T23:59:30Z", now)).toBe("30s ago");
    expect(relativeAge("2026-09-17T23:30:00Z", now)).toBe("30m ago");
    expect(relativeAge("2026-09-17T00:00:00Z", now)).toBe("24h ago");
    expect(relativeAge("2026-09-10T00:00:00Z", now)).toBe("8d ago");
    expect(relativeAge("not a date", now)).toBeNull();
    expect(relativeAge(null, now)).toBeNull();
  });

  it("prefixes an alert with its issue id only when it has one", () => {
    const base = { type: "stale_issue", severity: "warning", detectedAt: null, suggestedAction: null, labels: [] };
    expect(alertHeadline({ ...base, message: "inactive", issueId: "pib-1" })).toBe("pib-1 — inactive");
    expect(alertHeadline({ ...base, message: "cycle detected", issueId: null })).toBe("cycle detected");
  });
});

describe("error labels", () => {
  it("produces a distinct message for every error code", () => {
    const codes: readonly CommandErrorCode[] = [
      "unavailable",
      "timeout",
      "exit",
      "output_limit",
      "invalid_json",
      "cwd_invalid",
      "workspace_unresolved",
      "tracker_unknown",
      "internal",
    ];
    const labels = codes.map((code) => errorLabel({ code, message: `msg-${code}`, exitCode: null }));
    for (const label of labels) expect(label.length).toBeGreaterThan(0);
    expect(new Set(labels).size).toBe(codes.length);
  });

  it("never implies a mutation and stays honest with no error object", () => {
    expect(errorLabel(null)).toBe("Unavailable.");
    const label = errorLabel({ code: "unavailable", message: "bv missing", exitCode: null });
    expect(label).toContain("bv is unavailable");
  });
});
