import * as fsp from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { registerBuckIsolation } from "./owned-process-state";

export async function initializeVerifyProcessState(root: string): Promise<{
  iso: string;
  stateFile: string;
}> {
  const iso = `v-${process.pid}-${Date.now()}`;
  const stateFile = path.join(root, "buck-out", "tmp", `viberoots-buck-reaper-${iso}.txt`);
  process.env.VBR_BUCK_REAPER_STATE_FILE = process.env.VBR_VERIFY_PROCESS_STATE_FILE = stateFile;
  process.env.VBR_VERIFY_OWNER_PID = String(process.pid);
  await fsp.mkdir(path.dirname(stateFile), { recursive: true }).catch(() => {});
  await fsp.writeFile(stateFile, "", "utf8").catch(() => {});
  await registerBuckIsolation({ stateFile, iso, repoRoot: root, kind: "verify-parent" });
  return { iso, stateFile };
}
