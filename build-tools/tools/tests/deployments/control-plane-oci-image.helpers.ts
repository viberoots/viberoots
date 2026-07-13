#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { reconcilePnpmStore } from "../../dev/intentional-pnpm-store-reconcile";
import { runInTemp, workspaceFlakeRef } from "../lib/test-helpers";

const execFileAsync = promisify(execFile);
export const CONTROL_PLANE_OCI_IMAGE_HEAVY_ENV = "VBR_CONTROL_PLANE_OCI_IMAGE_HEAVY";

export type ControlPlaneImageTarball = {
  outPath: string;
  repoTag: string;
  config: any;
  layerPaths: string[];
  rootFilesystemPaths: string[];
};

export type ControlPlaneRuntime = {
  outPath: string;
  commandPath: string;
};

export function requireHeavyOciImage(t: { skip(message?: string): void }): boolean {
  if (process.env[CONTROL_PLANE_OCI_IMAGE_HEAVY_ENV] === "1") return true;
  t.skip(`set ${CONTROL_PLANE_OCI_IMAGE_HEAVY_ENV}=1 to build and inspect the OCI image tarball`);
  return false;
}

const fixedStoreByRepo = new Map<string, ReturnType<typeof reconcilePnpmStore>>();
const nixBuildOutputByAttr = new Map<string, Promise<string>>();
const imageTarballByOutputPath = new Map<string, Promise<ControlPlaneImageTarball>>();

export async function buildImageContract() {
  const outPath = await nixBuildOutput("deployment-control-plane-image-contract");
  const raw = await fsp.readFile(path.join(outPath, "contract.json"), "utf8");
  return { outPath, contract: JSON.parse(raw) as any };
}

export async function buildControlPlaneRuntime(): Promise<ControlPlaneRuntime> {
  const outPath = await nixBuildOutput("deployment-control-plane-runtime");
  return { outPath, commandPath: path.join(outPath, "bin", "control-plane") };
}

export async function buildImageTarball(): Promise<ControlPlaneImageTarball> {
  const outPath = await nixBuildOutput("deployment-control-plane-image");
  const cached = imageTarballByOutputPath.get(outPath);
  if (cached) return await cached;
  const parsed = parseImageTarball(outPath);
  imageTarballByOutputPath.set(outPath, parsed);
  return await parsed;
}

async function parseImageTarball(outPath: string): Promise<ControlPlaneImageTarball> {
  return await runInTemp("control-plane-oci-image", async (tmp) => {
    await execFileAsync("tar", ["-xf", outPath, "-C", tmp], { maxBuffer: 1024 * 1024 });
    const manifest = JSON.parse(await fsp.readFile(path.join(tmp, "manifest.json"), "utf8"))[0];
    const config = JSON.parse(await fsp.readFile(path.join(tmp, manifest.Config), "utf8"));
    const repoTag = String(manifest.RepoTags?.[0] || "");
    assert.ok(repoTag, "image archive did not include a repo tag");
    const layerPaths: string[] = [];
    const rootFilesystemPaths = new Set<string>();
    for (const layer of manifest.Layers) {
      const layerPath = path.join(tmp, layer);
      const { stdout } = await execFileAsync("tar", ["-tf", layerPath], {
        maxBuffer: 16 * 1024 * 1024,
      });
      for (const entry of stdout.split(/\n+/).filter(Boolean)) {
        layerPaths.push(entry);
        rootFilesystemPaths.add(normalizeLayerPath(entry));
      }
      await assertNoForbiddenLayerContents(layerPath);
    }
    return {
      outPath,
      repoTag,
      config: config as any,
      layerPaths,
      rootFilesystemPaths: [...rootFilesystemPaths].sort(),
    };
  });
}

export function assertNoSecretPayloads(value: any) {
  const text = JSON.stringify(value);
  for (const forbidden of [
    "postgres://",
    "PRIVATE KEY",
    "BEGIN OPENSSH",
    "infisical-client-secret-value",
    "cloudflare-token",
    "/root/.ssh/id_rsa",
  ]) {
    assert.doesNotMatch(text, escapedPattern(forbidden));
  }
}

export function assertProhibitedPathContract(contract: any) {
  for (const prohibited of [
    ".env",
    "id_rsa",
    "control-plane-database-url",
    "artifact-store-secret-access-key",
    "infisical-client-secret",
  ]) {
    assert.ok(contract.prohibitedPaths.includes(prohibited));
  }
}

