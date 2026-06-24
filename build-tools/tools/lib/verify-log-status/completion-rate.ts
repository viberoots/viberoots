import { normalizeBuckTestLabel } from "./derived";
import { parseLineFromBuckLogForMatching } from "./parsing";

export const RECENT_COMPLETION_WINDOW_SECONDS = 3 * 60;

function labelAfterMarker(line: string, marker: string): string | null {
  const idx = line.indexOf(marker);
  if (idx < 0) return null;
  if (idx > 0 && !/\s/.test(line[idx - 1] || "")) return null;
  const label = line.slice(idx + marker.length).trim();
  return label ? label : null;
}

function parseCompletionTimestampSec(line: string): number | undefined {
  const m = /^\[(\d{4}-\d{2}-\d{2}T[^}\]]+)\]/.exec(line.trim());
  if (!m) return undefined;
  const ms = Date.parse(m[1]);
  return Number.isFinite(ms) ? ms / 1000 : undefined;
}

function completionLabelFromLine(line: string): { status: string; label: string } | undefined {
  const passAltRe = /(?:^|\s)Pass:\s*(.+)$/;
  const failAltRe = /(?:^|\s)Fail:\s*(.+)$/;
  const fatalRe = /(?:^|\s)Fatal:\s*(.+)$/;
  const skipRe = /(?:^|\s)(?:Skip|Skipped):\s*(.+)$/;

  let status = "";
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
  if (!status) return undefined;
  return { status, label: normalizeBuckTestLabel(label) || line };
}

export function countRecentCompletions(
  lines: string[],
  endSec: number,
  opts: { targetLabels?: ReadonlySet<string> } = {},
): number | undefined {
  const seen = new Set<string>();
  let foundTimestamp = false;
  let count = 0;
  const startSec = endSec - RECENT_COMPLETION_WINDOW_SECONDS;
  for (const raw of lines) {
    const timestampSec = parseCompletionTimestampSec(raw);
    if (timestampSec === undefined) continue;
    foundTimestamp = true;
    if (timestampSec < startSec || timestampSec > endSec) continue;
    const parsed = parseLineFromBuckLogForMatching(raw);
    if (parsed.isComment) continue;
    const completion = completionLabelFromLine(parsed.normalized);
    if (!completion) continue;
    if (opts.targetLabels && !opts.targetLabels.has(completion.label)) continue;
    const key = `${completion.status}|${completion.label}`;
    if (seen.has(key)) continue;
    seen.add(key);
    count++;
  }
  return foundTimestamp ? count : undefined;
}
