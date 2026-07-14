function diagnosticsEnabled(): boolean {
  const mode = String(process.env.TEST_TIMING || "").trim();
  return mode === "1" || mode === "summary" || process.env.TEST_TIMING_SUMMARY === "1";
}

function diagnosticsDetailEnabled(): boolean {
  return String(process.env.TEST_TIMING || "").trim() === "1";
}

function readInt(value: unknown): number {
  const n = Number.parseInt(String(value || "").trim(), 10);
  return Number.isFinite(n) ? n : 0;
}

export function filteredFlakeDiagnosticsEnabled(): boolean {
  return diagnosticsEnabled();
}

export function formatTimingDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(ms < 10_000 ? 2 : 1)}s`;
  const mins = Math.floor(ms / 60_000);
  const secs = ((ms % 60_000) / 1000).toFixed(1);
  return `${mins}m${secs}s`;
}

export async function readSnapshotStats(
  dir: string,
): Promise<{ fileCount: number; dirCount: number; kb: number }> {
  const [{ stdout: files }, { stdout: dirs }, { stdout: kb }] = await Promise.all([
    runCommand({ command: "find", args: [dir, "-type", "f", "-print"] }),
    runCommand({ command: "find", args: [dir, "-type", "d", "-print"] }),
    runCommand({ command: "du", args: ["-sk", dir] }),
  ]);
  return {
    fileCount: files.trim() ? files.trimEnd().split("\n").length : 0,
    dirCount: dirs.trim() ? dirs.trimEnd().split("\n").length : 0,
    kb: readInt(String(kb || "").split(/\s+/)[0]),
  };
}

export async function readDirtyGitStats(workspaceRoot: string): Promise<{
  entryCount: number;
  sample: string[];
} | null> {
  if (!diagnosticsEnabled()) return null;
  const status = await runCommand({
    command: "git",
    args: ["status", "--porcelain", "--untracked-files=normal"],
    cwd: workspaceRoot,
    allowFailure: true,
  });
  if (Number(status.exitCode || 0) !== 0) return null;
  const entries = String(status.stdout || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  return {
    entryCount: entries.length,
    sample: diagnosticsDetailEnabled() ? entries.slice(0, 8) : [],
  };
}
import { runCommand } from "./filtered-flake-command";
