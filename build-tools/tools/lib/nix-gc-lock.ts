import { spawnSync } from "node:child_process";

export function activeNixGcPids(): number[] {
  const out = spawnSync("ps", ["-axo", "pid=,command="], {
    encoding: "utf8",
  });
  if (out.status !== 0) return [];
  const lines = String(out.stdout || "").split("\n");
  const pids: number[] = [];
  for (const line of lines) {
    const s = line.trim();
    if (!s) continue;
    const i = s.indexOf(" ");
    if (i <= 0) continue;
    const pid = Number(s.slice(0, i).trim());
    const cmd = s.slice(i + 1).trim();
    if (!Number.isFinite(pid) || pid <= 0 || !cmd) continue;
    if (
      cmd.includes("nix store gc") ||
      cmd.includes("nix-store --gc") ||
      cmd.includes("nix-store -gc")
    ) {
      pids.push(pid);
    }
  }
  return pids;
}

export function nixGcLockMessage(context: string, pids: number[]): string {
  return `${context}: blocked by active 'nix store gc' process(es): ${pids.join(", ")}. Stop GC and retry.`;
}
