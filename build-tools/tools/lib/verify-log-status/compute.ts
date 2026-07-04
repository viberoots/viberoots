import path from "node:path";
import { stripAnsiAndCrs } from "./types";
import type { VerifyPassGroupStatus, VerifyStatus } from "./types";
import { countRecentCompletions, RECENT_COMPLETION_WINDOW_SECONDS } from "./completion-rate";
import {
  findLastFullSuiteWindowStart,
  formatElapsed,
  collectFailedLabels,
  parseBuck2ExitMarker,
  parseGcDetected,
  parseVerifyBeginEpochSec,
  parseVerifyStoppedMarker,
} from "./parsing";
import { deriveInProgressCounts, normalizeBuckTestLabel } from "./derived";
import {
  parseExpandedTargetCount,
  parsePassBegins,
  parsePassExits,
  passExitForBegin,
} from "./passes";
import { parseFinalSummary } from "./summary";

function formatProjectedEndTime(epochSec: number): string {
  return new Date(epochSec * 1000).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
}

const MIN_GROUP_ELAPSED_SECONDS_FOR_AVG_PROJECTION = 30;

function passExitCompletedForProgress(
  exit: { status: number; pass: number; fail: number; completions?: number },
  targetCount: number | undefined,
): number {
  if (targetCount !== undefined && passExitRanToCompletion(exit)) {
    return targetCount;
  }
  return exit.completions ?? exit.pass + exit.fail;
}

function passExitRanToCompletion(exit: { status: number; fail: number }): boolean {
  return exit.status === 0 || (exit.status === 32 && exit.fail > 0);
}

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
  const knownTargetLabels = new Set<string>();
  for (const begin of begins) {
    for (const label of begin.targetLabels || []) knownTargetLabels.add(label);
  }
  const canScopeFailedAcrossPasses = knownTargetLabels.size > 0;
  const failedAcrossPasses = canScopeFailedAcrossPasses
    ? collectFailedLabels(lines).filter((label) =>
        knownTargetLabels.has(normalizeBuckTestLabel(label)),
      )
    : collectFailedLabels(lines);
  const passGroups: VerifyPassGroupStatus[] = [];

  for (const begin of begins) {
    const exit = passExitForBegin(begin, exits);
    if (exit) {
      const exitCompleted = passExitCompletedForProgress(exit, begin.targetCount);
      pass += exit.pass;
      fail += exit.fail;
      completed += exitCompleted;
      passGroups.push({
        name: begin.name,
        index: begin.index,
        total: begin.total,
        completed: exitCompleted,
        targetCount: begin.targetCount,
        pass: exit.pass,
        fail: exit.fail,
        fatal: 0,
        skip: 0,
        buildFailure: passExitRanToCompletion(exit) ? 0 : 1,
        completionRateAvgPerMinute: completionRatePerMinute(
          exitCompleted,
          begin.startSec,
          exit.endSec,
        ),
        done: true,
        active: false,
      });
      continue;
    }
    const canFilterBegin = begin.targetLabels !== undefined && begin.targetLabels.size > 0;
    if (!canFilterBegin && activeBegins.length > 1 && begin !== latestBegin) {
      passGroups.push(unknownActivePassGroup(begin));
      continue;
    }
    if (!canFilterBegin && activeBegins.length <= 1 && begin !== activeBegins[0]) {
      passGroups.push(unknownActivePassGroup(begin));
      continue;
    }
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
    passGroups.push({
      name: begin.name,
      index: begin.index,
      total: begin.total,
      completed: current.pass + current.fail + current.fatal + current.skip,
      targetCount: begin.targetCount,
      pass: current.pass,
      fail: current.fail,
      fatal: current.fatal,
      skip: current.skip,
      buildFailure: current.buildFailure,
      completionRateAvgPerMinute: completionRatePerMinute(
        current.pass + current.fail + current.fatal + current.skip,
        begin.startSec,
        Date.now() / 1000,
      ),
      done: false,
      active: true,
    });
  }

  const expectedPassTotal = Math.max(...begins.map((begin) => begin.total));
  const begunPassIndexes = new Set(begins.map((begin) => begin.index));
  const allPassesExited =
    begunPassIndexes.size >= expectedPassTotal &&
    begins.every((begin) => passExitForBegin(begin, exits) !== undefined);
  const interruptedExits = begins
    .map((begin) => passExitForBegin(begin, exits))
    .filter((exit): exit is NonNullable<typeof exit> => exit !== undefined)
    .filter((exit) => !passExitRanToCompletion(exit));
  const done = allPassesExited && interruptedExits.length === 0;
  const aggregateRemaining =
    totalTargets === undefined ? remaining : Math.max(0, totalTargets - completed);
  const groupProgress = (() => {
    const targetLabels =
      latestBegin.targetLabels && latestBegin.targetLabels.size > 0
        ? latestBegin.targetLabels
        : undefined;
    if (latestExit) {
      return {
        groupCompleted: passExitCompletedForProgress(latestExit, latestBegin.targetCount),
        groupTotal: latestBegin.targetCount,
      };
    }
    if (!targetLabels) {
      return { groupCompleted: undefined, groupTotal: latestBegin.targetCount };
    }
    const current = deriveInProgressCounts(lines.slice(latestBegin.idx), { targetLabels });
    return {
      groupCompleted: current.pass + current.fail + current.fatal + current.skip,
      groupTotal: latestBegin.targetCount,
    };
  })();
  return {
    ...base,
    pass,
    fail,
    fatal,
    skip,
    buildFailure: buildFailure + interruptedExits.length,
    remaining: done ? 0 : aggregateRemaining,
    failed:
      canScopeFailedAcrossPasses || failedAcrossPasses.length > 0
        ? failedAcrossPasses
        : failed.length > 0
          ? failed
          : base.failed,
    done,
    stopped: base.stopped || (!done && allPassesExited && interruptedExits.length > 0),
    stopReason:
      base.stopReason ||
      (!done && allPassesExited && interruptedExits.length > 0
        ? `pass exited before completing all targets: ${interruptedExits
            .map((exit) => `${exit.name} status=${exit.status}`)
            .join(", ")}`
        : undefined),
    source: "derived",
    passName: latestBegin.name || undefined,
    passIndex: latestBegin.index,
    passTotal: latestBegin.total,
    groupCompleted: groupProgress.groupCompleted,
    groupTotal: groupProgress.groupTotal,
    passGroups,
  };
}

