import * as fsp from "node:fs/promises";
import path from "node:path";
import type { CredentialMap } from "./cloud-control-credential-map";
import {
  type LiveBackendWriteEvidence,
  type LiveHostVerificationEvidence,
} from "./control-plane-credential-staging-types";
import { readLiveInfisicalBackendProfile } from "./control-plane-credential-live-profile";
import { writeGeneratedSecretsToInfisical } from "./control-plane-credential-live-writer";
import { verifyLiveCredentialHostMount } from "./control-plane-credential-host-verifier";

export type LiveExecutionResult = {
  backendWrite?: LiveBackendWriteEvidence;
  hostVerification?: LiveHostVerificationEvidence;
  errors: string[];
};

export async function runLiveCredentialExecution(opts: {
  live: boolean;
  bundleDir: string;
  credentialMap: CredentialMap;
  requiredFiles: string[];
  liveHostVerificationProvided?: boolean;
  liveBackendProfile?: string;
  credentialDirectory?: string;
  credentialOwnerUid?: number;
  credentialOwnerGid?: number;
}): Promise<LiveExecutionResult> {
  if (!opts.live) return { errors: [] };
  if (process.env.VBR_CONTROL_PLANE_LIVE_CREDENTIAL_STAGING !== "1") return { errors: [] };
  const errors: string[] = [];
  const backendWrite = await backendWriteEvidence(opts).catch((error) => {
    errors.push(String(error?.message || error));
    return undefined;
  });
  const hostVerification = await hostVerificationEvidence(opts).catch((error) => {
    errors.push(String(error?.message || error));
    return undefined;
  });
  return { backendWrite, hostVerification, errors };
}

async function backendWriteEvidence(opts: {
  liveBackendProfile?: string;
  credentialMap: CredentialMap;
}) {
  if (!opts.liveBackendProfile)
    throw new Error("live credential staging requires --live-backend-profile");
  const profile = await readLiveInfisicalBackendProfile(opts.liveBackendProfile);
  return await writeGeneratedSecretsToInfisical({ credentialMap: opts.credentialMap, profile });
}

async function hostVerificationEvidence(opts: {
  credentialDirectory?: string;
  bundleDir: string;
  requiredFiles: string[];
  liveHostVerificationProvided?: boolean;
  credentialOwnerUid?: number;
  credentialOwnerGid?: number;
}) {
  if (opts.liveHostVerificationProvided) return undefined;
  if (!opts.credentialDirectory) {
    throw new Error("live credential staging requires --credential-directory");
  }
  const root = path.resolve(opts.bundleDir);
  return await verifyLiveCredentialHostMount({
    credentialDirectory: opts.credentialDirectory,
    requiredFiles: opts.requiredFiles,
    expectedOwner:
      opts.credentialOwnerUid !== undefined && opts.credentialOwnerGid !== undefined
        ? { uid: opts.credentialOwnerUid, gid: opts.credentialOwnerGid }
        : undefined,
    awsProfileText: await readOptional(path.join(root, "aws-ec2-profile.yaml")),
    systemdUnits: await readSystemdUnits(path.join(root, "systemd")),
  });
}

async function readOptional(file: string): Promise<string | undefined> {
  return await fsp.readFile(file, "utf8").catch(() => undefined);
}

async function readSystemdUnits(dir: string): Promise<string[]> {
  const names = await fsp.readdir(dir).catch(() => []);
  return await Promise.all(
    names
      .filter((name) => name.endsWith(".service"))
      .map((name) => fsp.readFile(path.join(dir, name), "utf8")),
  );
}
