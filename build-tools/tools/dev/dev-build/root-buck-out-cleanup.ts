import * as fsp from "node:fs/promises";
import path from "node:path";
import { buckProcessCommandLines } from "../../lib/process-inspection";

function isDevBuildRootBuckOutEntry(name: string): boolean {
  return name === ".housekeeping" || name.startsWith("devbuild-") || name.startsWith("exporter-");
}

async function removeIfEmpty(dir: string): Promise<void> {
  await fsp.rmdir(dir).catch(() => {});
}

async function liveBuckIsolations(): Promise<Set<string>> {
  const live = new Set<string>();
  for (const line of await buckProcessCommandLines(2000).catch(() => [])) {
    const match = line.match(/--isolation-dir\s+([^\s]+)/);
    const iso = String(match?.[1] || "").trim();
    if (iso) live.add(iso);
  }
  return live;
}

export async function cleanupDevBuildRootBuckOut(root: string): Promise<string[]> {
  const buckOut = path.join(root, "buck-out");
  const removed: string[] = [];
  const broadCleanup = process.env.VBR_DEVBUILD_BROAD_BUCK_OUT_CLEANUP === "1";
  let entries: string[] = [];
  try {
    entries = await fsp.readdir(buckOut);
  } catch {
    return [];
  }

  const live = await liveBuckIsolations();
  for (const entry of entries) {
    if (!isDevBuildRootBuckOutEntry(entry)) continue;
    if (entry.startsWith("devbuild-") || entry.startsWith("exporter-")) {
      if (live.has(entry) && !broadCleanup) continue;
      await $({ stdio: "ignore" })`buck2 --isolation-dir ${entry} kill`.nothrow();
      live.delete(entry);
    }
    if (live.has(entry)) continue;
    await fsp.rm(path.join(buckOut, entry), { recursive: true, force: true }).catch(() => {});
    removed.push(entry);
  }

  const tmp = path.join(buckOut, "tmp");
  const tmpEntries = await fsp.readdir(tmp).catch(() => [] as string[]);
  for (const entry of tmpEntries) {
    const abs = path.join(tmp, entry);
    if (entry.startsWith("dev-build-buck-reaper-")) {
      await fsp.rm(abs, { recursive: true, force: true }).catch(() => {});
      removed.push(`tmp/${entry}`);
      continue;
    }
    if (entry === "shared-isolation-locks") {
      await fsp.rm(abs, { recursive: true, force: true }).catch(() => {});
      removed.push(`tmp/${entry}`);
      continue;
    }
    if (entry === "verify-logs") {
      const logEntries = await fsp.readdir(abs).catch(() => [] as string[]);
      for (const log of logEntries) {
        if (!log.startsWith("dev-build-cleanup-")) continue;
        await fsp.rm(path.join(abs, log), { recursive: true, force: true }).catch(() => {});
        removed.push(`tmp/verify-logs/${log}`);
      }
      await removeIfEmpty(abs);
    }
  }

  await removeIfEmpty(tmp);
  await removeIfEmpty(buckOut);
  return removed;
}
