import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { workspaceCargoHome } from "../dev/install/cargo-home";
import type { ProtectedRustPatchCaseDefinition } from "./protected-rust-patch-case-definitions";
import {
  injectProtectedTargetArgs,
  injectProtectedTargetSources,
  installProtectedConsumerSources,
} from "./protected-rust-patch-consumer-sources";
import { addLockedDependency } from "./protected-rust-patch-lock";

export const PROTECTED_DEPENDENCY = {
  name: "viberoots-protected-behavior",
  crate: "viberoots_protected_behavior",
  version: "1.0.0",
  source: "registry+https://registry.viberoots.invalid/public-index",
  registryName: "viberoots-public",
} as const;

export const PROTECTED_DEPENDENCY_STORE_NAME =
  `${PROTECTED_DEPENDENCY.name}-${PROTECTED_DEPENDENCY.version}` as const;

export type ProtectedDependencyAuthority = {
  checksum: string;
  storePath: string;
  narHash: string;
};

export async function createProtectedDependencySource(root: string): Promise<{
  sourceRoot: string;
  checksum: string;
}> {
  const sourceRoot = path.join(root, "fixed-source", PROTECTED_DEPENDENCY.name);
  const manifest = [
    "[package]",
    `name = "${PROTECTED_DEPENDENCY.name}"`,
    `version = "${PROTECTED_DEPENDENCY.version}"`,
    'edition = "2021"',
    "",
  ].join("\n");
  const library = "pub fn observed() -> i32 { 42 }\n";
  await fs.mkdir(path.join(sourceRoot, "src"), { recursive: true });
  await fs.writeFile(path.join(sourceRoot, "Cargo.toml"), manifest);
  await fs.writeFile(path.join(sourceRoot, "src/lib.rs"), library);
  const files = {
    "Cargo.toml": sha256Hex(manifest),
    "src/lib.rs": sha256Hex(library),
  };
  const checksum = crypto
    .createHash("sha256")
    .update(`${PROTECTED_DEPENDENCY.name} public crate archive`)
    .digest("hex");
  await fs.writeFile(
    path.join(sourceRoot, ".cargo-checksum.json"),
    `${JSON.stringify({ files, package: checksum })}\n`,
  );
  return { sourceRoot, checksum };
}

