import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { isNixStorePath, resolveToolPathSync } from "../../lib/tool-paths";

function optionalToolPath(tool: string): string | undefined {
  try {
    return resolveToolPathSync(tool);
  } catch {
    return undefined;
  }
}

function canonicalArtifactToolPath(artifactToolsRoot: string, tool: string): string {
  const candidate = path.join(artifactToolsRoot, "bin", tool);
  try {
    fs.accessSync(candidate, fs.constants.X_OK);
    const resolved = fs.realpathSync.native(candidate);
    if (!isNixStorePath(candidate) || !isNixStorePath(resolved)) throw new Error("not store-owned");
  } catch (error) {
    throw new Error(
      `canonical artifact tool authority is missing store-backed ${tool}: ${candidate}; run u && i`,
      { cause: error },
    );
  }
  return candidate;
}

export function localVerifyToolPaths(
  artifactToolsRoot: string,
): Record<string, string | undefined> {
  return {
    NIX_BIN: process.env.VBR_NIX_BIN || process.env.NIX_BIN || optionalToolPath("nix"),
    PATCH_BIN: canonicalArtifactToolPath(artifactToolsRoot, "patch"),
    GIT_BIN: canonicalArtifactToolPath(artifactToolsRoot, "git"),
    OPENSSL_BIN: canonicalArtifactToolPath(artifactToolsRoot, "openssl"),
    GZIP_BIN: canonicalArtifactToolPath(artifactToolsRoot, "gzip"),
    OTOOL_BIN:
      process.platform === "darwin" ? process.env.OTOOL_BIN || "/usr/bin/otool" : undefined,
  };
}

export function resolveNixDirenvDirenvrc(): string | undefined {
  const profiles = String(process.env.NIX_PROFILES || "")
    .split(/\s+/u)
    .filter(Boolean);
  const homes = [process.env.BUCK2_REAL_HOME, process.env.HOME].filter(Boolean) as string[];
  const candidates = [
    String(process.env.VBR_NIX_DIRENV_DIRENVRC || "").trim(),
    ...profiles.map((profile) => path.join(profile, "share", "nix-direnv", "direnvrc")),
    ...homes.map((home) => path.join(home, ".nix-profile", "share", "nix-direnv", "direnvrc")),
    "/nix/var/nix/profiles/default/share/nix-direnv/direnvrc",
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      const resolved = fs.realpathSync.native(candidate);
      if (/^\/nix\/store\/[^/]+-nix-direnv-[^/]+\/share\/nix-direnv\/direnvrc$/u.test(resolved)) {
        return resolved;
      }
    } catch {}
  }
  return undefined;
}
