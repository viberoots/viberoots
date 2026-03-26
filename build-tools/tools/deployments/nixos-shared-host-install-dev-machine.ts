#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { writeJsonDocument } from "./nixos-shared-host-io.ts";
import {
  NIXOS_SHARED_HOST_DEV_MACHINE_SCHEMA_V1,
  NIXOS_SHARED_HOST_INSTALL_TOOL,
  type NixosSharedHostDevMachineManifest,
} from "./nixos-shared-host-install-contract.ts";

type DevMachineInput = {
  profileName: string;
  destination: string;
  remoteRepoPath: string;
  remoteStatePath: string;
  remoteRuntimeRoot: string;
  remoteRecordsRoot: string;
  sshMode: string;
};

export async function readDevMachineInstallInputFromStdin(): Promise<Partial<DevMachineInput>> {
  if (process.stdin.isTTY) return {};
  const raw = await new Promise<string>((resolve) => {
    let done = false;
    let data = "";
    let timer: NodeJS.Timeout | undefined;
    const onData = (chunk: string | Buffer) => {
      data += String(chunk);
    };
    const onFinish = () => finish();
    const finish = () => {
      if (done) return;
      done = true;
      if (timer) clearTimeout(timer);
      process.stdin.off("data", onData);
      process.stdin.off("end", onFinish);
      process.stdin.off("error", onFinish);
      process.stdin.pause();
      resolve(data);
    };
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", onData);
    process.stdin.once("end", onFinish);
    process.stdin.once("error", onFinish);
    process.stdin.resume();
    timer = setTimeout(finish, 25);
    timer.unref?.();
  });
  const trimmed = raw.trim();
  if (!trimmed) return {};
  try {
    return JSON.parse(trimmed) as Partial<DevMachineInput>;
  } catch (error) {
    throw new Error(`failed to parse dev-machine stdin JSON (${String(error)})`);
  }
}

function requireValue(name: keyof DevMachineInput, value: string): string {
  if (!value.trim()) throw new Error(`missing required dev-machine parameter "${name}"`);
  return value.trim();
}

export function createDevMachineManifest(input: DevMachineInput & { toolFingerprint: string }): {
  fileName: string;
  manifest: NixosSharedHostDevMachineManifest;
} {
  const profileName = requireValue("profileName", input.profileName);
  const fileName = `${profileName}.json`;
  return {
    fileName,
    manifest: {
      schemaVersion: NIXOS_SHARED_HOST_DEV_MACHINE_SCHEMA_V1,
      tool: NIXOS_SHARED_HOST_INSTALL_TOOL,
      toolFingerprint: input.toolFingerprint,
      profileName,
      destination: requireValue("destination", input.destination),
      remoteRepoPath: requireValue("remoteRepoPath", input.remoteRepoPath),
      remoteStatePath: requireValue("remoteStatePath", input.remoteStatePath),
      remoteRuntimeRoot: requireValue("remoteRuntimeRoot", input.remoteRuntimeRoot),
      remoteRecordsRoot: requireValue("remoteRecordsRoot", input.remoteRecordsRoot),
      sshMode: requireValue("sshMode", input.sshMode),
      localManagedPaths: [],
    },
  };
}

export async function installNixosSharedHostDevMachine(opts: {
  outputRoot: string;
  toolFingerprint: string;
  input: DevMachineInput;
  dryRun?: boolean;
}): Promise<{ manifestPath: string; manifest: NixosSharedHostDevMachineManifest }> {
  const { fileName, manifest } = createDevMachineManifest({
    ...opts.input,
    toolFingerprint: opts.toolFingerprint,
  });
  const manifestPath = path.resolve(opts.outputRoot, fileName);
  manifest.localManagedPaths = [manifestPath];
  if (!opts.dryRun) {
    await fsp.mkdir(path.dirname(manifestPath), { recursive: true });
    await writeJsonDocument(manifestPath, manifest);
  }
  return { manifestPath, manifest };
}
