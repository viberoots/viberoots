import path from "node:path";

export function buckIsolationProcessPidsFromLines(opts: {
  root: string;
  iso: string;
  lines: string[];
}): number[] {
  const root = path.resolve(opts.root);
  const stateDir = path.join(root, "buck-out", opts.iso, "forkserver");
  const pids = new Set<number>();
  const daemonByPid = new Map<number, string>();
  for (const line of opts.lines) {
    const parsed = line.match(/^(\d+)\s+(\d+)\s+\S+\s+(.*)$/);
    if (!parsed) continue;
    const pid = Number(parsed[1]);
    const cmd = parsed[3] || "";
    if (
      Number.isFinite(pid) &&
      cmd.includes("buck2d[") &&
      cmd.includes(` --isolation-dir ${opts.iso}`)
    ) {
      daemonByPid.set(pid, cmd);
    }
  }
  for (const line of opts.lines) {
    const parsed = line.match(/^(\d+)\s+(\d+)\s+\S+\s+(.*)$/);
    if (!parsed) continue;
    const pid = Number(parsed[1]);
    const ppid = Number(parsed[2]);
    const cmd = parsed[3] || "";
    if (!Number.isFinite(pid) || !Number.isFinite(ppid)) continue;
    if (!cmd.includes("(buck2-forkserver)") || !cmd.includes(`--state-dir ${stateDir}`)) {
      continue;
    }
    pids.add(pid);
    if (daemonByPid.has(ppid)) pids.add(ppid);
  }
  return [...pids].sort((a, b) => a - b);
}
