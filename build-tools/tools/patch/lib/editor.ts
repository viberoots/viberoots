import { spawn, type ChildProcess } from "node:child_process";

const DEFAULT_EDITOR_TIMEOUT_SECS = 300;
const EDITOR_KILL_GRACE_MS = 250;

function editorTimeoutMs(): number {
  const raw = String(process.env.PATCH_EDITOR_TIMEOUT_SECS || "").trim();
  if (!raw) return DEFAULT_EDITOR_TIMEOUT_SECS * 1_000;
  const seconds = Number(raw);
  if (!Number.isFinite(seconds) || seconds <= 0) {
    throw new Error("PATCH_EDITOR_TIMEOUT_SECS must be a positive number");
  }
  return seconds * 1_000;
}

function signalEditor(child: ChildProcess, signal: NodeJS.Signals): void {
  if (child.pid && process.platform !== "win32") {
    try {
      process.kill(-child.pid, signal);
      return;
    } catch {}
  }
  try {
    child.kill(signal);
  } catch {}
}

export async function runPatchEditor(editor: string, cwd: string): Promise<void> {
  const timeoutMs = editorTimeoutMs();
  await new Promise<void>((resolve, reject) => {
    const child = spawn(editor, {
      cwd,
      stdio: "inherit",
      shell: true,
      detached: process.platform !== "win32",
    });
    let timedOut = false;
    let settled = false;
    let killTimer: NodeJS.Timeout | undefined;
    const timeout = setTimeout(() => {
      timedOut = true;
      signalEditor(child, "SIGTERM");
      killTimer = setTimeout(() => {
        signalEditor(child, "SIGKILL");
        child.unref();
        finish(new Error(`PATCH_EDITOR timed out after ${timeoutMs / 1_000} seconds`));
      }, EDITOR_KILL_GRACE_MS);
    }, timeoutMs);
    timeout.unref();
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (killTimer) clearTimeout(killTimer);
      if (error) reject(error);
      else resolve();
    };
    child.once("error", (error) => finish(error));
    child.once("exit", (code, signal) => {
      if (timedOut) {
        return;
      } else if (code === 0) {
        finish();
      } else {
        finish(
          new Error(`PATCH_EDITOR exited with code ${String(code)}${signal ? ` (${signal})` : ""}`),
        );
      }
    });
  });
}
