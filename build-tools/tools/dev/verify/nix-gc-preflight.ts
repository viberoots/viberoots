import process from "node:process";
import { activeNixGcProcesses as activeNixGcProcessesDefault } from "./preflight";
import { appendVerifyLogLine } from "./process-control";

type NixGcProcess = { pid: number; command: string };

export async function recordNixGcPreflight(
  logFile: string | null,
  deps?: {
    activeNixGcProcesses?: () => Promise<NixGcProcess[]>;
    appendVerifyLogLine?: (logFile: string | null, line: string) => Promise<void>;
    writeStderr?: (text: string) => void;
  },
): Promise<void> {
  const activeNixGcProcesses = deps?.activeNixGcProcesses || activeNixGcProcessesDefault;
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
      `[verify] NOTICE: active 'nix store gc' process(es) detected (${nixGc
        .map((p) => p.pid)
        .join(", ")}); recording GC evidence and continuing.\n`,
    );
    process.env.VBR_VERIFY_NIX_GC_DETECTED = "1";
  } else {
    await appendLine(logFile, "[verify] nix gc preflight: ok");
    process.env.VBR_VERIFY_NIX_GC_DETECTED = "0";
  }
  process.env.VBR_VERIFY_NIX_GC_PRECHECK_OK = "1";
}