function unknownActivePassGroup(begin: {
  name: string;
  index: number;
  total: number;
  targetCount?: number;
}): VerifyPassGroupStatus {
  return {
    name: begin.name,
    index: begin.index,
    total: begin.total,
    completed: undefined,
    targetCount: begin.targetCount,
    pass: 0,
    fail: 0,
    fatal: 0,
    skip: 0,
    buildFailure: 0,
    done: false,
    active: true,
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
  const stoppedAtSec =
    stoppedMarker.endSec ??
    opts.stoppedAtSec ??
    (!base.done && base.stopped ? exitMarker.endSec : undefined);
  const stopped = !done && (base.stopped || stoppedMarker.stopped || stoppedAtSec !== undefined);
  const elapsedSeconds = (() => {
    if (beginSec === undefined) return undefined;
    if (done) {
      if (exitMarker.endSec === undefined) return undefined;
      return exitMarker.endSec - beginSec;
    }
    if (stopped && stoppedAtSec !== undefined) return stoppedAtSec - beginSec;
    return Date.now() / 1000 - beginSec;
  })();
  const elapsed = (() => {
    if (base.elapsed) return base.elapsed;
    if (elapsedSeconds === undefined) return undefined;
    return formatElapsed(elapsedSeconds);
  })();
  const completedTests = base.pass + base.fail + base.fatal + base.skip;
  const completionRateAvgPerMinute =
    elapsedSeconds !== undefined && elapsedSeconds > 0
      ? completedTests / (elapsedSeconds / 60)
      : undefined;
  const recentEndSec =
    done && exitMarker.endSec !== undefined
      ? exitMarker.endSec
      : stopped && stoppedAtSec !== undefined
        ? stoppedAtSec
        : beginSec !== undefined
          ? Date.now() / 1000
          : undefined;
  const recentCompletions =
    recentEndSec === undefined ? undefined : countRecentCompletions(window, recentEndSec);
  const completionRateRecentPerMinute =
    recentCompletions === undefined
      ? undefined
      : recentCompletions / (RECENT_COMPLETION_WINDOW_SECONDS / 60);
  const nowSec =
    done && exitMarker.endSec !== undefined
      ? exitMarker.endSec
      : stopped && stoppedAtSec !== undefined
        ? stoppedAtSec
        : Date.now() / 1000;
  const projection = (() => {
    const begins = parsePassBegins(window);
    const exits = parsePassExits(window);
    const expectedPassTotal =
      begins.length > 0 ? Math.max(...begins.map((begin) => begin.total)) : 0;
    const begunPassIndexes = new Set(begins.map((begin) => begin.index));
    const activeBegins = begins.filter((begin) => passExitForBegin(begin, exits) === undefined);
    if (
      done ||
      stopped ||
      expectedPassTotal <= 0 ||
      begunPassIndexes.size < expectedPassTotal ||
      activeBegins.length === 0
    ) {
      return {};
    }

    let remainingSeconds = 0;
    for (const begin of activeBegins) {
      if (begin.startSec === undefined) return {};
      if (nowSec - begin.startSec < MIN_GROUP_ELAPSED_SECONDS_FOR_AVG_PROJECTION) return {};

      const targetLabels =
        begin.targetLabels && begin.targetLabels.size > 0 ? begin.targetLabels : undefined;
      const current = deriveInProgressCounts(lines.slice(begin.idx), { targetLabels });
      const groupRemaining =
        begin.targetCount === undefined
          ? current.remaining
          : Math.max(
              0,
              begin.targetCount - current.pass - current.fail - current.fatal - current.skip,
            );
      if (groupRemaining === undefined) return {};
      if (groupRemaining <= 0) continue;
      const groupCompleted = current.pass + current.fail + current.fatal + current.skip;
      const averageRateForGroup = completionRatePerMinute(groupCompleted, begin.startSec, nowSec);
      if (
        averageRateForGroup === undefined ||
        !Number.isFinite(averageRateForGroup) ||
        averageRateForGroup <= 0
      ) {
        return {};
      }
      remainingSeconds = Math.max(remainingSeconds, (groupRemaining / averageRateForGroup) * 60);
    }

    if (remainingSeconds <= 0) return {};
    const projectedTotalSeconds =
      beginSec === undefined ? undefined : nowSec + remainingSeconds - beginSec;
    return {
      projectedDuration:
        projectedTotalSeconds === undefined ? undefined : formatElapsed(projectedTotalSeconds),
      projectedEndTime: formatProjectedEndTime(nowSec + remainingSeconds),
    };
  })();
  // If the buck2 test exited non-zero but we didn't see an explicit build failure count,
  // treat it as a build failure for status coloring.
  const buildFailure =
    exitMarker.done &&
    exitMarker.exitCode !== undefined &&
    exitMarker.exitCode !== 0 &&
    base.fail === 0 &&
    base.fatal === 0 &&
    base.buildFailure === 0
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
    remaining: done ? 0 : base.remaining,
    elapsed,
    completionRateAvgPerMinute,
    completionRateRecentPerMinute,
    projectedDuration: projection.projectedDuration,
    projectedEndTime: projection.projectedEndTime,
    gcDetected,
  };
}

function completionRatePerMinute(
  completed: number,
  startSec: number | undefined,
  endSec: number | undefined,
): number | undefined {
  if (startSec === undefined || endSec === undefined) return undefined;
  const elapsedSeconds = endSec - startSec;
  if (!Number.isFinite(elapsedSeconds) || elapsedSeconds <= 0) return undefined;
  if (!Number.isFinite(completed) || completed <= 0) return undefined;
  return completed / (elapsedSeconds / 60);
}
