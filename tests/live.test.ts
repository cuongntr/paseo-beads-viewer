import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChangeState } from "../shared/beads";
import { isNewer, startChangePolling } from "../client/live";

const LIVE: ChangeState = { live: true, reason: "live", token: "a.1.3" };

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("change polling", () => {
  it("asks once per interval and reports each answer", async () => {
    const check = vi.fn(async () => LIVE);
    const onResult = vi.fn();
    const stop = startChangePolling({ intervalMs: 5_000, check, onResult });

    expect(check).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(check).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(check).toHaveBeenCalledTimes(2);
    expect(onResult).toHaveBeenCalledTimes(2);
    stop();
  });

  it("stops polling when stopped, as on unmount or a workspace change", async () => {
    const check = vi.fn(async () => LIVE);
    const stop = startChangePolling({ intervalMs: 5_000, check, onResult: () => {} });
    await vi.advanceTimersByTimeAsync(5_000);
    stop();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(check).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("drops an answer that arrives after it was stopped", async () => {
    let answer: (state: ChangeState) => void = () => {};
    const check = vi.fn(() => new Promise<ChangeState>((resolve) => {
      answer = resolve;
    }));
    const onResult = vi.fn();
    const stop = startChangePolling({ intervalMs: 5_000, check, onResult });
    await vi.advanceTimersByTimeAsync(5_000);
    stop();
    answer(LIVE);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(onResult).not.toHaveBeenCalled();
    expect(check).toHaveBeenCalledTimes(1);
  });

  it("never overlaps requests: the next waits for the previous answer", async () => {
    let answer: (state: ChangeState) => void = () => {};
    const check = vi.fn(() => new Promise<ChangeState>((resolve) => {
      answer = resolve;
    }));
    const stop = startChangePolling({ intervalMs: 5_000, check, onResult: () => {} });
    await vi.advanceTimersByTimeAsync(30_000);
    expect(check).toHaveBeenCalledTimes(1);
    answer(LIVE);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(check).toHaveBeenCalledTimes(2);
    stop();
  });

  it("ends at the first answer that is not live", async () => {
    const check = vi.fn(async (): Promise<ChangeState> => ({ live: false, reason: "journal-off", token: null }));
    const onResult = vi.fn();
    startChangePolling({ intervalMs: 5_000, check, onResult });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(check).toHaveBeenCalledTimes(1);
    expect(onResult).toHaveBeenCalledWith({ live: false, reason: "journal-off", token: null });
  });

  it("treats a failed request as not live and stops", async () => {
    const check = vi.fn(async (): Promise<ChangeState> => {
      throw new Error("daemon unreachable");
    });
    const onResult = vi.fn();
    startChangePolling({ intervalMs: 5_000, check, onResult });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(check).toHaveBeenCalledTimes(1);
    expect(onResult).toHaveBeenCalledWith({ live: false, reason: "unavailable", token: null });
  });
});

describe("token comparison", () => {
  it("reloads only for a live answer with a different token", () => {
    expect(isNewer(LIVE, "a.1.3")).toBe(false);
    expect(isNewer(LIVE, "a.0.2")).toBe(true);
    expect(isNewer({ live: false, reason: "unavailable", token: null }, "a.1.3")).toBe(false);
  });
});
