import path from "node:path";
import { stripAnsiAndCrs } from "./types.ts";
import type { VerifyStatus } from "./types.ts";
import {
  findLastFullSuiteWindowStart,
  formatElapsed,
  parseBuck2ExitMarker,
  parseGcDetected,
  parseVerifyBeginEpochSec,
  parseVerifyStoppedMarker,
} from "./parsing.ts";
import { deriveInProgressCounts } from "./derived.ts";
import {
  parseExpandedTargetCount,
  parsePassBegins,
  parsePassExits,
  passExitForBegin,
} from "./passes.ts";
import { parseFinalSummary } from "./summary.ts";

function aggregateVerifyPassStatus(
  lines: string[],
  base: Omit<VerifyStatus, "logPath">,
): Omit<VerifyStatus, "logPath"> {
  const begins = parsePassBegins(lines);
  if (begins.length === 0) return base;
  if (begins.length === 1 && begins[0].total <= 1) return base;

  const exits = parsePassExits(lines);
  const latestBegin = begins[begins.length - 1];
  const latestExit = passExitForBegin(latestBegin, exits);
  const activeBegins = begins.filter((begin) => passExitForBegin(begin, exits) === undefined);
  let pass = 0;
  let fail = 0;
  let fatal = 0;
  let skip = 0;
  let buildFailure = 0;
  let failed: string[] = [];
  let remaining = base.remaining;
  let completed = 0;
  const expandedTargetCount = parseExpandedTargetCount(lines);
  const totalFromBegins = begins.every((begin) => begin.targetCount !== undefined)
    ? begins.reduce((sum, begin) => sum + (begin.targetCount || 0), 0)
    : undefined;
  const totalTargets = expandedTargetCount ?? totalFromBegins;

  for (const begin of begins) {
    const exit = passExitForBegin(begin, exits);
    if (exit) {
      pass += exit.pass;
      fail += exit.fail;
      completed += exit.pass + exit.fail;
      if (exit.status !== 0) buildFailure++;
      continue;
    }
    const canFilterBegin = begin.targetLabels !== undefined && begin.targetLabels.size > 0;
    if (!canFilterBegin && activeBegins.length > 1 && begin !== latestBegin) continue;
    if (!canFilterBegin && activeBegins.length <= 1 && begin !== activeBegins[0]) continue;
    const current = deriveInProgressCounts(lines.slice(begin.idx), {
      targetLabels: canFilterBegin ? begin.targetLabels : undefined,
    });
    pass += current.pass;
    fail += current.fail;
    fatal += current.fatal;
    skip += current.skip;
    buildFailure += current.buildFailure;
    completed += current.pass + current.fail + current.fatal + current.skip;
    failed = current.failed;
    remaining = current.remaining;
  }

  const expectedPassTotal = Math.max(...begins.map((begin) => begin.total));
  const begunPassIndexes = new Set(begins.map((begin) => begin.index));
  const done =
    begunPassIndexes.size >= expectedPassTotal &&
    begins.every((begin) => passExitForBegin(begin, exits) !== undefined);
  const aggregateRemaining =
    totalTargets === undefined ? remaining : Math.max(0, totalTargets - completed);
  return {
    ...base,
    pass,
    fail,
    fatal,
    skip,
    buildFailure,
    remaining: done && latestExit?.status === 0 ? 0 : aggregateRemaining,
    failed: failed.length > 0 ? failed : base.failed,
    done,
    source: "derived",
    passName: latestBegin.name || undefined,
    passIndex: latestBegin.index,
    passTotal: latestBegin.total,
  };
}

export function computeVerifyStatusFromLogText(opts: {
  logPath: string;
  pid?: number;
  text: string;
  stoppedAtSec?: number;
  stopReason?: string;
}): VerifyStatus {
  const cleaned = stripAnsiAndCrs(opts.text);
  const lines = cleaned.split("\n");

  const startIdx = findLastFullSuiteWindowStart(lines);
  const window = startIdx > 0 ? lines.slice(startIdx) : lines;

  const exitMarker = parseBuck2ExitMarker(window);
  const stoppedMarker = parseVerifyStoppedMarker(window);
  const beginSec = parseVerifyBeginEpochSec(window);
  const gcDetected = parseGcDetected(window);

  // Prefer summary *for the current run window* when present.
  // parseFinalSummary is strict about ignoring nested harness output and won't accept a summary
  // if it appears to be followed by still-running-suite status lines (e.g., "Waiting on ...").
  const fromSummary = parseFinalSummary(window);
  const unaggregatedBase = fromSummary ?? deriveInProgressCounts(window);
  const base = aggregateVerifyPassStatus(window, unaggregatedBase);

  // Elapsed policy:
  // - Prefer an explicit "Time elapsed:" line from buck output if present (base.elapsed).
  // - While running: compute from start_s → now (updates).
  // - When done: freeze using end_s if available; otherwise treat as unknown ("?").
  const done =
    base.passTotal && base.passTotal > 1 ? base.done : exitMarker.done ? true : base.done;
  const stoppedAtSec = stoppedMarker.endSec ?? opts.stoppedAtSec;
  const stopped = !done && (stoppedMarker.stopped || stoppedAtSec !== undefined);
  const elapsed = (() => {
    if (base.elapsed) return base.elapsed;
    if (beginSec === undefined) return undefined;
    if (done) {
      if (exitMarker.endSec === undefined) return undefined;
      return formatElapsed(exitMarker.endSec - beginSec);
    }
    if (stopped && stoppedAtSec !== undefined) {
      return formatElapsed(stoppedAtSec - beginSec);
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
    stopped,
    stopReason: stopped ? (stoppedMarker.reason ?? opts.stopReason) : undefined,
    buildFailure,
    elapsed,
    gcDetected,
  };
}
