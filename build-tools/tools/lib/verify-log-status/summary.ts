import type { VerifyStatus } from "./types";
import {
  collectFailedLabels,
  parseFinalFailedTargetsBlock,
  parseLineFromBuckLogForMatching,
} from "./parsing";

export function parseFinalSummary(lines: string[]): Omit<VerifyStatus, "logPath"> | null {
  // Examples:
  // Tests finished: Pass 581. Fail 0. Fatal 0. Skip 0. Build failure 0
  // Tests finished: Pass 6. Fail 0. Timeout 0. Fatal 0. Skip 0. Omit 0.
  //   Infra Failure 0. Build failure 0
  const summaryRe =
    /^Tests finished:\s+Pass\s+(\d+)\.\s+Fail\s+(\d+)\.(?:\s+Timeout\s+\d+\.)?\s+Fatal\s+(\d+)\.\s+Skip\s+(\d+)\.(?:\s+Omit\s+\d+\.)?(?:\s+Infra Failure\s+\d+\.)?\s+Build failure\s+(\d+)/;

  // Only treat the run as "done" if a non-comment summary appears very near the end of the log window.
  // This avoids incorrectly reporting completion when the log contains older full-suite summaries.
  const tailWindow = lines.slice(Math.max(0, lines.length - 800));

  let last: { idx: number; m: RegExpExecArray } | null = null;
  for (let i = 0; i < tailWindow.length; i++) {
    const { normalized, isComment } = parseLineFromBuckLogForMatching(tailWindow[i]);
    // Ignore node:test / harness summaries (often prefixed with '#').
    if (isComment) continue;
    const m = summaryRe.exec(normalized);
    if (m) last = { idx: i, m };
  }
  if (!last) return null;

  // Guard: do not treat an action-level summary as the full-suite summary.
  // We've observed "Tests finished: ..." lines from nested zx/node test output while the overall
  // buck2 test run is still running; those are typically followed by "Waiting on ..." / "Remaining"
  // status lines for the still-running suite.
  const inProgressAfterSummaryRe = /^(?:Loading targets\.|Remaining:?\s+\d+\b|Waiting on\b)/;
  for (let i = last.idx + 1; i < tailWindow.length; i++) {
    const { normalized, isComment } = parseLineFromBuckLogForMatching(tailWindow[i]);
    if (isComment) continue;
    if (inProgressAfterSummaryRe.test(normalized)) return null;
  }

  // Find the closest preceding "Time elapsed:" for a nicer status output.
  let elapsed: string | undefined;
  for (let i = lines.length - 1; i >= 0; i--) {
    const l = parseLineFromBuckLogForMatching(lines[i]).normalized.trim();
    const idx = l.lastIndexOf("Time elapsed:");
    if (idx >= 0) {
      elapsed = l.slice(idx + "Time elapsed:".length).trim();
      if (elapsed) break;
    }
  }

  return {
    pass: Number(last.m[1]),
    fail: Number(last.m[2]),
    fatal: Number(last.m[3]),
    skip: Number(last.m[4]),
    buildFailure: Number(last.m[5]),
    remaining: 0,
    failed:
      Number(last.m[2]) + Number(last.m[3]) + Number(last.m[5]) > 0
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
