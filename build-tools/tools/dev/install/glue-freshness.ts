import path from "node:path";
import {
  prebuildFingerprintFresh,
  writePrebuildFingerprint,
  type FingerprintFreshness,
} from "../../buck/prebuild/fingerprint";
import { listFreshnessOutputs, listOutputs } from "../../buck/prebuild/scan";
import { buildToolPath } from "../dev-build/paths";

export function glueFreshnessOutputs(workspaceRoot: string): string[] {
  return [
    ...listFreshnessOutputs(listOutputs()),
    path.relative(workspaceRoot, buildToolPath(workspaceRoot, "lang/importer_roots.bzl")),
    path.relative(workspaceRoot, buildToolPath(workspaceRoot, "tools/nix/langs.nix")),
    path.relative(workspaceRoot, buildToolPath(workspaceRoot, "lang/nix_attr_aliases.bzl")),
  ].map((p) => p.replace(/\\/g, "/"));
}

export async function glueFingerprintFresh(workspaceRoot: string): Promise<FingerprintFreshness> {
  return await prebuildFingerprintFresh({
    root: workspaceRoot,
    outputs: glueFreshnessOutputs(workspaceRoot),
  });
}

export async function writeGlueFingerprint(workspaceRoot: string): Promise<void> {
  await writePrebuildFingerprint({
    root: workspaceRoot,
    outputs: glueFreshnessOutputs(workspaceRoot),
  });
}
