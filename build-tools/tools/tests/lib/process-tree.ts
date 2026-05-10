import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { setTimeout as sleep } from "node:timers/promises";
import { resolveToolPathSync } from "../../lib/tool-paths";

function parsePid(value: string): number {
  const n = Number(String(value || "").trim());
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function descendantPidsFromPs(rootPid: number): number[] {
  let ps;
  try {
    ps = spawnSync(resolveToolPathSync("ps"), ["-Ao", "pid=,ppid="], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return [];
  }
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

async function childPidsFromPgrep(parentPid: number): Promise<number[]> {
  let pgrepPath = "";
  try {
    pgrepPath = resolveToolPathSync("pgrep");
  } catch {
    return [];
  }
  return await new Promise<number[]>((resolve) => {
    let child;
    try {
      child = spawn(pgrepPath, ["-P", String(parentPid)], {
        stdio: ["ignore", "pipe", "ignore"],
      });
    } catch {
      resolve([]);
      return;
    }
    let buf = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      buf += String(chunk || "");
    });
    child.on("error", () => resolve([]));
    child.on("close", () => {
      resolve(
        String(buf || "")
          .split(/\s+/)
          .map(parsePid)
          .filter(Boolean),
      );
    });
  });
}

async function descendantPidsFromPgrep(rootPid: number): Promise<number[]> {
  const out: number[] = [];
  const stack = await childPidsFromPgrep(rootPid);
  while (stack.length > 0) {
    const pid = stack.pop();
    if (!pid || out.includes(pid)) continue;
    out.push(pid);
    stack.push(...(await childPidsFromPgrep(pid)));
  }
  return out;
}

async function descendantPids(rootPid: number): Promise<number[]> {
  const fromPs = descendantPidsFromPs(rootPid);
  if (fromPs.length > 0) return fromPs;
  return await descendantPidsFromPgrep(rootPid);
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
  const targets = [rootPid, ...(await descendantPids(rootPid))];
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
