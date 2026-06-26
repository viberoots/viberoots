import * as fsp from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { mkdirWithMacosMetadataExclusion } from "../../lib/macos-metadata";
import { registerBuckIsolation } from "./owned-process-state";

export async function initializeVerifyProcessState(root: string): Promise<{
  iso: string;
  stateFile: string;
}> {
  const iso = `v-${process.pid}-${Date.now()}`;
  const stateFile = path.join(
    root,
    ".viberoots",
    "workspace",
    "buck",
    "tmp",
    `viberoots-buck-reaper-${iso}.txt`,
  );
  process.env.VBR_BUCK_REAPER_STATE_FILE = process.env.VBR_VERIFY_PROCESS_STATE_FILE = stateFile;
  process.env.VBR_VERIFY_OWNER_PID = String(process.pid);
  await mkdirWithMacosMetadataExclusion(path.dirname(stateFile)).catch(() => {});
  await fsp.writeFile(stateFile, "", "utf8").catch(() => {});
  await registerBuckIsolation({ stateFile, iso, repoRoot: root, kind: "verify-parent" });
  return { iso, stateFile };
}
