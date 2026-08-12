import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { spawnInspectionProcess } from "../../lib/process-inspection-runner";

export const DARWIN_IOSTAT_PATH = "/usr/sbin/iostat";

export type DiskIoSample = {
  sequence: number;
  mbps: number;
  tps: number;
};

export type DiskIoStatus = "unavailable" | "parse" | "exit" | "timeout";

export type DiskIoTelemetryCounters = {
  diskIoSuccesses: number;
  diskIoUnavailable: number;
  diskIoParseErrors: number;
  diskIoExits: number;
  diskIoTimeouts: number;
  maxDiskMbps: number | null;
  maxDiskTps: number | null;
};

export function emptyDiskIoTelemetryCounters(): DiskIoTelemetryCounters {
  return {
    diskIoSuccesses: 0,
    diskIoUnavailable: 0,
    diskIoParseErrors: 0,
    diskIoExits: 0,
    diskIoTimeouts: 0,
    maxDiskMbps: null,
    maxDiskTps: null,
  };
}

export function makeFailSoftLineWriter(write: (line: string) => Promise<void>): {
  append: (line: string) => void;
  flush: () => Promise<void>;
} {
  let pending = Promise.resolve();
  return {
    append: (line) => {
      pending = pending
        .then(
          () => write(line),
          () => write(line),
        )
        .catch(() => {});
    },
    flush: async () => await pending,
  };
}

export function accumulateDiskIoTelemetryLine(
  counters: DiskIoTelemetryCounters,
  line: string,
): boolean {
  if (!line.startsWith("[verify] disk-io sample ")) return false;
  const status = /\bstatus=(success|unavailable|parse|exit|timeout)\b/u.exec(line)?.[1];
  if (status === "success") {
    counters.diskIoSuccesses++;
    const mbps = Number(/\bmbps=([0-9]+(?:\.[0-9]+)?)\b/u.exec(line)?.[1]);
    const tps = Number(/\btps=([0-9]+(?:\.[0-9]+)?)\b/u.exec(line)?.[1]);
    if (Number.isFinite(mbps)) counters.maxDiskMbps = Math.max(counters.maxDiskMbps ?? 0, mbps);
    if (Number.isFinite(tps)) counters.maxDiskTps = Math.max(counters.maxDiskTps ?? 0, tps);
  }
  if (status === "unavailable") counters.diskIoUnavailable++;
  if (status === "parse") counters.diskIoParseErrors++;
  if (status === "exit") counters.diskIoExits++;
  if (status === "timeout") counters.diskIoTimeouts++;
  return true;
}

export const darwinIostatArgs = (intervalSec = 5): string[] => [
  "-dC",
  "-w",
  String(intervalSec),
  "disk0",
];

export function makeDarwinIostatParser(
  onSample: (sample: DiskIoSample) => void,
  onParseError: () => void,
): (line: string) => void {
  let discardedUptimeAverage = false;
  let sequence = 0;
  return (line: string) => {
    const trimmed = line.trim();
    if (!trimmed || !/^[0-9.]/u.test(trimmed)) return;
    const fields = trimmed.split(/\s+/u);
    if (fields.length !== 6 || fields.some((field) => !Number.isFinite(Number(field)))) {
      onParseError();
      return;
    }
    const [kbPerTransfer, tps, mbps, user, system, idle] = fields.map(Number);
    if (
      ![kbPerTransfer, tps, mbps, user, system, idle].every(
        (value) => Number.isFinite(value) && value >= 0,
      )
    ) {
      onParseError();
      return;
    }
    if (!discardedUptimeAverage) {
      discardedUptimeAverage = true;
      return;
    }
    onSample({ sequence: ++sequence, mbps: mbps!, tps: tps! });
  };
}

