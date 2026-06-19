import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { repoRoot, resolveWorkspaceRootsSync } from "../lib/repo";

const OPENTOFU_SOURCE_DIR = "build-tools/deployments/aws-control-plane-foundation/opentofu";
export const OPENTOFU_BUNDLE_DIR = "opentofu/aws-control-plane-foundation";

export function renderOpenTofuStackFiles(): Record<string, string> {
  return renderOpenTofuSourceFiles(OPENTOFU_SOURCE_DIR, OPENTOFU_BUNDLE_DIR);
}

export function renderOpenTofuSourceFiles(
  sourceDir: string,
  bundleDir: string,
): Record<string, string> {
  return Object.fromEntries(
    opentofuSourceFilenames(sourceDir).map((name) => [
      `${bundleDir}/${name}`,
      readFileSync(path.join(opentofuSourceDirPath(sourceDir), name), "utf8"),
    ]),
  );
}

export function opentofuStackInputs(): string[] {
  return opentofuSourceInputs(OPENTOFU_SOURCE_DIR, OPENTOFU_BUNDLE_DIR);
}

export function opentofuSourceInputs(sourceDir: string, bundleDir: string): string[] {
  return opentofuSourceFilenames(sourceDir).map((name) => `$PROFILE_ROOT/${bundleDir}/${name}`);
}

function opentofuSourceFilenames(sourceDir: string): string[] {
  return readdirSync(opentofuSourceDirPath(sourceDir))
    .filter((name) => name.endsWith(".tf") || name.endsWith(".hcl.example"))
    .sort();
}

function opentofuSourceDirPath(sourceDir: string): string {
  if (path.isAbsolute(sourceDir)) return sourceDir;
  const workspaceRoot = repoRoot();
  const viberootsRoot = resolveWorkspaceRootsSync({ start: workspaceRoot }).viberootsRoot;
  return path.join(viberootsRoot, sourceDir);
}
