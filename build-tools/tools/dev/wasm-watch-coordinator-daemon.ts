#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { getFlagStr } from "../lib/cli";
import { repoRoot } from "../lib/repo";
import {
  computeFingerprintMap,
  copyAtomically,
  mapsEqual,
  runBuildStep,
  type Fingerprint,
} from "./watch-wasm-producer-ops";
import {
  normalizeSubscription,
  type CoordinatorLease,
  type CoordinatorTask,
} from "./wasm-watch-coordinator-types";

function sorted(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean))).sort((a, b) => a.localeCompare(b));
}

async function readLeases(leasesDir: string, leaseTtlMs: number): Promise<CoordinatorLease[]> {
  const names = await fsp.readdir(leasesDir).catch(() => [] as string[]);
  const now = Date.now();
  const leases: CoordinatorLease[] = [];
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    const abs = path.join(leasesDir, name);
    try {
      const raw = await fsp.readFile(abs, "utf8");
      const parsed = JSON.parse(raw) as CoordinatorLease;
      if (!parsed || parsed.schemaVersion !== 1) continue;
      if (!Array.isArray(parsed.subscriptions)) continue;
      const updatedAtMs = Number(parsed.updatedAtMs || 0);
      if (now - updatedAtMs > leaseTtlMs) continue;
      leases.push({
        ...parsed,
        subscriptions: parsed.subscriptions.map((s) => normalizeSubscription(s)),
      });
    } catch {}
  }
  return leases;
}

function tasksFromLeases(leases: CoordinatorLease[]): CoordinatorTask[] {
  const byKey = new Map<string, CoordinatorTask>();
  for (const lease of leases) {
    for (const sub of lease.subscriptions) {
      if (!sub.taskKey || !sub.buildCommand || !sub.buildOut || !sub.buildCwd) continue;
      if (!byKey.has(sub.taskKey)) {
        byKey.set(sub.taskKey, {
          taskKey: sub.taskKey,
          moduleType: "wasm",
          buildCommand: sub.buildCommand,
          buildCwd: sub.buildCwd,
          buildOut: sub.buildOut,
          watchPaths: [...sub.watchPaths],
          syncOuts: [...sub.syncOuts],
          subscribers: [`${lease.appId}:${lease.leaseId}`],
        });
        continue;
      }
      const cur = byKey.get(sub.taskKey)!;
      cur.syncOuts = sorted([...cur.syncOuts, ...sub.syncOuts]);
      cur.watchPaths = sorted([...cur.watchPaths, ...sub.watchPaths]);
      cur.subscribers = sorted([...cur.subscribers, `${lease.appId}:${lease.leaseId}`]);
    }
  }
  return Array.from(byKey.values()).sort((a, b) => a.taskKey.localeCompare(b.taskKey));
}

async function ensureDirs(baseDir: string): Promise<{ leasesDir: string; daemonPid: string }> {
  const leasesDir = path.join(baseDir, "leases");
  await fsp.mkdir(leasesDir, { recursive: true });
  const daemonPid = path.join(baseDir, "daemon.pid");
  return { leasesDir, daemonPid };
}

async function writePidFile(pidPath: string): Promise<void> {
  await fsp.writeFile(
    pidPath,
    JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }) + "\n",
    "utf8",
  );
}

