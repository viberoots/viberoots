import { registerBuckIsolationSync } from "./owned-process-state";

export function registerVerifyBuckTestIsolations(opts: {
  parentIso: string;
  nestedIso: string;
  repoRoot: string;
}): void {
  const stateFile = String(process.env.VBR_VERIFY_PROCESS_STATE_FILE || "").trim();
  if (!stateFile) return;
  try {
    registerBuckIsolationSync({
      stateFile,
      iso: opts.parentIso,
      repoRoot: opts.repoRoot,
      kind: "verify-pass",
    });
    registerBuckIsolationSync({
      stateFile,
      iso: opts.nestedIso,
      repoRoot: opts.repoRoot,
      kind: "verify-nested",
    });
  } catch {}
}
