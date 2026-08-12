import assert from "node:assert/strict";
import { processTreeRows } from "../lib/process-tree";

export async function stopTauriProduction(childPid: number): Promise<void> {
  try {
    process.kill(-childPid, "SIGTERM");
  } catch {
    // The child may already have completed its own cleanup.
  }
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (!(await processTreeRows()).some((row) => row.pgid === childPid)) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  try {
    process.kill(-childPid, "SIGKILL");
  } catch {
    // Nothing remains to terminate.
  }
  assert.equal(
    (await processTreeRows()).some((row) => row.pgid === childPid),
    false,
    "Tauri production process group survived cleanup",
  );
}