export function makeDiskProcessCaptureGate(opts?: {
  cooldownMs?: number;
  nowMs?: () => number;
}): (loadTriggered: boolean, sample: DiskIoSample | null) => boolean {
  const cooldownMs = opts?.cooldownMs ?? 60_000;
  const nowMs = opts?.nowMs ?? Date.now;
  let lastSequence = 0;
  let consecutiveDiskPressure = 0;
  let lastCaptureMs = Number.NEGATIVE_INFINITY;
  return (loadTriggered, sample) => {
    if (sample && sample.sequence !== lastSequence) {
      lastSequence = sample.sequence;
      const pressured = sample.mbps >= 50 || (sample.mbps >= 20 && sample.tps >= 5000);
      consecutiveDiskPressure = pressured ? consecutiveDiskPressure + 1 : 0;
    }
    const triggered = loadTriggered || (sample !== null && consecutiveDiskPressure >= 2);
    const now = nowMs();
    if (!triggered || now - lastCaptureMs < cooldownMs) return false;
    lastCaptureMs = now;
    return true;
  };
}

export type DarwinDiskIoSampler = {
  latest: () => DiskIoSample | null;
  stop: () => Promise<void>;
};

export function startDarwinDiskIoSampler(opts: {
  intervalSec?: number;
  onSample?: (sample: DiskIoSample) => void;
  onStatus: (status: DiskIoStatus) => void;
  platform?: NodeJS.Platform;
  resolveIostat?: () => string;
  spawnProcess?: (cmd: string, args: string[]) => ChildProcessWithoutNullStreams;
}): DarwinDiskIoSampler {
  const platform = opts.platform ?? process.platform;
  if (platform !== "darwin") return { latest: () => null, stop: async () => {} };
  const intervalSec = Math.max(1, Math.floor(opts.intervalSec ?? 5));
  let latest: DiskIoSample | null = null;
  let child: ChildProcessWithoutNullStreams | null = null;
  let stopped = false;
  let restarts = 0;
  let emittedSequence = 0;
  let failureReported = false;
  let inactivityTimer: NodeJS.Timeout | null = null;
  const resetInactivityTimer = () => {
    if (inactivityTimer) clearTimeout(inactivityTimer);
    inactivityTimer = setTimeout(
      () => {
        if (stopped || failureReported) return;
        failureReported = true;
        latest = null;
        opts.onStatus("timeout");
        child?.kill("SIGKILL");
      },
      intervalSec * 3000 + 2000,
    );
    inactivityTimer.unref?.();
  };
  const launch = () => {
    failureReported = false;
    let iostat = "";
    try {
      iostat = (opts.resolveIostat ?? (() => DARWIN_IOSTAT_PATH))();
      child = (opts.spawnProcess ?? spawnInspectionProcess)(iostat, darwinIostatArgs(intervalSec));
    } catch {
      opts.onStatus("unavailable");
      return;
    }
    const parse = makeDarwinIostatParser(
      (sample) => {
        latest = { ...sample, sequence: ++emittedSequence };
        opts.onSample?.(latest);
        resetInactivityTimer();
      },
      () => {
        if (failureReported) return;
        failureReported = true;
        latest = null;
        opts.onStatus("parse");
        child?.kill("SIGTERM");
      },
    );
    let buffered = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      buffered += String(chunk || "");
      const lines = buffered.split(/\r?\n/u);
      buffered = lines.pop() || "";
      for (const line of lines) parse(line);
      resetInactivityTimer();
    });
    child.on("error", () => {
      if (failureReported) return;
      failureReported = true;
      latest = null;
      opts.onStatus("unavailable");
    });
    child.on("close", () => {
      if (inactivityTimer) clearTimeout(inactivityTimer);
      inactivityTimer = null;
      child = null;
      if (stopped) return;
      latest = null;
      if (!failureReported) opts.onStatus("exit");
      if (restarts++ < 1) launch();
    });
    resetInactivityTimer();
  };
  launch();
  return {
    latest: () => latest,
    stop: async () => {
      stopped = true;
      if (inactivityTimer) clearTimeout(inactivityTimer);
      inactivityTimer = null;
      const running = child;
      if (!running) return;
      await new Promise<void>((resolve) => {
        const timeout = setTimeout(() => {
          running.kill("SIGKILL");
          resolve();
        }, 1000);
        timeout.unref?.();
        running.once("close", () => {
          clearTimeout(timeout);
          resolve();
        });
        running.kill("SIGTERM");
      });
    },
  };
}
