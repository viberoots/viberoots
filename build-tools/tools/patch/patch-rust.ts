#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { readFlagStrFromTokens } from "../lib/cli";
import { devOverrideEnvNameForLang } from "../lib/dev-override-envs";
import { requirePositional } from "./lib/args";
import {
  applyWorkspaceWorkflow,
  interruptWorkspaceWorkflow,
  resetWorkspaceWorkflow,
  startWorkspaceWorkflow,
} from "./lib/workspace-workflow";
import { runSession } from "./lib/session";
import type { LanguageHandler } from "./types";
import {
  cargoManifestAlias,
  cargoPackageKey,
  readCargoPackages,
  selectCargoPackage,
} from "./rust-lock";
import { resolveRustCargoRoot } from "./rust-root";
import { rustPatchDir } from "./rust-patch-dir";
import { resolveRustPackageOrigin } from "./rust-source";
import { runRustSyncRequired, rustPatchFilename } from "./rust-sync-required";

async function resolveRequest(args: string[]) {
  const requested = requirePositional(args, 0, {
    name: "<crate> name",
    example: "itoa",
  });
  const cargoRoot = await resolveRustCargoRoot(args);
  const actual = await cargoManifestAlias(path.join(cargoRoot, "Cargo.toml"), requested);
  const packages = await readCargoPackages(path.join(cargoRoot, "Cargo.lock"));
  const pkg = selectCargoPackage(
    packages,
    actual,
    readFlagStrFromTokens("version", "", args).trim(),
    readFlagStrFromTokens("source", "", args).trim(),
  );
  if (!pkg.source) throw new Error("local path dependencies are not third-party patch targets");
  return { requested, cargoRoot, pkg, key: cargoPackageKey(pkg) };
}

async function doStart(args: string[], ownerPid?: number): Promise<void> {
  const request = await resolveRequest(args);
  const originPath = await resolveRustPackageOrigin(request.cargoRoot, request.pkg);
  await startWorkspaceWorkflow({
    lang: "rust",
    key: request.key,
    importPath: request.pkg.name,
    version: request.pkg.version,
    originPath,
    overrideEnvName: devOverrideEnvNameForLang("rust"),
    echoSnippetEnv: "PATCH_RUST_ECHO_SNIPPET",
    moduleKeyForWorkspace: request.key,
    ownerPid,
  });
}

async function doApply(args: string[]): Promise<void> {
  const request = await resolveRequest(args);
  const patchPath = path.join(
    await rustPatchDir(request.cargoRoot, args),
    rustPatchFilename(request.pkg.name, request.pkg.version, request.pkg.source),
  );
  await applyWorkspaceWorkflow({
    lang: "rust",
    key: request.key,
    missingSessionError: `no active session for ${request.key}; run: patch-pkg start rust ${request.requested}`,
    overrideEnvName: devOverrideEnvNameForLang("rust"),
    patchPathAbs: patchPath,
    verifyMode: "rust",
    verifySubjectLabel: "Crate",
    verifySubjectValue: request.key,
    forceWrite: args.includes("--force"),
    skipVerify: false,
  });
}

async function doReset(args: string[]): Promise<void> {
  const request = await resolveRequest(args);
  await resetWorkspaceWorkflow({
    lang: "rust",
    key: request.key,
    overrideEnvName: devOverrideEnvNameForLang("rust"),
  });
}

async function doRemove(args: string[]): Promise<void> {
  const request = await resolveRequest(args);
  const patchDir = await rustPatchDir(request.cargoRoot, args);
  const patchPath = path.join(
    patchDir,
    rustPatchFilename(request.pkg.name, request.pkg.version, request.pkg.source),
  );
  await fsp.rm(patchPath, { force: true });
  if (!readFlagStrFromTokens("patch-dir", "", args).trim()) {
    await fsp.rmdir(patchDir).catch(() => {});
    await fsp.rmdir(path.dirname(patchDir)).catch(() => {});
  }
  await resetWorkspaceWorkflow({
    lang: "rust",
    key: request.key,
    overrideEnvName: devOverrideEnvNameForLang("rust"),
  });
}

async function doInterrupt(args: string[]): Promise<void> {
  const request = await resolveRequest(args);
  await interruptWorkspaceWorkflow({
    lang: "rust",
    key: request.key,
    overrideEnvName: devOverrideEnvNameForLang("rust"),
  });
}

async function doSession(args: string[]): Promise<void> {
  await doStart(args, process.pid);
  await runSession(
    async () => await doApply(args),
    async () => await doReset(args),
    async () => await doInterrupt(args),
  );
}

const handler: LanguageHandler = {
  start: doStart,
  apply: doApply,
  reset: doReset,
  session: doSession,
  remove: doRemove,
  syncRequired: runRustSyncRequired,
};

export default handler;