async function main() {
  const root = path.resolve(getFlagStr("root", repoRoot()) || repoRoot());
  const pollMs = Math.max(100, Number(getFlagStr("poll-ms", "300")));
  const leaseTtlMs = Math.max(1500, Number(getFlagStr("lease-ttl-ms", "6000")));
  const idleExitMs = Math.max(5000, Number(getFlagStr("idle-exit-ms", "120000")));
  const baseDir = path.join(root, "buck-out", "tmp", "wasm-watch-coordinator");
  const instanceLockDir = path.join(baseDir, "daemon.instance.lock");
  await fsp.mkdir(baseDir, { recursive: true });
  try {
    await fsp.mkdir(instanceLockDir);
  } catch {
    // Another daemon process already owns the singleton lock for this repo.
    return;
  }
  const { leasesDir, daemonPid } = await ensureDirs(baseDir);
  await writePidFile(daemonPid);
  let stopping = false;
  process.once("SIGINT", () => {
    stopping = true;
  });
  process.once("SIGTERM", () => {
    stopping = true;
  });
  const prevByTask = new Map<string, Map<string, Fingerprint>>();
  const pending = new Map<string, string>();
  let tasks: CoordinatorTask[] = [];
  let byTask = new Map<string, CoordinatorTask>();
  let running = false;
  let buildSeq = 0;
  let lastActiveAt = Date.now();

  const queue = (taskKey: string, reason: string) => {
    pending.set(taskKey, reason);
  };
  const runQueued = async () => {
    if (running) return;
    running = true;
    try {
      while (pending.size > 0) {
        const taskKey = pending.keys().next().value as string | undefined;
        if (!taskKey) break;
        const task = byTask.get(taskKey);
        const reason = pending.get(taskKey) || "unknown";
        pending.delete(taskKey);
        if (!task) continue;
        buildSeq += 1;
        const seq = buildSeq;
        const started = Date.now();
        console.error(
          `[wasm-watchd] rebuild:start seq=${seq} task=${task.taskKey} reason=${reason} subscribers=${task.subscribers.length}`,
        );
        try {
          await runBuildStep(task.buildCommand, task.buildCwd);
          let copiedSize = 0;
          for (const syncOut of task.syncOuts)
            copiedSize = await copyAtomically(task.buildOut, syncOut);
          console.error(
            `[wasm-watchd] sync:ok seq=${seq} task=${task.taskKey} bytes=${copiedSize} elapsed_ms=${Date.now() - started}`,
          );
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error(
            `[wasm-watchd] rebuild:fail seq=${seq} task=${task.taskKey} elapsed_ms=${Date.now() - started}`,
          );
          console.error(msg);
        }
      }
    } finally {
      running = false;
    }
  };

  try {
    console.error(`[wasm-watchd] start root=${root} poll_ms=${pollMs}`);
    for (;;) {
      if (stopping) break;
      const leases = await readLeases(leasesDir, leaseTtlMs);
      if (leases.length > 0) lastActiveAt = Date.now();
      if (leases.length === 0 && Date.now() - lastActiveAt > idleExitMs) {
        console.error("[wasm-watchd] idle:exit");
        break;
      }
      const nextTasks = tasksFromLeases(leases);
      const nextByTask = new Map(nextTasks.map((t) => [t.taskKey, t]));
      const prevKeys = new Set(tasks.map((t) => t.taskKey));
      const nextKeys = new Set(nextTasks.map((t) => t.taskKey));
      for (const removed of Array.from(prevKeys).filter((k) => !nextKeys.has(k))) {
        prevByTask.delete(removed);
        pending.delete(removed);
      }
      for (const added of Array.from(nextKeys).filter((k) => !prevKeys.has(k))) {
        const t = nextByTask.get(added);
        if (!t) continue;
        prevByTask.set(added, await computeFingerprintMap(t.watchPaths));
        queue(added, "startup");
      }
      tasks = nextTasks;
      byTask = nextByTask;
      for (const task of tasks) {
        const prev = prevByTask.get(task.taskKey) || new Map<string, Fingerprint>();
        const next = await computeFingerprintMap(task.watchPaths);
        if (!mapsEqual(prev, next)) {
          prevByTask.set(task.taskKey, next);
          queue(task.taskKey, "source-change");
        }
      }
      await runQueued();
      await new Promise((resolve) => setTimeout(resolve, pollMs));
    }
  } finally {
    await fsp.rm(instanceLockDir, { recursive: true, force: true }).catch(() => {});
    await fsp.rm(daemonPid, { force: true }).catch(() => {});
  }
}

main().catch((err) => {
  console.error("[wasm-watchd] fatal");
  console.error(err instanceof Error ? err.stack || err.message : String(err));
  process.exit(1);
});
