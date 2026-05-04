import process from "node:process";
import { activeNixGcProcesses } from "./preflight";
import { appendVerifyLogLine } from "./process-control";

export async function recordNixGcPreflight(logFile: string | null): Promise<void> {
  const nixGc = await activeNixGcProcesses();
  if (nixGc.length > 0) {
    const sample = nixGc
      .slice(0, 3)
      .map((p) => `${p.pid}:${p.command.slice(0, 120)}`)
      .join(" | ");
    await appendVerifyLogLine(
      logFile,
      `[verify] nix gc preflight warning: active_gc_processes=${nixGc.length} sample=${sample}`,
    );
    process.stderr.write(
      `[verify] WARNING: active 'nix store gc' process(es) detected (${nixGc
        .map((p) => p.pid)
        .join(", ")}); continuing verify with potential contention.\n`,
    );
    process.env.BNX_VERIFY_NIX_GC_DETECTED = "1";
  } else {
    await appendVerifyLogLine(logFile, "[verify] nix gc preflight: ok");
    process.env.BNX_VERIFY_NIX_GC_DETECTED = "0";
  }
  process.env.BNX_VERIFY_NIX_GC_PRECHECK_OK = "1";
}
