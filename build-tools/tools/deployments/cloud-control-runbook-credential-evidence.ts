import * as fsp from "node:fs/promises";
import path from "node:path";
import {
  digestCredentialInput,
  validateCredentialRotationEvidence,
  validateCredentialStagingEvidence,
} from "./control-plane-credential-staging-evidence";

export async function validateCredentialStagingOutput(
  profileRoot: string,
  fileName = "credential-staging.json",
): Promise<string[]> {
  const localPath = path.join(profileRoot, fileName);
  if (!(await exists(localPath))) return [];
  return validateCredentialStagingEvidence(await readJson(localPath), {
    ...(await credentialDigestExpectations(profileRoot)),
    requireLive: fileName === "credential-staging.live.json",
  });
}

export async function validateCredentialRotationOutput(profileRoot: string): Promise<string[]> {
  const localPath = path.join(profileRoot, "credential-rotation.json");
  if (!(await exists(localPath))) return [];
  return validateCredentialRotationEvidence(
    await readJson(localPath),
    await credentialDigestExpectations(profileRoot),
  );
}

async function credentialDigestExpectations(profileRoot: string) {
  const [manifest, map] = await Promise.all([
    readJson(path.join(profileRoot, "credential-manifest.json")),
    readJson(path.join(profileRoot, "credential-map.json")),
  ]);
  return {
    manifestDigest: digestCredentialInput(manifest),
    credentialMapDigest: digestCredentialInput(map),
    requiredFiles: requiredFiles(manifest),
    credentialMap: map,
    maxAgeMinutes: 60,
  };
}

function requiredFiles(manifest: any): string[] {
  return [...new Set((manifest?.requiredFiles || []).map(String))].sort();
}

async function readJson(file: string): Promise<any> {
  return JSON.parse(await fsp.readFile(file, "utf8"));
}

async function exists(file: string): Promise<boolean> {
  return await fsp
    .access(file)
    .then(() => true)
    .catch(() => false);
}
