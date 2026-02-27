import { appendVerifyLogLine } from "./process-control.ts";
import { isNixGcCommand } from "../../lib/nix-gc-lock.ts";

export async function activeNixGcProcesses(): Promise<Array<{ pid: number; command: string }>> {
  const out = await $({
    stdio: "pipe",
    reject: false,
  })`ps -axo pid=,command=`;
  if ((out as any).exitCode !== 0) return [];
  const rows: Array<{ pid: number; command: string }> = [];
  const lines = String((out as any).stdout || "").split("\n");
  for (const line of lines) {
    const s = line.trim();
    if (!s) continue;
    const firstSpace = s.indexOf(" ");
    if (firstSpace <= 0) continue;
    const pid = Number(s.slice(0, firstSpace).trim());
    const command = s.slice(firstSpace + 1).trim();
    if (!Number.isFinite(pid) || pid <= 0 || !command) continue;
    if (isNixGcCommand(command)) {
      rows.push({ pid, command });
    }
  }
  return rows;
}

export async function logVerifyRevision(root: string, logFile: string | null): Promise<void> {
  if (!logFile) return;
  // Log the current git revision for performance correlation across runs.
  try {
    const revOut = await $({ cwd: root, stdio: "pipe", reject: false })`git rev-parse HEAD`;
    const rev = String((revOut as any).stdout || "").trim();
    const dirtyOut = await $({
      cwd: root,
      stdio: "pipe",
      reject: false,
    })`bash --noprofile --norc -c 'test -z \"$(git status --porcelain 2>/dev/null)\" && echo 0 || echo 1'`;
    const dirty = String((dirtyOut as any).stdout || "").trim() || "0";
    if (rev) await appendVerifyLogLine(logFile, `[verify] rev=${rev} dirty=${dirty}`);
  } catch {}
}
