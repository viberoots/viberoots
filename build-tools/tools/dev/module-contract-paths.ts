#!/usr/bin/env zx-wrapper
import fs from "node:fs";
import path from "node:path";
import { normalizeTargetLabel } from "../lib/labels";
import { repoRoot } from "../lib/repo";
import { sanitizeName } from "../lib/sanitize";
import { toPosixPath } from "../lib/posix-path";

export type ModuleContractsPaths = {
  repoRoot: string;
  appTargetLabel: string;
  appId: string;
  contractsDir: string;
  wasmManifestPath: string;
  tsManifestPath: string;
};

export function deriveAppIdFromTargetLabel(appTargetLabel: string): string {
  const normalized = normalizeTargetLabel(appTargetLabel);
  const appId = sanitizeName(normalized);
  if (!appId) {
    throw new Error(
      `[module-contracts:E_APP_ID_INVALID] could not derive app-id from target '${appTargetLabel}'`,
    );
  }
  return appId;
}

function canonicalPath(p: string): string {
  const resolved = path.resolve(p);
  try {
    return fs.realpathSync.native(resolved);
  } catch {
    return resolved;
  }
}

export function deriveAppTargetLabelFromCwd(appCwd: string, root: string): string {
  const rootAbs = canonicalPath(root);
  const cwdAbs = canonicalPath(appCwd);
  const rel = toPosixPath(path.relative(rootAbs, cwdAbs));
  if (rel === "." || rel.startsWith("../")) {
    throw new Error(
      `[module-contracts:E_APP_CWD_OUTSIDE_REPO] app cwd '${cwdAbs}' is not inside repo root '${rootAbs}'`,
    );
  }
  return `//${rel}:app`;
}

export function resolveModuleContractsPaths(args: {
  appCwd: string;
  appTargetLabel?: string;
  root?: string;
}): ModuleContractsPaths {
  const root = canonicalPath(args.root || repoRoot());
  const appTargetLabel = normalizeTargetLabel(
    args.appTargetLabel || deriveAppTargetLabelFromCwd(args.appCwd, root),
  );
  const appId = deriveAppIdFromTargetLabel(appTargetLabel);
  const contractsDir = path.join(root, "buck-out", "tmp", "module-contracts", appId);
  return {
    repoRoot: root,
    appTargetLabel,
    appId,
    contractsDir,
    wasmManifestPath: path.join(contractsDir, "wasm-modules.manifest.json"),
    tsManifestPath: path.join(contractsDir, "ts-modules.manifest.json"),
  };
}
