import { existsSync } from "node:fs";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  parseTsModuleManifest,
  parseWasmModuleManifest,
} from "../scaffolding/webapp-module-manifests.ts";

export type WasmModuleSpec = {
  moduleKey: string;
  moduleType: "wasm";
  watchPaths: string[];
  buildCommand: string;
  buildOut: string;
  syncOut: string;
  extraSyncOuts: string[];
};

function shellQuote(value: string): string {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

async function readJsonObject(absPath: string): Promise<unknown> {
  const raw = await fsp.readFile(absPath, "utf8");
  return JSON.parse(raw);
}

function producerDirForContractDir(contractDir: string): string {
  const normalized = contractDir.replace(/\\/g, "/");
  if (normalized.endsWith("/wasm-contract")) {
    return normalized.slice(0, -"/wasm-contract".length) + "/wasm-producer";
  }
  if (normalized.endsWith("wasm-contract")) {
    return normalized.slice(0, -"wasm-contract".length) + "wasm-producer";
  }
  return path.posix.join(normalized, "..", "wasm-producer");
}

function choosePayloadPath(cwd: string, sourcePath: string, moduleBasename: string): string {
  const sourceNorm = sourcePath.replace(/\\/g, "/");
  const sourceDir = path.posix.dirname(sourceNorm);
  const producerDir = producerDirForContractDir(sourceDir);
  const primary = path.posix.join(producerDir, `${moduleBasename}.txt`);
  const legacy = path.posix.join(producerDir, "payload.txt");
  if (existsSync(path.resolve(cwd, primary))) return primary;
  if (existsSync(path.resolve(cwd, legacy))) return legacy;
  return primary;
}

function producerToolAbsPath(): string {
  const thisFile = fileURLToPath(import.meta.url);
  return path.resolve(path.dirname(thisFile), "build-wasm-producer.ts");
}

export async function specsFromWasmManifest(
  cwd: string,
  wasmManifestPath: string,
): Promise<WasmModuleSpec[]> {
  const manifestAbs = path.resolve(cwd, wasmManifestPath);
  const parsed = parseWasmModuleManifest(
    await readJsonObject(manifestAbs),
    `wasm manifest '${manifestAbs}'`,
  );
  const producerTool = producerToolAbsPath();
  return parsed.modules.map((entry): WasmModuleSpec => {
    const moduleBasename = path.posix.basename(entry.sourcePath.replace(/\\/g, "/"), ".wasm");
    const basename = moduleBasename || entry.moduleKey;
    const payloadRel = choosePayloadPath(cwd, entry.sourcePath, basename);
    const buildOutRel = path.posix.join(".wasm-producer", `${basename}.wasm`);
    const nodeBin = process.execPath;
    const buildCmd = [
      shellQuote(nodeBin),
      "--experimental-strip-types",
      shellQuote(producerTool),
      "--payload",
      shellQuote(payloadRel),
      "--out",
      shellQuote(buildOutRel),
    ].join(" ");
    return {
      moduleKey: entry.moduleKey,
      moduleType: "wasm",
      watchPaths: [path.resolve(cwd, payloadRel)],
      buildCommand: buildCmd,
      buildOut: path.resolve(cwd, buildOutRel),
      syncOut: path.resolve(cwd, entry.sourcePath),
      extraSyncOuts: Array.from(
        new Set(
          [entry.runtimeDestinations.client, entry.runtimeDestinations.server]
            .map((p) => path.resolve(cwd, p))
            .filter((p) => p !== path.resolve(cwd, entry.sourcePath)),
        ),
      ),
    };
  });
}

export async function validateTsManifestProbes(
  cwd: string,
  tsManifestPath: string,
): Promise<string[]> {
  const manifestAbs = path.resolve(cwd, tsManifestPath);
  const parsed = parseTsModuleManifest(
    await readJsonObject(manifestAbs),
    `ts manifest '${manifestAbs}'`,
  );
  const probeLogs: string[] = [];
  for (const entry of parsed.modules) {
    const sourceEntryAbs = path.resolve(cwd, entry.sourceEntryPath);
    const ok = existsSync(sourceEntryAbs);
    probeLogs.push(
      `[wasm-watch] probe:ts module_type=ts module_key=${entry.moduleKey} source=${entry.sourceEntryPath} status=${ok ? "ok" : "missing"}`,
    );
    if (!ok)
      throw new Error(
        `ts manifest module '${entry.moduleKey}' source is missing: ${sourceEntryAbs}`,
      );
  }
  return probeLogs;
}
