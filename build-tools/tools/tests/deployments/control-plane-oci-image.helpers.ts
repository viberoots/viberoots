#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { runInTemp } from "../lib/test-helpers";

const execFileAsync = promisify(execFile);

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

export async function buildImageContract() {
  const outPath = await nixBuildOutput(".#deployment-control-plane-image-contract");
  const raw = await fsp.readFile(path.join(outPath, "contract.json"), "utf8");
  return { outPath, contract: JSON.parse(raw) as any };
}

export async function buildControlPlaneRuntime(): Promise<ControlPlaneRuntime> {
  const outPath = await nixBuildOutput(".#deployment-control-plane-runtime");
  return { outPath, commandPath: path.join(outPath, "bin", "control-plane") };
}

export async function buildImageTarball(): Promise<ControlPlaneImageTarball> {
  const outPath = await nixBuildOutput(".#deployment-control-plane-image");
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
  const repoRoot = process.env.WORKSPACE_ROOT || process.cwd();
  const { stdout } = await execFileAsync("nix", ["build", attr, "--no-link", "--print-out-paths"], {
    cwd: repoRoot,
    maxBuffer: 1024 * 1024,
  });
  const outPath = stdout.trim().split(/\s+/).at(-1) || "";
  assert.ok(outPath, "nix build did not return an output path");
  return outPath;
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