export function layerPathMatches(layerPath: string, prohibitedPath: string): boolean {
  const normalizedLayerPath = normalizeLayerPath(layerPath);
  const normalizedProhibitedPath = prohibitedPath.replace(/^\//, "");
  return (
    normalizedLayerPath === normalizedProhibitedPath ||
    normalizedLayerPath.startsWith(`${normalizedProhibitedPath}/`) ||
    normalizedLayerPath.split("/").includes(normalizedProhibitedPath)
  );
}

async function nixBuildOutput(attr: string) {
  const repoRoot = path.resolve(process.env.WORKSPACE_ROOT || process.cwd());
  const key = `${repoRoot}\0${attr}`;
  const cached = nixBuildOutputByAttr.get(key);
  if (cached) return await cached;
  const built = runNixBuildOutput(repoRoot, attr);
  nixBuildOutputByAttr.set(key, built);
  return await built;
}

async function runNixBuildOutput(repoRoot: string, attr: string) {
  const flakeRef = await workspaceFlakeRef(repoRoot);
  const viberootsInput = path.join(repoRoot, "viberoots");
  if (requiresFinalPnpmStore(attr)) await finalPnpmStoreForRepo(repoRoot);
  const { stdout } = await execFileAsync(
    "nix",
    [
      "build",
      `path:${flakeRef}#${attr}`,
      "--override-input",
      "viberoots",
      `path:${viberootsInput}`,
      "--no-link",
      "--print-out-paths",
      "--accept-flake-config",
    ],
    {
      cwd: repoRoot,
      env: process.env,
      maxBuffer: 1024 * 1024,
    },
  );
  const outPath = stdout.trim().split(/\s+/).at(-1) || "";
  assert.ok(outPath, "nix build did not return an output path");
  return outPath;
}

function requiresFinalPnpmStore(attr: string): boolean {
  return attr !== "deployment-control-plane-image-contract";
}

async function finalPnpmStoreForRepo(repoRoot: string) {
  const cached = fixedStoreByRepo.get(repoRoot);
  if (cached) return await cached;
  const prepared = reconcilePnpmStore({ repoRoot, importer: "viberoots" });
  fixedStoreByRepo.set(repoRoot, prepared);
  return await prepared;
}

async function assertNoForbiddenLayerContents(layerPath: string): Promise<void> {
  const scan = await scanTarLayerContents(layerPath);
  assert.equal(
    scan.match,
    null,
    [
      `image layer contains forbidden secret payload: ${scan.match}`,
      scan.stderr ? `tar stderr: ${scan.stderr}` : "",
      scan.error ? `tar error: ${scan.error.message}` : "",
      scan.code === 0 || scan.code === null ? "" : `tar exit code: ${scan.code}`,
      scan.signal ? `tar signal: ${scan.signal}` : "",
    ]
      .filter(Boolean)
      .join("\n"),
  );
  assert.equal(scan.error, null, `failed to scan image layer: ${scan.error?.message}`);
  assert.equal(scan.code, 0, `tar failed while scanning image layer: ${scan.stderr}`);
}

async function scanTarLayerContents(layerPath: string) {
  const child = spawn("tar", ["-xOf", layerPath], { stdio: ["ignore", "pipe", "pipe"] });
  const stderr: Buffer[] = [];
  child.stderr.on("data", (chunk) => stderr.push(chunk as Buffer));
  const close = new Promise<{ code: number | null; signal: NodeJS.Signals | null; error: any }>(
    (resolve) => {
      child.once("error", (error) => resolve({ code: null, signal: null, error }));
      child.once("close", (code, signal) => resolve({ code, signal, error: null }));
    },
  );
  const match = await findForbiddenPayloadInStream(child.stdout);
  if (match) child.kill("SIGTERM");
  const result = await close;
  return { ...result, match, stderr: Buffer.concat(stderr).toString("utf8").trim() };
}

async function findForbiddenPayloadInStream(stream: AsyncIterable<Buffer>): Promise<string | null> {
  const patterns = forbiddenLayerPayloads().map((payload) => Buffer.from(payload));
  const carrySize = Math.max(...patterns.map((pattern) => pattern.length)) - 1;
  let carry = Buffer.alloc(0);
  for await (const chunk of stream) {
    const data = Buffer.concat([carry, chunk]);
    const match = patterns.find((pattern) => data.includes(pattern));
    if (match) return match.toString("utf8");
    carry = data.subarray(Math.max(0, data.length - carrySize));
  }
  return null;
}

function forbiddenLayerPayloads(): string[] {
  return [
    "smoke-access-key",
    "smoke-secret-key",
    "smoke-ssh-key",
    "pgmem://container-smoke-secret-database-url",
    "infisical-client-secret-value",
    "cloudflare-token-secret-value",
    "container-smoke-token",
    "/Users/kiltyj/Code/viberoots",
  ];
}

function normalizeLayerPath(layerPath: string): string {
  return layerPath.replace(/^\.?\//, "");
}

function escapedPattern(text: string): RegExp {
  return new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
}
