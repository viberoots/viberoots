#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { createRegisteredStateCleaner } from "./verify/registered-state-cleanup";
import { mkdirWithMacosMetadataExclusion } from "../lib/macos-metadata";
import { findRepoRoot } from "../lib/repo";

type EnvSnapshot = {
  stateFile?: string;
  reaperStateFile?: string;
  ownerPid?: string;
};

function restoreEnv(snapshot: EnvSnapshot): void {
  if (snapshot.stateFile === undefined) delete process.env.VBR_VERIFY_PROCESS_STATE_FILE;
  else process.env.VBR_VERIFY_PROCESS_STATE_FILE = snapshot.stateFile;
  if (snapshot.reaperStateFile === undefined) delete process.env.VBR_BUCK_REAPER_STATE_FILE;
  else process.env.VBR_BUCK_REAPER_STATE_FILE = snapshot.reaperStateFile;
  if (snapshot.ownerPid === undefined) delete process.env.VBR_VERIFY_OWNER_PID;
  else process.env.VBR_VERIFY_OWNER_PID = snapshot.ownerPid;
}

export async function withRegisteredToolState<T>(kind: string, fn: () => Promise<T>): Promise<T> {
  if (String(process.env.VBR_VERIFY_PROCESS_STATE_FILE || "").trim()) {
    return await fn();
  }

  const root = await findRepoRoot(process.cwd());
  const tmpRoot = path.join(root, ".viberoots", "workspace", "buck", "tmp");
  const logRoot = path.join(root, ".viberoots", "workspace", "buck", "test-logs");
  await mkdirWithMacosMetadataExclusion(tmpRoot);
  await mkdirWithMacosMetadataExclusion(logRoot);
  const stamp = `${Date.now()}-${process.pid}`;
  const stateFile = path.join(tmpRoot, `${kind}-buck-reaper-${stamp}.txt`);
  const logFile = path.join(logRoot, `${kind}-cleanup-${stamp}.log`);
  await fsp.writeFile(stateFile, "", "utf8");

  const snapshot: EnvSnapshot = {
    stateFile: process.env.VBR_VERIFY_PROCESS_STATE_FILE,
    reaperStateFile: process.env.VBR_BUCK_REAPER_STATE_FILE,
    ownerPid: process.env.VBR_VERIFY_OWNER_PID,
  };
  process.env.VBR_VERIFY_PROCESS_STATE_FILE = stateFile;
  process.env.VBR_BUCK_REAPER_STATE_FILE = stateFile;
  process.env.VBR_VERIFY_OWNER_PID = String(process.pid);

  const cleanup = createRegisteredStateCleaner({ stateFile, logFile });
  try {
    return await fn();
  } finally {
    await cleanup();
    restoreEnv(snapshot);
  }
}
