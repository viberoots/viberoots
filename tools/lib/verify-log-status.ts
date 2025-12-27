import path from "node:path";

export type VerifyStatusSource = "summary" | "derived";

export type VerifyStatus = {
  pid?: number;
  logPath: string;
  pass: number;
  fail: number;
  fatal: number;
  skip: number;
  buildFailure: number;
  remaining?: number;
  failed: string[];
  done: boolean;
  elapsed?: string;
  source: VerifyStatusSource;
};

const ANSI_RE = /\x1b\[[0-9;?]*[A-Za-z]/g;

export function stripAnsiAndCrs(text: string): string {
  // Superconsole logs contain ANSI cursor controls; remove them for stable parsing.
  return text.replaceAll(ANSI_RE, "").replaceAll("\r", "");
}

function parseLineForMatching(line: string): { normalized: string; isComment: boolean } {
  let s = line.trim();
  // Strip common buck2 log prefix: [2025-...]
  // Important: do NOT strip non-timestamp bracketed prefixes like "[verify] ...".
  if (/^\[\d{4}-\d{2}-\d{2}T/.test(s)) {
    const end = s.indexOf("]");
    if (end > 0) s = s.slice(end + 1).trim();
  }
  const isComment = s.startsWith("#");
  if (isComment) s = s.slice(1).trim();
  return { normalized: s, isComment };
}

function parseRemaining(lines: string[]): number | undefined {
  // Best-effort extraction from buck2 output.
  // Examples seen in the wild:
  // - "Loading targets. Remaining ...", "Loading targets. Remaining: 123"
  // - "Remaining: 12"
  // - A block like:
  //     Waiting on Test A -- ...
  //     Waiting on Test B -- ...
  //     Waiting on Test C -- ..., and 9 other actions
  //   In this case: remaining = (9 other actions) + (3 explicitly listed actions) = 12
  const re = /\bRemaining:?\s+(\d+)\b/;
  const waitingWithOthersRe = /^\s*Waiting on\b.*\band\s+(\d+)\s+other actions\b/;
  const waitingLineRe = /^\s*Waiting on\b/;

  for (let i = lines.length - 1; i >= 0; i--) {
    const { normalized } = parseLineForMatching(lines[i]);
    const w = waitingWithOthersRe.exec(normalized);
    if (w) {
      const other = Number(w[1]);
      if (!Number.isFinite(other)) continue;
      // Count how many "Waiting on ..." lines are part of this same status block.
      let listed = 1;
      for (let j = i - 1; j >= 0; j--) {
        const prev = parseLineForMatching(lines[j]).normalized;
        if (!waitingLineRe.test(prev)) break;
        // Stop if we hit another "and N other actions" line (newer block boundary).
        if (waitingWithOthersRe.test(prev)) break;
        listed++;
      }
      return Math.max(0, other) + listed;
    }

    const m = re.exec(normalized);
    if (m) {
      const n = Number(m[1]);
      if (Number.isFinite(n)) return n;
    }
  }
  return undefined;
}

function collectFailedLabels(lines: string[]): string[] {
  const failRe = /(?:^|.*\s)✗\s*Fail:\s*(.+)$/;
  const failAltRe = /(?:^|.*\s)Fail:\s*(.+)$/;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of lines) {
    const { normalized: line, isComment } = parseLineForMatching(raw);
    if (isComment) continue;
    let m: RegExpExecArray | null = null;
    if ((m = failRe.exec(line)) || (m = failAltRe.exec(line))) {
      const label = (m[1] || "").replace(/\s+\([^)]*\)\s*$/, "").trim();
      const key = label || line;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(label || line);
    }
  }
  return out;
}

