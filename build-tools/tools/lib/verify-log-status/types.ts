export type VerifyStatusSource = "summary" | "derived";

export type VerifyPassGroupStatus = {
  name: string;
  index: number;
  total: number;
  completed?: number;
  targetCount?: number;
  pass: number;
  fail: number;
  fatal: number;
  skip: number;
  buildFailure: number;
  completionRateAvgPerMinute?: number;
  done: boolean;
  active: boolean;
};

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
  stopped?: boolean;
  stopReason?: string;
  elapsed?: string;
  completionRateAvgPerMinute?: number;
  completionRateRecentPerMinute?: number;
  projectedDuration?: string;
  projectedEndTime?: string;
  gcDetected: boolean;
  source: VerifyStatusSource;
  passName?: string;
  passIndex?: number;
  passTotal?: number;
  groupCompleted?: number;
  groupTotal?: number;
  passGroups?: VerifyPassGroupStatus[];
};

const ANSI_RE = /\x1b\[[0-9;?]*[A-Za-z]/g;

export function stripAnsiAndCrs(text: string): string {
  // Superconsole logs contain ANSI cursor controls; remove them for stable parsing.
  return text.replaceAll(ANSI_RE, "").replaceAll("\r", "");
}
