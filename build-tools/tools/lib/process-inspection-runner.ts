import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { resolveToolPathSync } from "./tool-paths";

export type ProcessInspectionStatus = "success" | "unavailable" | "timeout" | "error";

export type ProcessTableResult = {
  lines: string[];
  status: ProcessInspectionStatus;
};

export function spawnInspectionProcess(
  cmd: string,
  args: string[],
): ChildProcessWithoutNullStreams {
  return spawn(cmd, args, { stdio: ["pipe", "pipe", "pipe"] });
}

export async function spawnOutputResult(
  cmd: string,
  args: string[],
  timeoutMs: number,
): Promise<{ output: string; status: ProcessInspectionStatus; exitCode: number | null }> {
  return await new Promise((resolve) => {
    let child;
    try {
      child = spawn(cmd, args, { stdio: ["ignore", "pipe", "ignore"] });
    } catch {
      resolve({ output: "", status: "error", exitCode: null });
      return;
    }
    let settled = false;
    let buf = "";
    const finish = (output: string, status: ProcessInspectionStatus, exitCode: number | null) => {
      if (settled) return;
      settled = true;
      resolve({ output, status, exitCode });
    };
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      buf += String(chunk || "");
    });
    child.on("error", () => finish("", "error", null));
    child.on("close", (code) => finish(buf, code === 0 ? "success" : "error", code));
    const timer = setTimeout(
      () => {
        try {
          child.kill("SIGKILL");
        } catch {}
        finish("", "timeout", null);
      },
      Math.max(250, timeoutMs),
    );
    child.on("close", () => clearTimeout(timer));
  });
}

function splitLines(text: string): string[] {
  return String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

export async function psTableResult(
  args: string[],
  timeoutMs: number,
): Promise<ProcessTableResult> {
  let psPath = "";
  try {
    psPath = resolveToolPathSync("ps");
  } catch {
    return { lines: [], status: "unavailable" };
  }
  const result = await spawnOutputResult(psPath, args, timeoutMs);
  const lines = splitLines(result.output);
  return {
    lines,
    status: result.status === "success" && lines.length === 0 ? "unavailable" : result.status,
  };
}

export async function pgrepTableResult(
  pattern: string,
  timeoutMs: number,
  toLine: (pid: number, cmd: string) => string | null,
): Promise<ProcessTableResult> {
  let pgrepPath = "";
  try {
    pgrepPath = resolveToolPathSync("pgrep");
  } catch {
    return { lines: [], status: "unavailable" };
  }
  const result = await spawnOutputResult(pgrepPath, ["-afil", pattern], timeoutMs);
  const lines = splitLines(result.output).flatMap((line) => {
    const match = line.match(/^(\d+)\s+(.*)$/);
    const pid = Number(match?.[1]);
    const cmd = String(match?.[2] || "").trim();
    if (!Number.isFinite(pid) || pid <= 1 || !cmd || cmd.includes("pgrep -afil")) return [];
    const mapped = toLine(pid, cmd);
    return mapped ? [mapped] : [];
  });
  if (lines.length > 0) return { lines, status: "success" };
  if (result.status === "error" && result.exitCode === 1) {
    return { lines: [], status: "unavailable" };
  }
  return { lines: [], status: result.status };
}
