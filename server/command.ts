import { access, constants } from "node:fs/promises";
import { delimiter, isAbsolute, join } from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import type { CommandError, CommandErrorCode } from "../shared/beads";

export interface CommandLimits {
  readonly timeoutMs: number;
  readonly maxOutputBytes: number;
}

export const DEFAULT_LIMITS: CommandLimits = {
  timeoutMs: 20_000,
  maxOutputBytes: 4 * 1024 * 1024,
};

/** Raw process outcome, before it is interpreted as JSON. */
export interface ProcessOutcome {
  readonly exitCode: number | null;
  readonly signal: string | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut: boolean;
  readonly truncated: boolean;
}

export type CommandResult<Value> =
  | { readonly ok: true; readonly value: Value }
  | { readonly ok: false; readonly error: CommandError };

function commandError(code: CommandErrorCode, message: string, exitCode: number | null = null): CommandError {
  return { code, message, exitCode };
}

export function failure(code: CommandErrorCode, message: string, exitCode: number | null = null): CommandResult<never> {
  return { ok: false, error: commandError(code, message, exitCode) };
}

/** Keeps stderr useful without leaking a multi-megabyte blob into the UI. */
export function summarizeStderr(stderr: string, maxLength = 400): string {
  const collapsed = stderr.replace(/\s+/g, " ").trim();
  if (collapsed.length <= maxLength) return collapsed;
  return `${collapsed.slice(0, maxLength)}…`;
}

const executableCache = new Map<string, string | null>();
const activeProcesses = new Set<ChildProcess>();

async function isExecutableFile(candidate: string): Promise<boolean> {
  try {
    await access(candidate, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolves a bare tool name to an absolute path by scanning `PATH` directly.
 * No shell is involved, so `PATH` entries cannot inject arguments or operators.
 */
export async function resolveExecutable(name: string): Promise<string | null> {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(name)) return null;
  const cached = executableCache.get(name);
  if (cached !== undefined) return cached;

  const searchPath = process.env.PATH ?? "";
  let resolved: string | null = null;
  for (const entry of searchPath.split(delimiter)) {
    if (entry.length === 0) continue;
    if (!isAbsolute(entry)) continue;
    const candidate = join(entry, name);
    if (await isExecutableFile(candidate)) {
      resolved = candidate;
      break;
    }
  }
  // Do not cache misses: installing a missing CLI should take effect on the next
  // explicit refresh without requiring a plugin reload.
  if (resolved !== null) executableCache.set(name, resolved);
  return resolved;
}

/** Test seam: lets unit tests exercise resolution failures without touching `PATH`. */
export function primeExecutableCache(name: string, value: string | null): void {
  executableCache.set(name, value);
}

export function clearExecutableCache(): void {
  executableCache.clear();
}

/** Terminates every process this module still owns. Used by plugin cleanup. */
export function killActiveProcesses(): void {
  for (const child of activeProcesses) {
    child.kill("SIGKILL");
  }
  activeProcesses.clear();
}

export type BeadsEnvironment = Readonly<
  Partial<Record<"BEADS_DIR" | "BEADS_DB" | "BEADS_JSONL" | "BD_DB", string | null>>
>;

function childEnvironment(overrides: BeadsEnvironment | undefined): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, NO_COLOR: "1", CLICOLOR: "0" };
  if (overrides === undefined) return env;
  for (const [key, value] of Object.entries(overrides)) {
    if (value === null) delete env[key];
    else env[key] = value;
  }
  return env;
}

export interface SpawnRequest {
  /** Absolute path to the executable. Never a shell string. */
  readonly executable: string;
  /** Literal argv. Values are passed verbatim; no interpolation, no shell. */
  readonly args: readonly string[];
  readonly cwd: string;
  readonly limits?: CommandLimits;
  readonly env?: BeadsEnvironment;
}

/**
 * Spawns a process with a literal argv, a fixed cwd, a hard timeout, and an
 * output cap. `shell` is never enabled.
 */
export async function runProcess(request: SpawnRequest): Promise<ProcessOutcome> {
  const limits = request.limits ?? DEFAULT_LIMITS;
  return await new Promise<ProcessOutcome>((resolve, reject) => {
    const child = spawn(request.executable, [...request.args], {
      cwd: request.cwd,
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: childEnvironment(request.env),
    });
    activeProcesses.add(child);

    let stdout = "";
    let stderr = "";
    let stdoutBytes = 0;
    let truncated = false;
    let timedOut = false;
    let settled = false;
    let killGraceTimer: NodeJS.Timeout | null = null;

    const finish = (outcome: ProcessOutcome): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (killGraceTimer !== null) clearTimeout(killGraceTimer);
      activeProcesses.delete(child);
      resolve(outcome);
    };

    // A grandchild can inherit the pipes and prevent `close` after this child is
    // killed. Bound that case too, otherwise one timeout can pin the per-workspace queue.
    const killAndBoundClose = (): void => {
      child.kill("SIGKILL");
      if (killGraceTimer !== null) return;
      killGraceTimer = setTimeout(() => {
        child.stdout?.destroy();
        child.stderr?.destroy();
        finish({
          exitCode: child.exitCode,
          signal: child.signalCode,
          stdout,
          stderr,
          timedOut,
          truncated,
        });
      }, 250);
    };

    const timer = setTimeout(() => {
      timedOut = true;
      killAndBoundClose();
    }, limits.timeoutMs);

    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      stdoutBytes += Buffer.byteLength(chunk, "utf8");
      if (stdoutBytes > limits.maxOutputBytes) {
        if (!truncated) {
          truncated = true;
          killAndBoundClose();
        }
        return;
      }
      stdout += chunk;
    });
    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk: string) => {
      if (stderr.length < 8192) stderr += chunk;
    });

    child.on("error", (error: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (killGraceTimer !== null) clearTimeout(killGraceTimer);
      activeProcesses.delete(child);
      reject(error);
    });

    child.on("close", (exitCode: number | null, signal: NodeJS.Signals | null) => {
      finish({ exitCode, signal, stdout, stderr, timedOut, truncated });
    });
  });
}

