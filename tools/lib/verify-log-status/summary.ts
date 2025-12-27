import type { VerifyStatus } from "./types.ts";
import {
  collectFailedLabels,
  parseFinalFailedTargetsBlock,
  parseLineFromBuckLogForMatching,
} from "./parsing.ts";

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
    const { normalized, isComment } = parseLineFromBuckLogForMatching(line);
    // Ignore node:test / harness summaries (often prefixed with '#').
    if (isComment) continue;
    const m = summaryRe.exec(normalized);
    if (m) last = m;
  }
  if (!last) return null;

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
