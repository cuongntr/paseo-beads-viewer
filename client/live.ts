import type { ChangeState } from "../shared/beads";

/**
 * Asks the server whether a live workspace changed. One question at a time: the
 * next waits for the previous answer plus the interval, so a slow server never
 * stacks requests. Polling ends at the first answer that is not live or that
 * fails, and for good once the returned stop function runs; an answer arriving
 * after that is dropped.
 */
export interface ChangePolling {
  readonly intervalMs: number;
  readonly check: () => Promise<ChangeState>;
  readonly onResult: (state: ChangeState) => void;
  readonly setTimer?: (run: () => void, ms: number) => unknown;
  readonly clearTimer?: (timer: unknown) => void;
}

const UNAVAILABLE: ChangeState = { live: false, reason: "unavailable", token: null };

export function startChangePolling(options: ChangePolling): () => void {
  const setTimer = options.setTimer ?? ((run: () => void, ms: number) => setTimeout(run, ms));
  const clearTimer = options.clearTimer ?? ((timer: unknown) => clearTimeout(timer as number));
  let stopped = false;
  let timer: unknown = null;

  const schedule = (): void => {
    timer = setTimer(() => {
      timer = null;
      void poll();
    }, options.intervalMs);
  };

  const poll = async () => {
    let state: ChangeState;
    try {
      state = await options.check();
    } catch {
      state = UNAVAILABLE;
    }
    if (stopped) return;
    options.onResult(state);
    if (!stopped && state.live) schedule();
  };

  schedule();
  return () => {
    stopped = true;
    if (timer !== null) clearTimer(timer);
    timer = null;
  };
}

/** True when a live answer says the journal moved past what the shown snapshot was read at. */
export function isNewer(state: ChangeState, shownToken: string | null): boolean {
  return state.live && state.token !== null && state.token !== shownToken;
}
