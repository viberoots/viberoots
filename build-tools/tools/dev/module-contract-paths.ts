#!/usr/bin/env zx-wrapper
import path from "node:path";
import { normalizeTargetLabel } from "../lib/labels.ts";
import { repoRoot } from "../lib/repo.ts";
import { sanitizeName } from "../lib/sanitize.ts";
import { toPosixPath } from "../lib/posix-path.ts";

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

export function deriveAppTargetLabelFromCwd(appCwd: string, root: string): string {
  const rootAbs = path.resolve(root);
  const cwdAbs = path.resolve(appCwd);
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
  const root = path.resolve(args.root || repoRoot());
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
