import timers from "node:timers";
import { type ManagedCommandActivity } from "../../lib/managed-command";

export async function withHeartbeat<T>(
  label: string,
  promise: Promise<T>,
  opts?: { activity?: ManagedCommandActivity; noOutputWarnSec?: number },
): Promise<T> {
  const started = Date.now();
  const noOutputWarnSec = Math.max(30, Number(opts?.noOutputWarnSec || 90));
  const thresholds = [15, 30, 60, 120, 240, 480, 900];
  let lastBytes = -1;
  let lastNoOutputBucket = -1;
  const isAlive = (pid: number): boolean => {
    if (!pid || pid <= 0) return false;
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  };
  const timer = timers.setInterval(() => {
    const elapsed = Math.floor((Date.now() - started) / 1000);
    const activity = opts?.activity;
    if (!activity) {
      console.error(`[update-pnpm-hash] phase=${label} elapsed=${elapsed}s`);
      return;
    }
    const now = Date.now();
    const lastAt = activity.lastOutputAtMs || activity.startedAtMs || started;
    const silentForSec = Math.max(0, Math.floor((now - lastAt) / 1000));
    const bytes = activity.stdoutBytes + activity.stderrBytes;
    const childPid = Number(activity.childPid || 0);
    const childAlive = isAlive(childPid);
    if (bytes > lastBytes) {
      lastBytes = bytes;
      const last = activity.lastEventSnippet || "<activity>";
      console.error(
        `[update-pnpm-hash] phase=${label} elapsed=${elapsed}s status=progress child_pid=${childPid} child_alive=${childAlive} bytes=${bytes} last_event_ago=${silentForSec}s last_event="${last}"`,
      );
      return;
    }
    let bucket = 0;
    for (const t of thresholds) {
      if (silentForSec >= t) bucket = t;
    }
    if (bucket <= lastNoOutputBucket) return;
    lastNoOutputBucket = bucket;
    const stall = silentForSec >= noOutputWarnSec ? " no_output_window_exceeded=true" : "";
    console.error(
      `[update-pnpm-hash] phase=${label} elapsed=${elapsed}s status=waiting-for-output child_pid=${childPid} child_alive=${childAlive} bytes=${bytes} no_output_for=${silentForSec}s${stall}`,
    );
  }, 15000);
  try {
    return await promise;
  } finally {
    timers.clearInterval(timer);
  }
}