export async function prepareProtectedRustConsumer(
  workspaceRoot: string,
  definition: ProtectedRustPatchCaseDefinition,
  authority: ProtectedDependencyAuthority,
): Promise<void> {
  const bundledDependency = path.posix.join(
    definition.cargoRoot,
    ".viberoots-fixed-sources",
    `${PROTECTED_DEPENDENCY.name}-${PROTECTED_DEPENDENCY.version}`,
  );
  await fs.mkdir(path.dirname(path.join(workspaceRoot, bundledDependency)), {
    recursive: true,
  });
  await fs.cp(authority.storePath, path.join(workspaceRoot, bundledDependency), {
    recursive: true,
  });
  const cargoRoot = path.join(workspaceRoot, definition.cargoRoot);
  await addDependency(path.join(cargoRoot, "Cargo.toml"));
  await addLockedDependency(
    path.join(cargoRoot, "Cargo.lock"),
    definition.cargoPackage,
    PROTECTED_DEPENDENCY,
    authority.checksum,
  );
  await installProtectedConsumerSources(workspaceRoot, definition, PROTECTED_DEPENDENCY.crate);
  const fixed = JSON.stringify({
    source: PROTECTED_DEPENDENCY.source,
    checksum: authority.checksum,
    storePath: authority.storePath,
    narHash: authority.narHash,
    registryName: PROTECTED_DEPENDENCY.registryName,
    bundlePath: bundledDependency,
  });
  const sourceEntry = {
    source: PROTECTED_DEPENDENCY.source,
    checksum: authority.checksum,
    storePath: authority.storePath,
    narHash: authority.narHash,
    buildInput: {
      source: PROTECTED_DEPENDENCY.source,
      checksum: authority.checksum,
      storePath: authority.storePath,
      narHash: authority.narHash,
    },
  };
  const cargoHome = workspaceCargoHome(workspaceRoot);
  await fs.mkdir(cargoHome, { recursive: true });
  await fs.writeFile(
    path.join(cargoHome, "viberoots-fixed-sources.json"),
    `${JSON.stringify({ [dependencyKey(authority.checksum)]: sourceEntry }, null, 2)}\n`,
  );
  const args = [
    `cargo_fixed_sources = {${JSON.stringify(dependencyKey(authority.checksum))}: ${JSON.stringify(fixed)}},`,
    ...(definition.id === "rust-pyodide-extension-pr14" ? [] : ["behavior_probe = True,"]),
  ];
  const targets = path.join(workspaceRoot, definition.targetsFile);
  let targetText = await fs.readFile(targets, "utf8");
  const bundledSourceFiles = protectedBundledSourceFiles(definition.targetsFile, bundledDependency);
  targetText = injectProtectedTargetArgs(
    targetText,
    definition.targetName,
    definition.id === "rust-cross-root-pr12" ? ["behavior_probe = True,"] : args,
  );
  if (definition.id === "rust-cross-root-pr12") {
    const appRoot = path.dirname(path.join(workspaceRoot, definition.targetsFile));
    await addDependency(path.join(appRoot, "Cargo.toml"));
    await addLockedDependency(
      path.join(appRoot, "Cargo.lock"),
      `${definition.matrixCase.scaffoldRecipe.name}-app`,
      PROTECTED_DEPENDENCY,
      authority.checksum,
    );
    await addLockedDependency(
      path.join(appRoot, "Cargo.lock"),
      definition.cargoPackage,
      PROTECTED_DEPENDENCY,
      authority.checksum,
    );
    await injectCrossRootCoreTarget(workspaceRoot, definition, bundledDependency, args[0]!);
    targetText = injectProtectedTargetArgs(targetText, definition.targetName, [args[0]!]);
  }
  if (definition.id === "rust-tauri-darwin-pr12") {
    targetText = injectProtectedTargetSources(targetText, "frontend_wasm", bundledSourceFiles);
    targetText = injectProtectedTargetArgs(targetText, "frontend_wasm", [
      `cargo_fixed_sources = {${JSON.stringify(dependencyKey(authority.checksum))}: ${JSON.stringify(fixed)}},`,
    ]);
  }
  if (definition.id !== "rust-cross-root-pr12") {
    targetText = injectProtectedTargetSources(
      targetText,
      definition.targetName,
      bundledSourceFiles,
    );
  }
  await fs.writeFile(targets, targetText);
}

async function injectCrossRootCoreTarget(
  workspaceRoot: string,
  definition: ProtectedRustPatchCaseDefinition,
  bundledDependency: string,
  fixedSourceArg: string,
): Promise<void> {
  const coreTargets = path.join(workspaceRoot, definition.cargoRoot, "TARGETS");
  let coreText = await fs.readFile(coreTargets, "utf8");
  coreText = injectProtectedTargetSources(
    coreText,
    definition.cargoPackage,
    protectedBundledSourceFiles(
      path.posix.join(definition.cargoRoot, "TARGETS"),
      bundledDependency,
    ),
  );
  await fs.writeFile(
    coreTargets,
    injectProtectedTargetArgs(coreText, definition.cargoPackage, [fixedSourceArg]),
  );
}

function protectedBundledSourceFiles(targetsFile: string, bundledDependency: string): string[] {
  const relativeBundle = path.posix.relative(path.posix.dirname(targetsFile), bundledDependency);
  return ["Cargo.toml", "src/lib.rs", ".cargo-checksum.json"].map((file) =>
    path.posix.join(relativeBundle, file),
  );
}

export function dependencyKey(_checksum: string): string {
  return `${PROTECTED_DEPENDENCY.name}@${PROTECTED_DEPENDENCY.version}#${PROTECTED_DEPENDENCY.source}`;
}

function sha256Hex(bytes: string): string {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

async function addDependency(manifest: string): Promise<void> {
  let text = await fs.readFile(manifest, "utf8");
  const dependency = `${PROTECTED_DEPENDENCY.name} = { version = "=${PROTECTED_DEPENDENCY.version}", registry = "${PROTECTED_DEPENDENCY.registryName}" }`;
  if (text.includes(dependency)) return;
  const heading = "[dependencies]";
  const index = text.indexOf(heading);
  if (index < 0) text += `\n${heading}\n${dependency}\n`;
  else
    text = `${text.slice(0, index + heading.length)}\n${dependency}${text.slice(index + heading.length)}`;
  await fs.writeFile(manifest, text);
}
