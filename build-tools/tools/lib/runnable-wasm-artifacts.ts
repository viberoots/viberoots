#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { parseWasmModuleManifest } from "../scaffolding/webapp-module-manifests.ts";

function pathFromRuntimeDestination(baseDir: string, runtimeDestination: string): string {
  const pathSegments = runtimeDestination.split("/").filter(Boolean);
  return path.join(baseDir, ...pathSegments);
}

export async function resolveServerWasmContractArtifact(opts: {
  label: string;
  distDir: string;
  allowMissingManifest?: boolean;
}): Promise<string | undefined> {
  const manifestPath = path.join(opts.distDir, "server", "wasm-modules.manifest.json");
  let parsedManifestText = "";
  try {
    parsedManifestText = await fsp.readFile(manifestPath, "utf8");
  } catch {
    if (opts.allowMissingManifest) {
      return undefined;
    }
    throw new Error(
      `runnable contract error for ${opts.label}: missing wasm module manifest at ${manifestPath}`,
    );
  }

  let manifest;
  try {
    manifest = parseWasmModuleManifest(JSON.parse(parsedManifestText), manifestPath);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `runnable contract error for ${opts.label}: invalid wasm module manifest at ${manifestPath}: ${message}`,
    );
  }
  if (manifest.modules.length === 0 || manifest.defaultModuleKey === "") {
    return undefined;
  }

  const defaultEntry = manifest.modules.find(
    (entry) => entry.moduleKey === manifest.defaultModuleKey,
  );
  if (!defaultEntry) {
    throw new Error(
      `runnable contract error for ${opts.label}: default wasm module '${manifest.defaultModuleKey}' is not declared in ${manifestPath}`,
    );
  }

  const serverRuntimeDestination = defaultEntry.runtimeDestinations.server.trim();
  if (!serverRuntimeDestination) {
    throw new Error(
      `runnable contract error for ${opts.label}: default wasm module '${defaultEntry.moduleKey}' is missing runtimeDestinations.server in ${manifestPath}`,
    );
  }
  const serverWasmContract = pathFromRuntimeDestination(opts.distDir, serverRuntimeDestination);
  try {
    const stat = await fsp.stat(serverWasmContract);
    if (!stat.isFile()) throw new Error("not a file");
  } catch {
    throw new Error(
      `runnable contract error for ${opts.label}: missing server wasm contract asset at ${serverWasmContract}`,
    );
  }

  return serverWasmContract;
}