/**
 * Maps a raw process outcome onto the plugin's error taxonomy. Timeout, output
 * overrun, non-zero exit, and malformed JSON stay distinguishable.
 */
export function interpretJsonOutcome<Value>(
  label: string,
  outcome: ProcessOutcome,
  parse: (payload: unknown) => Value,
): CommandResult<Value> {
  if (outcome.truncated) {
    return failure("output_limit", `${label} produced more output than the plugin accepts.`, outcome.exitCode);
  }
  if (outcome.timedOut) {
    return failure("timeout", `${label} timed out.`, outcome.exitCode);
  }

  const trimmed = outcome.stdout.trim();
  if (trimmed.length === 0) {
    const detail = summarizeStderr(outcome.stderr);
    if (outcome.exitCode === 0) {
      return failure("invalid_json", `${label} returned no output.`, outcome.exitCode);
    }
    return failure(
      "exit",
      detail.length > 0 ? `${label} failed: ${detail}` : `${label} failed with exit code ${outcome.exitCode ?? "unknown"}.`,
      outcome.exitCode,
    );
  }

  let payload: unknown;
  try {
    payload = JSON.parse(trimmed) as unknown;
  } catch {
    if (outcome.exitCode !== 0) {
      const detail = summarizeStderr(outcome.stderr);
      return failure(
        "exit",
        detail.length > 0 ? `${label} failed: ${detail}` : `${label} failed with exit code ${outcome.exitCode ?? "unknown"}.`,
        outcome.exitCode,
      );
    }
    return failure("invalid_json", `${label} returned output that is not JSON.`, outcome.exitCode);
  }

  if (outcome.exitCode !== 0) {
    const record = typeof payload === "object" && payload !== null && !Array.isArray(payload) ? payload as Record<string, unknown> : null;
    const payloadError = typeof record?.["error"] === "string" ? record["error"].trim() : "";
    const stderrDetail = summarizeStderr(outcome.stderr);
    const detail = payloadError || stderrDetail;
    return failure(
      "exit",
      detail.length > 0 ? `${label} failed: ${detail}` : `${label} failed with exit code ${outcome.exitCode}.`,
      outcome.exitCode,
    );
  }

  try {
    return { ok: true, value: parse(payload) };
  } catch (error) {
    const message = error instanceof Error ? error.message : "unrecognized payload";
    return failure("invalid_json", `${label} returned an unexpected payload: ${message}`, outcome.exitCode);
  }
}

export interface JsonCommandRequest {
  readonly label: string;
  readonly executableName: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly limits?: CommandLimits;
  readonly env?: BeadsEnvironment;
}

/** Resolves the executable, runs it, and interprets its stdout as JSON. */
export async function runJsonCommand<Value>(
  request: JsonCommandRequest,
  parse: (payload: unknown) => Value,
): Promise<CommandResult<Value>> {
  const executable = await resolveExecutable(request.executableName);
  if (executable === null) {
    return failure("unavailable", `${request.executableName} was not found on the daemon PATH.`);
  }

  let outcome: ProcessOutcome;
  try {
    outcome = await runProcess({
      executable,
      args: request.args,
      cwd: request.cwd,
      limits: request.limits,
      env: request.env,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "spawn failed";
    return failure("unavailable", `${request.label} could not start: ${message}`);
  }

  return interpretJsonOutcome(request.label, outcome, parse);
}

/** Runs a command purely for its text output, e.g. `--version`. */
export async function runTextCommand(request: JsonCommandRequest): Promise<CommandResult<string>> {
  const executable = await resolveExecutable(request.executableName);
  if (executable === null) {
    return failure("unavailable", `${request.executableName} was not found on the daemon PATH.`);
  }
  let outcome: ProcessOutcome;
  try {
    outcome = await runProcess({
      executable,
      args: request.args,
      cwd: request.cwd,
      limits: request.limits,
      env: request.env,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "spawn failed";
    return failure("unavailable", `${request.label} could not start: ${message}`);
  }
  if (outcome.truncated) return failure("output_limit", `${request.label} produced more output than the plugin accepts.`, outcome.exitCode);
  if (outcome.timedOut) return failure("timeout", `${request.label} timed out.`, outcome.exitCode);
  if (outcome.exitCode !== 0) {
    const detail = summarizeStderr(outcome.stderr);
    return failure(
      "exit",
      detail.length > 0 ? `${request.label} failed: ${detail}` : `${request.label} failed.`,
      outcome.exitCode,
    );
  }
  return { ok: true, value: outcome.stdout.trim() };
}
