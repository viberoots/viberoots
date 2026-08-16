import fs from "node:fs/promises";
import path from "node:path";

type ResolveRoots = () => Promise<string[]>;
type LogsDirsFor = (root: string) => string[];
type AgentDirsFor = (root: string) => string[];

async function statFirstExisting(paths: string[]) {
  for (const p of paths) {
    const st = await fs.stat(p).catch(() => null);
    if (st) return st;
  }
  return null;
}

async function realVerifyLogForUnmanagedWrapper(opts: {
  root: string;
  wrapperLogText: string;
  logsDirsFor: LogsDirsFor;
}): Promise<string | null> {
  const refs = Array.from(
    opts.wrapperLogText.matchAll(
      /(?:\/[^\s]+)?\.viberoots\/(?:workspace\/)?buck\/verify-logs\/verify-[^\s]+\.log/g,
    ),
  )
    .map((match) => match[0] || "")
    .map((value) => (path.isAbsolute(value) ? value : path.join(opts.root, value)))
    .filter(Boolean);
  for (const ref of refs.reverse()) {
    const st = await fs.stat(ref).catch(() => null);
    if (st?.isFile()) return await fs.realpath(ref).catch(() => ref);
  }
  return null;
}

export async function bestActiveUnmanagedAgentLog(opts: {
  resolveCandidateRoots: ResolveRoots;
  logsDirsFor: LogsDirsFor;
  unmanagedLogsDirsFor: AgentDirsFor;
}): Promise<{ pid: number; logPath: string } | null> {
  let best: { logPath: string; mtime: number } | null = null;
  const now = Date.now();
  for (const root of await opts.resolveCandidateRoots()) {
    for (const dir of opts.unmanagedLogsDirsFor(root)) {
      let entries: string[] = [];
      try {
        entries = await fs.readdir(dir);
      } catch {
        continue;
      }
      for (const name of entries) {
        if (!name.endsWith(".log")) continue;
        const logPath = path.join(dir, name);
        const base = logPath.slice(0, -".log".length);
        const [logStat, startStat, statusStat] = await Promise.all([
          fs.stat(logPath).catch(() => null),
          statFirstExisting([`${base}.start`, `${logPath}.start`]),
          statFirstExisting([`${base}.status`, `${logPath}.status`]),
        ]);
        if (!logStat?.isFile() || !startStat?.isFile() || statusStat) continue;
        if (now - logStat.mtimeMs > 30 * 60 * 1000) continue;
        const head = await fs.readFile(logPath, "utf8").catch(() => "");
        if (!head.includes("viberoots verify") && !head.includes("Command: i && b && v")) {
          continue;
        }
        const verifyLog = await realVerifyLogForUnmanagedWrapper({
          root,
          wrapperLogText: head,
          logsDirsFor: opts.logsDirsFor,
        });
        if (verifyLog) return { pid: 0, logPath: verifyLog };
        if (!best || logStat.mtimeMs > best.mtime) {
          const lp = await fs.realpath(logPath).catch(() => logPath);
          best = { logPath: lp, mtime: logStat.mtimeMs };
        }
      }
    }
  }
  return best ? { pid: 0, logPath: best.logPath } : null;
}
