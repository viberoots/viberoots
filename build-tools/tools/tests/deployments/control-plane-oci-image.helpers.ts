#!/usr/bin/env zx-wrapper
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { runInTemp } from "../lib/test-helpers";

const execFileAsync = promisify(execFile);

export type ControlPlaneImageTarball = {
  outPath: string;
  repoTag: string;
  archiveSha256: string;
  config: any;
  layerPaths: string[];
  rootFilesystemPaths: string[];
};

export async function buildImageContract() {
  const outPath = await nixBuildOutput(".#deployment-control-plane-image-contract");
  const raw = await fsp.readFile(path.join(outPath, "contract.json"), "utf8");
  return { outPath, contract: JSON.parse(raw) as any };
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
    const forbiddenPayloadPatternPath = await writeForbiddenPayloadPatternFile(tmp);
    for (const layer of manifest.Layers) {
      const layerPath = path.join(tmp, layer);
      const { stdout } = await execFileAsync("tar", ["-tf", layerPath], {
        maxBuffer: 16 * 1024 * 1024,
      });
      for (const entry of stdout.split(/\n+/).filter(Boolean)) {
        layerPaths.push(entry);
        rootFilesystemPaths.add(normalizeLayerPath(entry));
      }
      await assertNoForbiddenLayerContents(layerPath, forbiddenPayloadPatternPath);
    }
    return {
      outPath,
      repoTag,
      archiveSha256: await sha256File(outPath),
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
  for (const prohibited of [".env", "id_rsa", "control-plane-database-url"]) {
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

async function writeForbiddenPayloadPatternFile(tmp: string): Promise<string> {
  const patternPath = path.join(tmp, "forbidden-layer-payloads.txt");
  await fsp.writeFile(patternPath, [...forbiddenLayerPayloads(), ""].join("\n"), "utf8");
  return patternPath;
}

async function assertNoForbiddenLayerContents(
  layerPath: string,
  patternPath: string,
): Promise<void> {
  const scan = await execFileAsync(
    "rg",
    ["--text", "--fixed-strings", "--line-number", "--file", patternPath, layerPath],
    {
      env: { ...process.env, LC_ALL: "C" },
      maxBuffer: 1024 * 1024,
    },
  ).catch((error: any) => error);
  assert.equal(
    Number(scan.code ?? 0),
    1,
    `image layer contains forbidden secret payload:\n${scan.stdout}`,
  );
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

async function sha256File(file: string): Promise<string> {
  const hash = createHash("sha256");
  hash.update(await fsp.readFile(file));
  return hash.digest("hex");
}

function normalizeLayerPath(layerPath: string): string {
  return layerPath.replace(/^\.?\//, "");
}

function escapedPattern(text: string): RegExp {
  return new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
}
