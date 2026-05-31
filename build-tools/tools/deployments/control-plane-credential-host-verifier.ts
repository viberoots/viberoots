import * as fsp from "node:fs/promises";
import path from "node:path";
import {
  CONTROL_PLANE_CREDS,
  CONTROL_PLANE_GID,
  CONTROL_PLANE_UID,
} from "./cloud-control-process-contract";
import type { LiveHostVerificationEvidence } from "./control-plane-credential-staging-types";

export async function verifyLiveCredentialHostMount(opts: {
  credentialDirectory: string;
  requiredFiles: string[];
  awsProfileText?: string;
  systemdUnits?: string[];
  expectedOwner?: { uid: number; gid: number };
  targetPath?: string;
}): Promise<LiveHostVerificationEvidence> {
  const root = path.resolve(opts.credentialDirectory);
  const realRoot = await fsp.realpath(root);
  const targetPath = opts.targetPath || CONTROL_PLANE_CREDS;
  if (targetPath !== CONTROL_PLANE_CREDS) {
    throw new Error(`live host mount target must be ${CONTROL_PLANE_CREDS}`);
  }
  if (root !== path.resolve(CONTROL_PLANE_CREDS)) {
    throw new Error(`live host verification must inspect ${CONTROL_PLANE_CREDS}`);
  }
  const names = await fsp.readdir(root);
  const expected = sorted(opts.requiredFiles);
  const owner = opts.expectedOwner || { uid: CONTROL_PLANE_UID, gid: CONTROL_PLANE_GID };
  await verifyCredentialFileSet({ root, realRoot, names, expected, owner });
  const awsBindMountVerified = verifyAwsBindMount(opts.awsProfileText, opts.systemdUnits || []);
  return {
    wiringMode: "bind-mounted-credential-directory",
    targetPath,
    filenameSet: expected,
    owner,
    permissions: "0400",
    verifiedBy: "live-host-check",
    evidenceRef: "evidence://credential-staging/deployment-owned-live-host-verification",
    schemaVersion: "control-plane-live-host-verification@1",
    checkedAt: new Date().toISOString(),
    source: "deployment-owned-live-host-verification",
    verifier: "local-filesystem",
    verifierIdentity: "deployment-control-plane-local-host-verifier",
    provenance: {
      kind: "local-host-verifier",
      evidenceRef: "evidence://credential-staging/local-host-verifier",
      sourceHostIdentity: CONTROL_PLANE_CREDS,
      reviewedAt: new Date().toISOString(),
    },
    awsBindMountVerified,
  };
}

export async function verifyCredentialFileSet(opts: {
  root: string;
  realRoot: string;
  names: string[];
  expected: string[];
  owner: { uid: number; gid: number };
}): Promise<void> {
  const { root, realRoot, names, expected, owner } = opts;
  if (JSON.stringify(sorted(names)) !== JSON.stringify(expected)) {
    throw new Error("live host mount filename set does not match current manifest");
  }
  for (const name of names) await verifyCredentialFile(root, realRoot, name, owner);
}

async function verifyCredentialFile(
  root: string,
  realRoot: string,
  name: string,
  owner: { uid: number; gid: number },
): Promise<void> {
  if (name.includes("/") || name === "." || name === "..") {
    throw new Error(`${name}: credential filename is invalid`);
  }
  const file = path.join(root, name);
  const stat = await fsp.lstat(file);
  if (!stat.isFile()) throw new Error(`${name}: credential must be a regular file`);
  if (stat.isSymbolicLink()) throw new Error(`${name}: credential must not be a symlink`);
  if (stat.uid !== owner.uid || stat.gid !== owner.gid) {
    throw new Error(`${name}: credential ownership must be uid/gid ${owner.uid}`);
  }
  if ((stat.mode & 0o777) !== 0o400) {
    throw new Error(`${name}: credential permissions must be 0400`);
  }
  const real = await fsp.realpath(file);
  if (!real.startsWith(`${realRoot}/`)) throw new Error(`${name}: credential escapes mount root`);
}

function verifyAwsBindMount(profileText?: string, systemdUnits: string[] = []): boolean {
  if (!profileText && systemdUnits.length === 0) return false;
  if (profileText && !profileText.includes("bind-mounted-credential-directory")) {
    throw new Error("AWS profile credential mount wiring is stale");
  }
  for (const unit of systemdUnits) {
    if (!unit.includes(`${CONTROL_PLANE_CREDS}:${CONTROL_PLANE_CREDS}:ro`)) {
      throw new Error("AWS systemd credential bind mount must be read-only");
    }
  }
  return true;
}

function sorted(values: string[]): string[] {
  return [...new Set(values.map(String))].sort();
}
