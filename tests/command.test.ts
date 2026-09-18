import { afterEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execPath } from "node:process";
import {
  DEFAULT_LIMITS,
  clearExecutableCache,
  interpretJsonOutcome,
  primeExecutableCache,
  resolveExecutable,
  runJsonCommand,
  runProcess,
  runTextCommand,
  summarizeStderr,
  type ProcessOutcome,
} from "../server/command";
import {
  bvCommandRequest,
  bvInvocation,
  clampSearchLimit,
  runTrackerShow,
  sanitizeSearchQuery,
  trackerShowInvocation,
} from "../server/bv";
import { ExpiringCache } from "../server/cache";
import { resolveTrackerFromPayload } from "../server/tracker";
import { detectTracker, readTrackerFromTriage } from "../server/workspace";
import { triagePayload } from "./fixtures";

const CWD = tmpdir();

function outcome(overrides: Partial<ProcessOutcome>): ProcessOutcome {
  return {
    exitCode: 0,
    signal: null,
    stdout: "",
    stderr: "",
    timedOut: false,
    truncated: false,
    ...overrides,
  };
}

afterEach(() => {
  clearExecutableCache();
});

describe("argv construction", () => {
  it("only ever emits allowlisted read-only bv commands", () => {
    expect(bvInvocation("version").args).toEqual(["--version"]);
    expect(bvInvocation("triage").args).toEqual(["--robot-triage", "--format", "json"]);
    expect(bvInvocation("plan").args).toEqual(["--robot-plan", "--format", "json"]);
    expect(bvInvocation("alerts").args).toEqual(["--robot-alerts", "--format", "json"]);
  });

  it("never invokes bare bv", () => {
    for (const command of ["version", "triage", "plan", "alerts"] as const) {
      expect(bvInvocation(command).args.length).toBeGreaterThan(0);
    }
  });

  it("passes the search query as one literal argv value", () => {
    const args = bvInvocation("search", { query: "login oauth", limit: 5 }).args;
    expect(args).toEqual(["--robot-search", "--search=login oauth", "--search-limit=5", "--format", "json"]);
  });

  it("keeps shell metacharacters inside a single argv value", () => {
    const query = sanitizeSearchQuery("a; rm -rf / && echo $(whoami) `id` | cat");
    expect(query).not.toBeNull();
    const args = bvInvocation("search", { query: query ?? "", limit: 5 }).args;
    const searchArgs = args.filter((arg) => arg.startsWith("--search="));
    expect(searchArgs).toHaveLength(1);
    expect(searchArgs[0]).toBe("--search=a; rm -rf / && echo $(whoami) `id` | cat");
  });

  it("rejects a search command without parameters", () => {
    expect(() => bvInvocation("search")).toThrow(/requires search parameters/);
  });

  it("clears ambient Beads routes on every bv request", () => {
    expect(bvCommandRequest("triage", "/repo").env).toEqual({
      BEADS_DIR: null,
      BEADS_DB: null,
      BEADS_JSONL: null,
      BD_DB: null,
    });
  });
});

describe("query and limit bounds", () => {
  it("collapses whitespace, strips control characters, and bounds length", () => {
    expect(sanitizeSearchQuery("  hello   world \n")).toBe("hello world");
    expect(sanitizeSearchQuery("a\u0000b\tc")).toBe("a b c");
    expect(sanitizeSearchQuery("   ")).toBeNull();
    expect(sanitizeSearchQuery("")).toBeNull();
    expect(sanitizeSearchQuery("x".repeat(500))?.length).toBe(120);
  });

  it("clamps the limit into the shared bounds", () => {
    expect(clampSearchLimit(undefined)).toBe(10);
    expect(clampSearchLimit(0)).toBe(1);
    expect(clampSearchLimit(-5)).toBe(1);
    expect(clampSearchLimit(1000)).toBe(25);
    expect(clampSearchLimit(7.9)).toBe(7);
    expect(clampSearchLimit(Number.NaN)).toBe(10);
  });
});

