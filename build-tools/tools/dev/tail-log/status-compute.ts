import fsp from "node:fs/promises";
import { computeVerifyStatusFromLogText } from "../../lib/verify-log-status";

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
    group_completed: null,
    group_total: null,
    error,
  });
}

export async function computeStatusFromLogPath(logPath: string, pid: number, active: boolean) {
  const text = await readTextWithStatusPlan(logPath);
  const startedAtSec = await readSidecarStartSec(logPath);
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
    startedAtSec,
    stoppedAtSec,
    stopReason: active ? undefined : pid > 0 ? "process-exited" : "no-active-verify",
  });
}

async function readSidecarStartSec(logPath: string): Promise<number | undefined> {
  if (!logPath.endsWith(".log")) return undefined;
  const raw = await readFirstExistingText([`${logPath.slice(0, -4)}.start`, `${logPath}.start`]);
  const trimmed = raw.trim();
  const parsed = Number(trimmed);
  if (Number.isFinite(parsed) && parsed > 0) return parsed;
  const parsedDate = Date.parse(trimmed);
  return Number.isFinite(parsedDate) && parsedDate > 0 ? Math.floor(parsedDate / 1000) : undefined;
}

async function readFirstExistingText(paths: string[]): Promise<string> {
  for (const p of paths) {
    const text = await fsp.readFile(p, "utf8").catch(() => "");
    if (text) return text;
  }
  return "";
}

async function readTextWithStatusPlan(logPath: string): Promise<string> {
  const text = await fsp.readFile(logPath, "utf8");
  if (!logPath.endsWith(".log")) return text;
  const plan = await fsp.readFile(`${logPath.slice(0, -4)}.status-plan`, "utf8").catch(() => "");
  return plan.trim() ? `${plan.trim()}\n${text}` : text;
}
