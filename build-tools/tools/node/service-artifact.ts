#!/usr/bin/env zx-wrapper
import crypto from "node:crypto";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { getFlagStr } from "../lib/cli";

export const NODE_SERVICE_CONTRACT_SCHEMA = "node-service-runtime@1";
export const NODE_SERVICE_IDENTITY_SCHEMA = "node-service-artifact-identity@1";

type ServiceRuntimeContract = {
  schemaVersion: typeof NODE_SERVICE_CONTRACT_SCHEMA;
  serviceName: string;
  entrypoint: string;
  productionCommand: string[];
  health: { path: string; port: number };
  runtimeConfig?: string[];
  secretRequirements?: string[];
};

type ArtifactFile = { rel: string; abs: string; executable: boolean };

function assertSafeRel(rel: string): void {
  if (!rel || path.isAbsolute(rel) || rel.includes("\0")) {
    throw new Error(`node service artifact contains unsafe path: ${rel}`);
  }
  if (rel.split(/[\\/]/).some((part) => part === "" || part === "..")) {
    throw new Error(`node service artifact contains unsafe path: ${rel}`);
  }
}

function assertEnvNames(names: readonly string[], kind: string): void {
  for (const name of names) {
    if (!/^[A-Z_][A-Z0-9_]*$/.test(name)) {
      throw new Error(`node service ${kind} has invalid env name: ${name}`);
    }
  }
}

async function scanFiles(root: string, dir: string, out: ArtifactFile[]): Promise<void> {
  const entries = await fsp.readdir(dir, { withFileTypes: true });
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const abs = path.join(dir, entry.name);
    const rel = path.relative(root, abs);
    assertSafeRel(rel);
    if (entry.isDirectory()) {
      await scanFiles(root, abs, out);
      continue;
    }
    if (rel === "artifact-identity.json") continue;
    if (entry.isSymbolicLink())
      throw new Error(`node service artifact may not contain symlinks: ${rel}`);
    if (!entry.isFile())
      throw new Error(`node service artifact contains unsupported entry: ${rel}`);
    const stat = await fsp.stat(abs);
    out.push({ rel, abs, executable: (stat.mode & 0o111) !== 0 });
  }
}

async function copyTree(src: string, dest: string): Promise<void> {
  const entries = await fsp.readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      await copyTree(srcPath, destPath);
      continue;
    }
    if (entry.isSymbolicLink())
      throw new Error(`node service input may not contain symlinks: ${srcPath}`);
    if (!entry.isFile()) continue;
    await fsp.mkdir(path.dirname(destPath), { recursive: true });
    await fsp.copyFile(srcPath, destPath);
  }
}

export async function loadServiceRuntimeContract(
  filePath: string,
): Promise<ServiceRuntimeContract> {
  const parsed = JSON.parse(await fsp.readFile(filePath, "utf8")) as ServiceRuntimeContract;
  if (parsed.schemaVersion !== NODE_SERVICE_CONTRACT_SCHEMA) {
    throw new Error(`unsupported node service runtime schema: ${parsed.schemaVersion}`);
  }
  if (!parsed.serviceName || !parsed.entrypoint || parsed.productionCommand?.length === 0) {
    throw new Error(
      "node service runtime contract must declare serviceName, entrypoint, and productionCommand",
    );
  }
  if (!parsed.health?.path?.startsWith("/") || !Number.isInteger(parsed.health?.port)) {
    throw new Error("node service runtime contract must declare health.path and health.port");
  }
  assertSafeRel(parsed.entrypoint);
  assertEnvNames(parsed.runtimeConfig || [], "runtimeConfig");
  assertEnvNames(parsed.secretRequirements || [], "secretRequirements");
  return parsed;
}

export async function artifactIdentityForNodeServiceDir(artifactDir: string): Promise<string> {
  const root = path.resolve(artifactDir);
  const files: ArtifactFile[] = [];
  await scanFiles(root, root, files);
  const hash = crypto.createHash("sha256");
  for (const file of files) {
    hash.update(`${file.rel}\n${file.executable ? "executable" : "file"}\n`);
    hash.update(await fsp.readFile(file.abs));
    hash.update("\n");
  }
  return `node-service:${hash.digest("hex")}`;
}

export async function createNodeServiceArtifact(opts: {
  distDir: string;
  contractPath: string;
  packageJsonPath: string;
  outDir: string;
  identityPath: string;
}): Promise<string> {
  const contract = await loadServiceRuntimeContract(opts.contractPath);
  await fsp.access(path.join(opts.distDir, contract.entrypoint));
  await fsp.rm(opts.outDir, { recursive: true, force: true });
  await fsp.mkdir(opts.outDir, { recursive: true });
  await copyTree(opts.distDir, path.join(opts.outDir, "dist"));
  await fsp.copyFile(opts.packageJsonPath, path.join(opts.outDir, "package.json"));
  await fsp.writeFile(
    path.join(opts.outDir, "runtime-contract.json"),
    JSON.stringify(contract, null, 2) + "\n",
  );
  const identity = await artifactIdentityForNodeServiceDir(opts.outDir);
  await fsp.mkdir(path.dirname(opts.identityPath), { recursive: true });
  await fsp.writeFile(
    opts.identityPath,
    JSON.stringify(
      { schemaVersion: NODE_SERVICE_IDENTITY_SCHEMA, kind: "node-service", identity },
      null,
      2,
    ) + "\n",
  );
  return identity;
}

async function main(): Promise<void> {
  const required = (name: string) => {
    const value = getFlagStr(name).trim();
    if (!value) throw new Error(`missing --${name}`);
    return value;
  };
  await createNodeServiceArtifact({
    distDir: required("dist-dir"),
    contractPath: required("contract"),
    packageJsonPath: required("package-json"),
    outDir: required("out"),
    identityPath: required("identity-out"),
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