describe("outcome interpretation", () => {
  it("parses clean JSON", () => {
    const result = interpretJsonOutcome("bv", outcome({ stdout: '{"a":1}' }), (payload) => payload);
    expect(result).toEqual({ ok: true, value: { a: 1 } });
  });

  it("maps a timeout to the timeout code", () => {
    const result = interpretJsonOutcome("bv", outcome({ timedOut: true, exitCode: null }), (p) => p);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("timeout");
  });

  it("maps an output overrun to output_limit even with partial JSON present", () => {
    const result = interpretJsonOutcome("bv", outcome({ truncated: true, stdout: '{"a":' }), (p) => p);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("output_limit");
  });

  it("maps a non-zero exit with stderr to exit and keeps the exit code", () => {
    const result = interpretJsonOutcome(
      "bv",
      outcome({ exitCode: 1, stderr: "Error loading beads: failed to read beads directory" }),
      (p) => p,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("exit");
      expect(result.error.exitCode).toBe(1);
      expect(result.error.message).toContain("failed to read beads directory");
    }
  });

  it("treats valid JSON from a non-zero exit as a failure", () => {
    const result = interpretJsonOutcome(
      "bv",
      outcome({ exitCode: 1, stdout: '{"error":"failed to read beads directory"}' }),
      (p) => p,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("exit");
      expect(result.error.message).toContain("failed to read beads directory");
    }
  });

  it("prefers exit over invalid_json when the tool failed and printed prose", () => {
    const result = interpretJsonOutcome("bv", outcome({ exitCode: 1, stdout: "not json", stderr: "boom" }), (p) => p);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("exit");
  });

  it("maps unparseable output from a successful run to invalid_json", () => {
    const result = interpretJsonOutcome("bv", outcome({ stdout: "not json" }), (p) => p);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("invalid_json");
  });

  it("maps empty successful output to invalid_json", () => {
    const result = interpretJsonOutcome("bv", outcome({ stdout: "   " }), (p) => p);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("invalid_json");
  });

  it("maps a rejected payload shape to invalid_json with the reason", () => {
    const result = interpretJsonOutcome("bv", outcome({ stdout: "{}" }), () => {
      throw new Error("no issue record in the response");
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("invalid_json");
      expect(result.error.message).toContain("no issue record");
    }
  });

  it("summarizes stderr without leaking a huge blob", () => {
    expect(summarizeStderr("a\n\n  b   c ")).toBe("a b c");
    expect(summarizeStderr("x".repeat(1000)).length).toBe(401);
  });
});

describe("executable resolution", () => {
  it("refuses names that are not plain tool names", async () => {
    expect(await resolveExecutable("../../bin/sh")).toBeNull();
    expect(await resolveExecutable("bv; rm -rf /")).toBeNull();
    expect(await resolveExecutable("bv bv")).toBeNull();
    expect(await resolveExecutable(".")).toBeNull();
    expect(await resolveExecutable("..")).toBeNull();
  });

  it("reports unavailable when the binary is absent", async () => {
    primeExecutableCache("bv", null);
    const result = await runJsonCommand(
      { label: "bv --robot-triage", executableName: "bv", args: ["--robot-triage"], cwd: CWD },
      (payload) => payload,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("unavailable");
      expect(result.error.message).toContain("not found on the daemon PATH");
    }
  });

  it("reports unavailable for a text command when the binary is absent", async () => {
    primeExecutableCache("bv", null);
    const result = await runTextCommand({ label: "bv --version", executableName: "bv", args: ["--version"], cwd: CWD });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("unavailable");
  });
});

describe("process execution", () => {
  it("runs with a literal argv and no shell interpretation", async () => {
    const result = await runProcess({
      executable: execPath,
      args: ["-e", "console.log(process.argv[1])", "$HOME && echo pwned"],
      cwd: CWD,
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe("$HOME && echo pwned");
  });

  it("runs in the requested cwd", async () => {
    const result = await runProcess({
      executable: execPath,
      args: ["-e", "process.stdout.write(process.cwd())"],
      cwd: CWD,
    });
    expect(result.stdout).toContain(CWD.replace(/\/$/, ""));
  });

  it("can remove inherited tracker routing variables", async () => {
    const previous = process.env.BEADS_DB;
    process.env.BEADS_DB = "/wrong/project.db";
    try {
      const result = await runProcess({
        executable: execPath,
        args: ["-e", "process.stdout.write(String(process.env.BEADS_DB))"],
        cwd: CWD,
        env: { BEADS_DB: null },
      });
      expect(result.stdout).toBe("undefined");
    } finally {
      if (previous === undefined) delete process.env.BEADS_DB;
      else process.env.BEADS_DB = previous;
    }
  });

  it("kills a process that exceeds the timeout", async () => {
    const result = await runProcess({
      executable: execPath,
      args: ["-e", "setTimeout(() => {}, 10000)"],
      cwd: CWD,
      limits: { timeoutMs: 150, maxOutputBytes: DEFAULT_LIMITS.maxOutputBytes },
    });
    expect(result.timedOut).toBe(true);
    const mapped = interpretJsonOutcome("slow", result, (payload) => payload);
    expect(mapped.ok).toBe(false);
    if (!mapped.ok) expect(mapped.error.code).toBe("timeout");
  });

  it("settles after timeout even when a grandchild keeps the pipes open", async () => {
    const startedAt = Date.now();
    const script = [
      "const { spawn } = require('node:child_process');",
      "spawn(process.execPath, ['-e', 'setTimeout(() => {}, 1500)'], { stdio: ['ignore', process.stdout, process.stderr] });",
      "setTimeout(() => {}, 10000);",
    ].join("");
    const result = await runProcess({
      executable: execPath,
      args: ["-e", script],
      cwd: CWD,
      limits: { timeoutMs: 50, maxOutputBytes: DEFAULT_LIMITS.maxOutputBytes },
    });
    expect(result.timedOut).toBe(true);
    expect(Date.now() - startedAt).toBeLessThan(800);
  });

  it("kills a process that exceeds the output cap", async () => {
    const result = await runProcess({
      executable: execPath,
      args: ["-e", "for (let i = 0; i < 100000; i += 1) console.log('x'.repeat(200))"],
      cwd: CWD,
      limits: { timeoutMs: 10_000, maxOutputBytes: 4096 },
    });
    expect(result.truncated).toBe(true);
    const mapped = interpretJsonOutcome("loud", result, (payload) => payload);
    expect(mapped.ok).toBe(false);
    if (!mapped.ok) expect(mapped.error.code).toBe("output_limit");
  });

  it("captures a non-zero exit with its stderr", async () => {
    const result = await runProcess({
      executable: execPath,
      args: ["-e", "process.stderr.write('bad input'); process.exit(3)"],
      cwd: CWD,
    });
    expect(result.exitCode).toBe(3);
    const mapped = interpretJsonOutcome("failing", result, (payload) => payload);
    expect(mapped.ok).toBe(false);
    if (!mapped.ok) {
      expect(mapped.error.code).toBe("exit");
      expect(mapped.error.exitCode).toBe(3);
      expect(mapped.error.message).toContain("bad input");
    }
  });

  it("parses JSON through the full runJsonCommand path", async () => {
    primeExecutableCache("node-stub", execPath);
    const result = await runJsonCommand(
      {
        label: "stub",
        executableName: "node-stub",
        args: ["-e", "process.stdout.write(JSON.stringify({ ok: 1 }))"],
        cwd: CWD,
      },
      (payload) => payload,
    );
    expect(result).toEqual({ ok: true, value: { ok: 1 } });
  });
});

describe("tracker route resolution", () => {
  it("uses bv's selected source metadata for redirected br workspaces", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "paseo-beads-worktree-"));
    const trackerDirectory = await mkdtemp(join(tmpdir(), "paseo-beads-tracker-"));
    const beadsDirectory = join(trackerDirectory, ".beads");
    const database = join(beadsDirectory, "beads.db");
    await mkdir(beadsDirectory);
    await writeFile(database, "");
    await writeFile(
      join(beadsDirectory, "metadata.json"),
      JSON.stringify({ database: "beads.db", jsonl_export: "issues.jsonl" }),
    );
    primeExecutableCache("br", execPath);
    const resolution = await resolveTrackerFromPayload(
      {
        source_path: database,
        source_kind: "sqlite",
        triage: { recommendations: [{ actions: { tracker: "br" } }] },
      },
      workspace,
    );
    expect(resolution).toEqual({
      state: { kind: "br", available: true, detail: null },
      route: { kind: "br", beadsDirectory, database },
    });
  });

  it("fails detail routing closed when the declared database does not exist", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "paseo-beads-route-missing-"));
    await mkdir(join(workspace, ".beads"));
    await writeFile(join(workspace, ".beads", "metadata.json"), JSON.stringify({ database: "missing.db" }));
    primeExecutableCache("br", execPath);
    const resolution = await resolveTrackerFromPayload(
      {
        source_path: join(workspace, ".beads", "missing.db"),
        source_kind: "sqlite",
        triage: { recommendations: [{ actions: { tracker: "br" } }] },
      },
      workspace,
    );
    expect(resolution.route).toBeNull();
    expect(resolution.state).toMatchObject({ kind: "br", available: false });
  });
});

