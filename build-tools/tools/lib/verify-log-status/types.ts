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
  gcDetected: boolean;
  source: VerifyStatusSource;
  passName?: string;
  passIndex?: number;
  passTotal?: number;
};

const ANSI_RE = /\x1b\[[0-9;?]*[A-Za-z]/g;

export function stripAnsiAndCrs(text: string): string {
  // Superconsole logs contain ANSI cursor controls; remove them for stable parsing.
  return text.replaceAll(ANSI_RE, "").replaceAll("\r", "");
}
