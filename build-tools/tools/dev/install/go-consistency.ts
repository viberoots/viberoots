import crypto from "node:crypto";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { staleMetadataError } from "./metadata-mode";

const FINGERPRINT_PREFIX = "# viberoots-go-input-sha256: ";
const FINGERPRINT_PATTERN = /^# viberoots-go-input-sha256: ([a-f0-9]{64})\r?\n/;

function relativeMetadata(root: string, dir: string, name: string): string {
  return path.relative(root, path.join(dir, name)).replace(/\\/g, "/") || name;
}

export async function goModuleInputFingerprint(dir: string): Promise<string> {
  const hash = crypto.createHash("sha256");
  for (const name of ["go.mod", "go.sum"]) {
    const data = await fsp.readFile(path.join(dir, name));
    hash.update(name);
    hash.update("\0");
    hash.update(String(data.length));
    hash.update("\0");
    hash.update(data);
  }
  return hash.digest("hex");
}

export async function withGoModuleInputFingerprint(
  dir: string,
  gomod2nixToml: string,
): Promise<string> {
  const body = gomod2nixToml.replace(FINGERPRINT_PATTERN, "");
  return `${FINGERPRINT_PREFIX}${await goModuleInputFingerprint(dir)}\n${body}`;
}

export async function assertGoModuleMetadataReady(root: string, dir: string): Promise<void> {
  const goSum = path.join(dir, "go.sum");
  const gomod2nix = path.join(dir, "gomod2nix.toml");
  const goSumRel = relativeMetadata(root, dir, "go.sum");
  const gomod2nixRel = relativeMetadata(root, dir, "gomod2nix.toml");
  try {
    await fsp.access(goSum);
  } catch {
    throw staleMetadataError(goSumRel, "go.mod exists but go.sum is missing");
  }

  const metadata = await fsp.readFile(gomod2nix, "utf8").catch(() => "");
  const recorded = metadata.match(FINGERPRINT_PATTERN)?.[1] || "";
  if (!recorded) {
    throw staleMetadataError(
      gomod2nixRel,
      "Go module metadata is missing its tracked input fingerprint",
    );
  }
  if (recorded !== (await goModuleInputFingerprint(dir))) {
    throw staleMetadataError(
      gomod2nixRel,
      "go.mod or go.sum changed after gomod2nix reconciliation",
    );
  }
}
