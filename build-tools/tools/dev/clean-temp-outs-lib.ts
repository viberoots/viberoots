import { ownerPidForIsolation } from "./buck-watchdog-lib.ts";

export function shouldRemoveDeadDevBuildIsolationDir(
  name: string,
  isPidAlive: (pid: number) => boolean,
): boolean {
  const iso = String(name || "").trim();
  if (!iso.startsWith("devbuild-")) return false;
  if (iso.startsWith("devbuild-shared-")) return false;

  const ownerPid = ownerPidForIsolation(iso);
  if (ownerPid === null) return false;
  return !isPidAlive(ownerPid);
}
