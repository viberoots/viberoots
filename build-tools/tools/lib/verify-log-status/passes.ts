import { normalizeBuckTestLabel } from "./derived";
import { parseLineFromBuckLogForMatching } from "./parsing";

export type PassBegin = {
  idx: number;
  name: string;
  index: number;
  total: number;
  startSec?: number;
  targetCount?: number;
  targetLabels?: ReadonlySet<string>;
};

export type PassExit = {
  idx: number;
  name: string;
  status: number;
  endSec?: number;
  pass: number;
  fail: number;
  completions?: number;
};

function countTargetsFromPassBeginLine(line: string): number | undefined {
  const marker = " targets=";
  const idx = line.indexOf(marker);
  if (idx < 0) return undefined;
  const targets = line.slice(idx + marker.length).trim();
  if (!targets) return 0;
  return targets.split(/\s+/).filter(Boolean).length;
}

function parseTargetLabelsFromPassBeginLine(line: string): ReadonlySet<string> | undefined {
  const marker = " targets=";
  const idx = line.indexOf(marker);
  if (idx < 0) return undefined;
  const targets = line
    .slice(idx + marker.length)
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((label) => normalizeBuckTestLabel(label));
  return targets.length > 0 ? new Set(targets) : undefined;
}

function parseNumberField(line: string, name: string): number | undefined {
  const re = new RegExp(`(?:^|\\s)${name}=(\\d+)\\b`);
  const m = re.exec(line);
  if (!m) return undefined;
  const value = Number(m[1]);
  return Number.isFinite(value) ? value : undefined;
}

export function parsePassBegins(lines: string[]): PassBegin[] {
  const re = /^\[verify\]\s+target pass begin name=(\S+)\s+index=(\d+)\/(\d+)\b/;
  const out: PassBegin[] = [];
  for (let idx = 0; idx < lines.length; idx++) {
    const { normalized } = parseLineFromBuckLogForMatching(lines[idx]);
    const m = re.exec(normalized);
    if (!m) continue;
    const explicitTargetCount = parseNumberField(normalized, "target_count");
    const inferredTargetCount =
      explicitTargetCount !== undefined
        ? explicitTargetCount
        : countTargetsFromPassBeginLine(normalized);
    out.push({
      idx,
      name: m[1] || "",
      index: Number(m[2]),
      total: Number(m[3]),
      startSec: parseNumberField(normalized, "start_s"),
      targetCount:
        inferredTargetCount !== undefined && Number.isFinite(inferredTargetCount)
          ? inferredTargetCount
          : undefined,
      targetLabels: parseTargetLabelsFromPassBeginLine(normalized),
    });
  }
  return out;
}

export function parsePassExits(lines: string[]): PassExit[] {
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
      endSec: parseNumberField(normalized, "end_s"),
      pass: Number(m[3]),
      fail: Number(m[4]),
      completions: parseNumberField(normalized, "completions"),
    });
  }
  return out;
}

export function passExitForBegin(begin: PassBegin, exits: PassExit[]): PassExit | undefined {
  return exits.find((exit) => exit.name === begin.name && exit.idx > begin.idx);
}

export function parseExpandedTargetCount(lines: string[]): number | undefined {
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
