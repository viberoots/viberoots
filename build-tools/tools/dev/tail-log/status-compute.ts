import fsp from "node:fs/promises";
import { computeVerifyStatusFromLogText } from "../../lib/verify-log-status.ts";

export function emptyNdjson(pid: number, error: string): string {
  return JSON.stringify({
    pid,
    pass: 0,
    fail: 0,
    fatal: 0,
    skip: 0,
    build_failure: 0,
    remaining: null,
    failed: [],
    done: false,
    elapsed: null,
    gc_detected: false,
    log: null,
    source: "derived",
    stopped: false,
    stop_reason: null,
    error,
  });
}

export async function computeStatusFromLogPath(logPath: string, pid: number, active: boolean) {
  const text = await fsp.readFile(logPath, "utf8");
  const stoppedAtSec = active
    ? undefined
    : await fsp
        .stat(logPath)
        .then((st) => Math.floor(st.mtimeMs / 1000))
        .catch(() => undefined);
  return computeVerifyStatusFromLogText({
    logPath,
    pid: pid || undefined,
    text,
    stoppedAtSec,
    stopReason: active ? undefined : pid > 0 ? "process-exited" : "no-active-verify",
  });
}
