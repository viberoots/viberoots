import fs from "node:fs/promises";
import path from "node:path";
import { stripTypeScriptTypes } from "node:module";

export type ReproducibilityNodeArtifact = {
  format: "esm" | "esm-with-native-addon";
  sourcePath: string;
  outputPaths: readonly string[];
  toolchainAuthority: "nix-store-nodejs-22";
  nativeClosureTarget?: string;
};

export function reproducibilityNodeArtifact(
  format: ReproducibilityNodeArtifact["format"],
  sourcePath: string,
  outputPaths: readonly string[],
  nativeClosureTarget?: string,
): ReproducibilityNodeArtifact {
  return {
    format,
    sourcePath,
    outputPaths,
    toolchainAuthority: "nix-store-nodejs-22",
    ...(nativeClosureTarget ? { nativeClosureTarget } : {}),
  };
}

export async function assertReproducibilityNodeArtifact(opts: {
  contract: ReproducibilityNodeArtifact | undefined;
  evaluationBundleSourceRoot: string;
  outputPath: string;
  runNix: (args: string[]) => Promise<{ stdout: string }>;
  readSource?: (file: string) => Promise<string>;
  transformSource?: (source: string) => string;
}): Promise<void> {
  const contract = opts.contract;
  if (!contract) return;
  if (contract.outputPaths.length !== (contract.format === "esm-with-native-addon" ? 2 : 1)) {
    throw new Error("Node reproducibility contract has an invalid output shape");
  }
  if (
    !opts.evaluationBundleSourceRoot.startsWith("/nix/store/") ||
    !opts.outputPath.startsWith("/nix/store/") ||
    contract.sourcePath.startsWith("/") ||
    contract.outputPaths.some((output) => output.startsWith("/") || output.includes(".."))
  ) {
    throw new Error("Node reproducibility contract requires immutable relative paths");
  }
  const sourceFile = path.join(opts.evaluationBundleSourceRoot, contract.sourcePath);
  const source = opts.readSource
    ? await opts.readSource(sourceFile)
    : await fs.readFile(sourceFile, "utf8");
  const transform =
    opts.transformSource ||
    ((value: string) => stripTypeScriptTypes(value, { mode: "transform", sourceMap: false }));
  const transformed = transform(source);
  const expected = transformed.endsWith("\n") ? transformed : `${transformed}\n`;
  const javascript = (
    await opts.runNix(["store", "cat", `${opts.outputPath}/${contract.outputPaths[0]}`])
  ).stdout;
  if (javascript !== expected) {
    throw new Error("Node reproducibility output does not match its immutable source contract");
  }
  const derivationPath = onlyLine(
    (await opts.runNix(["path-info", "--derivation", opts.outputPath])).stdout,
    "Node artifact derivation",
  );
  const derivation = selectedDerivation(
    JSON.parse((await opts.runNix(["derivation", "show", derivationPath])).stdout),
    derivationPath,
  );
  const inputs = Object.keys(derivation.inputDrvs);
  if (!inputs.some((input) => /-nodejs-22(?:\.|-)[^/]*\.drv$/u.test(input))) {
    throw new Error("Node reproducibility derivation omitted its pinned Node 22 toolchain");
  }
  if (contract.format === "esm-with-native-addon") {
    if (!contract.nativeClosureTarget || contract.outputPaths.length !== 2) {
      throw new Error("mixed Node reproducibility contract lacks its native closure authority");
    }
    const nativeName = sanitizeTarget(contract.nativeClosureTarget);
    const nativeDerivation = inputs.find((input) =>
      new RegExp(`-cppnode-addon-${escapeRegex(nativeName)}-[^/]+\\.drv$`, "u").test(input),
    );
    if (!nativeDerivation) {
      throw new Error("mixed Node reproducibility derivation omitted its native addon input");
    }
    const nativeOutput = selectedDerivationOutput(
      JSON.parse((await opts.runNix(["derivation", "show", nativeDerivation])).stdout),
      nativeDerivation,
    );
    const [packagedHash, dependencyHash] = await Promise.all([
      opts.runNix([
        "hash",
        "file",
        "--type",
        "sha256",
        `${opts.outputPath}/${contract.outputPaths[1]}`,
      ]),
      opts.runNix(["hash", "file", "--type", "sha256", `${nativeOutput}/lib/${nativeName}.node`]),
    ]);
    if (
      !packagedHash.stdout.trim() ||
      packagedHash.stdout.trim() !== dependencyHash.stdout.trim()
    ) {
      throw new Error("mixed Node reproducibility output does not match its native addon input");
    }
  }
}

type Derivation = { inputDrvs: Record<string, unknown> };

function selectedDerivation(value: unknown, derivationPath: string): Derivation {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Node artifact derivation evidence must be an object");
  }
  const selected = (value as Record<string, unknown>)[derivationPath];
  if (!selected || typeof selected !== "object" || Array.isArray(selected)) {
    throw new Error("Node artifact derivation evidence omitted the selected derivation");
  }
  const inputDrvs = (selected as Record<string, unknown>).inputDrvs;
  if (!inputDrvs || typeof inputDrvs !== "object" || Array.isArray(inputDrvs)) {
    throw new Error("Node artifact derivation evidence omitted immutable inputs");
  }
  return { inputDrvs: inputDrvs as Record<string, unknown> };
}

function selectedDerivationOutput(value: unknown, derivationPath: string): string {
  const selected = selectedRecord(value, derivationPath);
  const outputs = selected.outputs;
  if (!outputs || typeof outputs !== "object" || Array.isArray(outputs)) {
    throw new Error("native addon derivation evidence omitted outputs");
  }
  const output = (outputs as Record<string, unknown>).out;
  const outputPath =
    output && typeof output === "object" && !Array.isArray(output)
      ? (output as Record<string, unknown>).path
      : undefined;
  if (typeof outputPath !== "string" || !outputPath.startsWith("/nix/store/")) {
    throw new Error("native addon derivation evidence omitted its immutable output");
  }
  return outputPath;
}

function selectedRecord(value: unknown, key: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Node artifact derivation evidence must be an object");
  }
  const selected = (value as Record<string, unknown>)[key];
  if (!selected || typeof selected !== "object" || Array.isArray(selected)) {
    throw new Error("Node artifact derivation evidence omitted the selected derivation");
  }
  return selected as Record<string, unknown>;
}

function sanitizeTarget(target: string): string {
  return target.replace(/^\/\//u, "").replace(/[:/ ]/gu, "-");
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function onlyLine(stdout: string, name: string): string {
  const lines = stdout.trim().split(/\s+/u).filter(Boolean);
  if (lines.length !== 1 || !lines[0]!.startsWith("/nix/store/") || !lines[0]!.endsWith(".drv")) {
    throw new Error(`${name} must identify exactly one store derivation`);
  }
  return lines[0]!;
}