describe("tracker detail routing", () => {
  it("pins br to the exact database and disables automatic import and flush", () => {
    const route = { kind: "br" as const, beadsDirectory: "/repo/.beads", database: "/repo/.beads/beads.db" };
    expect(trackerShowInvocation(route, "pib-1")).toEqual({
      args: [
        "--db",
        "/repo/.beads/beads.db",
        "--no-auto-import",
        "--no-auto-flush",
        "show",
        "--json",
        "--",
        "pib-1",
      ],
      env: {
        BEADS_DIR: "/repo/.beads",
        BEADS_DB: "/repo/.beads/beads.db",
        BEADS_JSONL: null,
        BD_DB: "/repo/.beads/beads.db",
      },
    });
  });

  it("pins bd to its Dolt directory without br-only flags", () => {
    const route = { kind: "bd" as const, beadsDirectory: "/repo/.beads", database: "/repo/.beads" };
    expect(trackerShowInvocation(route, "pib-1")?.args).toEqual([
      "--db",
      "/repo/.beads",
      "show",
      "--json",
      "--",
      "pib-1",
    ]);
  });
});

describe("tracker detail reads", () => {
  it("refuses an issue id with unexpected characters before spawning", async () => {
    primeExecutableCache("br", execPath);
    const result = await runTrackerShow(
      { kind: "br", beadsDirectory: CWD, database: join(CWD, "beads.db") },
      CWD,
      "pib-1; rm -rf /",
      (payload) => payload,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("internal");
      expect(result.error.message).toContain("unexpected characters");
    }
  });

  it("refuses an id that could be read as a flag", async () => {
    primeExecutableCache("bd", execPath);
    for (const id of ["--json", "-x", "../etc/passwd", ""]) {
      const result = await runTrackerShow(
        { kind: "bd", beadsDirectory: CWD, database: CWD },
        CWD,
        id,
        (payload) => payload,
      );
      expect(result.ok).toBe(false);
    }
  });

  it("takes the tracker bv named in triage actions", () => {
    expect(readTrackerFromTriage(triagePayload)).toBe("bd");
    expect(readTrackerFromTriage({ triage: { recommendations: [{ actions: { tracker: "br" } }] } })).toBe("br");
    expect(
      readTrackerFromTriage({ triage: { quick_ref: { top_picks: [{ actions: { tracker: "br" } }] } } }),
    ).toBe("br");
    expect(readTrackerFromTriage({ triage: { recommendations: [{ actions: { tracker: "hg" } }] } })).toBeNull();
    expect(readTrackerFromTriage({})).toBeNull();
  });

  it("detects the tracker from workspace metadata when triage has no recommendation", async () => {
    const directory = await mkdtemp(join(tmpdir(), "paseo-beads-metadata-"));
    await mkdir(join(directory, ".beads"));
    await writeFile(join(directory, ".beads", "metadata.json"), JSON.stringify({ backend: "dolt" }));
    primeExecutableCache("bd", execPath);
    await expect(detectTracker({}, directory)).resolves.toEqual({ kind: "bd", available: true, detail: null });
  });
});

describe("short-lived result cache", () => {
  it("returns a value until it expires and never after", () => {
    let now = 1000;
    const cache = new ExpiringCache<string>(500, 8, () => now);
    cache.set("a", "one");
    expect(cache.get("a")).toBe("one");
    now = 1499;
    expect(cache.get("a")).toBe("one");
    now = 1500;
    expect(cache.get("a")).toBeNull();
    expect(cache.size).toBe(0);
  });

  it("bounds its own size and supports explicit clearing", () => {
    const cache = new ExpiringCache<number>(1000, 2);
    cache.set("a", 1);
    cache.set("b", 2);
    cache.set("c", 3);
    expect(cache.size).toBe(2);
    expect(cache.get("a")).toBeNull();
    cache.clear();
    expect(cache.size).toBe(0);
  });
});
