import { pathToFileURL } from "node:url";
import { processTableLines } from "./process-inspection";

function isExactTokenOrNixBin(token: string, binName: "nix" | "nix-store"): boolean {
  if (token === binName) return true;
  return token.endsWith(`/bin/${binName}`);
}

function executableIndex(tokens: string[]): number {
  let index = 0;
  const basename = (value: string) => value.slice(value.lastIndexOf("/") + 1);
  if (basename(tokens[index] || "") === "sudo") {
    index += 1;
    while (index < tokens.length && tokens[index].startsWith("-")) {
      const option = tokens[index++];
      if (
        [
          "-C",
          "-D",
          "-g",
          "-h",
          "-p",
          "-R",
          "-r",
          "-T",
          "-t",
          "-u",
          "--chdir",
          "--group",
          "--host",
          "--prompt",
          "--role",
          "--type",
          "--user",
        ].includes(option)
      ) {
        index += 1;
      }
    }
  }
  if (basename(tokens[index] || "") === "env") {
    index += 1;
    while (index < tokens.length) {
      const token = tokens[index];
      if (token === "-u" || token === "--unset") {
        index += 2;
        continue;
      }
      if (token.startsWith("-") || /^[A-Za-z_][A-Za-z0-9_]*=/.test(token)) {
        index += 1;
        continue;
      }
      break;
    }
  }
  return index;
}

export function isNixGcCommand(cmd: string): boolean {
  const tokens = String(cmd || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (tokens.length === 0) return false;
  const index = executableIndex(tokens);
  const executable = tokens[index];
  if (isExactTokenOrNixBin(executable, "nix")) {
    return tokens[index + 1] === "store" && tokens[index + 2] === "gc";
  }
  if (!isExactTokenOrNixBin(executable, "nix-store")) return false;
  const args = tokens.slice(index + 1);
  return args.includes("--gc") || args.includes("-gc");
}

export async function activeNixGcPids(): Promise<number[]> {
  const lines = await processTableLines({
    psArgs: ["-axo", "pid=,command="],
    timeoutMs: 1500,
    pgrepPattern: "nix store gc|nix-store .*--gc|nix-store .*-gc",
    pgrepToLine: (pid, cmd) => `${pid} ${cmd}`,
  });
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

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  const n = Number(String(raw || "").trim());
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.floor(n);
}

export function gcWaitConfig(): { timeoutMs: number; pollMs: number } {
  const timeoutSec = parsePositiveInt(process.env.NIX_GC_WAIT_TIMEOUT_SECS, 900);
  const pollSec = parsePositiveInt(process.env.NIX_GC_WAIT_POLL_SECS, 2);
  return {
    timeoutMs: timeoutSec * 1000,
    pollMs: pollSec * 1000,
  };
}

export async function waitForNoActiveNixGc(opts?: {
  timeoutMs?: number;
  pollMs?: number;
  onWait?: (pids: number[], elapsedMs: number, timeoutMs: number) => void;
}): Promise<number[]> {
  const cfg = gcWaitConfig();
  const timeoutMs = Math.max(1000, Number(opts?.timeoutMs || cfg.timeoutMs));
  const pollMs = Math.max(250, Number(opts?.pollMs || cfg.pollMs));
  const started = Date.now();
  while (true) {
    const pids = await activeNixGcPids();
    if (pids.length === 0) return [];
    const elapsed = Date.now() - started;
    if (elapsed >= timeoutMs) return pids;
    try {
      opts?.onWait?.(pids, elapsed, timeoutMs);
    } catch {}
    await new Promise<void>((resolve) => setTimeout(resolve, pollMs));
  }
}

export function nixGcLockMessage(context: string, pids: number[]): string {
  return `${context}: blocked by active 'nix store gc' process(es): ${pids.join(", ")}. Stop GC and retry.`;
}

async function main(): Promise<void> {
  const command = process.argv[2] || "";
  if (command !== "wait-for-no-active-gc") {
    throw new Error("usage: nix-gc-lock.ts wait-for-no-active-gc");
  }
  const remaining = await waitForNoActiveNixGc({
    onWait: (pids, elapsedMs, timeoutMs) => {
      if (elapsedMs === 0) {
        console.error(
          `[nix-gc-lock] waiting for active nix store gc process(es): ${pids.join(", ")} ` +
            `(timeout ${Math.ceil(timeoutMs / 1000)}s)`,
        );
      }
    },
  });
  if (remaining.length > 0) {
    console.error(nixGcLockMessage("[nix-gc-lock]", remaining));
    process.exitCode = 1;
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  });
}
