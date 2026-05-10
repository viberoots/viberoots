import { spawnSync } from "node:child_process";

export function terminateListenersOnPort(port: number): void {
  const out = spawnSync("lsof", ["-ti", `tcp:${port}`], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  if (out.status !== 0) return;
  const pids = String(out.stdout || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((value) => Number(value))
    .filter((pid) => Number.isFinite(pid) && pid > 1);
  for (const pid of pids) {
    try {
      process.kill(pid, "SIGTERM");
    } catch {}
  }
}
