import type { VerifyStatus } from "./types";
import { collectFailedLabels, parseLineFromBuckLogForMatching, parseRemaining } from "./parsing";

export function normalizeBuckTestLabel(label: string): string {
  return label
    .replace(/\s+\([^)]*\)\s*$/, "")
    .trim()
    .replace(/^[A-Za-z0-9_.-]+(?=\/\/)/, "");
}

function labelAfterMarker(line: string, marker: string): string | null {
  const idx = line.indexOf(marker);
  if (idx < 0) return null;
  if (idx > 0 && !/\s/.test(line[idx - 1] || "")) return null;
  const label = line.slice(idx + marker.length).trim();
  return label ? label : null;
}

export function deriveInProgressCounts(
  lines: string[],
  opts: {
    targetLabels?: ReadonlySet<string>;
  } = {},
): Omit<VerifyStatus, "logPath"> {
  // Buck emits completion lines that are stable (unlike superconsole repaint frames).
  // We only count these and dedupe by status+label or status+line.
  const passAltRe = /(?:^|\s)Pass:\s*(.+)$/;
  const failAltRe = /(?:^|\s)Fail:\s*(.+)$/;
  const fatalRe = /(?:^|\s)Fatal:\s*(.+)$/;
  const skipRe = /(?:^|\s)(?:Skip|Skipped):\s*(.+)$/;

  const seen = new Set<string>();
  let pass = 0,
    fail = 0,
    fatal = 0,
    skip = 0;
  const failed: string[] = [];

  for (const raw of lines) {
    const parsed = parseLineFromBuckLogForMatching(raw);
    // Ignore nested runner / subtest output (often prefixed with '#').
    // We want counters to reflect the top-level buck2 test run.
    if (parsed.isComment) continue;
    const line = parsed.normalized;
    if (line.startsWith("[verify] failure diagnostics ")) continue;
    let status: "pass" | "fail" | "fatal" | "skip" | null = null;
    let label = "";

    let m: RegExpExecArray | null;
    const passLabel = labelAfterMarker(line, "✓ Pass:");
    const failLabel = labelAfterMarker(line, "✗ Fail:");
    if (passLabel) {
      status = "pass";
      label = passLabel;
    } else if (failLabel) {
      status = "fail";
      label = failLabel;
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
    const cleaned = normalizeBuckTestLabel(label);
    if (opts.targetLabels && !opts.targetLabels.has(cleaned)) continue;
    const key = cleaned ? `${status}|${cleaned}` : `${status}|${line}`;
    if (seen.has(key)) continue;
    seen.add(key);

    if (status === "pass") pass++;
    else if (status === "fail") {
      fail++;
      if (cleaned) failed.push(cleaned);
    } else if (status === "fatal") fatal++;
    else if (status === "skip") skip++;
  }

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
    pass,
    fail,
    fatal,
    skip,
    buildFailure: 0,
    remaining: parseRemaining(lines),
    failed: opts.targetLabels ? failed : collectFailedLabels(lines),
    done: false,
    elapsed,
    source: "derived",
  };
}
