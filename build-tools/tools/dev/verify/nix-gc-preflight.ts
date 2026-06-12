import process from "node:process";
import {
  nixGcLockMessage,
  waitForNoActiveNixGc as waitForNoActiveNixGcDefault,
} from "../../lib/nix-gc-lock";
import { activeNixGcProcesses as activeNixGcProcessesDefault } from "./preflight";
import { appendVerifyLogLine } from "./process-control";

type NixGcProcess = { pid: number; command: string };

export async function recordNixGcPreflight(
  logFile: string | null,
  deps?: {
    activeNixGcProcesses?: () => Promise<NixGcProcess[]>;
    waitForNoActiveNixGc?: (opts?: {
      onWait?: (pids: number[], elapsedMs: number, timeoutMs: number) => void;
    }) => Promise<number[]>;
    appendVerifyLogLine?: (logFile: string | null, line: string) => Promise<void>;
    writeStderr?: (text: string) => void;
  },
): Promise<void> {
  const activeNixGcProcesses = deps?.activeNixGcProcesses || activeNixGcProcessesDefault;
  const waitForNoActiveNixGc = deps?.waitForNoActiveNixGc || waitForNoActiveNixGcDefault;
  const appendLine = deps?.appendVerifyLogLine || appendVerifyLogLine;
  const writeStderr = deps?.writeStderr || ((text: string) => process.stderr.write(text));

  const nixGc = await activeNixGcProcesses();
  if (nixGc.length > 0) {
    const sample = nixGc
      .slice(0, 3)
      .map((p) => `${p.pid}:${p.command.slice(0, 120)}`)
      .join(" | ");
    await appendLine(
      logFile,
      `[verify] nix gc preflight warning: active_gc_processes=${nixGc.length} sample=${sample}`,
    );
    writeStderr(
      `[verify] WARNING: active 'nix store gc' process(es) detected (${nixGc
        .map((p) => p.pid)
        .join(", ")}); waiting for GC to finish before starting tests.\n`,
    );
    process.env.VBR_VERIFY_NIX_GC_DETECTED = "1";

    const remaining = await waitForNoActiveNixGc({
      onWait: (pids, elapsedMs, timeoutMs) => {
        const elapsedSec = Math.floor(elapsedMs / 1000);
        const timeoutSec = Math.floor(timeoutMs / 1000);
        writeStderr(
          `[verify] nix gc preflight: waiting elapsed=${elapsedSec}s timeout=${timeoutSec}s active=${pids.join(
            ",",
          )}\n`,
        );
      },
    });
    if (remaining.length > 0) {
      const message = nixGcLockMessage("verify", remaining);
      await appendLine(logFile, `[verify] nix gc preflight error: ${message}`);
      throw new Error(message);
    }
    await appendLine(logFile, "[verify] nix gc preflight: gc completed");
  } else {
    await appendLine(logFile, "[verify] nix gc preflight: ok");
    process.env.VBR_VERIFY_NIX_GC_DETECTED = "0";
  }
  process.env.VBR_VERIFY_NIX_GC_PRECHECK_OK = "1";
}
