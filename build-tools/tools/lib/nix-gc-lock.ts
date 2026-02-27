import { spawnSync } from "node:child_process";

function isExactTokenOrNixBin(token: string, binName: "nix" | "nix-store"): boolean {
  if (token === binName) return true;
  return token.endsWith(`/bin/${binName}`);
}

export function isNixGcCommand(cmd: string): boolean {
  const tokens = String(cmd || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (tokens.length === 0) return false;
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (isExactTokenOrNixBin(token, "nix") && tokens[i + 1] === "store" && tokens[i + 2] === "gc") {
      return true;
    }
    if (isExactTokenOrNixBin(token, "nix-store")) {
      const rest = tokens.slice(i + 1);
      if (rest.includes("--gc") || rest.includes("-gc")) return true;
    }
  }
  return false;
}

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
    if (isNixGcCommand(cmd)) {
      pids.push(pid);
    }
  }
  return pids;
}

export function nixGcLockMessage(context: string, pids: number[]): string {
  return `${context}: blocked by active 'nix store gc' process(es): ${pids.join(", ")}. Stop GC and retry.`;
}
