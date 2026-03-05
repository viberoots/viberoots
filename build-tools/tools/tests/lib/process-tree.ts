import { spawnSync, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { setTimeout as sleep } from "node:timers/promises";

function parsePid(value: string): number {
  const n = Number(String(value || "").trim());
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function descendantPids(rootPid: number): number[] {
  const ps = spawnSync("ps", ["-Ao", "pid=,ppid="], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  if (ps.status !== 0) return [];
  const childrenByParent = new Map<number, number[]>();
  for (const line of String(ps.stdout || "").split(/\r?\n/)) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 2) continue;
    const pid = parsePid(parts[0] || "");
    const ppid = parsePid(parts[1] || "");
    if (!pid || !ppid) continue;
    if (!childrenByParent.has(ppid)) childrenByParent.set(ppid, []);
    childrenByParent.get(ppid)?.push(pid);
  }
  const out: number[] = [];
  const stack = [...(childrenByParent.get(rootPid) || [])];
  while (stack.length > 0) {
    const pid = stack.pop();
    if (!pid || out.includes(pid)) continue;
    out.push(pid);
    for (const child of childrenByParent.get(pid) || []) stack.push(child);
  }
  return out;
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function signalPids(pids: number[], signal: NodeJS.Signals): void {
  for (const pid of pids) {
    if (!pid || !isAlive(pid)) continue;
    try {
      process.kill(pid, signal);
    } catch {}
  }
}

export async function terminateChildTree(child: ChildProcess, graceMs = 5000): Promise<void> {
  const rootPid = child.pid || 0;
  if (!rootPid) return;
  const targets = [rootPid, ...descendantPids(rootPid)];
  signalPids(targets, "SIGINT");
  try {
    await Promise.race([once(child, "exit"), sleep(graceMs)]);
  } catch {}
  if (child.exitCode != null) return;
  signalPids(targets, "SIGTERM");
  try {
    await Promise.race([once(child, "exit"), sleep(2000)]);
  } catch {}
  if (child.exitCode != null) return;
  signalPids(targets, "SIGKILL");
}