function parseFinalFailedTargetsBlock(lines: string[]): string[] {
  // Prefer the final buck2 failure list if present, e.g.:
  //   1 TESTS FAILED
  //     ✗ root//:some_test
  //     ✗ root//:another_test
  const tail = lines.slice(Math.max(0, lines.length - 400));
  let startIdx = -1;
  for (let i = tail.length - 1; i >= 0; i--) {
    const { normalized, isComment } = parseLineForMatching(tail[i]);
    if (isComment) continue;
    if (/\bTESTS FAILED\b/.test(normalized)) {
      startIdx = i;
      break;
    }
  }
  if (startIdx < 0) return [];

  const out: string[] = [];
  const seen = new Set<string>();
  const itemRe = /^\s*✗\s+(.+)\s*$/;
  for (let i = startIdx + 1; i < tail.length; i++) {
    const { normalized, isComment } = parseLineForMatching(tail[i]);
    if (isComment) continue;
    const m = itemRe.exec(normalized);
    if (!m) continue;
    const t = (m[1] || "").trim();
    if (!t) continue;
    if (seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

function findLastFullSuiteWindowStart(lines: string[]): number {
  // Best-effort: prefer an explicit verify marker emitted by tools/bin/verify.
  for (let i = lines.length - 1; i >= 0; i--) {
    const { normalized } = parseLineForMatching(lines[i]);
    if (normalized.startsWith("[verify] buck2 test begin iso=")) return i;
    if (normalized.startsWith("[verify] begin iso=")) return i;
  }
  // Fallback: look for a stable header block from the full-suite buck2 test:
  //   Loading targets. Remaining ...
  for (let i = lines.length - 1; i >= 0; i--) {
    const { normalized } = parseLineForMatching(lines[i]);
    if (normalized.startsWith("Loading targets.")) return i;
  }
  return 0;
}

function parseBuck2ExitMarker(lines: string[]): {
  done: boolean;
  exitCode?: number;
  endSec?: number;
} {
  // [verify] buck2 test exit iso=v-123 status=0 end_s=1735251111
  const re = /^\[verify\]\s+buck2 test exit iso=.*\s+status=(\d+)(?:\s+end_s=(\d+))?/;
  for (let i = lines.length - 1; i >= 0; i--) {
    const { normalized } = parseLineForMatching(lines[i]);
    const m = re.exec(normalized);
    if (m) {
      const code = Number(m[1]);
      const end = m[2] ? Number(m[2]) : undefined;
      return {
        done: true,
        exitCode: Number.isFinite(code) ? code : undefined,
        endSec: end !== undefined && Number.isFinite(end) && end > 0 ? end : undefined,
      };
    }
  }
  return { done: false };
}

function parseBuck2BeginEpochSec(lines: string[]): number | undefined {
  // [verify] buck2 test begin iso=v-123 start_s=1735250987
  const re = /^\[verify\]\s+buck2 test begin iso=.*\s+start_s=(\d+)/;
  for (let i = lines.length - 1; i >= 0; i--) {
    const { normalized } = parseLineForMatching(lines[i]);
    const m = re.exec(normalized);
    if (m) {
      const s = Number(m[1]);
      if (Number.isFinite(s) && s > 0) return s;
    }
  }
  return undefined;
}

function formatElapsed(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const mins = Math.floor(s / 60);
  const secs = s % 60;
  if (mins >= 60) {
    const hrs = Math.floor(mins / 60);
    const remMins = mins % 60;
    return `${hrs}:${String(remMins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  }
  return `${mins}:${String(secs).padStart(2, "0")}`;
}

export function parseFinalSummary(lines: string[]): Omit<VerifyStatus, "logPath"> | null {
  // Example:
  // Tests finished: Pass 581. Fail 0. Fatal 0. Skip 0. Build failure 0
  const summaryRe =
    /^Tests finished:\s+Pass\s+(\d+)\.\s+Fail\s+(\d+)\.\s+Fatal\s+(\d+)\.\s+Skip\s+(\d+)\.\s+Build failure\s+(\d+)/;

  // Only treat the run as "done" if a non-comment summary appears very near the end of the log window.
  // This avoids incorrectly reporting completion when the log contains older full-suite summaries.
  const tailWindow = lines.slice(Math.max(0, lines.length - 800));

  let last: RegExpExecArray | null = null;
  for (const line of tailWindow) {
    const { normalized, isComment } = parseLineForMatching(line);
    // Ignore node:test / harness summaries (often prefixed with '#').
    if (isComment) continue;
    const m = summaryRe.exec(normalized);
    if (m) {
      last = m;
    }
  }
  if (!last) return null;

  // Find the closest preceding "Time elapsed:" for a nicer status output.
  let elapsed: string | undefined;
  for (let i = lines.length - 1; i >= 0; i--) {
    const l = parseLineForMatching(lines[i]).normalized.trim();
    const idx = l.lastIndexOf("Time elapsed:");
    if (idx >= 0) {
      elapsed = l.slice(idx + "Time elapsed:".length).trim();
      if (elapsed) break;
    }
  }

  return {
    pass: Number(last[1]),
    fail: Number(last[2]),
    fatal: Number(last[3]),
    skip: Number(last[4]),
    buildFailure: Number(last[5]),
    remaining: 0,
    failed:
      Number(last[2]) + Number(last[3]) + Number(last[5]) > 0
        ? (() => {
            const fromBlock = parseFinalFailedTargetsBlock(lines);
            return fromBlock.length > 0 ? fromBlock : collectFailedLabels(lines);
          })()
        : [],
    done: true,
    elapsed,
    source: "summary",
  };
}

export function deriveInProgressCounts(lines: string[]): Omit<VerifyStatus, "logPath"> {
  // Buck emits completion lines that are stable (unlike superconsole repaint frames).
  // We only count these and dedupe by status+label or status+line.
  const passRe = /(?:^|.*\s)✓\s*Pass:\s*(.+)$/;
  const failRe = /(?:^|.*\s)✗\s*Fail:\s*(.+)$/;
  const passAltRe = /(?:^|.*\s)Pass:\s*(.+)$/;
  const failAltRe = /(?:^|.*\s)Fail:\s*(.+)$/;
  const fatalRe = /(?:^|.*\s)Fatal:\s*(.+)$/;
  const skipRe = /(?:^|.*\s)(?:Skip|Skipped):\s*(.+)$/;

  const seen = new Set<string>();
  let pass = 0,
    fail = 0,
    fatal = 0,
    skip = 0;

  for (const raw of lines) {
    const parsed = parseLineForMatching(raw);
    // Ignore nested runner / subtest output (often prefixed with '#').
    // We want counters to reflect the top-level buck2 test run.
    if (parsed.isComment) continue;
    const line = parsed.normalized;
    let status: "pass" | "fail" | "fatal" | "skip" | null = null;
    let label = "";

    let m: RegExpExecArray | null;
    if ((m = passRe.exec(line))) {
      status = "pass";
      label = m[1];
    } else if ((m = failRe.exec(line))) {
      status = "fail";
      label = m[1];
    } else if ((m = passAltRe.exec(line))) {
      status = "pass";
      label = m[1];
    } else if ((m = failAltRe.exec(line))) {
      status = "fail";
      label = m[1];
    } else if ((m = fatalRe.exec(line))) {
      status = "fatal";
      label = m[1];
    } else if ((m = skipRe.exec(line))) {
      status = "skip";
      label = m[1];
    }
    if (!status) continue;

    // Normalize label a bit: remove trailing parens duration if present.
    const cleaned = label.replace(/\s+\([^)]*\)\s*$/, "").trim();
    const key = cleaned ? `${status}|${cleaned}` : `${status}|${line}`;
    if (seen.has(key)) continue;
    seen.add(key);

    if (status === "pass") pass++;
    else if (status === "fail") fail++;
    else if (status === "fatal") fatal++;
    else if (status === "skip") skip++;
  }

  let elapsed: string | undefined;
  for (let i = lines.length - 1; i >= 0; i--) {
    const l = parseLineForMatching(lines[i]).normalized.trim();
    const idx = l.lastIndexOf("Time elapsed:");
    if (idx >= 0) {
      elapsed = l.slice(idx + "Time elapsed:".length).trim();
      if (elapsed) break;
    }
  }

  return {
    pass,
    fail,
    fatal,
    skip,
    buildFailure: 0,
    remaining: parseRemaining(lines),
    failed: collectFailedLabels(lines),
    done: false,
    elapsed,
    source: "derived",
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
