import path from "node:path";
import { stripAnsiAndCrs } from "./types.ts";
import type { VerifyStatus } from "./types.ts";
import {
  findLastFullSuiteWindowStart,
  formatElapsed,
  parseLineFromBuckLogForMatching,
  parseBuck2ExitMarker,
  parseGcDetected,
  parseVerifyBeginEpochSec,
} from "./parsing.ts";
import { deriveInProgressCounts } from "./derived.ts";
import { parseFinalSummary } from "./summary.ts";

type PassBegin = {
  idx: number;
  name: string;
  index: number;
  total: number;
  targetCount?: number;
};

type PassExit = {
  idx: number;
  name: string;
  status: number;
  pass: number;
  fail: number;
};

function countTargetsFromPassBeginLine(line: string): number | undefined {
  const marker = " targets=";
  const idx = line.indexOf(marker);
  if (idx < 0) return undefined;
  const targets = line.slice(idx + marker.length).trim();
  if (!targets) return 0;
  return targets.split(/\s+/).filter(Boolean).length;
}

function parsePassBegins(lines: string[]): PassBegin[] {
  const re =
    /^\[verify\]\s+target pass begin name=(\S+)\s+index=(\d+)\/(\d+)\b(?:\s+target_count=(\d+))?/;
  const out: PassBegin[] = [];
  for (let idx = 0; idx < lines.length; idx++) {
    const { normalized } = parseLineFromBuckLogForMatching(lines[idx]);
    const m = re.exec(normalized);
    if (!m) continue;
    const explicitTargetCount = m[4] ? Number(m[4]) : undefined;
    const inferredTargetCount =
      explicitTargetCount !== undefined
        ? explicitTargetCount
        : countTargetsFromPassBeginLine(normalized);
    out.push({
      idx,
      name: m[1] || "",
      index: Number(m[2]),
      total: Number(m[3]),
      targetCount:
        inferredTargetCount !== undefined && Number.isFinite(inferredTargetCount)
          ? inferredTargetCount
          : undefined,
    });
  }
  return out;
}

function parsePassExits(lines: string[]): PassExit[] {
  const re =
    /^\[verify\]\s+buck2 test exit iso=.*\s+pass=(\S+)\s+status=(\d+).*?\bpass_count=(\d+)\s+fail_count=(\d+)\b/;
  const out: PassExit[] = [];
  for (let idx = 0; idx < lines.length; idx++) {
    const { normalized } = parseLineFromBuckLogForMatching(lines[idx]);
    const m = re.exec(normalized);
    if (!m) continue;
    out.push({
      idx,
      name: m[1] || "",
      status: Number(m[2]),
      pass: Number(m[3]),
      fail: Number(m[4]),
    });
  }
  return out;
}

function passExitForBegin(begin: PassBegin, exits: PassExit[]): PassExit | undefined {
  return exits.find((exit) => exit.name === begin.name && exit.idx > begin.idx);
}

function parseExpandedTargetCount(lines: string[]): number | undefined {
  const re = /^\[verify\]\s+expanded targets:\s+concrete=(\d+)\b/;
  for (const raw of lines) {
    const { normalized } = parseLineFromBuckLogForMatching(raw);
    const m = re.exec(normalized);
    if (!m) continue;
    const count = Number(m[1]);
    return Number.isFinite(count) ? count : undefined;
  }
  return undefined;
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
    if (begin !== latestBegin) continue;
    const current = deriveInProgressCounts(lines.slice(begin.idx));
    pass += current.pass;
    fail += current.fail;
    fatal += current.fatal;
    skip += current.skip;
    buildFailure += current.buildFailure;
    completed += current.pass + current.fail + current.fatal + current.skip;
    failed = current.failed;
    remaining = current.remaining;
  }

  const done = latestExit !== undefined && latestBegin.index >= latestBegin.total;
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
}): VerifyStatus {
  const cleaned = stripAnsiAndCrs(opts.text);
  const lines = cleaned.split("\n");

  const startIdx = findLastFullSuiteWindowStart(lines);
  const window = startIdx > 0 ? lines.slice(startIdx) : lines;

  const exitMarker = parseBuck2ExitMarker(window);
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
    gcDetected,
  };
}
