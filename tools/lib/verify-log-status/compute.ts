import path from "node:path";
import { stripAnsiAndCrs } from "./types.ts";
import type { VerifyStatus } from "./types.ts";
import {
  findLastFullSuiteWindowStart,
  formatElapsed,
  parseBuck2BeginEpochSec,
  parseBuck2ExitMarker,
} from "./parsing.ts";
import { deriveInProgressCounts } from "./derived.ts";
import { parseFinalSummary } from "./summary.ts";

export function computeVerifyStatusFromLogText(opts: {
  logPath: string;
  pid?: number;
  text: string;
}): VerifyStatus {
  const cleaned = stripAnsiAndCrs(opts.text);
  const lines = cleaned.split("\n");

  const startIdx = findLastFullSuiteWindowStart(lines);
  const window = startIdx > 0 ? lines.slice(startIdx) : lines;

  const exitMarker = parseBuck2ExitMarker(window);
  const beginSec = parseBuck2BeginEpochSec(window);

  // Prefer summary *for the current run window*.
  // This avoids incorrectly reporting "done" if the log contains an older full-suite summary
  // but a newer full-suite run has started (common when the same log file accumulates content).
  const fromSummary = parseFinalSummary(window);
  const base = fromSummary ?? deriveInProgressCounts(window);

  // Elapsed policy:
  // - Prefer an explicit "Time elapsed:" line from buck output if present (base.elapsed).
  // - While running: compute from start_s → now (updates).
  // - When done: freeze using end_s if available; otherwise treat as unknown ("?").
  const done = exitMarker.done ? true : base.done;
  const elapsed = (() => {
    if (base.elapsed) return base.elapsed;
    if (beginSec === undefined) return undefined;
    if (done) {
      if (exitMarker.endSec === undefined) return undefined;
      return formatElapsed(exitMarker.endSec - beginSec);
    }
    return formatElapsed(Date.now() / 1000 - beginSec);
  })();
  // If the buck2 test exited non-zero but we didn't see an explicit build failure count,
  // treat it as a build failure for status coloring.
  const buildFailure =
    exitMarker.done && exitMarker.exitCode !== undefined && exitMarker.exitCode !== 0
      ? Math.max(1, base.buildFailure)
      : base.buildFailure;

  return {
    pid: opts.pid,
    logPath: path.normalize(opts.logPath),
    ...base,
    done,
    buildFailure,
    elapsed,
  };
}
